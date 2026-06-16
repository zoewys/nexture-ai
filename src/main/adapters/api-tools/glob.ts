import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__'])
const MAX_RESULTS = 1000

export function createGlobTool(cwd: string) {
  return tool({
    description: 'Find files by glob pattern. Use this for file names and paths; use grep to search file contents.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern such as "src/**/*.ts". Results are relative to the search base.'),
      path: z.string().optional().describe('Base directory to search. Relative paths are resolved from the current project directory. Defaults to the project directory.')
    }),
    execute: async (input: { pattern: string; path?: string }) => {
      const baseDir = input.path ? (isAbsolute(input.path) ? input.path : resolve(cwd, input.path)) : cwd
      if (!existsSync(baseDir)) return `错误: 目录不存在: ${baseDir}`

      const matcher = globMatcher(input.pattern)
      const results: string[] = []
      walk(baseDir, baseDir, (filePath) => {
        const rel = normalizePath(relative(baseDir, filePath))
        if (matcher(rel) || matcher(basename(rel))) results.push(rel)
      })
      const limited = results.slice(0, MAX_RESULTS)
      const suffix = results.length > MAX_RESULTS ? `\n[结果已截断，仅显示前 ${MAX_RESULTS} 个文件]` : ''
      return `${limited.join('\n')}${suffix}`
    }
  })
}

function walk(baseDir: string, currentDir: string, onFile: (filePath: string) => void): void {
  for (const entry of readdirSync(currentDir)) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const fullPath = join(currentDir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) walk(baseDir, fullPath, onFile)
    else if (stat.isFile()) onFile(fullPath)
  }
}

function globMatcher(pattern: string): (value: string) => boolean {
  const normalized = normalizePath(pattern)
  const escaped = normalized
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
