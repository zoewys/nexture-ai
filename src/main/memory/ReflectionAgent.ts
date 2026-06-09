import type {
  AgentDefinition,
  AgentEvent,
  MemoryCategory,
  MemoryEntry,
  MemoryScope,
  MemorySignal,
  ReflectionResult,
  RunConfig
} from '@shared/types'
import type { RunManager } from '../RunManager'
import type { MemoryStore } from './MemoryStore'

type ReflectionRunManager = Pick<RunManager, 'start'>
type ReflectionMemoryStore = Pick<
  MemoryStore,
  'getReflectionConfig' | 'getReflectionCwd'
>

const MIN_CONFIDENCE = 0.6
const VALID_CATEGORIES: MemoryCategory[] = ['method', 'knowledge', 'preference', 'avoidance']
const VALID_SCOPES: MemoryScope[] = ['global', 'project']

export class ReflectionParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReflectionParseError'
  }
}

export class ReflectionRunError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReflectionRunError'
  }
}

export class ReflectionAgent {
  constructor(
    private readonly runManager: ReflectionRunManager,
    private readonly memoryStore: ReflectionMemoryStore
  ) {}

  /**
   * Reflect on one learning signal and return high-confidence memories.
   * Parse failures are retried once; repeated parse failures are rethrown so
   * callers can keep the source signal for a later retry.
   */
  async reflect(
    signal: MemorySignal,
    agentDefinition: AgentDefinition,
    existingMemories: MemoryEntry[]
  ): Promise<ReflectionResult[]> {
    const reflectionConfig = this.memoryStore.getReflectionConfig()
    if (!reflectionConfig.enabled) return []

    const prompt = buildReflectionPrompt(signal, agentDefinition, existingMemories)
    let lastParseError: ReflectionParseError | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const events = await this.runReflectionTurn({
        vendor: reflectionConfig.vendor,
        model: reflectionConfig.model,
        cwd: this.memoryStore.getReflectionCwd(),
        prompt,
        permissionMode: 'default'
      })

      try {
        return parseReflectionResults(events)
      } catch (err) {
        if (!(err instanceof ReflectionParseError)) throw err
        lastParseError = err
      }
    }

    throw lastParseError ?? new ReflectionParseError('Reflection output could not be parsed')
  }

  private runReflectionTurn(config: RunConfig): Promise<AgentEvent[]> {
    const events: AgentEvent[] = []

    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }

      try {
        this.runManager.start(config, (_runId, event) => {
          events.push(event)

          if (event.kind === 'error' && !event.recoverable) {
            settle(() => reject(new ReflectionRunError(event.message)))
            return
          }

          if (event.kind === 'turn-done') {
            if (event.reason === 'complete') {
              settle(() => resolve(events))
            } else {
              settle(() => reject(new ReflectionRunError(`Reflection run ${event.reason}`)))
            }
          }
        })
      } catch (err) {
        settle(() => reject(new ReflectionRunError(err instanceof Error ? err.message : String(err))))
      }
    })
  }
}

