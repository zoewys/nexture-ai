import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'

const EXCLUDED_DIRS = new Set(['node_modules', '.git'])
const MAX_RESULTS = 500

export function createGrepTool(cwd: string) {
  return tool({
    inputSchema: z.object({
      pattern: z.string().describe('搜索的正则表达式'),
      path: z.string().optional().describe('搜索的文件或目录，默认为项目根目录'),
      include: z.string().optional().describe('文件过滤模式，如 "*.ts"')
    }),
    execute: async (input: { pattern: string; path?: string; include?: string }) => {
      let regex: RegExp
      try {
        regex = new RegExp(input.pattern)
      } catch (err) {
        return `错误: 无效正则表达式: ${err instanceof Error ? err.message : String(err)}`
      }

      const searchPath = input.path ? (isAbsolute(input.path) ? input.path : resolve(cwd, input.path)) : cwd
      if (!existsSync(searchPath)) return `错误: 路径不存在: ${searchPath}`

      const rg = await runRipgrep(input.pattern, searchPath, input.include)
      if (rg.available) return rg.output

      return runNodeGrep(searchPath, regex, input.include, cwd)
    }
  })
}

function runRipgrep(pattern: string, searchPath: string, include?: string): Promise<{ available: boolean; output: string }> {
  return new Promise((resolveResult) => {
    const args = ['--line-number', '--no-heading', '--color', 'never', pattern, searchPath, '-g', '!node_modules', '-g', '!.git']
    if (include) args.push('-g', include)
    const child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      resolveResult({ available: err.code !== 'ENOENT', output: `错误: ${err.message}` })
    })
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolveResult({ available: true, output: limitLines(output.trimEnd(), MAX_RESULTS) })
      } else {
        resolveResult({ available: true, output: `错误: ${stderr.trim() || `rg exited with ${code}`}` })
      }
    })
  })
}

function runNodeGrep(searchPath: string, regex: RegExp, include: string | undefined, cwd: string): string {
  const includeMatcher = include ? globMatcher(include) : () => true
  const files: string[] = []
  collectFiles(searchPath, files)
  const results: string[] = []

  for (const filePath of files) {
    const rel = normalizePath(relative(cwd, filePath))
    if (!includeMatcher(basename(filePath)) && !includeMatcher(rel)) continue
    let content: string
    try {
      const raw = readFileSync(filePath)
      if (raw.includes(0)) continue
      content = raw.toString('utf8')
    } catch {
      continue
    }
    content.split('\n').forEach((line, index) => {
      regex.lastIndex = 0
      if (regex.test(line) && results.length < MAX_RESULTS) results.push(`${rel}:${index + 1}:${line}`)
    })
  }

  return results.join('\n')
}

function collectFiles(currentPath: string, files: string[]): void {
  const stat = statSync(currentPath)
  if (stat.isFile()) {
    files.push(currentPath)
    return
  }
  if (!stat.isDirectory()) return
  for (const entry of readdirSync(currentPath)) {
    if (EXCLUDED_DIRS.has(entry)) continue
    collectFiles(join(currentPath, entry), files)
  }
}

function limitLines(output: string, limit: number): string {
  if (!output) return ''
  const lines = output.split('\n')
  return lines.slice(0, limit).join('\n')
}

function globMatcher(pattern: string): (value: string) => boolean {
  const escaped = normalizePath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\0/g, '.*')
  const regex = new RegExp(`^${escaped}$`)
  return (value) => regex.test(normalizePath(value))
}

function normalizePath(value: string): string {
  return value.split(sep).join('/')
}
