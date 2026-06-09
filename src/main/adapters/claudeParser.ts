import type { AgentEvent } from '@shared/types'
import { num } from './parseUtils'

/**
 * Parses one line of Claude Code's `--output-format stream-json` into zero or
 * more normalized AgentEvents. Defensive by design: unknown shapes yield no
 * events rather than throwing, so a CLI format tweak can't crash a run.
 *
 * Observed line shapes (newline-delimited JSON):
 *  - {"type":"system","subtype":"init","session_id":"...","model":"..."}
 *  - {"type":"assistant","message":{"content":[{type:"text",text} | {type:"tool_use",id,name,input} | {type:"thinking",thinking}]},"session_id"}
 *  - {"type":"user","message":{"content":[{type:"tool_result",tool_use_id,content,is_error}]}}
 *  - {"type":"result","subtype":"success"|"error...","usage":{input_tokens,output_tokens},"total_cost_usd","session_id"}
 *  - {"type":"stream_event", ...}  // partial deltas when --include-partial-messages
 */
export function parseClaudeLine(line: string): AgentEvent[] {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    // Not JSON — surface as a system note for debugging, but don't crash.
    return [{ kind: 'system', text: line }]
  }
  if (!obj || typeof obj !== 'object') return []

  const sessionId: string = obj.session_id ?? ''

  switch (obj.type) {
    case 'system':
      if (obj.subtype === 'init' && sessionId) {
        return [{ kind: 'session-started', sessionId, vendor: 'claude' }]
      }
      return []

    case 'assistant':
      return parseAssistantContent(obj?.message?.content)

    case 'user':
      return parseToolResults(obj?.message?.content)

    case 'result': {
      const events: AgentEvent[] = []
      const usage = obj.usage
      if (usage) {
        events.push({
          kind: 'usage',
          inputTokens: num(usage.input_tokens),
          outputTokens: num(usage.output_tokens),
          costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined
        })
      }
      const isError = typeof obj.subtype === 'string' && obj.subtype !== 'success'
      events.push({
        kind: 'turn-done',
        sessionId,
        reason: isError ? 'error' : 'complete'
      })
      return events
    }

    // Partial streaming deltas (only when --include-partial-messages is on).
    case 'stream_event': {
      const delta = obj?.event?.delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ kind: 'message-delta', text: delta.text }]
      }
      return []
    }

    default:
      return []
  }
}

function parseAssistantContent(content: unknown): AgentEvent[] {
  if (!Array.isArray(content)) return []
  const events: AgentEvent[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as any
    if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
      events.push({ kind: 'message', role: 'assistant', text: b.text })
    } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
      events.push({ kind: 'thinking', text: b.thinking })
    } else if (b.type === 'tool_use') {
      events.push({
        kind: 'tool-call',
        id: String(b.id ?? ''),
        name: String(b.name ?? 'unknown'),
        input: b.input ?? {}
      })
    }
  }
  return events
}

function parseToolResults(content: unknown): AgentEvent[] {
  if (!Array.isArray(content)) return []
  const events: AgentEvent[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as any
    if (b.type === 'tool_result') {
      events.push({
        kind: 'tool-result',
        id: String(b.tool_use_id ?? ''),
        ok: b.is_error !== true,
        output: b.content ?? ''
      })
    }
  }
  return events
}
