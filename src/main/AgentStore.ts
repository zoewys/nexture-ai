import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentDefinition } from '@shared/types'
import { ensureSeedAgents } from '../shared/seedAgents'

type SaveInput = Omit<AgentDefinition, 'id'> & { id?: string }

/**
 * Flat-file store for predefined agent definitions. One agents.json in the
 * app's userData directory, updated synchronously — same style as
 * TranscriptStore for consistency within the main process.
 */
export class AgentStore {
  private readonly path: string

  constructor() {
    const dir = join(app.getPath('userData'))
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'agents.json')
    // Seed / upgrade the built-in usage-helper agent on every launch.
    this.writeAll(ensureSeedAgents(this.list()))
  }

  /** Return every saved agent, newest-first. Never throws. */
  list(): AgentDefinition[] {
    try {
      if (!existsSync(this.path)) return []
      const raw = readFileSync(this.path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AgentDefinition[]) : []
    } catch {
      return []
    }
  }

  /** Create or update. Returns the persisted record (with generated id). */
  save(input: SaveInput): AgentDefinition {
    const list = this.list()
    const now: AgentDefinition = input.id
      ? ({ ...input, id: input.id } as AgentDefinition)
      : ({ ...input, id: randomUUID() } as AgentDefinition)

    const idx = list.findIndex((a) => a.id === now.id)
    if (idx >= 0) list[idx] = now
    else list.unshift(now)

    this.writeAll(list)
    return now
  }

  /** Remove one agent by id. No-op if not found. */
  remove(id: string): void {
    const list = this.list().filter((a) => a.id !== id)
    this.writeAll(list)
  }

  // ── internals ──────────────────────────────────────────────────────────

  private writeAll(list: AgentDefinition[]): void {
    try {
      writeFileSync(this.path, JSON.stringify(list, null, 2))
    } catch {
      // Persistence is best-effort.
    }
  }
}