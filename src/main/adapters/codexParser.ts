import type { AgentEvent } from '@shared/types'
import { num } from './parseUtils'

type CodexItem = Record<string, unknown> & { id?: unknown; type?: unknown }

export function createCodexParser(): (line: string) => AgentEvent[] {
  let sessionId = ''
  const lastTextByItem = new Map<string, string>()

  const deltaForText = (id: string, text: string): string => {
    const previous = lastTextByItem.get(id) ?? ''
    lastTextByItem.set(id, text)
    return text.startsWith(previous) ? text.slice(previous.length) : text
  }

  return function parseCodexLine(line: string): AgentEvent[] {
    const trimmed = line.trim()
    if (!trimmed || /^Reading additional input from stdin/i.test(trimmed)) return []

    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return []
    }

    switch (obj.type) {
      case 'thread.started': {
        const threadId = stringValue(obj.thread_id)
        if (!threadId) return []
        sessionId = threadId
        return [{ kind: 'session-started', sessionId: threadId, vendor: 'codex' }]
      }

      case 'turn.started':
        return []

      case 'item.started':
        return parseItemStarted(itemValue(obj.item))

      case 'item.updated':
        return parseItemUpdated(itemValue(obj.item), deltaForText)

      case 'item.completed':
        return parseItemCompleted(itemValue(obj.item), lastTextByItem)

      case 'turn.completed':
        return [
          {
            kind: 'usage',
            inputTokens: num((obj.usage as Record<string, unknown> | undefined)?.input_tokens),
            outputTokens: num((obj.usage as Record<string, unknown> | undefined)?.output_tokens)
          },
          { kind: 'turn-done', sessionId, reason: 'complete' }
        ]

      case 'turn.failed': {
        const message =
          stringValue((obj.error as Record<string, unknown> | undefined)?.message) ??
          'codex turn failed'
        return [
          { kind: 'error', recoverable: false, message },
          { kind: 'turn-done', sessionId, reason: 'error' }
        ]
      }

      case 'error':
        return [
          {
            kind: 'error',
            recoverable: false,
            message: stringValue(obj.message) ?? 'codex error',
            raw: obj
          }
        ]

      default:
        return []
    }
  }
}

function parseItemStarted(item: CodexItem | null): AgentEvent[] {
  if (!item) return []
  const id = stringValue(item.id) ?? ''
  switch (item.type) {
    case 'command_execution': {
      const command = stringValue(item.command) ?? ''
      return [{ kind: 'tool-call', id, name: 'bash', input: { command } }]
    }
    case 'mcp_tool_call': {
      const server = stringValue(item.server) ?? 'unknown'
      const tool = stringValue(item.tool) ?? 'unknown'
      return [
        {
          kind: 'tool-call',
          id,
          name: `mcp:${server}:${tool}`,
          input: item.arguments ?? {}
        }
      ]
    }
    default:
      return []
  }
}

function parseItemUpdated(
  item: CodexItem | null,
  deltaForText: (id: string, text: string) => string
): AgentEvent[] {
  if (!item) return []
  const id = stringValue(item.id) ?? ''
  const text = stringValue(item.text)
  if (!id || !text) return []

  const delta = deltaForText(id, text)
  if (!delta) return []

  switch (item.type) {
    case 'agent_message':
      return [{ kind: 'message-delta', text: delta }]
    case 'reasoning':
      return [{ kind: 'thinking', text: delta }]
    default:
      return []
  }
}

function parseItemCompleted(
  item: CodexItem | null,
  lastTextByItem: Map<string, string>
): AgentEvent[] {
  if (!item) return []
  const id = stringValue(item.id) ?? ''

  switch (item.type) {
    case 'agent_message': {
      const text = stringValue(item.text)
      if (!text) return []

      // If we previously emitted deltas for this item, only emit the
      // remaining suffix as a message-delta so groupEvents accumulates
      // it into pending. This avoids duplicating the full message when
      // the deltas already covered most of the text. When there were no
      // prior deltas at all, fall back to a full message.
      if (id && lastTextByItem.has(id)) {
        const previous = lastTextByItem.get(id)!
        lastTextByItem.delete(id)
        const suffix = text.startsWith(previous) ? text.slice(previous.length) : text
        return suffix ? [{ kind: 'message-delta', text: suffix }] : []
      }

      if (id) lastTextByItem.delete(id)
      return [{ kind: 'message', role: 'assistant', text }]
    }

    case 'reasoning': {
      if (id) lastTextByItem.delete(id)
      const text = stringValue(item.text)
      return text ? [{ kind: 'thinking', text }] : []
    }

    case 'command_execution': {
      return [
        {
          kind: 'tool-result',
          id,
          ok: item.status === 'completed' && num(item.exit_code) === 0,
          output: item.aggregated_output ?? ''
        }
      ]
    }

    case 'mcp_tool_call': {
      const error = item.error as Record<string, unknown> | null | undefined
      return [
        {
          kind: 'tool-result',
          id,
          ok: item.status === 'success',
          output:
            (item.result as Record<string, unknown> | undefined)?.content ??
            item.result ??
            error?.message ??
            error ??
            ''
        }
      ]
    }

    case 'file_change':
      return parseFileChanges(item.changes)

    case 'web_search':
      return [
        {
          kind: 'tool-result',
          id,
          ok: true,
          output: item.query ?? item
        }
      ]

    case 'todo_list':
      return [{ kind: 'system', text: `todo: ${safeStringify(item)}` }]

    case 'error':
      return [
        {
          kind: 'error',
          recoverable: false,
          message: stringValue(item.message) ?? stringValue(item.text) ?? 'codex item error',
          raw: item
        }
      ]

    default:
      return []
  }
}

function parseFileChanges(changes: unknown): AgentEvent[] {
  if (!Array.isArray(changes)) return []
  return changes
    .map((change): AgentEvent | null => {
      if (!change || typeof change !== 'object') return null
      const item = change as Record<string, unknown>
      const path = stringValue(item.path)
      if (!path) return null
      const kind = item.kind
      const op = kind === 'add' ? 'create' : kind === 'delete' ? 'delete' : 'modify'
      return { kind: 'file-changed', path, op }
    })
    .filter((event): event is AgentEvent => event !== null)
}

function itemValue(value: unknown): CodexItem | null {
  return value && typeof value === 'object' ? (value as CodexItem) : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