export function buildReflectionPrompt(
  signal: MemorySignal,
  agent: AgentDefinition,
  existingMemories: MemoryEntry[]
): string {
  return [
    '你是一个 agent 经验提取器。分析以下 agent 运行记录，提取值得记住的经验，帮助这个 agent 在未来类似任务中表现更好。',
    '',
    '## Agent 角色定义',
    `名称: ${agent.name}`,
    `角色: ${agent.role}`,
    'System Prompt:',
    agent.systemPrompt || '（无）',
    '',
    '## 本次运行信号',
    `信号类型: ${signal.type} (来源: ${signal.source})`,
    signalGuidance(signal),
    '',
    '## 项目路径',
    signal.projectPath,
    '',
    '## 运行 Transcript (已精简)',
    signal.transcript,
    '',
    '## 已有记忆（避免重复提取相同经验）',
    formatExistingMemories(existingMemories),
    '',
    '## 输出要求',
    '',
    '请提取 0-3 条值得记住的经验。宁缺毋滥——只提取真正有指导价值、且尚未被已有记忆覆盖的内容。',
    '',
    '每条经验必须包含:',
    '- category: 必须是以下之一',
    '  - "method"     方法论 (如何做某事)',
    '  - "knowledge"  领域知识 (项目/技术相关事实)',
    '  - "preference" 用户偏好 (用户喜欢/不喜欢什么)',
    '  - "avoidance"  应避免的做法',
    '- scope: 必须是以下之一',
    '  - "global"     跨项目通用 (如方法论、通用规则)',
    '  - "project"    仅限当前项目 (如项目特定技术栈、特定要求)',
    '- content: 一句话描述这条经验，必须是具体的、可操作的、面向未来 agent 行为的指导语',
    '- confidence: 你对这条经验正确性的信心，0 到 1 的浮点数',
    '',
    '不要提取:',
    '- 与已有记忆重复的内容',
    '- 过于笼统的废话 (如 "要认真做事")',
    '- 一次性的偶然事件 (没有可推广价值)',
    '- confidence 低于 0.6 的不确定经验',
    '',
    '## 输出格式',
    '',
    '严格输出 JSON 数组，不要任何额外文字、解释或 markdown 代码块包裹：',
    '',
    '[',
    '  {"category": "method", "scope": "global", "content": "...", "confidence": 0.85},',
    '  {"category": "avoidance", "scope": "project", "content": "...", "confidence": 0.75}',
    ']',
    '',
    '如果没有值得记的经验，输出空数组: []'
  ].join('\n')
}

export function parseReflectionResults(events: AgentEvent[]): ReflectionResult[] {
  const text = [...events]
    .reverse()
    .find((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message')
    ?.text
  if (!text) throw new ReflectionParseError('Reflection run produced no assistant message')

  const candidates = [
    text,
    ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1])
  ]

  for (const candidate of candidates) {
    const json = extractJsonArray(candidate)
    if (!json) continue
    try {
      const parsed = JSON.parse(json) as unknown
      if (!Array.isArray(parsed)) continue
      return parsed
        .map(normalizeReflectionResult)
        .filter((result): result is ReflectionResult => {
          return result !== null && result.confidence >= MIN_CONFIDENCE
        })
        .slice(0, 3)
    } catch {
      // Try the next candidate.
    }
  }

  throw new ReflectionParseError('Reflection output is not valid JSON array')
}

function signalGuidance(signal: MemorySignal): string {
  switch (signal.type) {
    case 'positive':
      return '说明: 用户确认了这次输出，说明 agent 这次做得对。从 transcript 中提取「什么做法导致了成功」。'
    case 'negative':
      return [
        '说明: 用户重跑了这一步，说明上次输出不够好。分析「哪里做得不够好」、「下次应该怎么改进」。',
        signal.userAction ? `用户的修复指令: ${signal.userAction}` : ''
      ].filter(Boolean).join('\n')
    case 'format-error':
      return [
        '说明: 这次输出无法解析为合法 handoff JSON，提取「应避免的输出格式问题」。',
        signal.error ? `错误: ${signal.error}` : ''
      ].filter(Boolean).join('\n')
    case 'completion':
      return '说明: 整个 workflow 顺利完成，提取「全流程中可推广的最佳实践」。'
  }
}

function formatExistingMemories(existingMemories: MemoryEntry[]): string {
  if (existingMemories.length === 0) return '（无）'
  return existingMemories.map((memory) => `- [${memory.category}] ${memory.content}`).join('\n')
}

function normalizeReflectionResult(value: unknown): ReflectionResult | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as Partial<ReflectionResult>
  if (!isMemoryCategory(candidate.category)) return null
  if (!isMemoryScope(candidate.scope)) return null
  if (typeof candidate.content !== 'string' || candidate.content.trim().length === 0) return null
  if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence)) return null
  return {
    category: candidate.category,
    scope: candidate.scope,
    content: candidate.content.trim(),
    confidence: Math.max(0, Math.min(1, candidate.confidence))
  }
}

function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as MemoryCategory)
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && VALID_SCOPES.includes(value as MemoryScope)
}

function extractJsonArray(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null
}
