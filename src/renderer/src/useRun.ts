import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, RunConfig } from '@shared/types'

export interface RunState {
  runId: string | null
  events: AgentEvent[]
  running: boolean
  sessionId: string | null
}

const INITIAL: RunState = { runId: null, events: [], running: false, sessionId: null }

/**
 * Owns the lifecycle of a single agent run: subscribes to main-process events,
 * accumulates them, and tracks whether the turn is still going. Mid-run
 * interjection (claude) and abort are exposed as callbacks.
 */
export function useRun(): {
  state: RunState
  start: (config: RunConfig) => Promise<void>
  continueSession: (config: RunConfig, displayText?: string) => Promise<void>
  push: (text: string) => Promise<void>
  abort: () => Promise<void>
  reset: () => void
} {
  const [state, setState] = useState<RunState>(INITIAL)
  const runIdRef = useRef<string | null>(null)

  // Subscribe once; filter events by the active runId.
  useEffect(() => {
    const unsub = window.api.onRunEvent(({ runId, event }) => {
      if (runId !== runIdRef.current) return
      setState((prev) => {
        const next: RunState = { ...prev, events: [...prev.events, event] }
        if (event.kind === 'session-started') next.sessionId = event.sessionId
        if (event.kind === 'turn-done') next.running = false
        if (event.kind === 'error' && !event.recoverable) next.running = false
        return next
      })
    })
    return unsub
  }, [])

  const start = useCallback(async (config: RunConfig) => {
    setState({ ...INITIAL, running: true })
    const { runId } = await window.api.startRun(config)
    runIdRef.current = runId
    setState((prev) => ({ ...prev, runId }))
  }, [])

  /**
   * Continue the conversation in a new turn, keeping the visible transcript.
   * The config may carry `resumeFrom` so the main process reattaches to the
   * existing CLI session when the selected adapter supports it.
   */
  const continueSession = useCallback(async (config: RunConfig, displayText?: string) => {
    setState((prev) => ({
      ...prev,
      running: true,
      events: [...prev.events, { kind: 'system', text: `↳ ${displayText ?? config.prompt}` }]
    }))
    const { runId } = await window.api.startRun(config)
    runIdRef.current = runId
    setState((prev) => ({ ...prev, runId }))
  }, [])

  const push = useCallback(async (text: string) => {
    const id = runIdRef.current
    if (!id) return
    // Optimistically reflect the interjection in the transcript.
    setState((prev) => ({
      ...prev,
      running: true,
      events: [...prev.events, { kind: 'system', text: `↳ ${text}` }]
    }))
    await window.api.pushInput(id, text)
  }, [])

  const abort = useCallback(async () => {
    const id = runIdRef.current
    if (!id) return
    await window.api.abortRun(id)
  }, [])

  const reset = useCallback(() => {
    runIdRef.current = null
    setState(INITIAL)
  }, [])

  return { state, start, continueSession, push, abort, reset }
}
