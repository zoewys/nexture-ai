import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface SpawnOptions {
  cmd: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  abortSignal: AbortSignal
}

export interface ProcessHandle {
  /** Write a line to the child's stdin (used for claude's stream-json input). */
  writeLine(line: string): void
  /** Close stdin to signal end-of-input. */
  endStdin(): void
  /** Force-terminate the process tree. */
  kill(): void
  readonly child: ChildProcessWithoutNullStreams
}

export interface ProcessCallbacks {
  /** Called once per complete stdout line (newline-delimited). */
  onStdoutLine: (line: string) => void
  /** Called with raw stderr chunks (may be partial). */
  onStderr: (text: string) => void
  /** Called once when the process exits. */
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void
  /** Called if spawn itself fails (e.g. command not found). */
  onSpawnError: (err: Error) => void
}

/**
 * Spawns a child process and delivers newline-buffered stdout. Tolerates
 * partial lines (a JSON object split across two stdout chunks) by holding a
 * buffer until a newline arrives.
 *
 * Wiring the AbortSignal here means a single `abort()` upstream cleanly kills
 * the process from anywhere in the stack.
 */
export function spawnProcess(opts: SpawnOptions, cb: ProcessCallbacks): ProcessHandle {
  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  }) as ChildProcessWithoutNullStreams

  let stdoutBuf = ''
  let killed = false

  const kill = (): void => {
    if (killed) return
    killed = true
    // SIGTERM first; escalate to SIGKILL if it lingers.
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, 3000)
    // Don't let the escalation timer keep the event loop alive.
    t.unref?.()
  }

  const onAbort = (): void => kill()
  if (opts.abortSignal.aborted) {
    // Aborted before we even started — kill on next tick.
    queueMicrotask(kill)
  } else {
    opts.abortSignal.addEventListener('abort', onAbort, { once: true })
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuf += chunk
    let idx: number
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx)
      stdoutBuf = stdoutBuf.slice(idx + 1)
      if (line.length > 0) cb.onStdoutLine(line)
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => cb.onStderr(chunk))

  child.on('error', (err) => {
    opts.abortSignal.removeEventListener('abort', onAbort)
    cb.onSpawnError(err)
  })

  child.on('close', (code, signal) => {
    opts.abortSignal.removeEventListener('abort', onAbort)
    // Flush any trailing partial line that had no newline.
    if (stdoutBuf.trim().length > 0) {
      cb.onStdoutLine(stdoutBuf)
      stdoutBuf = ''
    }
    cb.onExit(code, signal)
  })

  return {
    child,
    writeLine(line: string) {
      if (!killed && child.stdin.writable) {
        child.stdin.write(line.endsWith('\n') ? line : line + '\n')
      }
    },
    endStdin() {
      if (!killed && child.stdin.writable) child.stdin.end()
    },
    kill
  }
}
