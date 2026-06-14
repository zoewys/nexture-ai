import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AdapterCapabilities, AgentEvent } from '@shared/types'
import type { CliAdapter, RunTurnInput } from './types'
import { AsyncQueue } from './AsyncQueue'
import { spawnProcess } from './ProcessManager'
import { buildCodexExecArgs } from './codexArgs'
import { createCodexParser } from './codexParser'

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
    nativeResume: true,
    structuredOutputSchema: true,
    partialTokenStream: true
  }

  runTurn(input: RunTurnInput): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>()
    const cmd = input.cliPath ?? 'codex'
    const parseCodexLine = createCodexParser()
    let sawTerminalEvent = false

    // Codex does not have --append-system-prompt; prepend to the prompt.
    const prompt = input.appendSystemPrompt
      ? `# System\n${input.appendSystemPrompt}\n\n# Task\n${input.prompt}`
      : input.prompt
    const outputSchemaPath = input.outputSchema ? writeCodexOutputSchema(input.outputSchema) : undefined
    const cleanupOutputSchema = createOutputSchemaCleanup(outputSchemaPath)
    const args = buildCodexExecArgs(
      { ...input, outputSchemaPath, resumeFrom: input.resumeFrom?.sessionId },
      prompt
    )

    const handle = spawnProcess(
      { cmd, args, cwd: input.cwd, abortSignal: input.abortSignal },
      {
        onStdoutLine: (line) => {
          for (const ev of parseCodexLine(line)) {
            if (ev.kind === 'turn-done') sawTerminalEvent = true
            queue.push(ev)
          }
        },
        onStderr: (text) => {
          // Separate benign plugin noise from potentially actionable auth/MCP
          // messages. Plugin warnings are silent; MCP/auth messages become
          // system events so the user can see connection progress.
          const { noise, mcp } = filterCodexStderr(text)
          if (noise) queue.push({ kind: 'stderr', text: noise })
          if (mcp) queue.push({ kind: 'system', text: `[Codex] ${mcp}` })
        },
        onSpawnError: (err) => {
          cleanupOutputSchema()
          queue.push({
            kind: 'error',
            recoverable: false,
            message: `Failed to launch '${cmd}': ${err.message}`,
            raw: err
          })
          queue.close()
        },
        onExit: (code, signal) => {
          cleanupOutputSchema()
          if (input.abortSignal.aborted) {
            queue.push({ kind: 'turn-done', sessionId: '', reason: 'aborted' })
          } else if (sawTerminalEvent) {
            // `turn.completed` / `turn.failed` already closed the logical turn.
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

function writeCodexOutputSchema(schema: unknown): string {
  const schemaDir = join(tmpdir(), 'agent-studio-codex-schemas')
  mkdirSync(schemaDir, { recursive: true })
  const schemaPath = join(schemaDir, `${randomUUID()}.json`)
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2), 'utf8')
  return schemaPath
}

function createOutputSchemaCleanup(schemaPath: string | undefined): () => void {
  let cleaned = false
  return () => {
    if (!schemaPath || cleaned) return
    cleaned = true
    try {
      rmSync(schemaPath, { force: true })
    } catch {
      // Best-effort cleanup only; the schema file is generated under tmpdir().
    }
  }
}

/** Split Codex stderr into benign noise (suppressed) and MCP/auth messages
 *  (surfaced as system events to show connection progress). */
function filterCodexStderr(text: string): { noise: string; mcp: string } {
  const withoutPluginAssetIconWarnings = text.replace(
    /(?:\S+\s+WARN\s+)?codex_core_skills::loader: ignoring\s+interface\.icon_(?:small|large): icon path with '\.\.' must\s+resolve under plugin assets\/?/g,
    ''
  )

  const lines = withoutPluginAssetIconWarnings.split('\n')
  const noiseLines: string[] = []
  const mcpLines: string[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    if (
      /rmcp::transport::worker/.test(line) ||
      /MCP grant token/.test(line) ||
      /grant token not valid/.test(line) ||
      /Missing or invalid access token/.test(line) ||
      /AuthRequired\b/.test(line) ||
      /UnexpectedContentType/.test(line)
    ) {
      mcpLines.push(line.trim())
    } else {
      noiseLines.push(line)
    }
  }

  return { noise: noiseLines.join('\n'), mcp: mcpLines.join('\n') }
}
