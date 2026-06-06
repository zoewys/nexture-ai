import { createReadStream, watch, statSync } from 'node:fs'
import type { FSWatcher, Stats } from 'node:fs'

/**
 * A lightweight delta emitted when a watched transcript grows.
 * Inspired by CodeIsland's `ConversationTailDelta`.
 */
export interface TranscriptDelta {
  sessionId: string
  /** Latest user prompt text seen in appended lines, if any. */
  lastUserPrompt?: string
  /** Latest assistant message text seen in appended lines, if any. */
  lastAssistantMessage?: string
}

export type DeltaHandler = (delta: TranscriptDelta) => void

interface WatchState {
  sessionId: string
  filePath: string
  offset: number
  inode: number
  watcher: FSWatcher
  /** Callback debounce timer so rapid writes produce a single delta. */
  debounce: ReturnType<typeof setTimeout> | null
}

/**
 * Watches one or more JSONL transcript files and streams incremental
 * `TranscriptDelta` events as new lines are appended.
 *
 * This is a Node.js port of CodeIsland's `JSONLTailer` — instead of
 * `DispatchSource.makeFileSystemObjectSource` we use `fs.watch` with a
 * debounce, and `createReadStream` for incremental reads.
 *
 * Thread safety: all state lives on the main thread (Electron), consistent
 * with the rest of agent-studio's main-process code.
 */
export class TranscriptTailer {
  private watches = new Map<string, WatchState>()

  constructor(private readonly onDelta: DeltaHandler) {}

  /** Start watching a session's transcript file. Idempotent — if already
   *  watching the same path, this is a no-op. */
  attach(sessionId: string, filePath: string): void {
    const existing = this.watches.get(sessionId)
    if (existing?.filePath === filePath) return

    // Tear down any previous watch for this session.
    this.detach(sessionId)

    let stat: Stats
    try {
      stat = statSync(filePath)
    } catch {
      // File doesn't exist yet — it will be created by the first write.
      // Start watching the directory so we pick it up when it appears.
      return
    }
    if (!stat.isFile()) return

    const watcher = watch(filePath, { persistent: false }, () =>
      this.onFileChange(sessionId)
    )
    watcher.on('error', () => this.detach(sessionId))

    this.watches.set(sessionId, {
      sessionId,
      filePath,
      offset: stat.size, // start at end-of-file
      inode: stat.ino,
      watcher,
      debounce: null
    })
  }

  /** Stop watching a session. */
  detach(sessionId: string): void {
    const w = this.watches.get(sessionId)
    if (!w) return
    if (w.debounce !== null) clearTimeout(w.debounce)
    try {
      w.watcher.close()
    } catch {
      /* already closed */
    }
    this.watches.delete(sessionId)
  }

  /** Stop all watches. */
  detachAll(): void {
    for (const sid of this.watches.keys()) this.detach(sid)
  }

  get activeSessionCount(): number {
    return this.watches.size
  }

  // ── internals ──────────────────────────────────────────────────────────

  private onFileChange(sessionId: string): void {
    const w = this.watches.get(sessionId)
    if (!w) return

    // Debounce: rapid writes (e.g. one JSONL line) fire multiple fs.watch
    // events on macOS. Wait 10ms so batch writes produce a single delta.
    if (w.debounce !== null) return
    w.debounce = setTimeout(() => {
      w.debounce = null
      this.readIncrement(w)
    }, 10)
  }

  private readIncrement(w: WatchState): void {
    let stat: Stats
    try {
      stat = statSync(w.filePath)
    } catch {
      return
    }

    // Inode change: file was rotated (e.g. /clear — new session). Re-attach
    // from the start of the new file so we don't miss the new prefix.
    if (stat.ino !== w.inode) {
      const path = w.filePath
      const sid = w.sessionId
      this.detach(sid)
      // Restore the watch from byte 0 with the new inode.
      const watcher = watch(path, { persistent: false }, () =>
        this.onFileChange(sid)
      )
      watcher.on('error', () => this.detach(sid))
      this.watches.set(sid, {
        sessionId: sid,
        filePath: path,
        offset: 0,
        inode: stat.ino,
        watcher,
        debounce: null
      })
      // Read from byte 0 of the new file immediately.
      const renewed = this.watches.get(sid)
      if (renewed) this.readIncrement(renewed)
      return
    }

    // Truncation: the file shrank — rewind so we don't miss the new prefix.
    if (stat.size < w.offset) {
      w.offset = 0
    }

    if (stat.size <= w.offset) return

    // Read only the appended bytes.
    const start = w.offset
    const end = stat.size
    w.offset = end // advance before async read to avoid races

    const chunks: Buffer[] = []
    const stream = createReadStream(w.filePath, { start, end: end - 1 })

    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('error', () => {
      // On read error, rewind offset so we retry on the next change.
      w.offset = Math.min(w.offset, start)
    })
    stream.on('end', () => {
      const appended = Buffer.concat(chunks).toString('utf8')
      const delta = TranscriptTailer.scanLines(appended)
      if (!delta.lastUserPrompt && !delta.lastAssistantMessage) return
      this.onDelta({
        sessionId: w.sessionId,
        lastUserPrompt: delta.lastUserPrompt,
        lastAssistantMessage: delta.lastAssistantMessage
      })
    })
  }

  // ── Pure parser (exposed for tests) ────────────────────────────────────

  /**
   * Scan newline-delimited JSON text and extract the latest user / assistant
   * message text. Returns null fields when nothing changed.
   *
   * Like CodeIsland's `JSONLTailer.scanLines`, this does a fast-path byte
   * probe for `"type":"` before falling through to JSON.parse — most lines
   * in a Claude transcript are tool_use / tool_result / meta and can be
   * skipped cheaply.
   */
  static scanLines(text: string): {
    lastUserPrompt?: string
    lastAssistantMessage?: string
  } {
    const result: { lastUserPrompt?: string; lastAssistantMessage?: string } = {}
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line) continue

      // Fast path: skip lines that don't contain an interesting type.
      const upIdx = line.indexOf('"type":"')
      if (upIdx < 0) continue
      const typeChar = line[upIdx + 8]
      if (typeChar !== '"') continue
      const nextChar = line[upIdx + 9]
      // 'u' = user, 'a' = assistant — only these two matter.
      if (nextChar !== 'u' && nextChar !== 'a') continue
      // Verify exact match: "user" or "assistant"
      const typeStart = upIdx + 9
      if (nextChar === 'u' && line.startsWith('user"', typeStart)) {
        const text = TranscriptTailer.extractTextFromJson(line)
        if (text) result.lastUserPrompt = text
      } else if (nextChar === 'a' && line.startsWith('assistant"', typeStart)) {
        const text = TranscriptTailer.extractTextFromJson(line)
        if (text) result.lastAssistantMessage = text
      }
    }
    return result
  }

  /** Parse a single JSONL line and extract the text content from a
   *  user or assistant message. */
  private static extractTextFromJson(line: string): string | null {
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      return null
    }
    if (!obj || typeof obj !== 'object') return null
    if (obj.isMeta === true) return null
    return TranscriptTailer.extractText(obj.message?.content ?? obj.content)
  }

  /** Extract text from a Claude-style content value (string or array of
   *  content blocks). */
  static extractText(content: unknown): string | null {
    if (typeof content === 'string') {
      const trimmed = content.trim()
      return trimmed || null
    }
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          const trimmed = b.text.trim()
          if (trimmed) parts.push(trimmed)
        }
      }
      return parts.length ? parts.join('\n') : null
    }
    return null
  }
}
