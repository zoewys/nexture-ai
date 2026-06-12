import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'

export function createFileReadTool(cwd: string) {
  void cwd
  return tool({
    inputSchema: z.object({
      file_path: z.string().describe('文件的绝对路径'),
      offset: z.number().optional().describe('起始行号（从 0 开始）'),
      limit: z.number().optional().describe('最大读取行数，默认 2000')
    }),
    execute: async (input: { file_path: string; offset?: number; limit?: number }) => {
      if (!isAbsolute(input.file_path)) return `错误: file_path 必须是绝对路径: ${input.file_path}`
      try {
        const content = readFileSync(input.file_path, 'utf8')
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
