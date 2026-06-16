import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import type { FileChangedCallback } from './fileWrite'
import type { PermissionGuard } from './PermissionGuard'

const FILE_PATH_DESCRIPTION = 'File path to edit. Relative paths are resolved from the current project directory; absolute paths are accepted.'

interface FileEditOperation {
  old_string: string
  new_string: string
  replace_all?: boolean
}

export function createFileEditTool(cwd: string, guard: PermissionGuard, onFileChanged?: FileChangedCallback) {
  return tool({
    inputSchema: z.object({
      file_path: z.string().describe(FILE_PATH_DESCRIPTION),
      old_string: z.string().optional().describe('Exact text to replace for a single edit. Prefer edits[] when applying multiple changes.'),
      new_string: z.string().optional().describe('Replacement text for a single edit. Must be different from old_string.'),
      replace_all: z.boolean().optional().describe('For a single edit, replace every match instead of requiring exactly one match. Defaults to false.'),
      edits: z.array(z.object({
        old_string: z.string().describe('Exact text to replace in this edit. Edits are applied in array order.'),
        new_string: z.string().describe('Replacement text for this edit.'),
        replace_all: z.boolean().optional().describe('Replace every match for this edit instead of requiring exactly one match.')
      })).optional().describe('Multiple edits to apply to the same file in order. Use this for coordinated replacements.')
    }),
    execute: async (input: {
      file_path: string
      old_string?: string
      new_string?: string
      replace_all?: boolean
      edits?: FileEditOperation[]
    }) => {
      const filePath = resolveToolPath(cwd, input.file_path)
      if (!(await guard.request('file_edit', filePath))) return `错误: 权限被拒绝: ${filePath}`

      let content: string
      try {
        content = readFileSync(filePath, 'utf8')
      } catch (err) {
        return `错误: 文件不存在或无法读取: ${err instanceof Error ? err.message : String(err)}`
      }

      const edits = normalizeEdits(input)
      if (typeof edits === 'string') return edits

      let next = content
      let replacements = 0
      for (const edit of edits) {
        const applied = applyEdit(next, edit)
        if (typeof applied === 'string') return applied
        next = applied.content
        replacements += applied.replacements
      }
      writeFileSync(filePath, next, 'utf8')
      onFileChanged?.(filePath, 'modify')
      return edits.length === 1
        ? `替换成功: ${replacements} 处`
        : `${edits.length} edits applied successfully (${replacements} replacements)`
    }
  })
}

function normalizeEdits(input: {
  old_string?: string
  new_string?: string
  replace_all?: boolean
  edits?: FileEditOperation[]
}): FileEditOperation[] | string {
  if (input.edits && input.edits.length > 0) return input.edits
  if (input.old_string === undefined || input.new_string === undefined) {
    return '错误: 请提供 old_string/new_string 或 edits 数组'
  }
  return [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }]
}

function applyEdit(content: string, edit: FileEditOperation): { content: string; replacements: number } | string {
  if (edit.old_string === edit.new_string) return '错误: old_string 和 new_string 不能相同'
  const count = countOccurrences(content, edit.old_string)
  if (count === 0) return '错误: 未找到匹配文本'
  if (count > 1 && edit.replace_all !== true) return '错误: 找到多个匹配，请使用 replace_all'

  return {
    content: edit.replace_all === true
      ? content.split(edit.old_string).join(edit.new_string)
      : content.replace(edit.old_string, edit.new_string),
    replacements: edit.replace_all === true ? count : 1
  }
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

function resolveToolPath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}
