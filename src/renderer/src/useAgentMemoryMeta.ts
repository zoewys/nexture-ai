/**
 * useAgentMemoryMeta.ts — 轻量记忆统计 hook
 *
 * 仅拉取单个 agent 的记忆元数据（运行次数 / 记忆条数），供 Agents 卡片
 * 底部统计展示。与 useAgentMemories 的区别：不加载完整记忆列表，避免
 * 在卡片网格中为每个 agent 拉取大量记忆数据。
 */

import { useCallback, useEffect, useState } from 'react'
import type { AgentMemoryMeta } from '@shared/types'

export function useAgentMemoryMeta(agentId: string | null): {
  meta: AgentMemoryMeta | null
  refresh: () => Promise<void>
} {
  const [meta, setMeta] = useState<AgentMemoryMeta | null>(null)

  const refresh = useCallback(async () => {
    if (!agentId) {
      setMeta(null)
      return
    }
    setMeta(await window.api.memoryMeta(agentId))
  }, [agentId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { meta, refresh }
}
