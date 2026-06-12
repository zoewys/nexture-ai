import { spawn } from 'node:child_process'
import { tool } from 'ai'
import { z } from 'zod'
import type { PermissionGuard } from './PermissionGuard'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 100 * 1024

export function createBashTool(cwd: string, signal: AbortSignal, guard: PermissionGuard) {
  return tool({
    inputSchema: z.object({
      command: z.string().describe('要执行的 Shell 命令'),
      timeout: z.number().optional().describe('超时时间（毫秒），默认 120000，最大 600000'),
      description: z.string().optional().describe('命令用途描述')
    }),
    execute: async (input: { command: string; timeout?: number; description?: string }) => {
      if (!(await guard.request('bash', input.description ?? input.command))) {
        return { exitCode: null, output: '错误: 权限被拒绝' }
      }
      return runCommand(cwd, signal, input.command, Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS))
    }
  })
}

function runCommand(cwd: string, signal: AbortSignal, command: string, timeoutMs: number): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolveResult) => {
    const shell = process.env.SHELL || '/bin/bash'
    const child = spawn(shell, ['-c', command], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined

    const append = (chunk: string): void => {
      output += chunk
      if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
        output = `${Buffer.from(output).subarray(0, MAX_OUTPUT_BYTES).toString('utf8')}\n[输出已截断]`
      }
    }

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', abortHandler)
      resolveResult({
        exitCode,
        output: timedOut ? `${output}${output ? '\n' : ''}错误: command timed out after ${timeoutMs}ms` : output
      })
    }

    const terminate = (): void => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* process already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* process already gone */
        }
      }, 3000)
      killTimer.unref?.()
    }

    const abortHandler = (): void => {
      terminate()
      finish(null)
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
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
