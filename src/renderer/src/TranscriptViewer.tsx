/**
 * TranscriptViewer.tsx — Agent 输出流实时渲染器
 *
 * 将 AgentEvent[] 流转换为可视化的分块展示：
 *  - message 块：Markdown 渲染的 assistant 回复
 *  - thinking 块：可折叠的思考过程
 *  - tool-call / tool-result 块：工具调用卡片（按类别着色：read/write/exec/search/task）
 *  - stderr / error / system 块：诊断信息
 *  - StatusBar：顶部实时活动指示器（streaming / thinking / tool-running）
 *
 * 支持自动滚动跟随和手动滚动锁定。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Check,
  CheckCheck,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleX,
  FileMinus2,
  FilePenLine,
  FilePlus2,
  ListTodo,
  LockKeyhole,
  PencilLine,
  Search,
  SquareTerminal,
  X,
  type LucideIcon
} from 'lucide-react'
import type { AgentEvent } from '@shared/types'
import { isNearTranscriptBottom, shouldAutoFollowTranscriptEvent } from './transcriptScroll'

// ── markdown → HTML ──────────────────────────────────────────────────────

function parseMarkdown(text: string): string {
  // Phase 1: extract fenced code blocks so their content isn't processed
  const fences: string[] = []
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = fences.length
    fences.push(
      `<pre><code class="${esc(lang)}">${esc(code.replace(/\n$/, ''))}</code></pre>`
    )
    return `\x00FENCE${i}\x00`
  })

  // Phase 2: inline code (protect from further processing)
  const inlines: string[] = []
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const i = inlines.length
    inlines.push(`<code>${esc(code)}</code>`)
    return `\x00INLINE${i}\x00`
  })

  // Phase 3: block-level elements
  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Unordered lists (lines starting with - or *)
  html = html.replace(/((?:^[-*] .+\n?)+)/gm, (block: string) => {
    const items = block
      .split('\n')
      .filter((line) => /^[-*] /.test(line))
      .map((line) => `<li>${line.slice(2)}</li>`)
      .join('')
    return `<ul>${items}</ul>`
  })

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block: string) => {
    const items = block
      .split('\n')
      .filter((line) => /^\d+\. /.test(line))
      .map((line) => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('')
    return `<ol>${items}</ol>`
  })

  // Phase 4: restore inline code
  html = html.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlines[Number(i)]!)

  // Phase 5: restore fenced code blocks
  html = html.replace(/\x00FENCE(\d+)\x00/g, (_, i) => fences[Number(i)]!)

  // Phase 6: line breaks (double newline → paragraph, single → <br>)
  html = html
    .split(/\n\n+/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      // Don't wrap block elements in <p>
      if (/^<(h[1-6]|ul|ol|pre|blockquote|table)/.test(para)) return para
      return `<p>${para.replace(/\n/g, '<br>')}</p>`
    })
    .join('\n')

  return html
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

type ToolCategory = 'read' | 'write' | 'exec' | 'search' | 'task' | 'other'

function categorize(name: string): ToolCategory {
  const n = name.toLowerCase()
  if (/^(read|view|cat|list|ls|show)/.test(n)) return 'read'
  if (/^(write|edit|create|update|delete|remove|rm|mv|cp|replace|patch)/.test(n)) return 'write'
  if (/^(bash|exec|run|spawn|shell|command)/.test(n)) return 'exec'
  if (/^(grep|find|glob|search|query|lookup)/.test(n)) return 'search'
  if (/^(task|agent|todo|plan|skill|workflow)/.test(n)) return 'task'
  return 'other'
}

const CAT_ICON: Record<ToolCategory, LucideIcon> = {
  read: BookOpen,
  write: PencilLine,
  exec: SquareTerminal,
  search: Search,
  task: ListTodo,
  other: Circle
}

function toolTarget(input: unknown): string {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : null
  if (!obj) return ''
  return (
    (obj.file_path as string) ??
    (obj.path as string) ??
    (obj.command as string) ??
    (obj.pattern as string) ??
    (obj.query as string) ??
    ''
  )
}

function brief(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v
  if (v && typeof v === 'object') {
    try { return JSON.stringify(v, null, 2) } catch { return null }
  }
  return null
}

function resultSummary(output: unknown): string {
  if (typeof output === 'string') {
    return output.length > 120 ? output.slice(0, 120) + '…' : output
  }
  const obj = output && typeof output === 'object' ? (output as Record<string, unknown>) : null
  if (obj?.lines !== undefined) return `${obj.lines} lines`
  if (obj?.count !== undefined) return `${obj.count} results`
  return ''
}

function ToolCategoryIcon({ category, className }: { category: ToolCategory; className: string }): JSX.Element {
  const Icon = CAT_ICON[category]
  return <Icon size={14} className={className} aria-hidden="true" />
}

function FileChangeIcon({ op }: { op: Extract<AgentEvent, { kind: 'file-changed' }>['op'] }): JSX.Element {
  const Icon = op === 'create' ? FilePlus2 : op === 'delete' ? FileMinus2 : FilePenLine
  return <Icon size={13} className="cli-file-icon" aria-hidden="true" />
}

// ── activity detection ───────────────────────────────────────────────────

type Activity =
  | { kind: 'idle' }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool-running'; id: string; name: string; input: unknown }
  | { kind: 'tool-done'; id: string; name: string; input: unknown; ok: boolean; output: unknown }
  | { kind: 'streaming' }
  | { kind: 'error'; message: string }

function detectActivity(events: AgentEvent[]): Activity {
  if (events.length === 0) return { kind: 'idle' }

  // Build a set of tool-call ids that have been resolved.
  const resolved = new Set<string>()
  for (const ev of events) {
    if (ev.kind === 'tool-result') resolved.add(ev.id)
  }

  // Walk backwards to find the most recent meaningful event.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    switch (ev.kind) {
      case 'tool-result': {
        // Find the matching tool-call to label the result.
        const call = events.find(
          (e): e is Extract<AgentEvent, { kind: 'tool-call' }> =>
            e.kind === 'tool-call' && e.id === ev.id
        )
        return {
          kind: 'tool-done',
          id: ev.id,
          name: call?.name ?? 'unknown',
          input: call?.input ?? {},
          ok: ev.ok,
          output: ev.output
        }
      }
      case 'tool-call':
        if (!resolved.has(ev.id)) {
          return { kind: 'tool-running', id: ev.id, name: ev.name, input: ev.input }
        }
        break
      case 'thinking':
        return { kind: 'thinking', text: ev.text }
      case 'message-delta':
        return { kind: 'streaming' }
      case 'error':
        return { kind: 'error', message: ev.message }
      case 'message':
        // A completed message means the turn is done producing text.
        continue
    }
  }

  return { kind: 'idle' }
}

// ── block grouping ───────────────────────────────────────────────────────

type Block =
  | { kind: 'meta'; event: AgentEvent }
  | { kind: 'message'; text: string; role: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; ok: boolean; output: unknown }
  | { kind: 'stderr'; text: string }

type ChatBlock =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; text: string }
  | { kind: 'todo'; output: unknown; ok: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'permission'; request: PermissionRequestPayload }

type PermissionStatus = 'pending' | 'allowed' | 'denied'

interface PermissionRequestPayload {
  type: 'permission-request'
  requestId: string
  toolName: string
  description: string
}

function groupEvents(events: AgentEvent[]): Block[] {
  const blocks: Block[] = []
  let pending = ''

  const flush = () => {
    if (pending) {
      blocks.push({ kind: 'message', text: pending, role: 'assistant' })
      pending = ''
    }
  }

  for (const ev of events) {
    switch (ev.kind) {
      case 'message-delta':
        pending += ev.text
        break
      case 'message':
        if (pending) {
          if (ev.text.startsWith(pending)) {
            pending = ''
          } else {
            flush()
          }
        }
        blocks.push({ kind: 'message', text: ev.text, role: ev.role })
        break
      case 'thinking':
        flush()
        blocks.push({ kind: 'thinking', text: ev.text })
        break
      case 'tool-call':
        flush()
        blocks.push({ kind: 'tool', id: ev.id, name: ev.name, input: ev.input })
        break
      case 'tool-result':
        blocks.push({ kind: 'tool-result', id: ev.id, ok: ev.ok, output: ev.output })
        break
      case 'stderr':
        flush()
        blocks.push({ kind: 'stderr', text: ev.text })
        break
      case 'error':
        flush()
        blocks.push({ kind: 'meta', event: ev })
        break
      case 'session-started':
      case 'usage':
      case 'turn-done':
      case 'file-changed':
      case 'system':
        blocks.push({ kind: 'meta', event: ev })
        break
    }
  }
  flush()
  return blocks
}

function groupChatEvents(events: AgentEvent[]): ChatBlock[] {
  const blocks: ChatBlock[] = []
  let pendingAssistant = ''
  const toolNames = new Map<string, string>()

  const flushAssistant = () => {
    if (!pendingAssistant) return
    blocks.push({ kind: 'message', role: 'assistant', text: pendingAssistant })
    pendingAssistant = ''
  }

  for (const ev of events) {
    switch (ev.kind) {
      case 'message-delta':
        pendingAssistant += ev.text
        break
      case 'message':
        if (pendingAssistant) {
          if (ev.text.startsWith(pendingAssistant)) {
            pendingAssistant = ''
          } else {
            flushAssistant()
          }
        }
        blocks.push({ kind: 'message', role: 'assistant', text: ev.text })
        break
      case 'system': {
        const permissionRequest = parsePermissionRequest(ev.text)
        if (permissionRequest) {
          flushAssistant()
          blocks.push({ kind: 'permission', request: permissionRequest })
        } else if (ev.text.startsWith('↳')) {
          flushAssistant()
          blocks.push({ kind: 'message', role: 'user', text: ev.text.replace(/^↳\s*/, '') })
        } else if (!ev.text.startsWith('Injected ')) {
          flushAssistant()
          blocks.push({ kind: 'system', text: ev.text })
        }
        break
      }
      case 'thinking':
        flushAssistant()
        blocks.push({ kind: 'thinking', text: ev.text })
        break
      case 'tool-call': {
        flushAssistant()
        toolNames.set(ev.id, ev.name)
        const target = toolTarget(ev.input)
        blocks.push({ kind: 'tool', text: target ? `${ev.name} · ${target}` : ev.name })
        break
      }
      case 'tool-result': {
        flushAssistant()
        if (toolNames.get(ev.id) === 'todo_write') {
          blocks.push({ kind: 'todo', output: ev.output, ok: ev.ok })
          break
        }
        const summary = resultSummary(ev.output)
        blocks.push({ kind: 'tool', text: ev.ok ? `Done${summary ? ` · ${summary}` : ''}` : `Failed${summary ? ` · ${summary}` : ''}` })
        break
      }
      case 'stderr':
        flushAssistant()
        blocks.push({ kind: 'system', text: ev.text })
        break
      case 'error':
        flushAssistant()
        blocks.push({ kind: 'error', message: ev.message })
        break
      case 'file-changed':
        flushAssistant()
        blocks.push({ kind: 'system', text: `${ev.op}: ${ev.path}` })
        break
      case 'session-started':
      case 'usage':
      case 'turn-done':
        break
    }
  }

  flushAssistant()
  return blocks
}

