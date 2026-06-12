import { useCallback, useEffect, useState } from 'react'
import type { ApiProviderConfig } from '@shared/types'

export interface ProviderState {
  providers: ApiProviderConfig[]
  loading: boolean
  save: (input: Omit<ApiProviderConfig, 'id'> & { id?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<{ ok: boolean; message: string }>
  reload: () => Promise<void>
}

export function useProviders(): ProviderState {
  const [providers, setProviders] = useState<ApiProviderConfig[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setProviders(await window.api.listProviders())
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (input: Omit<ApiProviderConfig, 'id'> & { id?: string }) => {
    await window.api.saveProvider(input)
    await reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    await window.api.deleteProvider(id)
    await reload()
  }, [reload])

  const testConnection = useCallback((id: string) => window.api.testProvider(id), [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { providers, loading, save, remove, testConnection, reload }
}
