import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentMemoryMeta,
  MemoryEntry,
  MemorySignal,
  ReflectionEngineConfig
} from '@shared/types'
import { DEFAULT_REFLECTION_CONFIG } from '@shared/types'

type MemoryAddInput = Omit<
  MemoryEntry,
  'id' | 'createdAt' | 'lastReinforcedAt' | 'reinforceCount'
>

export function hashProjectPath(projectPath: string): string {
  return createHash('sha256').update(resolve(projectPath)).digest('hex').slice(0, 16)
}

export class MemoryStore {
  private readonly dir: string
  private readonly agentsDir: string
  private readonly rawDir: string
  private readonly configPath: string

  constructor() {
    this.dir = join(app.getPath('userData'), 'memories')
    this.agentsDir = join(this.dir, 'agents')
    this.rawDir = join(this.dir, 'raw')
    this.configPath = join(this.dir, 'config.json')
    mkdirSync(this.agentsDir, { recursive: true })
    mkdirSync(this.rawDir, { recursive: true })
  }

  list(agentId: string, projectPath?: string): MemoryEntry[] {
    const entries = [...this.readMemoryFile(this.globalPath(agentId))]
    if (projectPath) {
      entries.push(...this.readMemoryFile(this.projectPath(agentId, projectPath)))
    }
    return entries
  }

  listAll(agentId: string): MemoryEntry[] {
    const entries = [...this.readMemoryFile(this.globalPath(agentId))]
    const projectsDir = this.projectsDir(agentId)
    if (!existsSync(projectsDir)) return entries

    try {
      for (const file of readdirSync(projectsDir)) {
        if (file.endsWith('.json')) {
          entries.push(...this.readMemoryFile(join(projectsDir, file)))
        }
      }
    } catch {
      return entries
    }
    return entries
  }

  add(input: MemoryAddInput): MemoryEntry {
    const now = Date.now()
    const entry: MemoryEntry = {
      ...input,
      id: randomUUID(),
      projectHash: input.scope === 'project'
        ? input.projectHash ?? (input.projectPath ? hashProjectPath(input.projectPath) : undefined)
        : undefined,
      createdAt: now,
      lastReinforcedAt: now,
      reinforceCount: 0
    }

    const path = this.memoryPathForEntry(entry)
    const entries = this.readMemoryFile(path)
    entries.unshift(entry)
    this.writeJson(path, entries)
    this.updateMeta(entry.agentId, { totalMemories: this.listAll(entry.agentId).length })
    return entry
  }

  remove(memoryId: string): void {
    for (const { agentId, path } of this.memoryFiles()) {
      const entries = this.readMemoryFile(path)
      const next = entries.filter((entry) => entry.id !== memoryId)
      if (next.length !== entries.length) {
        this.writeJson(path, next)
        this.updateMeta(agentId, { totalMemories: this.listAll(agentId).length })
      }
    }
  }

  removeByAgent(agentId: string): void {
    try {
      rmSync(this.agentDir(agentId), { recursive: true, force: true })
    } catch {
      // Persistence is best-effort.
    }
  }

  reinforce(memoryId: string): void {
    for (const { agentId, path } of this.memoryFiles()) {
      const entries = this.readMemoryFile(path)
      let changed = false
      const next = entries.map((entry) => {
        if (entry.id !== memoryId) return entry
        changed = true
        return {
          ...entry,
          strength: 1,
          lastReinforcedAt: Date.now(),
          reinforceCount: entry.reinforceCount + 1
        }
      })

      if (changed) {
        this.writeJson(path, next)
        this.updateMeta(agentId, { totalMemories: this.listAll(agentId).length })
      }
    }
  }

  getMeta(agentId: string): AgentMemoryMeta {
    return this.readJson<AgentMemoryMeta>(this.metaPath(agentId)) ?? {
      agentId,
      totalRuns: 0,
      totalMemories: this.listAll(agentId).length
    }
  }

  updateMeta(agentId: string, patch: Partial<AgentMemoryMeta>): void {
    const current = this.getMeta(agentId)
    this.writeJson(this.metaPath(agentId), { ...current, ...patch, agentId })
  }

  saveRawSignal(signal: MemorySignal): void {
    const path = join(this.rawDir, `${signal.workflowRunId}.json`)
    const signals = this.readJson<MemorySignal[]>(path) ?? []
    signals.push(signal)
    this.writeJson(path, signals)
  }

  popRawSignals(): MemorySignal[] {
    const signals: MemorySignal[] = []
    try {
      for (const file of readdirSync(this.rawDir)) {
        if (!file.endsWith('.json')) continue
        const path = join(this.rawDir, file)
        const parsed = this.readJson<MemorySignal[]>(path)
        if (Array.isArray(parsed)) signals.push(...parsed)
        unlinkSync(path)
      }
    } catch {
      return signals
    }
    return signals
  }

  getReflectionConfig(): ReflectionEngineConfig {
    const config = this.readJson<ReflectionEngineConfig>(this.configPath)
    if (!config || !config.vendor || !config.model || typeof config.enabled !== 'boolean') {
      return DEFAULT_REFLECTION_CONFIG
    }
    return config
  }

  getReflectionCwd(): string {
    return this.dir
  }

  saveReflectionConfig(config: ReflectionEngineConfig): void {
    this.writeJson(this.configPath, config)
  }

  private memoryPathForEntry(entry: MemoryEntry): string {
    if (entry.scope === 'project') {
      const projectHash = entry.projectHash ?? (entry.projectPath ? hashProjectPath(entry.projectPath) : 'unknown')
      return this.projectHashPath(entry.agentId, projectHash)
    }
    return this.globalPath(entry.agentId)
  }

  private memoryFiles(): Array<{ agentId: string; path: string }> {
    const files: Array<{ agentId: string; path: string }> = []
    try {
      for (const agentId of readdirSync(this.agentsDir)) {
        const agentDir = this.agentDir(agentId)
        files.push({ agentId, path: join(agentDir, 'global.json') })
        const projectsDir = this.projectsDir(agentId)
        if (!existsSync(projectsDir)) continue
        for (const file of readdirSync(projectsDir)) {
          if (file.endsWith('.json')) files.push({ agentId, path: join(projectsDir, file) })
        }
      }
    } catch {
      return files
    }
    return files
  }

  private readMemoryFile(path: string): MemoryEntry[] {
    const parsed = this.readJson<MemoryEntry[]>(path)
    return Array.isArray(parsed) ? parsed : []
  }

  private readJson<T>(path: string): T | null {
    try {
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
      return null
    }
  }

  private writeJson(path: string, value: unknown): void {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(value, null, 2))
    } catch {
      // Persistence is best-effort.
    }
  }

  private agentDir(agentId: string): string {
    return join(this.agentsDir, agentId)
  }

  private projectsDir(agentId: string): string {
    return join(this.agentDir(agentId), 'projects')
  }

  private globalPath(agentId: string): string {
    return join(this.agentDir(agentId), 'global.json')
  }

  private projectPath(agentId: string, projectPath: string): string {
    return this.projectHashPath(agentId, hashProjectPath(projectPath))
  }

  private projectHashPath(agentId: string, projectHash: string): string {
    return join(this.projectsDir(agentId), `${projectHash}.json`)
  }

  private metaPath(agentId: string): string {
    return join(this.agentDir(agentId), 'meta.json')
  }
}