// ── status bar ───────────────────────────────────────────────────────────

function StatusBar({ activity }: { activity: Activity }): JSX.Element | null {
  switch (activity.kind) {
    case 'idle':
      return null

    case 'streaming':
      return (
        <div className="status-bar">
          <span className="status-dot status-dot-stream" />
          <span>Streaming</span>
        </div>
      )

    case 'thinking':
      return (
        <div className="status-bar status-bar-think">
          <span className="status-dot status-dot-think" />
          <span>Thinking</span>
          <span className="status-hint">
            {activity.text.length > 80 ? activity.text.slice(0, 80) + '…' : activity.text}
          </span>
        </div>
      )

    case 'tool-running': {
      const cat = categorize(activity.name)
      const target = toolTarget(activity.input)
      return (
        <div className={`status-bar status-bar-tool status-bar-${cat}`}>
          <span className="status-dot status-dot-tool" />
          <ToolCategoryIcon category={cat} className="status-icon" />
          <span className="status-tool-name">{activity.name}</span>
          {target ? <span className="status-tool-target">{target}</span> : null}
        </div>
      )
    }

    case 'tool-done': {
      const cat = categorize(activity.name)
      const target = toolTarget(activity.input)
      const summary = resultSummary(activity.output)
      return (
        <div className={`status-bar status-bar-result ${activity.ok ? '' : 'status-bar-err'}`}>
          {activity.ok
            ? <CircleCheck size={13} className="status-marker status-marker-ok" aria-hidden="true" />
            : <CircleX size={13} className="status-marker status-marker-error" aria-hidden="true" />}
          <ToolCategoryIcon category={cat} className="status-icon" />
          <span className="status-tool-name">{activity.name}</span>
          {target ? <span className="status-tool-target">{target}</span> : null}
          {summary ? <> &middot; {summary}</> : null}
        </div>
      )
    }

    case 'error':
      return (
        <div className="status-bar status-bar-err">
          <CircleAlert size={13} className="status-marker status-marker-error" aria-hidden="true" />
          <span>{activity.message}</span>
        </div>
      )

    default:
      return null
  }
}

