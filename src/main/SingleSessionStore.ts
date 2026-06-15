import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SingleSession, SingleSessionCreateInput } from '@shared/types'

export class SingleSessionStore {
  private readonly dir: string

  constructor() {
    this.dir = join(app.getPath('userData'), 'single-sessions')
    mkdirSync(this.dir, { recursive: true })
  }

  list(): SingleSession[] {
    try {
      return readdirSync(this.dir)
        .filter((file) => file.endsWith('.json'))
        .flatMap((file): SingleSession[] => {
          const session = this.readFile(join(this.dir, file))
          return session ? [session] : []
        })
        .filter((session) => session.status === 'active')
        .sort((a, b) => b.updatedAt - a.updatedAt)
    } catch {
      return []
    }
  }

  get(id: string): SingleSession | null {
    return this.readFile(this.pathFor(id))
  }

  create(input: SingleSessionCreateInput): SingleSession {
    const now = Date.now()
    const session: SingleSession = {
      id: randomUUID(),
      scope: 'single',
      title: input.title?.trim() || 'New Session',
      preview: '',
      status: 'active',
      cwd: input.cwd,
      route: input.route,
      conversation: {
        scope: 'single',
        segments: [],
        events: []
      },
      injectedMemoryIds: [],
      createdAt: now,
      updatedAt: now
    }
    this.save(session)
    return session
  }

  save(session: SingleSession): void {
    const next: SingleSession = {
      ...session,
      scope: 'single',
      conversation: {
        ...session.conversation,
        scope: 'single'
      }
    }
    try {
      writeFileSync(this.pathFor(next.id), JSON.stringify(next, null, 2))
    } catch {
      // Persistence is best-effort.
    }
  }

  delete(id: string): void {
    const session = this.get(id)
    if (!session) return
    this.save({
      ...session,
      status: 'deleted',
      updatedAt: Date.now()
    })
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private readFile(path: string): SingleSession | null {
    try {
      if (!existsSync(path)) return null
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as SingleSession
      if (!parsed || parsed.scope !== 'single' || !parsed.id) return null
      return {
        ...parsed,
        status: parsed.status ?? 'active',
        conversation: {
          scope: 'single',
          activeSegmentId: parsed.conversation?.activeSegmentId,
          segments: parsed.conversation?.segments ?? [],
          events: parsed.conversation?.events ?? []
        },
        injectedMemoryIds: parsed.injectedMemoryIds ?? []
      }
    } catch {
      return null
    }
  }
}
