import { useCallback, useEffect, useState } from 'react'
import type { Credential } from '@shared/types'

export type CredentialSaveInput = Omit<Credential, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

export interface CredentialState {
  credentials: Credential[]
  loading: boolean
  save: (input: CredentialSaveInput) => Promise<Credential>
  remove: (id: string) => Promise<void>
  getDecrypted: (id: string) => Promise<Credential>
  reload: () => Promise<void>
}

export function useCredentials(): CredentialState {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setCredentials(await window.api.credentialsList())
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (input: CredentialSaveInput) => {
    const saved = await window.api.credentialsSave(input)
    await reload()
    return saved
  }, [reload])

  const remove = useCallback(async (id: string) => {
    await window.api.credentialsDelete(id)
    await reload()
  }, [reload])

  const getDecrypted = useCallback((id: string) => window.api.credentialsGetDecrypted(id), [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { credentials, loading, save, remove, getDecrypted, reload }
}