// ── block renderer ───────────────────────────────────────────────────────

function BlockView({
  block,
  permissionStatuses,
  respondPermission,
  allowAllPermissions
}: {
  block: Block
  permissionStatuses: Map<string, PermissionStatus>
  respondPermission: (requestId: string, allowed: boolean) => void
  allowAllPermissions: (requestId: string) => void
}): JSX.Element | null {
  const [thinkExp, setThinkExp] = useState(false)

  switch (block.kind) {
    case 'message': {
      const md = parseMarkdown(block.text)
      return <div className="cli-msg" dangerouslySetInnerHTML={{ __html: md }} />
    }

    case 'thinking': {
      const maxPreview = 300
      const collapsed = !thinkExp
      const previewText = block.text.slice(0, maxPreview)
      const needsTruncation = block.text.length > maxPreview
      const displayText = collapsed ? previewText + (needsTruncation ? '…' : '') : block.text
      return (
        <div className="cli-think">
          <div
            className="cli-think-head cli-clickable"
            onClick={() => setThinkExp((v) => !v)}
            role="button"
            tabIndex={0}
          >
            <span className="cli-think-dot" />
            Thinking
            <span className="cli-think-toggle">
              {thinkExp ? <><ChevronUp size={13} /> Collapse</> : <><ChevronDown size={13} /> {needsTruncation ? 'Expand' : 'Show'}</>}
            </span>
          </div>
          <pre className="cli-think-body">{displayText}</pre>
        </div>
      )
    }

    case 'tool': {
      const cat = categorize(block.name)
      const target = toolTarget(block.input)
      const detail = brief(block.input)
      return (
        <div className={`cli-tool cli-tool-${cat}`}>
          <div className="cli-tool-head">
            <ToolCategoryIcon category={cat} className="cli-tool-icon" />
            <span className="cli-tool-name">{block.name}</span>
            {target ? <span className="cli-tool-target">{target}</span> : null}
          </div>
          {detail && (
            <details className="cli-tool-detail">
              <summary>Args</summary>
              <pre>{detail}</pre>
            </details>
          )}
        </div>
      )
    }

    case 'tool-result': {
      const summary = resultSummary(block.output)
      const errDetail = block.ok ? null : brief(block.output)
      return (
        <div className={`cli-result ${block.ok ? '' : 'cli-result-err'}`}>
          {block.ok
            ? <CircleCheck size={12} className="cli-result-marker" aria-hidden="true" />
            : <CircleX size={12} className="cli-result-marker" aria-hidden="true" />}
          <span className="cli-result-status">
            {block.ok ? 'Done' : 'Failed'}
            {summary ? <> &middot; {summary}</> : null}
          </span>
          {errDetail && (
            <details className="cli-result-detail">
              <summary>Error details</summary>
              <pre>{errDetail}</pre>
            </details>
          )}
        </div>
      )
    }

    case 'stderr':
      return <div className="cli-stderr">{block.text}</div>

    case 'meta': {
      const ev = block.event
      switch (ev.kind) {
        case 'error':
          return (
            <div className="cli-err">
              <CircleAlert size={14} className="cli-err-icon" aria-hidden="true" /> {ev.message}
            </div>
          )
        case 'turn-done':
          return (
            <div className="cli-rule">
              <span>{turnReason(ev.reason)}</span>
            </div>
          )
        case 'usage':
        case 'session-started':
          return null
        case 'file-changed':
          return (
            <div className="cli-file">
              <FileChangeIcon op={ev.op} />
              <span>{ev.path}</span>
            </div>
          )
        case 'system':
          const permissionRequest = parsePermissionRequest(ev.text)
          if (permissionRequest) {
            return (
              <PermissionRequestBlock
                request={permissionRequest}
                status={permissionStatuses.get(permissionRequest.requestId) ?? 'pending'}
                respondPermission={respondPermission}
                allowAllPermissions={allowAllPermissions}
              />
            )
          }
          return ev.text.includes('↳') ? (
            <div className="cli-user-input" data-text={ev.text.replace(/^↳\s*/, '')} />
          ) : (
            <div className="cli-meta-line">{ev.text}</div>
          )
        default:
          return null
      }
    }

    default:
      return null
  }
}

