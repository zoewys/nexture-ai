import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'

export interface WorktreeInfo {
  path: string
  branch: string
}

const WORKTREE_DIR = '.agent-studio/worktrees'

export function isGitRepo(projectPath: string): boolean {
  return !!git(['-C', resolve(projectPath), 'rev-parse', '--show-toplevel'])
}

export function createWorktree(projectPath: string, name: string): WorktreeInfo {
  const root = resolve(projectPath)
  const wtDir = join(root, WORKTREE_DIR)
  if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })

  const wtPath = join(wtDir, name)
  const branch = `agent-studio/${name}`
  git(['-C', root, 'worktree', 'add', wtPath, '-b', branch])
  return { path: wtPath, branch }
}

export function removeWorktree(projectPath: string, worktreePath: string): void {
  const root = resolve(projectPath)
  try {
    git(['-C', root, 'worktree', 'remove', worktreePath, '--force'])
  } catch {
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true })
    try { git(['-C', root, 'worktree', 'prune']) } catch { /* best-effort */ }
  }
}

export function listWorktrees(projectPath: string): WorktreeInfo[] {
  const root = resolve(projectPath)
  const output = git(['-C', root, 'worktree', 'list', '--porcelain'])
  if (!output) return []

  const entries: WorktreeInfo[] = []
  let currentPath: string | undefined
  let currentBranch: string | undefined

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (currentPath) entries.push({ path: currentPath, branch: currentBranch ?? '' })
      currentPath = line.slice('worktree '.length)
      currentBranch = undefined
    } else if (line.startsWith('branch ')) {
      currentBranch = line.slice('branch '.length).replace('refs/heads/', '')
    }
  }
  if (currentPath) entries.push({ path: currentPath, branch: currentBranch ?? '' })

  return entries.filter((e) => e.path !== root)
}

export function cleanupOrphanedWorktrees(
  projectPath: string,
  activeWorktreePaths: Set<string>
): void {
  const root = resolve(projectPath)
  const wtDir = join(root, WORKTREE_DIR)
  if (!existsSync(wtDir)) return

  let entries: string[]
  try {
    entries = readdirSync(wtDir)
  } catch {
    return
  }

  for (const entry of entries) {
    const wtPath = join(wtDir, entry)
    if (!activeWorktreePaths.has(wtPath)) {
      try { removeWorktree(root, wtPath) } catch { /* best-effort */ }
    }
  }

  try {
    const remaining = readdirSync(wtDir)
    if (remaining.length === 0) rmSync(wtDir, { recursive: true, force: true })
  } catch { /* best-effort */ }
}

function git(args: string[]): string | undefined {
  try {
    return (
      execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || undefined
    )
  } catch {
    return undefined
  }
}
