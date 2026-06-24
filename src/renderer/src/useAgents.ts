/**
 * useAgents.ts — Agent 定义管理 hook
 *
 * 从主进程加载 agent 定义列表，提供 save（创建/更新）和 remove（删除）操作。
 * Agent 定义是 workflow 模板步骤和 SingleRunPanel 选择 agent 的数据源。
 *
 * 列表始终把内置 agent（builtin，如使用助手）置顶，保证它们在 AgentManager、
 * SingleRunPanel 下拉、WorkflowCanvas 等所有展示处都排在第一条。
 */

import { useCallback, useEffect, useState } from 'react'
import type { AgentDefinition } from '@shared/types'

export interface AgentDraft extends Omit<AgentDefinition, 'id'> {
  id?: string
}

/** 内置 agent 置顶，其余维持原有相对顺序。 */
export function sortAgents(list: AgentDefinition[]): AgentDefinition[] {
  const builtin = list.filter((a) => a.builtin)
  const rest = list.filter((a) => !a.builtin)
  return [...builtin, ...rest]
}

function upsert(list: AgentDefinition[], agent: AgentDefinition): AgentDefinition[] {
  const idx = list.findIndex((a) => a.id === agent.id)
  if (idx >= 0) {
    const next = [...list]
    next[idx] = agent
    return next
  }
  return [agent, ...list]
}

/**
 * Loads, creates, updates & deletes predefined agent definitions via the
 * main-process store. Pattern matches useRun — a thin bridge over window.api.
 */
export function useAgents() {
  const [agents, setAgents] = useState<AgentDefinition[]>([])

  const reload = useCallback(async () => {
    const list = await window.api.listAgents()
    setAgents(sortAgents(list))
  }, [])

  const save = useCallback(async (draft: AgentDraft) => {
    const saved = await window.api.saveAgent(draft)
    setAgents((prev) => sortAgents(upsert(prev, saved)))
    return saved
  }, [])

  const remove = useCallback(async (id: string) => {
    await window.api.deleteAgent(id)
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { agents, reload, save, remove }
}