function PermissionRequestBlock({
  request,
  status,
  respondPermission,
  allowAllPermissions
}: {
  request: PermissionRequestPayload
  status: PermissionStatus
  respondPermission: (requestId: string, allowed: boolean) => void
  allowAllPermissions: (requestId: string) => void
}): JSX.Element {
  const resolved = status !== 'pending'
  return (
    <div className={`perm-block ${resolved ? 'perm-block-resolved' : 'perm-block-pending'}`}>
      <div className="perm-header">
        <LockKeyhole size={14} className="perm-icon" />
        <span className={`perm-title ${resolved ? 'perm-title-resolved' : 'perm-title-pending'}`}>权限请求</span>
        {resolved && (
          <span className={`perm-badge ${status === 'allowed' ? 'perm-badge-allowed' : 'perm-badge-denied'}`}>
            {status === 'allowed' ? '已允许' : '已拒绝'}
          </span>
        )}
      </div>
      <div className="perm-tool">{request.toolName} 请求执行</div>
      <div className="perm-cmd">{request.description}</div>
      {!resolved && (
        <div className="perm-btns">
          <button className="pf-btn success" type="button" onClick={() => respondPermission(request.requestId, true)}>
            <Check size={13} /> 允许
          </button>
          <button className="pf-btn pf-btn-danger" type="button" onClick={() => respondPermission(request.requestId, false)}>
            <X size={13} /> 拒绝
          </button>
          <button className="pf-btn" type="button" onClick={() => allowAllPermissions(request.requestId)}>
            <CheckCheck size={13} /> 本次全部允许
          </button>
        </div>
      )}
    </div>
  )
}

