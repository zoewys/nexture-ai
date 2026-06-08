import { spawn } from 'node:child_process'
import { withCliPath } from './cliEnv'

export type InstallResult = { ok: boolean; message: string }

/** Spawn a command and collect stdout/stderr. Resolves when the process exits. */
function run(
  cmd: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(cmd, args, {
      env: withCliPath(),
      stdio: 'pipe'
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
      resolve({ code: null, stdout, stderr: stderr + '\n[timed out]' })
    }, timeoutMs)
    timer.unref?.()
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: err.message })
    })
  })
}

/** Install Claude Code globally via npm. */
export async function installClaudeCode(): Promise<InstallResult> {
  const result = await run('npm', ['install', '-g', '@anthropic-ai/claude-code'], 180_000)
  if (result.code === 0) {
    return { ok: true, message: 'Claude Code installed successfully.' }
  }
  return {
    ok: false,
    message: `Install failed (exit ${result.code}): ${result.stderr.slice(-300) || result.stdout.slice(-300) || 'unknown error'}`
  }
}

/** Install Codex CLI via the official curl installer. */
export async function installCodexCli(): Promise<InstallResult> {
  // codex's recommended install: curl -fsSL https://… | sh
  const pipe = spawn('sh', [], {
    env: withCliPath(),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  pipe.stdout.setEncoding('utf8')
  pipe.stdout.on('data', (chunk: string) => { stdout += chunk })
  pipe.stderr.setEncoding('utf8')
  pipe.stderr.on('data', (chunk: string) => { stderr += chunk })

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { pipe.kill('SIGKILL') } catch { /* noop */ }
      resolve({ ok: false, message: 'Install timed out after 3 minutes.' })
    }, 180_000)
    timer.unref?.()

    // Fetch the install script and pipe it to sh.
    const curl = spawn('curl', ['-fsSL', 'https://codex.openai.com/install.sh'], {
      env: withCliPath(),
      stdio: ['pipe', pipe.stdin, 'ignore']
    })
    curl.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, message: `Failed to fetch install script: ${err.message}` })
    })

    pipe.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ ok: true, message: 'Codex CLI installed successfully.' })
      } else {
        resolve({
          ok: false,
          message: `Install failed (exit ${code}): ${stderr.slice(-300) || stdout.slice(-300) || 'unknown error'}`
        })
      }
    })
    pipe.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, message: `Install failed: ${err.message}` })
    })
  })
}
