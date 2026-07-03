import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Credential } from '@shared/types'

type SaveInput = Omit<Credential, 'id' | 'createdAt'> & { id?: string; createdAt?: number }

const SAFE_PREFIX = 'safe:'
const BASE64_PREFIX = 'base64:'
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/

export class CredentialStore {
  private readonly path: string

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'credentials.json')
  }

  list(): Credential[] {
    try {
      if (!existsSync(this.path)) return []
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(parsed) ? (parsed as Credential[]) : []
    } catch {
      return []
    }
  }

  save(input: SaveInput): Credential {
    const name = input.name.trim()
    const envKey = input.envKey.trim()
    if (!name) throw new Error('请输入凭据名称')
    if (!ENV_KEY_PATTERN.test(envKey)) {
      throw new Error('环境变量名只能包含大写字母、数字和下划线，且不能以数字开头')
    }

    const list = this.list()
    const existing = input.id ? list.find((credential) => credential.id === input.id) : undefined
    if (list.some((credential) => credential.envKey === envKey && credential.id !== input.id)) {
      throw new Error(`环境变量名已存在：${envKey}`)
    }
    if (!input.value && !existing) throw new Error('请输入凭据值')

    const id = input.id ?? randomUUID()
    const encryptedValue =
      input.value.length === 0 && existing
        ? existing.value
        : this.isStoredValue(input.value)
          ? input.value
          : this.encrypt(input.value)

    const next: Credential = {
      id,
      name,
      envKey,
      value: encryptedValue,
      createdAt: existing?.createdAt ?? input.createdAt ?? Date.now()
    }

    const idx = list.findIndex((credential) => credential.id === id)
    if (idx >= 0) list[idx] = next
    else list.unshift(next)

    this.writeAll(list)
    return next
  }

  remove(id: string): void {
    this.writeAll(this.list().filter((credential) => credential.id !== id))
  }

  getDecrypted(id: string): Credential {
    const credential = this.list().find((item) => item.id === id)
    if (!credential) throw new Error(`Credential not found: ${id}`)
    try {
      return { ...credential, value: this.decrypt(credential.value) }
    } catch (err) {
      throw new Error(
        `凭据无法解密（${credential.name || credential.envKey || credential.id}）。请重新输入并保存该凭据值。`,
        { cause: err }
      )
    }
  }

  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return `${SAFE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
    }

    console.warn('safeStorage encryption unavailable; falling back to base64 credential storage')
    return `${BASE64_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`
  }

  private decrypt(value: string): string {
    if (value.startsWith(SAFE_PREFIX)) {
      return safeStorage.decryptString(Buffer.from(value.slice(SAFE_PREFIX.length), 'base64'))
    }
    if (value.startsWith(BASE64_PREFIX)) {
      console.warn('safeStorage encryption unavailable; reading base64 credential storage')
      return Buffer.from(value.slice(BASE64_PREFIX.length), 'base64').toString('utf8')
    }
    return value
  }

  private isStoredValue(value: string): boolean {
    return value.startsWith(SAFE_PREFIX) || value.startsWith(BASE64_PREFIX)
  }

  private writeAll(list: Credential[]): void {
    writeFileSync(this.path, JSON.stringify(list, null, 2), 'utf8')
  }
}