function parsePermissionRequest(text: string): PermissionRequestPayload | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Record<string, unknown>
    if (value.type !== 'permission-request') return null
    if (typeof value.requestId !== 'string' || typeof value.toolName !== 'string' || typeof value.description !== 'string') return null
    return {
      type: 'permission-request',
      requestId: value.requestId,
      toolName: value.toolName,
      description: value.description
    }
  } catch {
    return null
  }
}

function turnReason(reason: string): string {
  switch (reason) {
    case 'complete':
      return 'Turn complete'
    case 'error':
      return 'Turn error'
    case 'aborted':
      return 'Aborted'
    default:
      return reason
  }
}

function ChatTranscript({ events }: { events: AgentEvent[] }): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const shouldFollowOutputRef = useRef(true)
  const [permissionStatuses, setPermissionStatuses] = useState<Map<string, PermissionStatus>>(() => new Map())
  const [allowAllForRun, setAllowAllForRun] = useState(false)
  const blocks = useMemo(() => groupChatEvents(events), [events])

  const respondPermission = useCallback((requestId: string, allowed: boolean): void => {
    setPermissionStatuses((prev) => {
      const next = new Map(prev)
      next.set(requestId, allowed ? 'allowed' : 'denied')
      return next
    })
    void window.api.respondPermission(requestId, allowed)
  }, [])

  const allowAllPermissions = useCallback((requestId: string): void => {
    setAllowAllForRun(true)
    respondPermission(requestId, true)
  }, [respondPermission])

  useEffect(() => {
    shouldFollowOutputRef.current = shouldAutoFollowTranscriptEvent(
      shouldFollowOutputRef.current,
      events.at(-1),
      events.length
    )
    if (!shouldFollowOutputRef.current) return
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [events.length])

  useEffect(() => {
    if (!allowAllForRun) return
    for (const event of events) {
      if (event.kind !== 'system') continue
      const request = parsePermissionRequest(event.text)
      if (!request || permissionStatuses.has(request.requestId)) continue
      respondPermission(request.requestId, true)
    }
  }, [allowAllForRun, events, permissionStatuses, respondPermission])

  const updateAutoFollow = (): void => {
    const scroller = scrollerRef.current
    if (!scroller) return
    shouldFollowOutputRef.current = isNearTranscriptBottom(scroller)
  }

  if (blocks.length === 0) {
    return <div className="transcript-empty transcript-chat-empty">No messages yet.</div>
  }

  return (
    <div className="transcript transcript-chat" ref={scrollerRef} onScroll={updateAutoFollow}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'message': {
            return (
              <div key={index} className={`chat-row chat-row-${block.role}`}>
                {block.role === 'user' ? (
                  <div className="chat-bubble chat-bubble-user">{block.text}</div>
                ) : (
                  <div className="chat-bubble chat-bubble-assistant" dangerouslySetInnerHTML={{ __html: parseMarkdown(block.text) }} />
                )}
              </div>
            )
          }
          case 'permission':
            return (
              <div key={index} className="chat-row chat-row-assistant">
                <PermissionRequestBlock
                  request={block.request}
                  status={permissionStatuses.get(block.request.requestId) ?? 'pending'}
                  respondPermission={respondPermission}
                  allowAllPermissions={allowAllPermissions}
                />
              </div>
            )
          case 'thinking':
            return (
              <details key={index} className="chat-system chat-thinking">
                <summary>Thinking</summary>
                <pre>{block.text}</pre>
              </details>
            )
          case 'tool':
            return <div key={index} className="chat-system chat-tool">{block.text}</div>
          case 'todo':
            return (
              <div key={index} className="chat-row chat-row-assistant">
                <div className="chat-todo">{renderTodoResult(block.output, block.ok)}</div>
              </div>
            )
          case 'error':
            return (
              <div key={index} className="chat-row chat-row-assistant">
                <div className="chat-bubble chat-bubble-error">{block.message}</div>
              </div>
            )
          case 'system':
            return <div key={index} className="chat-system">{block.text}</div>
          default:
            return null
        }
      })}
      <div ref={endRef} />
    </div>
  )
}

