import type { AdapterCapabilities, AgentEvent } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'
import { spawnProcess } from './ProcessManager'
import { parseCodexLine } from './codexParser'

/**
 * Drives the Codex CLI in single-shot exec mode.
 *
 * Unlike claude, codex exec is not resident — each turn spawns a fresh process.
 * There is no bidirectional stdin, so pushInput is intentionally absent.
 * Session continuity is achieved via `--resume <sessionId>`.
 */
export class CodexAdapter implements CliAdapter {
  readonly vendor = 'codex' as const
  readonly capabilities: AdapterCapabilities = {
    bidirectionalStdin: false,
    structuredOutputSchema: true,
    partialTokenStream: false
  }

  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    const cmd = input.cliPath ?? 'codex'

    const args = ['exec']
    if (input.model) args.push('--model', input.model)
    for (const dir of input.addDirs ?? []) args.push('--add-dir', dir)
    args.push('--json')
    if (input.resumeFrom?.sessionId) args.push('--resume', input.resumeFrom.sessionId)
    args.push('--dangerously-bypass-approvals-and-sandbox')

    // Codex does not have --append-system-prompt; prepend to the prompt.
    const prompt = input.appendSystemPrompt
      ? `# System\n${input.appendSystemPrompt}\n\n# Task\n${input.prompt}`
      : input.prompt
    args.push(prompt)

    spawnProcess(
      { cmd, args, cwd: input.cwd, abortSignal: input.abortSignal },
      {
        onStdoutLine: (line) => {
          for (const ev of parseCodexLine(line)) queue.push(ev)
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
              message: `codex exited with code ${code}${signal ? ` (${signal})` : ''}`
            })
          } else {
            queue.push({ kind: 'turn-done', sessionId: '', reason: 'complete' })
          }
          queue.close()
        }
      }
    )

    return queue
  }
}