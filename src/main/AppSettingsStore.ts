import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/types'
import { DEFAULT_APP_SETTINGS } from '@shared/types'

export class AppSettingsStore {
  private readonly path: string

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'settings.json')
  }

  get(): AppSettings {
    try {
      if (!existsSync(this.path)) return { ...DEFAULT_APP_SETTINGS }
      const raw = readFileSync(this.path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_APP_SETTINGS }
      return { ...DEFAULT_APP_SETTINGS, ...(parsed as Partial<AppSettings>) }
    } catch {
      return { ...DEFAULT_APP_SETTINGS }
    }
  }

  save(settings: AppSettings): void {
    writeFileSync(this.path, JSON.stringify(settings, null, 2), 'utf8')
  }
}
