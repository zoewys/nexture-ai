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
    args.push('--skip-git-repo-check')

    // Codex does not have --append-system-prompt; prepend to the prompt.
    const prompt = input.appendSystemPrompt
      ? `# System\n${input.appendSystemPrompt}\n\n# Task\n${input.prompt}`
      : input.prompt
    args.push(prompt)

    const handle = spawnProcess(
      { cmd, args, cwd: input.cwd, abortSignal: input.abortSignal },
      {
        onStdoutLine: (line) => {
          for (const ev of parseCodexLine(line)) queue.push(ev)
        },
        onStderr: (text) => {
          // Codex's MCP client logs noisy transport errors to stderr when an
          // upstream MCP server is unreachable or its OAuth token expired.
          // These don't affect the main exec flow, so suppress them rather
          // than scaring the user with red text in the UI.
          if (isMcpNoise(text)) return
          queue.push({ kind: 'stderr', text })
        },
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

    // Close stdin immediately: codex sees a piped stdin and waits for EOF
    // before processing the prompt arg ("Reading additional input from stdin...").
    // Closing stdin signals EOF so codex proceeds with just the prompt argument.
    handle.endStdin()

    return queue
  }
}

/** Recognize codex's MCP transport chatter so we don't surface it to the UI. */
function isMcpNoise(text: string): boolean {
  return (
    /rmcp::transport::worker/.test(text) ||
    /MCP grant token/.test(text) ||
    /grant token not valid/.test(text) ||
    /Missing or invalid access token/.test(text) ||
    /AuthRequired\b/.test(text) ||
    /UnexpectedContentType/.test(text)
  )
}