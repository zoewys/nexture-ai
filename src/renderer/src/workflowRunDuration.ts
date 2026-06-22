import type { WorkflowRun, WorkflowStepExecution } from '@shared/types'

export function workflowRunActualDurationMs(run: WorkflowRun, now = Date.now()): number {
  return run.steps.reduce((sum, step) => {
    return sum + step.executions.reduce((stepSum, execution) => {
      return stepSum + workflowStepExecutionDurationMs(execution, now)
    }, 0)
  }, 0)
}

export function formatWorkflowRunActualDuration(run: WorkflowRun, now = Date.now()): string {
  return formatDurationMs(workflowRunActualDurationMs(run, now))
}

function workflowStepExecutionDurationMs(execution: WorkflowStepExecution, now: number): number {
  if (!isFiniteNumber(execution.startedAt)) return 0
  const finishedAt = isFiniteNumber(execution.finishedAt) ? execution.finishedAt : undefined
  const end = finishedAt ?? (execution.status === 'running' ? now : undefined)
  if (!isFiniteNumber(end)) return 0
  return Math.max(0, end - execution.startedAt)
}

function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 1) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 1) return `${minutes}m ${seconds}s`
  return `${hours}h ${restMinutes}m`
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
