import { useCallback, useEffect, useState } from 'react'
import type { WorkflowSchedule } from '@shared/types'

export type ScheduleDraft = Omit<WorkflowSchedule, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

export interface UseSchedulesResult {
  schedules: WorkflowSchedule[]
  loading: boolean
  save: (input: ScheduleDraft) => Promise<WorkflowSchedule>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<WorkflowSchedule>
  refresh: () => Promise<void>
}

export function useSchedules(): UseSchedulesResult {
  const [schedules, setSchedules] = useState<WorkflowSchedule[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSchedules(sortSchedules(await window.api.listSchedules()))
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (input: ScheduleDraft) => {
    const saved = await window.api.saveSchedule(input)
    setSchedules((prev) => sortSchedules([saved, ...prev.filter((item) => item.id !== saved.id)]))
    return saved
  }, [])

  const remove = useCallback(async (id: string) => {
    await window.api.deleteSchedule(id)
    setSchedules((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    const saved = await window.api.toggleSchedule(id, enabled)
    setSchedules((prev) => sortSchedules(prev.map((item) => (item.id === saved.id ? saved : item))))
    return saved
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { schedules, loading, save, remove, toggle, refresh }
}

function sortSchedules(schedules: WorkflowSchedule[]): WorkflowSchedule[] {
  return [...schedules].sort((a, b) => b.createdAt - a.createdAt)
}
