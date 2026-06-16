import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ApiProviderConfig } from '@shared/types'

type SaveInput = Omit<ApiProviderConfig, 'id'> & { id?: string }

const SAFE_PREFIX = 'safe:'
const BASE64_PREFIX = 'base64:'

export class ProviderStore {
  private readonly path: string

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'providers.json')
  }

  list(): ApiProviderConfig[] {
    try {
      if (!existsSync(this.path)) return []
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(parsed) ? (parsed as ApiProviderConfig[]) : []
    } catch {
      return []
    }
  }

  save(input: SaveInput): ApiProviderConfig {
    const list = this.list()
    const existing = input.id ? list.find((provider) => provider.id === input.id) : undefined
    const id = input.id ?? randomUUID()
    const encryptedKey =
      input.apiKey.length === 0 && existing
        ? existing.apiKey
        : this.isStoredApiKey(input.apiKey)
          ? input.apiKey
          : this.encrypt(input.apiKey)

    const next: ApiProviderConfig = {
      id,
      name: input.name,
      format: input.format,
      apiKey: encryptedKey,
      baseUrl: input.baseUrl,
      models: input.models,
      defaultModel: input.defaultModel,
      maxOutputTokens: input.maxOutputTokens
    }

    const idx = list.findIndex((provider) => provider.id === id)
    if (idx >= 0) list[idx] = next
    else list.unshift(next)

    this.writeAll(list)
    return next
  }

  remove(id: string): void {
    this.writeAll(this.list().filter((provider) => provider.id !== id))
  }

  getDecrypted(id: string): ApiProviderConfig {
    const provider = this.list().find((item) => item.id === id)
    if (!provider) throw new Error(`Provider not found: ${id}`)
    try {
      return { ...provider, apiKey: this.decrypt(provider.apiKey) }
    } catch (err) {
      throw new Error(
        `API Key 无法解密（${provider.name || provider.id}）。请重新输入并保存该供应商的 API Key。`,
        { cause: err }
      )
    }
  }

  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return `${SAFE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
    }

    console.warn('safeStorage encryption unavailable; falling back to base64 provider key storage')
    return `${BASE64_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`
  }

  private decrypt(value: string): string {
    if (value.startsWith(SAFE_PREFIX)) {
      return safeStorage.decryptString(Buffer.from(value.slice(SAFE_PREFIX.length), 'base64'))
    }
    if (value.startsWith(BASE64_PREFIX)) {
      console.warn('safeStorage encryption unavailable; reading base64 provider key storage')
      return Buffer.from(value.slice(BASE64_PREFIX.length), 'base64').toString('utf8')
    }
    return value
  }

  private isStoredApiKey(value: string): boolean {
    return value.startsWith(SAFE_PREFIX) || value.startsWith(BASE64_PREFIX)
  }

  private writeAll(list: ApiProviderConfig[]): void {
    writeFileSync(this.path, JSON.stringify(list, null, 2), 'utf8')
  }
}
