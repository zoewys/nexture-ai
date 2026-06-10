import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { DEFAULT_APP_SETTINGS } from '@shared/types'

export interface AppSettingsState {
  settings: AppSettings
  loading: boolean
  save: (settings: AppSettings) => Promise<void>
}

export function useAppSettings(): AppSettingsState {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.appSettingsGet()
      .then((next) => {
        if (!cancelled) setSettings({ ...DEFAULT_APP_SETTINGS, ...next })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async (next: AppSettings) => {
    await window.api.appSettingsSave(next)
    setSettings(next)
  }, [])

  return { settings, loading, save }
}
