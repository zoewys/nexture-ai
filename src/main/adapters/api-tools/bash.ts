import { spawn } from 'node:child_process'
import { existsSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import type { PermissionGuard } from './PermissionGuard'
import type { FileChangedCallback } from './fileWrite'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 100 * 1024
const SNAPSHOT_LIMIT = 5000
const SNAPSHOT_IGNORE = new Set(['.git', 'node_modules', 'dist', 'out', '.tmp'])

export function createBashTool(cwd: string, signal: AbortSignal, guard: PermissionGuard, onFileChanged?: FileChangedCallback) {
  let currentCwd = cwd
  return tool({
    description: 'Run a shell command from the project. Use this for tests, builds, and commands that cannot be done with file tools; use file_read/file_edit/file_write for direct file operations.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute. The working directory is preserved across calls when the command changes directory.'),
      timeout: z.number().optional().describe('Timeout in milliseconds. Defaults to 120000 and is capped at 600000. Use shorter timeouts for risky commands.'),
      description: z.string().optional().describe('Short reason for running this command, shown in permission prompts.')
    }),
    execute: async (input: { command: string; timeout?: number; description?: string }) => {
      if (!(await guard.request('bash', input.description ?? input.command))) {
        return 'exit code: null\nError: permission denied'
      }
      const commandCwd = currentCwd
      const before = snapshotFiles(commandCwd)
      const result = await runCommand(commandCwd, signal, input.command, Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS))
      const after = snapshotFiles(commandCwd)
      for (const change of diffSnapshots(before, after)) onFileChanged?.(change.path, change.op)
      if (result.cwd && existsSync(result.cwd)) currentCwd = normalizeCwd(commandCwd, result.cwd)
      return formatResult(result.exitCode, result.output)
    }
  })
}

interface CommandResult {
  exitCode: number | null
  output: string
  cwd?: string
}

function runCommand(cwd: string, signal: AbortSignal, command: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const shell = process.env.SHELL || '/bin/bash'
    const marker = `__AGENT_STUDIO_CWD_${Date.now()}_${Math.random().toString(16).slice(2)}__`
    const wrappedCommand = [
      command,
      '__agent_studio_status=$?',
      `printf '\\n${marker}%s\\n' "$PWD"`,
      'exit $__agent_studio_status'
    ].join('\n')
    const child = spawn(shell, ['-lc', wrappedCommand], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    let output = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let killTimer: NodeJS.Timeout | undefined

    const append = (chunk: string): void => {
      output += chunk
      if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
        output = `${Buffer.from(output).subarray(0, MAX_OUTPUT_BYTES).toString('utf8')}\n[output truncated]`
      }
    }

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', abortHandler)
      const parsed = extractCwd(output, marker)
      output = parsed.output
      resolveResult({
        exitCode,
        output: timedOut
          ? `${output}${output ? '\n' : ''}Error: command timed out after ${timeoutMs}ms`
          : aborted
            ? `${output}${output ? '\n' : ''}Error: command aborted`
            : output,
        cwd: parsed.cwd
      })
    }

    const terminate = (): void => {
      killChildProcess(child.pid, 'SIGTERM')
      killTimer = setTimeout(() => {
        killChildProcess(child.pid, 'SIGKILL')
      }, 3000)
      killTimer.unref?.()
    }

    const abortHandler = (): void => {
      aborted = true
      terminate()
      finish(null)
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
      finish(null)
    }, timeoutMs)
    timer.unref?.()

    signal.addEventListener('abort', abortHandler)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (err) => {
      append(err.message)
      finish(null)
    })
    child.on('close', (code) => finish(timedOut ? null : code))
  })
}

function killChildProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') process.kill(pid, signal)
    else process.kill(-pid, signal)
  } catch {
    /* process already gone */
  }
}

function formatResult(exitCode: number | null, output: string): string {
  const body = output.replace(/\s+$/, '')
  return body ? `exit code: ${exitCode}\n${body}` : `exit code: ${exitCode}`
}

function extractCwd(output: string, marker: string): { output: string; cwd?: string } {
  const index = output.lastIndexOf(`\n${marker}`)
  if (index === -1) return { output }
  const before = output.slice(0, index)
  const rest = output.slice(index + marker.length + 1)
  const [cwd] = rest.split('\n')
  return { output: before, cwd: cwd?.trim() || undefined }
}

interface SnapshotEntry {
  mtimeMs: number
  size: number
}

function snapshotFiles(root: string): Map<string, SnapshotEntry> {
  const snapshot = new Map<string, SnapshotEntry>()
  collectSnapshot(root, snapshot)
  return snapshot
}

function collectSnapshot(current: string, snapshot: Map<string, SnapshotEntry>): void {
  if (snapshot.size >= SNAPSHOT_LIMIT) return
  let stat
  try {
    stat = statSync(current)
  } catch {
    return
  }
  if (stat.isFile()) {
    snapshot.set(current, { mtimeMs: stat.mtimeMs, size: stat.size })
    return
  }
  if (!stat.isDirectory()) return

  let entries: string[]
  try {
    entries = readdirSync(current)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SNAPSHOT_IGNORE.has(entry)) continue
    collectSnapshot(join(current, entry), snapshot)
    if (snapshot.size >= SNAPSHOT_LIMIT) return
  }
}

function diffSnapshots(before: Map<string, SnapshotEntry>, after: Map<string, SnapshotEntry>): Array<{ path: string; op: 'create' | 'modify' | 'delete' }> {
  const changes: Array<{ path: string; op: 'create' | 'modify' | 'delete' }> = []
  for (const [path, next] of after) {
    const prev = before.get(path)
    if (!prev) changes.push({ path, op: 'create' })
    else if (prev.mtimeMs !== next.mtimeMs || prev.size !== next.size) changes.push({ path, op: 'modify' })
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push({ path, op: 'delete' })
  }
  return changes
}

function normalizeCwd(previousCwd: string, nextCwd: string): string {
  try {
    const previousReal = realpathSync(previousCwd)
    const nextReal = realpathSync(nextCwd)
    const rel = relative(previousReal, nextReal)
    if (!rel || (!rel.startsWith('..') && !rel.startsWith('/'))) {
      return rel ? join(previousCwd, rel) : previousCwd
    }
  } catch {
    /* fall back to the shell-reported cwd */
  }
  return nextCwd
}
