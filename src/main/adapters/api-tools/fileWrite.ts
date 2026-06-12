import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import type { PermissionGuard } from './PermissionGuard'

export type FileChangedCallback = (filePath: string, op: 'create' | 'modify') => void

export function createFileWriteTool(cwd: string, guard: PermissionGuard, onFileChanged?: FileChangedCallback) {
  void cwd
  return tool({
    inputSchema: z.object({
      file_path: z.string().describe('文件的绝对路径'),
      content: z.string().describe('要写入的内容')
    }),
    execute: async (input: { file_path: string; content: string }) => {
      if (!isAbsolute(input.file_path)) return `错误: file_path 必须是绝对路径: ${input.file_path}`
      if (!(await guard.request('file_write', input.file_path))) return `错误: 权限被拒绝: ${input.file_path}`

      const existed = existsSync(input.file_path)
      mkdirSync(dirname(input.file_path), { recursive: true })
      writeFileSync(input.file_path, input.content, 'utf8')
      onFileChanged?.(input.file_path, existed ? 'modify' : 'create')
      return `写入成功: ${Buffer.byteLength(input.content, 'utf8')} bytes`
    }
  })
}
