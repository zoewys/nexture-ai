import { useEffect, useRef } from 'react'
import type { AgentEvent } from '@shared/types'

function renderEvent(event: AgentEvent, i: number): JSX.Element | null {
  switch (event.kind) {
    case 'session-started':
      return (
        <div key={i} className="ev ev-system">
          session started · {event.sessionId.slice(0, 8)}
        </div>
      )
    case 'message':
      return (
        <div key={i} className="ev ev-message">
          {event.text}
        </div>
      )
    case 'message-delta':
      return (
        <span key={i} className="ev-delta">
          {event.text}
        </span>
      )
    case 'thinking':
      return (
        <div key={i} className="ev ev-thinking">
          {event.text}
        </div>
      )
    case 'tool-call':
      return (
        <div key={i} className="ev ev-tool">
          <span className="ev-tag">tool</span> {event.name}
          <pre>{safeStringify(event.input)}</pre>
        </div>
      )
    case 'tool-result':
      return (
        <div key={i} className={`ev ev-tool-result ${event.ok ? '' : 'ev-error'}`}>
          <span className="ev-tag">{event.ok ? 'result' : 'result ✗'}</span>
          <pre>{truncate(safeStringify(event.output), 800)}</pre>
        </div>
      )
    case 'file-changed':
      return (
        <div key={i} className="ev ev-file">
          {event.op}: {event.path}
        </div>
      )
    case 'usage':
      return (
        <div key={i} className="ev ev-usage">
          tokens in/out: {event.inputTokens}/{event.outputTokens}
          {event.costUsd != null ? ` · $${event.costUsd.toFixed(4)}` : ''}
        </div>
      )
    case 'turn-done':
      return (
        <div key={i} className="ev ev-done">
          ── turn {event.reason} ──
        </div>
      )
    case 'error':
      return (
        <div key={i} className="ev ev-error">
          error: {event.message}
        </div>
      )
    case 'stderr':
      return (
        <div key={i} className="ev ev-stderr">
          {event.text}
        </div>
      )
    case 'system':
      return (
        <div key={i} className="ev ev-system">
          {event.text}
        </div>
      )
    default:
      return null
  }
}

export function TranscriptViewer({ events }: { events: AgentEvent[] }): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the latest event.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  if (events.length === 0) {
    return <div className="transcript-empty">No output yet. Start a run to see the agent work.</div>
  }

  return (
    <div className="transcript">
      {events.map((e, i) => renderEvent(e, i))}
      <div ref={endRef} />
    </div>
  )
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more chars)` : s
}
