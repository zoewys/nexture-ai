import type { AgentEvent } from '@shared/types'

/**
 * Parses one line of `codex exec --json` stdout into zero or more normalized
 * AgentEvents.  Defensive: unknown shapes produce no events rather than
 * throwing, so a CLI format tweak can't crash the run.
 *
 * Codex --json output is newline-delimited JSON.  Observed shapes overlap
 * heavily with the Claude stream-json envelope:
 *
 *   {"type":"system","subtype":"init","session_id":"…","model":"…"}
 *   {"type":"assistant","message":{"content":[{type:"text",text},…]}}
 *   {"type":"user","message":{"content":[{type:"tool_result",tool_use_id,content,is_error}]}}
 *   {"type":"result","subtype":"success"|"error…","usage":{input_tokens,output_tokens},"session_id":"…"}
 *   {"type":"stream_event","event":{"delta":{"type":"text_delta","text":"…"}}}
 */
export function parseCodexLine(line: string): AgentEvent[] {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    // Not JSON — surface as a system note so the UI isn't silent.
    return [{ kind: 'system', text: line }]
  }
  if (!obj || typeof obj !== 'object') return []

  const sessionId: string = obj.session_id ?? ''

  switch (obj.type) {
    case 'system':
      if (obj.subtype === 'init' && sessionId) {
        return [{ kind: 'session-started', sessionId, vendor: 'codex' }]
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
      const isError =
        typeof obj.subtype === 'string' && obj.subtype !== 'success'
      events.push({
        kind: 'turn-done',
        sessionId,
        reason: isError ? 'error' : 'complete'
      })
      return events
    }

    case 'stream_event': {
      const delta = obj?.event?.delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ kind: 'message-delta', text: delta.text }]
      }
      return []
    }

    default:
      // Best-effort: if the object carries a top-level text or content
      // string, forward it so the user sees something rather than nothing.
      if (typeof obj.text === 'string' && obj.text.length > 0) {
        return [{ kind: 'message', role: 'assistant', text: obj.text }]
      }
      if (typeof obj.content === 'string' && obj.content.length > 0) {
        return [{ kind: 'message', role: 'assistant', text: obj.content }]
      }
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

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}