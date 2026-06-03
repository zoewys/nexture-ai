import type { AdapterCapabilities, AgentEvent } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'
import { spawnProcess, type ProcessHandle } from './ProcessManager'
import { parseClaudeLine } from './claudeParser'

/**
 * Drives the Claude Code CLI in resident, bidirectional stream-json mode.
 *
 * Key shape: the process stays alive across turns. We feed user input as
 * stream-json on stdin and read normalized events off stdout. `turn-done` is
 * emitted as an event *within* the stream (we do NOT end the async iterable on
 * it) so the same run can accept interjections via pushInput().
 */
export class ClaudeAdapter implements CliAdapter {
  readonly vendor = 'claude' as const
  readonly capabilities: AdapterCapabilities = {
    bidirectionalStdin: true,
    structuredOutputSchema: true,
    partialTokenStream: true
  }

  private handle: ProcessHandle | null = null

  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    const cmd = input.cliPath ?? 'claude'

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose', // required by claude for stream-json output
      '--permission-mode',
      'bypassPermissions' // app-layer confirms at handoff points, not per-action
    ]
    if (input.model) args.push('--model', input.model)
    if (input.appendSystemPrompt) args.push('--append-system-prompt', input.appendSystemPrompt)
    for (const dir of input.addDirs ?? []) args.push('--add-dir', dir)
    if (input.resumeFrom?.sessionId) args.push('--resume', input.resumeFrom.sessionId)

    const handle = spawnProcess(
      { cmd, args, cwd: input.cwd, abortSignal: input.abortSignal },
      {
        onStdoutLine: (line) => {
          for (const ev of parseClaudeLine(line)) queue.push(ev)
        },
        onStderr: (text) => queue.push({ kind: 'stderr', text }),
        onSpawnError: (err) => {
          queue.push({
            kind: 'error',
            recoverable: false,
            message: `Failed to launch '${cmd}': ${err.message}`,
            raw: err
          })
          queue.close()
        },
        onExit: (code, signal) => {
          if (input.abortSignal.aborted) {
            queue.push({ kind: 'turn-done', sessionId: '', reason: 'aborted' })
          } else if (code !== 0 && code !== null) {
            queue.push({
              kind: 'error',
              recoverable: false,
              message: `claude exited with code ${code}${signal ? ` (${signal})` : ''}`
            })
          }
          queue.close()
        }
      }
    )
    this.handle = handle

    // Feed the first user turn as a stream-json user message.
    handle.writeLine(JSON.stringify(userMessage(input.prompt)))

    return queue
  }

  async pushInput(text: string): Promise<void> {
    if (!this.handle) throw new Error('No live claude process to push input to')
    this.handle.writeLine(JSON.stringify(userMessage(text)))
  }
}

/** Build a stream-json user message envelope accepted by `--input-format stream-json`. */
function userMessage(text: string): unknown {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }]
    }
  }
}
