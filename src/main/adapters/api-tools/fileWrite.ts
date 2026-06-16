import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import type { PermissionGuard } from './PermissionGuard'

export type FileChangedCallback = (filePath: string, op: 'create' | 'modify' | 'delete') => void

const FILE_PATH_DESCRIPTION = 'File path. Relative paths are resolved from the current project directory; absolute paths are accepted.'

export function createFileWriteTool(cwd: string, guard: PermissionGuard, onFileChanged?: FileChangedCallback) {
  return tool({
    inputSchema: z.object({
      file_path: z.string().describe(FILE_PATH_DESCRIPTION),
      content: z.string().describe('Content to write. Use file_read first when overwriting a file you did not just create.')
    }),
    execute: async (input: { file_path: string; content: string }) => {
      const filePath = resolveToolPath(cwd, input.file_path)
      if (!(await guard.request('file_write', filePath))) return `错误: 权限被拒绝: ${filePath}`

      const existed = existsSync(filePath)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, input.content, 'utf8')
      onFileChanged?.(filePath, existed ? 'modify' : 'create')
      return `写入成功: ${Buffer.byteLength(input.content, 'utf8')} bytes`
    }
  })
}

function resolveToolPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}
