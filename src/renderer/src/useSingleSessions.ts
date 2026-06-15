import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  SessionRoute,
  SingleSession,
  SingleSessionCreateInput,
  SingleSessionDetail,
  SingleSessionEventEnvelope,
  SingleSessionSendInput
} from '@shared/types'

export function useSingleSessions() {
  const [sessions, setSessions] = useState<SingleSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<SingleSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.scope === 'single' && session.status === 'active'),
    [sessions]
  )

  const reload = useCallback(async () => {
    const loaded = await window.api.listSingleSessions()
    setSessions(loaded)
    setSelectedSessionId((current) => current ?? loaded[0]?.id ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null)
      return
    }
    let cancelled = false
    void window.api.getSingleSession(selectedSessionId).then((detail) => {
      if (!cancelled) setSelectedSession(detail)
    })
    return () => {
      cancelled = true
    }
  }, [selectedSessionId])

  useEffect(() => {
    const unsub = window.api.onSingleSessionEvent((envelope: SingleSessionEventEnvelope) => {
      if (envelope.event.kind === 'session-updated') {
        const updated = envelope.event.session
        setSessions((prev) => sortSessions([
          updated,
          ...prev.filter((session) => session.id !== updated.id)
        ]))
        setSelectedSession((current) => (
          current?.id === updated.id ? updated : current
        ))
        return
      }
      const agentEvent = envelope.event
      setSelectedSession((current) => {
        if (!current || current.id !== envelope.sessionId) return current
        return {
          ...current,
          conversation: {
            ...current.conversation,
            events: [...current.conversation.events, agentEvent.event]
          },
          running: agentEvent.event.kind === 'turn-done' ? current.running : current.running
        }
      })
    })
    return unsub
  }, [])

  const createSession = useCallback(async (input: SingleSessionCreateInput) => {
    const created = await window.api.createSingleSession(input)
    setSessions((prev) => sortSessions([created, ...prev.filter((session) => session.id !== created.id)]))
    setSelectedSessionId(created.id)
    setSelectedSession(await window.api.getSingleSession(created.id))
    return created
  }, [])

  const selectSession = useCallback((id: string) => {
    setSelectedSessionId(id)
  }, [])

  const sendMessage = useCallback(async (
    text: string,
    route: SessionRoute,
    options: Partial<Omit<SingleSessionSendInput, 'sessionId' | 'text' | 'route'>> = {},
    sessionIdOverride?: string
  ) => {
    const targetSessionId = sessionIdOverride ?? selectedSessionId
    if (!targetSessionId) throw new Error('No selected Single session')
    const { cwd = selectedSession?.cwd ?? '', ...restOptions } = options
    const updated = await window.api.sendSingleSessionMessage({
      sessionId: targetSessionId,
      text,
      route,
      ...restOptions,
      cwd
    })
    setSelectedSession(updated)
    setSessions((prev) => sortSessions([updated, ...prev.filter((session) => session.id !== updated.id)]))
    return updated
  }, [selectedSession?.cwd, selectedSessionId])

  const abortSession = useCallback(async () => {
    if (!selectedSessionId) return null
    const updated = await window.api.abortSingleSession(selectedSessionId)
    setSelectedSession(updated)
    setSessions((prev) => sortSessions([updated, ...prev.filter((session) => session.id !== updated.id)]))
    return updated
  }, [selectedSessionId])

  const deleteSession = useCallback(async (id: string) => {
    await window.api.deleteSingleSession(id)
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== id)
      setSelectedSessionId((current) => (current === id ? next[0]?.id ?? null : current))
      setSelectedSession((current) => (current?.id === id ? null : current))
      return next
    })
  }, [])

  return {
    sessions: visibleSessions,
    selectedSession,
    selectedSessionId,
    loading,
    reload,
    createSession,
    selectSession,
    sendMessage,
    abortSession,
    deleteSession
  }
}

export type UseSingleSessionsResult = ReturnType<typeof useSingleSessions>

function sortSessions<T extends SingleSession>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}
