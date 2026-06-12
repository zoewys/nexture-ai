import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import type { FileChangedCallback } from './fileWrite'
import type { PermissionGuard } from './PermissionGuard'

export function createFileEditTool(cwd: string, guard: PermissionGuard, onFileChanged?: FileChangedCallback) {
  void cwd
  return tool({
    inputSchema: z.object({
      file_path: z.string().describe('文件的绝对路径'),
      old_string: z.string().describe('要查找的精确文本'),
      new_string: z.string().describe('替换文本'),
      replace_all: z.boolean().optional().describe('是否替换所有匹配项，默认 false')
    }),
    execute: async (input: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }) => {
      if (!isAbsolute(input.file_path)) return `错误: file_path 必须是绝对路径: ${input.file_path}`
      if (input.old_string === input.new_string) return '错误: old_string 和 new_string 不能相同'
      if (!(await guard.request('file_edit', input.file_path))) return `错误: 权限被拒绝: ${input.file_path}`

      let content: string
      try {
        content = readFileSync(input.file_path, 'utf8')
      } catch (err) {
        return `错误: 文件不存在或无法读取: ${err instanceof Error ? err.message : String(err)}`
      }

      const count = countOccurrences(content, input.old_string)
      if (count === 0) return '错误: 未找到匹配文本'
      if (count > 1 && input.replace_all !== true) return '错误: 找到多个匹配，请使用 replace_all'

      const next = input.replace_all === true
        ? content.split(input.old_string).join(input.new_string)
        : content.replace(input.old_string, input.new_string)
      writeFileSync(input.file_path, next, 'utf8')
      onFileChanged?.(input.file_path, 'modify')
      return `替换成功: ${input.replace_all === true ? count : 1} 处`
    }
  })
}

function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = 0
  while (true) {
    const next = content.indexOf(needle, index)
    if (next === -1) return count
    count += 1
    index = next + needle.length
  }
}