function renderTodoResult(output: unknown, ok: boolean): JSX.Element {
  const todos = parseTodoItems(output)
  return (
    <>
      <div className="chat-todo-head">
        <ListTodo size={14} />
        <span>todo_write</span>
        {!ok ? <span className="chat-todo-error">failed</span> : null}
      </div>
      {todos.length === 0 ? (
        <pre className="chat-todo-raw">{brief(output) ?? ''}</pre>
      ) : (
        <div className="chat-todo-list">
          {todos.map((todo, index) => (
            <div key={`${todo.status}-${index}`} className={`chat-todo-item chat-todo-${todo.status}`}>
              {todo.status === 'completed'
                ? <CircleCheck size={13} />
                : <Circle size={13} />}
              <span>{todo.content}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function parseTodoItems(output: unknown): Array<{ status: string; content: string }> {
  if (typeof output === 'string') {
    return output.split('\n').flatMap((line) => {
      const match = line.match(/^\s*\d+\.\s+\[(pending|in_progress|completed)\]\s+(.+)\s*$/)
      return match ? [{ status: match[1], content: match[2] }] : []
    })
  }
  const value = output && typeof output === 'object' ? output as Record<string, unknown> : null
  const todos = Array.isArray(value?.todos) ? value.todos : Array.isArray(output) ? output : []
  return todos.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const todo = item as Record<string, unknown>
    return typeof todo.content === 'string' && typeof todo.status === 'string'
      ? [{ status: todo.status, content: todo.content }]
      : []
  })
}

function ProcessTranscript({ events }: { events: AgentEvent[] }): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const shouldFollowOutputRef = useRef(true)
  const [permissionStatuses, setPermissionStatuses] = useState<Map<string, PermissionStatus>>(() => new Map())
  const [allowAllForRun, setAllowAllForRun] = useState(false)
  const blocks = useMemo(() => groupEvents(events), [events])
  const activity = useMemo(() => detectActivity(events), [events])

  const respondPermission = useCallback((requestId: string, allowed: boolean): void => {
    setPermissionStatuses((prev) => {
      const next = new Map(prev)
      next.set(requestId, allowed ? 'allowed' : 'denied')
      return next
    })
    void window.api.respondPermission(requestId, allowed)
  }, [])

  const allowAllPermissions = useCallback((requestId: string): void => {
    setAllowAllForRun(true)
    respondPermission(requestId, true)
  }, [respondPermission])

  useEffect(() => {
    shouldFollowOutputRef.current = shouldAutoFollowTranscriptEvent(
      shouldFollowOutputRef.current,
      events.at(-1),
      events.length
    )
    if (!shouldFollowOutputRef.current) return
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [events.length])

  useEffect(() => {
    if (!allowAllForRun) return
    for (const event of events) {
      if (event.kind !== 'system') continue
      const request = parsePermissionRequest(event.text)
      if (!request || permissionStatuses.has(request.requestId)) continue
      respondPermission(request.requestId, true)
    }
  }, [allowAllForRun, events, permissionStatuses, respondPermission])

  const updateAutoFollow = (): void => {
    const scroller = scrollerRef.current
    if (!scroller) return
    shouldFollowOutputRef.current = isNearTranscriptBottom(scroller)
  }

  if (blocks.length === 0) {
    return <div className="transcript-empty">No output yet. Start a run to see the agent process here.</div>
  }

  return (
    <div className="transcript" ref={scrollerRef} onScroll={updateAutoFollow}>
      <StatusBar activity={activity} />
      {blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          permissionStatuses={permissionStatuses}
          respondPermission={respondPermission}
          allowAllPermissions={allowAllPermissions}
        />
      ))}
      <div ref={endRef} />
    </div>
  )
}

// ── public component ─────────────────────────────────────────────────────

export function TranscriptViewer({
  events,
  variant = 'process'
}: {
  events: AgentEvent[]
  variant?: 'process' | 'chat'
}): JSX.Element {
  return variant === 'chat'
    ? <ChatTranscript events={events} />
    : <ProcessTranscript events={events} />
}
