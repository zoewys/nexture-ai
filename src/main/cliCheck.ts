import { spawn } from 'node:child_process'
import type { CliCheckResult, CliVersionResult } from '@shared/types'
import { withCliPath } from './cliEnv'

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
      const child = spawn(cmd, ['--version'], { stdio: 'ignore', env: withCliPath() })
      child.on('error', () => done(false))
      child.on('close', (code) => done(code === 0))
      const t = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* noop */ }
        done(false)
      }, 15000)
      t.unref?.()
    } catch {
      done(false)
    }
  })
}

/** Run `cmd --version` and return the stdout, or null if unavailable. */
function version(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (val: string | null): void => {
      if (settled) return
      settled = true
      resolve(val)
    }
    try {
      const child = spawn(cmd, ['--version'], { stdio: 'pipe', env: withCliPath() })
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { output += chunk })
      child.on('error', () => done(null))
      child.on('close', (code) => done(code === 0 ? output.trim() : null))
      const t = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* noop */ }
        done(null)
      }, 15000)
      t.unref?.()
    } catch {
      done(null)
    }
  })
}

export async function checkClis(): Promise<CliCheckResult> {
  const [claude, codex] = await Promise.all([probe('claude'), probe('codex')])
  return { claude, codex }
}

export async function getCliVersions(): Promise<CliVersionResult> {
  const [claude, codex] = await Promise.all([version('claude'), version('codex')])
  return { claude, codex }
}
