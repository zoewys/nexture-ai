/**
 * workflowRunView.ts — Workflow Run 视图层工具函数
 *
 * 提供 run 列表排序、步骤状态变化时的音效类型判定等辅助逻辑，
 * 被 useWorkflows hook 和 WorkflowWorkspace 使用。
 */

import type { AgentEvent, WorkflowRun } from '@shared/types'
import type { WorkflowNotificationSound } from './workflowNotificationSound'

export interface WorkflowNotification {
  key: string
  sound: WorkflowNotificationSound
}

export type WorkflowRunProgressSegment = 'done' | 'running' | 'awaiting-input' | 'waiting' | 'error' | 'idle'

type WorkflowRunUiMeta = WorkflowRun & {
  tailLines?: string[]
}

export function sortWorkflowRunsByStartedAt(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)
}

export function workflowDashboardRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs.filter((run) => !run.scheduledBy)
}

export function workflowRunDisplayName(run: WorkflowRun): string {
  return run.runName?.trim() || run.templateName
}

export function workflowRunTailLines(run: WorkflowRun, count = 3): string[] {
  const tailLines = (run as WorkflowRunUiMeta).tailLines
  if (tailLines?.length) return tailLines.slice(-count)
  const events = run.steps.flatMap((step) => step.executions.at(-1)?.events ?? [])
  return events.flatMap(eventToTailLine).slice(-count)
}

export function workflowRunProgressSegments(
  run: WorkflowRun
): WorkflowRunProgressSegment[] {
  return run.steps.map((step): WorkflowRunProgressSegment => {
    switch (step.status) {
      case 'done':
      case 'stale':
        return 'done'
      case 'running':
        return 'running'
      case 'awaiting-input':
        return 'awaiting-input'
      case 'awaiting-confirm':
        return 'waiting'
      case 'error':
        return 'error'
      case 'pending':
        return 'waiting'
    }
  })
}

export function workflowNotificationForRun(run: WorkflowRun): WorkflowNotification | null {
  if (run.status === 'running' && run.steps.every((s) => s.status === 'pending')) {
    // Fresh run just started — no step has executed yet.
    return {
      key: `${run.id}:start:${run.startedAt}`,
      sound: 'start'
    }
  }

  if (run.status === 'awaiting-confirm') {
    const step = run.steps[run.currentStepIndex]
    const execution = step?.executions.at(-1)
    return {
      key: `${run.id}:confirm:${run.currentStepIndex}:${execution?.id ?? 'none'}`,
      sound: 'confirm'
    }
  }

  if (run.status === 'awaiting-input') {
    const step = run.steps[run.currentStepIndex]
    const execution = step?.executions.at(-1)
    return {
      key: `${run.id}:input:${run.currentStepIndex}:${execution?.id ?? 'none'}`,
      sound: 'confirm'
    }
  }

  if (run.status === 'completed') {
    return {
      key: `${run.id}:finished:${run.status}:${run.finishedAt ?? 'none'}`,
      sound: 'finished'
    }
  }

  if (
    run.status === 'error' ||
    run.status === 'aborted' ||
    run.status === 'interrupted'
  ) {
    return {
      key: `${run.id}:error:${run.status}:${run.finishedAt ?? 'none'}`,
      sound: 'error'
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
