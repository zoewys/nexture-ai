import type { AgentEvent, WorkflowRun } from '@shared/types'
import type { WorkflowNotificationSound } from './workflowNotificationSound'

export interface WorkflowNotification {
  key: string
  sound: WorkflowNotificationSound
}

export function sortWorkflowRunsByStartedAt(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)
}

export function workflowRunDisplayName(run: WorkflowRun): string {
  return run.runName?.trim() || run.templateName
}

export function workflowRunTailLines(run: WorkflowRun, count = 3): string[] {
  const events = run.steps.flatMap((step) => step.executions.at(-1)?.events ?? [])
  return events
    .flatMap(eventToTailLine)
    .slice(-count)
}

export function workflowNotificationForRun(run: WorkflowRun): WorkflowNotification | null {
  if (run.status === 'awaiting-confirm') {
    const step = run.steps[run.currentStepIndex]
    const execution = step?.executions.at(-1)
    return {
      key: `${run.id}:confirm:${run.currentStepIndex}:${execution?.id ?? 'none'}`,
      sound: 'confirm'
    }
  }

  if (
    run.status === 'completed' ||
    run.status === 'error' ||
    run.status === 'aborted' ||
    run.status === 'interrupted'
  ) {
    return {
      key: `${run.id}:finished:${run.status}:${run.finishedAt ?? 'none'}`,
      sound: 'finished'
    }
  }

  return null
}

function eventToTailLine(event: AgentEvent): string[] {
  if (event.kind === 'message') return [`assistant: ${event.text}`]
  if (event.kind === 'message-delta') return [`delta: ${event.text}`]
  if (event.kind === 'tool-call') return [`tool: ${event.name}`]
  if (event.kind === 'system') return [`system: ${event.text}`]
  if (event.kind === 'error') return [`error: ${event.message}`]
  return []
}
