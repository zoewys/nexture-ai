import { randomUUID } from 'node:crypto'
import type { AgentEvent, RunConfig } from '@shared/types'
import type { CliAdapter } from './adapters/types'
import { createAdapter } from './adapters/factory'
import type { TranscriptStore } from './TranscriptStore'

interface LiveRun {
  id: string
  adapter: CliAdapter
  abort: AbortController
}

/** What one turn produced, used to decide whether a --resume attempt failed. */
interface TurnSummary {
  sawProgress: boolean
  sawError: boolean
}

/**
 * Tracks in-flight runs so the IPC layer can route pushInput()/abort() to the
 * right adapter, and so app shutdown can kill every child process.
 *
 * Also owns resume-failure recovery: if a turn launched with `--resume` never
 * makes progress and errors out (e.g. the session can't be found because cwd
 * changed), it transparently retries once by rebuilding context from the
 * transcript and running a fresh session.
 */
export class RunManager {
  private runs = new Map<string, LiveRun>()

  constructor(private readonly transcripts: TranscriptStore) {}

  /**
   * Start a run. Events are delivered via `onEvent`; the method returns the
   * runId immediately and pumps events on a detached async loop.
   */
  start(config: RunConfig, onEvent: (runId: string, event: AgentEvent) => void): string {
    const id = randomUUID()
    const adapter = createAdapter(config.vendor)
    const abort = new AbortController()
    this.runs.set(id, { id, adapter, abort })

    void this.runWithResume(id, config, adapter, abort, onEvent)
    return id
  }

  /** Run the turn; on detected resume failure, rebuild context and retry once. */
  private async runWithResume(
    id: string,
    config: RunConfig,
    adapter: CliAdapter,
    abort: AbortController,
    onEvent: (runId: string, event: AgentEvent) => void
  ): Promise<void> {
    try {
      const summary = await this.pump(id, adapter, config, abort, onEvent)

      // Heuristic (best-effort): a resume attempt failed if it was launched
      // with resumeFrom, wasn't user-aborted, never made progress (no session
      // start / no assistant output) and surfaced an error.
      const resumeFailed =
        !!config.resumeFrom &&
        !abort.signal.aborted &&
        !summary.sawProgress &&
        summary.sawError

      if (!resumeFailed) return

      onEvent(id, { kind: 'system', text: 'resume failed, retrying with transcript context' })
      const rebuiltPrompt = this.transcripts.buildResumePrompt(
        config.resumeFrom!.sessionId,
        config.prompt
      )
      const retryConfig: RunConfig = { ...config, prompt: rebuiltPrompt, resumeFrom: undefined }

      // Swap in a fresh adapter (claude keeps per-process state) but keep the
      // same AbortController so a user abort still targets the live process.
      const retryAdapter = createAdapter(config.vendor)
      const live = this.runs.get(id)
      if (live) live.adapter = retryAdapter

      await this.pump(id, retryAdapter, retryConfig, abort, onEvent)
    } finally {
      this.runs.delete(id)
    }
  }

  /** Drive one adapter turn to completion, forwarding events and summarizing. */
  private async pump(
    id: string,
    adapter: CliAdapter,
    config: RunConfig,
    abort: AbortController,
    onEvent: (runId: string, event: AgentEvent) => void
  ): Promise<TurnSummary> {
    let sawProgress = false
    let sawError = false

    const iterable = adapter.runTurn({
      prompt: config.prompt,
      cwd: config.cwd,
      model: config.model,
      addDirs: config.addDirs,
      appendSystemPrompt: config.appendSystemPrompt,
      outputSchema: config.outputSchema,
      resumeFrom: config.resumeFrom,
      cliPath: config.cliPath,
      permissionMode: config.permissionMode,
      abortSignal: abort.signal
    })

    try {
      for await (const event of iterable) {
        if (
          event.kind === 'session-started' ||
          event.kind === 'message' ||
          event.kind === 'message-delta'
        ) {
          sawProgress = true
        }
        if (event.kind === 'error') sawError = true
        if (event.kind === 'turn-done' && event.reason === 'error') sawError = true
        onEvent(id, event)
      }
    } catch (err) {
      sawError = true
      onEvent(id, {
        kind: 'error',
        recoverable: false,
        message: err instanceof Error ? err.message : String(err)
      })
    }

    return { sawProgress, sawError }
  }

  async push(id: string, text: string): Promise<void> {
    const run = this.runs.get(id)
    if (!run) throw new Error(`No live run: ${id}`)
    if (!run.adapter.pushInput) {
      throw new Error(`The ${run.adapter.vendor} adapter does not support mid-run interjection`)
    }
    await run.adapter.pushInput(text)
  }

  abort(id: string): void {
    this.runs.get(id)?.abort.abort()
  }

  /** Kill every live run — call on app shutdown to avoid orphan processes. */
  abortAll(): void {
    for (const run of this.runs.values()) run.abort.abort()
    this.runs.clear()
  }
}
