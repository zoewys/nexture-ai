import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import type { ApiCallLogEntry } from '@shared/types'

type ApiCallLogInput = Omit<ApiCallLogEntry, 'id' | 'timestamp'> & {
  id?: string
  timestamp?: string
  apiKey?: string
}

const MAX_SUMMARY_CHARS = 4000
const RETENTION_DAYS = 7
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

export class ApiCallLogStore {
  private readonly dir: string

  constructor() {
    this.dir = join(app.getPath('userData'), 'api-call-logs')
    mkdirSync(this.dir, { recursive: true })
  }

  record(input: ApiCallLogInput): ApiCallLogEntry {
    const entry = this.sanitize({
      ...input,
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString()
    })
    this.pruneBestEffort()
    writeFileSync(this.pathFor(entry.timestamp), `${JSON.stringify(entry)}\n`, { flag: 'a', encoding: 'utf8' })
    return entry
  }

  list(options: { limit?: number } = {}): ApiCallLogEntry[] {
    const limit = options.limit ?? 200
    const entries: ApiCallLogEntry[] = []
    for (const file of this.logFiles().reverse()) {
      const path = join(this.dir, file)
      for (const line of readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).reverse()) {
        try {
          entries.push(JSON.parse(line) as ApiCallLogEntry)
          if (entries.length >= limit) return entries
        } catch {
          /* ignore malformed log lines */
        }
      }
    }
    return entries
  }

  get(id: string): ApiCallLogEntry | null {
    return this.list({ limit: 1000 }).find((entry) => entry.id === id) ?? null
  }

  clear(): void {
    if (!existsSync(this.dir)) return
    for (const file of readdirSync(this.dir)) {
      if (file.endsWith('.jsonl')) rmSync(join(this.dir, file), { force: true })
    }
  }

  openDir(): Promise<string> {
    mkdirSync(this.dir, { recursive: true })
    return shell.openPath(this.dir)
  }

  private sanitize(input: ApiCallLogInput & { id: string; timestamp: string }): ApiCallLogEntry {
    const secrets = [input.apiKey].filter((value): value is string => !!value)
    const cleanText = (value: string | undefined): string | undefined => {
      if (!value) return value
      let next = value.replace(/authorization\s*:\s*bearer\s+\S+/gi, '[redacted auth header]')
      next = next.replace(/x-api-key\s*:\s*\S+/gi, '[redacted api key header]')
      for (const secret of secrets) {
        if (secret) next = next.split(secret).join('[redacted api key]')
      }
      next = next.replace(/\bsk-[A-Za-z0-9._-]{6,}\b/g, '[redacted api key]')
      return truncate(next, MAX_SUMMARY_CHARS)
    }

    return {
      id: input.id,
      timestamp: input.timestamp,
      source: input.source,
      providerId: input.providerId,
      providerName: input.providerName,
      format: input.format,
      baseUrl: input.baseUrl,
      model: input.model,
      cwd: input.cwd,
      messagesSummary: cleanText(input.messagesSummary),
      systemSummary: cleanText(input.systemSummary),
      toolNames: input.toolNames,
      apiMaxSteps: input.apiMaxSteps,
      temperature: input.temperature,
      topP: input.topP,
      durationMs: input.durationMs,
      status: input.status,
      usage: input.usage,
      error: cleanText(input.error),
      structuredOutput: input.structuredOutput,
      costUsd: input.costUsd
    }
  }

  private pathFor(timestamp: string): string {
    return join(this.dir, `${timestamp.slice(0, 10)}.jsonl`)
  }

  private logFiles(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort()
  }

  private pruneBestEffort(): void {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
      for (const file of this.logFiles()) {
        const stamp = Date.parse(basename(file, '.jsonl'))
        if (Number.isFinite(stamp) && stamp < cutoff) rmSync(join(this.dir, file), { force: true })
      }

      let files = this.logFiles()
      let totalBytes = files.reduce((sum, file) => sum + statSync(join(this.dir, file)).size, 0)
      while (totalBytes > MAX_TOTAL_BYTES && files.length > 0) {
        const oldest = files[0]
        const path = join(this.dir, oldest)
        totalBytes -= statSync(path).size
        rmSync(path, { force: true })
        files = files.slice(1)
      }
    } catch {
      /* logging must never break API calls */
    }
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value
}
