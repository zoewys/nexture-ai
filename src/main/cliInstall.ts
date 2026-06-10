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
export async function installClaudeCode(onProgress?: (msg: string) => void): Promise<InstallResult> {
  onProgress?.('正在通过 npm 安装 Claude Code…')
  const result = await run('npm', ['install', '-g', '@anthropic-ai/claude-code'], 180_000)
  if (result.code === 0) {
    onProgress?.('Claude Code 安装完成')
    return { ok: true, message: 'Claude Code installed successfully.' }
  }
  onProgress?.(`安装失败: ${result.stderr.slice(-100) || 'unknown error'}`)
  return {
    ok: false,
    message: `Install failed (exit ${result.code}): ${result.stderr.slice(-300) || result.stdout.slice(-300) || 'unknown error'}`
  }
}

/** Install Codex CLI via npm (cross-platform: macOS / Windows / Linux). */
export async function installCodexCli(onProgress?: (msg: string) => void): Promise<InstallResult> {
  onProgress?.('正在通过 npm 安装 Codex CLI…')
  const result = await run('npm', ['install', '-g', '@openai/codex'], 180_000)
  if (result.code === 0) {
    onProgress?.('Codex CLI 安装完成')
    return { ok: true, message: 'Codex CLI installed successfully.' }
  }
  onProgress?.(`安装失败: ${result.stderr.slice(-100) || 'unknown error'}`)
  return {
    ok: false,
    message: `Install failed (exit ${result.code}): ${result.stderr.slice(-300) || result.stdout.slice(-300) || 'unknown error'}`
  }
}
