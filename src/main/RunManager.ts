import { randomUUID } from 'node:crypto'
import type { AgentEvent, RunConfig } from '@shared/types'
import type { CliAdapter } from './adapters/types'
import { createAdapter } from './adapters/factory'

interface LiveRun {
  id: string
  adapter: CliAdapter
  abort: AbortController
}

/**
 * Tracks in-flight runs so the IPC layer can route pushInput()/abort() to the
 * right adapter, and so app shutdown can kill every child process.
 */
export class RunManager {
  private runs = new Map<string, LiveRun>()

  /**
   * Start a run. Events are delivered via `onEvent`; the method returns the
   * runId immediately and pumps events on a detached async loop.
   */
  start(config: RunConfig, onEvent: (runId: string, event: AgentEvent) => void): string {
    const id = randomUUID()
    const adapter = createAdapter(config.vendor)
    const abort = new AbortController()
    this.runs.set(id, { id, adapter, abort })

    const iterable = adapter.runTurn({
      prompt: config.prompt,
      cwd: config.cwd,
      model: config.model,
      addDirs: config.addDirs,
      appendSystemPrompt: config.appendSystemPrompt,
      outputSchema: config.outputSchema,
      resumeFrom: config.resumeFrom,
      cliPath: config.cliPath,
      abortSignal: abort.signal
    })

    void this.pump(id, iterable, onEvent)
    return id
  }

  private async pump(
    id: string,
    iterable: AsyncIterable<AgentEvent>,
    onEvent: (runId: string, event: AgentEvent) => void
  ): Promise<void> {
    try {
      for await (const event of iterable) {
        onEvent(id, event)
      }
    } catch (err) {
      onEvent(id, {
        kind: 'error',
        recoverable: false,
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      this.runs.delete(id)
    }
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
