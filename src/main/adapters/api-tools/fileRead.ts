import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'

const FILE_PATH_DESCRIPTION = 'File path to read. Relative paths are resolved from the current project directory; absolute paths are accepted.'

export function createFileReadTool(cwd: string) {
  return tool({
    inputSchema: z.object({
      file_path: z.string().describe(FILE_PATH_DESCRIPTION),
      offset: z.number().optional().describe('Zero-based starting line. Use this with limit for large files.'),
      limit: z.number().optional().describe('Maximum number of lines to return. Defaults to 2000.')
    }),
    execute: async (input: { file_path: string; offset?: number; limit?: number }) => {
      const filePath = resolveToolPath(cwd, input.file_path)
      try {
        const content = readFileSync(filePath, 'utf8')
        if (content.length === 0) return ''
        const lines = content.split('\n')
        const offset = Math.max(0, input.offset ?? 0)
        const limit = Math.max(0, input.limit ?? 2000)
        return lines
          .slice(offset, offset + limit)
          .map((line, index) => `${offset + index}\t${line}`)
          .join('\n')
      } catch (err) {
        return `错误: 文件不存在或无法读取: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  })
}

function resolveToolPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}
