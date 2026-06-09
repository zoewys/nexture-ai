/**
 * useAgents.ts — Agent 定义管理 hook
 *
 * 从主进程加载 agent 定义列表，提供 save（创建/更新）和 remove（删除）操作。
 * Agent 定义是 workflow 模板步骤和 SingleRunPanel 选择 agent 的数据源。
 */

import { useCallback, useEffect, useState } from 'react'
import type { AgentDefinition } from '@shared/types'

export interface AgentDraft extends Omit<AgentDefinition, 'id'> {
  id?: string
}

/**
 * Loads, creates, updates & deletes predefined agent definitions via the
 * main-process store. Pattern matches useRun — a thin bridge over window.api.
 */
export function useAgents() {
  const [agents, setAgents] = useState<AgentDefinition[]>([])

  const reload = useCallback(async () => {
    const list = await window.api.listAgents()
    setAgents(list)
  }, [])

  const save = useCallback(
    async (draft: AgentDraft) => {
      const saved = await window.api.saveAgent(draft)
      // Optimistically replace (upsert) or insert.
      setAgents((prev) => {
        const idx = prev.findIndex((a) => a.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [saved, ...prev]
      })
      return saved
    },
    []
  )

  const remove = useCallback(async (id: string) => {
    await window.api.deleteAgent(id)
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { agents, reload, save, remove }
}