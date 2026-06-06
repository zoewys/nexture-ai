import { execFileSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import type { WorkflowRun, WorkflowRunGitSafety } from '@shared/types'

export function inspectWorkflowGitSafety(
  projectPath: string,
  runs: WorkflowRun[]
): WorkflowRunGitSafety {
  const normalizedProjectPath = resolve(projectPath)
  const activeRuns = runs.filter(
    (run) => run.status === 'running' || run.status === 'awaiting-confirm'
  )
  const exactPathRunIds = activeRuns
    .filter((run) => resolve(run.projectPath) === normalizedProjectPath)
    .map((run) => run.id)
  const gitRoot = git(['-C', normalizedProjectPath, 'rev-parse', '--show-toplevel'])

  if (!gitRoot) {
    return {
      projectPath: normalizedProjectPath,
      isGitRepo: false,
      isLinkedWorktree: false,
      sameWorkingTreeRunIds: exactPathRunIds,
      relatedWorktreeRunIds: [],
      conflictingRunIds: exactPathRunIds,
      level: exactPathRunIds.length > 0 ? 'requires-confirmation' : 'safe',
      message:
        exactPathRunIds.length > 0
          ? 'Same project directory is already used by another workflow run; confirm before starting.'
          : undefined
    }
  }

  const gitDir = normalizeGitPath(
    normalizedProjectPath,
    git(['-C', normalizedProjectPath, 'rev-parse', '--git-dir'])
  )
  const commonGitDir = normalizeGitPath(
    normalizedProjectPath,
    git(['-C', normalizedProjectPath, 'rev-parse', '--git-common-dir'])
  )
  const branch = git(['-C', normalizedProjectPath, 'branch', '--show-current']) || undefined
  const isLinkedWorktree = !!gitDir && !!commonGitDir && gitDir !== commonGitDir

  const sameWorkingTreeRunIds = activeRuns
    .filter((run) => git(['-C', resolve(run.projectPath), 'rev-parse', '--show-toplevel']) === gitRoot)
    .map((run) => run.id)

  const relatedWorktreeRunIds = activeRuns
    .filter((run) => {
      const runPath = resolve(run.projectPath)
      const runRoot = git(['-C', runPath, 'rev-parse', '--show-toplevel'])
      if (runRoot === gitRoot) return false
      const runCommonGitDir = normalizeGitPath(
        runPath,
        git(['-C', runPath, 'rev-parse', '--git-common-dir'])
      )
      return !!commonGitDir && runCommonGitDir === commonGitDir
    })
    .map((run) => run.id)

  const conflictingRunIds = [...sameWorkingTreeRunIds, ...relatedWorktreeRunIds]

  if (conflictingRunIds.length === 0) {
    return {
      projectPath: normalizedProjectPath,
      gitRoot,
      commonGitDir,
      branch,
      isGitRepo: true,
      isLinkedWorktree,
      sameWorkingTreeRunIds,
      relatedWorktreeRunIds,
      conflictingRunIds,
      level: 'safe'
    }
  }

  return {
    projectPath: normalizedProjectPath,
    gitRoot,
    commonGitDir,
    branch,
    isGitRepo: true,
    isLinkedWorktree,
    sameWorkingTreeRunIds,
    relatedWorktreeRunIds,
    conflictingRunIds,
    level: sameWorkingTreeRunIds.length > 0 ? 'requires-confirmation' : 'warning',
    message:
      sameWorkingTreeRunIds.length > 0
        ? 'Same working tree is already used by another workflow run; confirm before starting without worktree isolation.'
        : 'Same repository is already used by another workflow run, but this directory is isolated by git worktree.'
  }
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

function normalizeGitPath(projectPath: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  return isAbsolute(value) ? resolve(value) : resolve(projectPath, value)
}
