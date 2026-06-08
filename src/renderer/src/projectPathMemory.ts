/**
 * projectPathMemory.ts — 项目路径持久记忆
 *
 * 使用 localStorage 记住用户上次选择的项目目录路径，
 * 下次打开应用时自动填入 SingleRunPanel / NewWorkflowRunDrawer 的路径输入框。
 */

const LAST_PROJECT_PATH_KEY = 'agent-studio:last-project-path'

export function readLastProjectPath(): string {
  try {
    return window.localStorage.getItem(LAST_PROJECT_PATH_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberProjectPath(path: string): void {
  const clean = path.trim()
  if (!clean) return
  try {
    window.localStorage.setItem(LAST_PROJECT_PATH_KEY, clean)
  } catch {
    // Ignore storage failures; the picker/input still works normally.
  }
}
