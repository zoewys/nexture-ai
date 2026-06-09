import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentMemoryMeta, MemoryEntry } from '@shared/types'

export interface ProjectMemoryGroup {
  path: string
  memories: MemoryEntry[]
}

export interface AgentMemoriesState {
  global: MemoryEntry[]
  byProject: Map<string, ProjectMemoryGroup>
  meta: AgentMemoryMeta | null
  refresh: () => Promise<void>
  remove: (memoryId: string) => Promise<void>
}

export function useAgentMemories(agentId: string | null): AgentMemoriesState {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [meta, setMeta] = useState<AgentMemoryMeta | null>(null)

  const refresh = useCallback(async () => {
    if (!agentId) {
      setEntries([])
      setMeta(null)
      return
    }

    const [memories, nextMeta] = await Promise.all([
      window.api.memoryList(agentId),
      window.api.memoryMeta(agentId)
    ])
    setEntries(memories)
    setMeta(nextMeta)
  }, [agentId])

  const remove = useCallback(
    async (memoryId: string) => {
      await window.api.memoryDelete(memoryId)
      await refresh()
    },
    [refresh]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const global = useMemo(
    () => entries.filter((entry) => entry.scope === 'global'),
    [entries]
  )

  const byProject = useMemo(() => {
    const groups = new Map<string, ProjectMemoryGroup>()
    for (const entry of entries) {
      if (entry.scope !== 'project') continue
      const path = entry.projectPath ?? entry.projectHash ?? 'Unknown project'
      const group = groups.get(path)
      if (group) {
        group.memories.push(entry)
      } else {
        groups.set(path, { path, memories: [entry] })
      }
    }
    return groups
  }, [entries])

  return { global, byProject, meta, refresh, remove }
}
