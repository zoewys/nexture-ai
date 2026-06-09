/**
 * useCliModels.ts — CLI 模型目录加载 hook
 *
 * 启动时从主进程获取各 CLI（claude / codex）支持的模型列表，
 * 供 ModelSelect 和 CodexOptions 组件使用。
 */

import { useCallback, useEffect, useState } from 'react'
import type { ModelCatalog } from '@shared/types'

export function useCliModels() {
  const [models, setModels] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setModels(await window.api.listModels())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { models, loading, reload }
}
