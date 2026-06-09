import { useCallback, useEffect, useState } from 'react'
import type { ReflectionEngineConfig } from '@shared/types'
import { DEFAULT_REFLECTION_CONFIG } from '@shared/types'

export interface ReflectionConfigState {
  config: ReflectionEngineConfig
  loading: boolean
  refresh: () => Promise<void>
  save: (config: ReflectionEngineConfig) => Promise<void>
}

export function useReflectionConfig(): ReflectionConfigState {
  const [config, setConfig] = useState<ReflectionEngineConfig>(DEFAULT_REFLECTION_CONFIG)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.api.reflectionConfigGet()
      setConfig(normalizeConfig(next))
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (next: ReflectionEngineConfig) => {
    const normalized = normalizeConfig(next)
    await window.api.reflectionConfigSave(normalized)
    setConfig(normalized)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { config, loading, refresh, save }
}

function normalizeConfig(config: ReflectionEngineConfig): ReflectionEngineConfig {
  return {
    vendor: config.vendor || DEFAULT_REFLECTION_CONFIG.vendor,
    model: config.model || DEFAULT_REFLECTION_CONFIG.model,
    enabled: typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_REFLECTION_CONFIG.enabled
  }
}
