import { spawn } from 'node:child_process'
import type { CliCheckResult } from '@shared/types'

/** Resolve true if `cmd --version` exits 0 within a short timeout. */
function probe(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const child = spawn(cmd, ['--version'], { stdio: 'ignore' })
      child.on('error', () => done(false))
      child.on('close', (code) => done(code === 0))
      const t = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* noop */
        }
        done(false)
      }, 5000)
      t.unref?.()
    } catch {
      done(false)
    }
  })
}

export async function checkClis(): Promise<CliCheckResult> {
  const [claude, gemini, codex] = await Promise.all([
    probe('claude'),
    probe('gemini'),
    probe('codex')
  ])
  return { claude, gemini, codex }
}
