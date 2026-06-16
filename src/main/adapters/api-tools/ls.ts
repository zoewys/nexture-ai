import { existsSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'

const MAX_ENTRIES = 500

export function createLsTool(cwd: string) {
  return tool({
    description: 'List one directory level. Use this to inspect directory contents; use glob to find files recursively and grep to search file contents.',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory path to list. Relative paths are resolved from the current project directory. Defaults to the project directory.')
    }),
    execute: async (input: { path?: string }) => {
      const dir = input.path ? resolveToolPath(cwd, input.path) : cwd
      if (!existsSync(dir)) return `Error: path not found: ${dir}`
      let stat
      try {
        stat = statSync(dir)
      } catch (err) {
        return `Error: cannot read path: ${err instanceof Error ? err.message : String(err)}`
      }
      if (!stat.isDirectory()) return `Error: path is not a directory: ${dir}`

      const entries = readdirSync(dir)
        .filter((entry) => entry !== 'node_modules' && entry !== '.git')
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_ENTRIES)
        .map((entry) => {
          const fullPath = join(dir, entry)
          const itemStat = statSync(fullPath)
          const type = itemStat.isDirectory() ? 'dir' : itemStat.isFile() ? 'file' : 'other'
          const rel = normalizePath(relative(cwd, fullPath)) + (type === 'dir' ? '/' : '')
          return `${rel || entry} ${type}`
        })
      const suffix = readdirSync(dir).length > MAX_ENTRIES
        ? `\n[output truncated to ${MAX_ENTRIES} entries]`
        : ''
      return `${entries.join('\n')}${suffix}`
    }
  })
}

function resolveToolPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}

function normalizePath(value: string): string {
  return value.split(sep).join('/')
}
