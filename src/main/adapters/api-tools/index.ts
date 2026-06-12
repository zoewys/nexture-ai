import { tool } from 'ai'
import { z } from 'zod'
import { createBashTool } from './bash'
import { createFetchTool } from './fetch'
import { createFileEditTool } from './fileEdit'
import { createFileReadTool } from './fileRead'
import { createFileWriteTool, type FileChangedCallback } from './fileWrite'
import { createGlobTool } from './glob'
import { createGrepTool } from './grep'
import { PermissionGuard } from './PermissionGuard'
import { createSourcegraphTool } from './sourcegraph'
import { createTodoWriteTool } from './todoWrite'

export { PermissionGuard }
export type { FileChangedCallback }

export function buildToolSet(
  cwd: string,
  signal: AbortSignal,
  guard: PermissionGuard,
  onFileChanged?: FileChangedCallback
) {
  return {
    bash: createBashTool(cwd, signal, guard),
    file_read: createFileReadTool(cwd),
    file_edit: createFileEditTool(cwd, guard, onFileChanged),
    file_write: createFileWriteTool(cwd, guard, onFileChanged),
    glob: createGlobTool(cwd),
    grep: createGrepTool(cwd),
    fetch: createFetchTool(),
    sourcegraph: createSourcegraphTool(),
    todo_write: createTodoWriteTool()
  }
}

export function unimplementedTool(name: string) {
  return tool({
    inputSchema: z.object({}),
    execute: async () => `${name} 工具未实现`
  })
}
