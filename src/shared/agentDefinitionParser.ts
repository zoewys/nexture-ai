/**
 * agentDefinitionParser.ts — 从助手 agent 的文本输出里提取"新建 agent 定义"。
 *
 * 内置"使用助手"在确认需求后，会输出一个带 `nexture_create_agent` 标记的 JSON
 * 对象。本模块负责把这段 JSON 从助手回复（含代码块、混杂自然语言）里稳健地
 * 扫描出来，并校验为一份可写入 agents.json 的 agent 草稿。
 *
 * 扫描思路复刻自 src/main/handoffParser.ts：先用正则取整段文本 + 所有代码块
 * 内容，再在每个来源里用平衡括号扫描提取所有 {...}，逐个 JSON.parse，命中
 * marker 键且通过校验即返回。不写"修复非法 JSON"的逻辑——handoffParser 的
 * 实践证明流式拼接后整段 parse 成功率足够。
 */
import type { AgentDefinition, AgentVendor, PermissionMode } from './types'

// 本地定义枚举常量，运行时不 import 任何值（只保留 import type），
// 这样 node 可直接 import 本 .ts 跑测试 —— 与 src/main/handoffParser.ts 的自包含模式一致。
// 如有变动需与 src/shared/types.ts 的 PERMISSION_MODES / AgentVendor 保持同步。
const ALL_VENDORS: AgentVendor[] = ['claude', 'codex', 'api']
const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan'
]

/** 助手输出中表示"要新建一个 agent"的 JSON 键名。 */
export const AGENT_CREATE_MARKER = 'nexture_create_agent'

/** 解析产物：不含系统生成的 id / builtin 字段的 agent 草稿。 */
export type AgentDraftPayload = Omit<AgentDefinition, 'id' | 'builtin' | 'builtinVersion'>

/**
 * 从文本里提取第一个带 `markerKey` 标记且通过 `validate` 的对象。
 * 抽象成通用形式，便于将来扩展 `nexture_create_workflow` 等标记复用同一管线。
 */
export function parseTaggedPayload<T>(
  text: string,
  markerKey: string,
  validate: (raw: unknown) => T | null
): T | null {
  const sources = [
    text,
    ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1])
  ]
  for (const source of sources) {
    for (const json of extractJsonObjects(source)) {
      try {
        const parsed = JSON.parse(json) as Record<string, unknown>
        const payload = parsed[markerKey]
        if (payload === undefined || payload === null) continue
        const result = validate(payload)
        if (result) return result
      } catch {
        // 非合法 JSON 或形状不对 —— 尝试下一个候选对象
      }
    }
  }
  return null
}

/** 从助手文本里解析出一份 agent 草稿；未命中标记或校验失败返回 null。 */
export function parseAgentDraftFromText(text: string): AgentDraftPayload | null {
  return parseTaggedPayload(text, AGENT_CREATE_MARKER, validateAgentDraft)
}

function validateAgentDraft(raw: unknown): AgentDraftPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const role = typeof obj.role === 'string' ? obj.role.trim() : ''
  const systemPrompt = typeof obj.systemPrompt === 'string' ? obj.systemPrompt.trim() : ''
  if (!name || !role || !systemPrompt) return null
  if (isPlaceholderText(name) || isPlaceholderText(role) || isPlaceholderText(systemPrompt)) {
    return null
  }

  const vendor: AgentVendor = ALL_VENDORS.includes(obj.vendor as AgentVendor)
    ? (obj.vendor as AgentVendor)
    : 'claude'

  const permissionMode: PermissionMode | undefined =
    obj.permissionMode === undefined || obj.permissionMode === null
      ? undefined
      : PERMISSION_MODES.includes(obj.permissionMode as PermissionMode)
        ? (obj.permissionMode as PermissionMode)
        : undefined

  const model =
    typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : undefined

  return { name, role, vendor, model, systemPrompt, permissionMode }
}

// ── JSON 扫描辅助（复刻自 handoffParser.ts）──────────────────────────────────

/** 取出文本里所有顶层平衡的 {...} 片段，去重。 */
function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  const seen = new Set<string>()

  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const end = findBalancedObjectEnd(text, start)
    if (end < 0) continue
    const candidate = text.slice(start, end + 1).trim()
    if (!seen.has(candidate)) {
      seen.add(candidate)
      objects.push(candidate)
    }
  }
  return objects
}

/** 从 start 处的 `{` 找到配对的 `}`，正确处理字符串与转义。未闭合返回 -1。 */
function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 识别占位符文本（"..." / <xxx> / 模板说明），过滤掉模型套模板的空输出。 */
function isPlaceholderText(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return (
    normalized === '...' ||
    /^<[^>]+>$/.test(normalized) ||
    normalized.includes('<one-paragraph') ||
    normalized.includes('<relative file path') ||
    normalized.includes('<optional:')
  )
}
