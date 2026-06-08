/**
 * workflowLabels.ts — 工作流状态的中文显示标签
 *
 * 提供 WorkflowRun 级别和 Step 级别的状态文案转换函数，
 * 被 WorkflowRunDetail、WorkflowRunsList 等多个组件共享使用。
 */

import type { StepStatus, WorkflowRunStatus } from '@shared/types'

export function workflowRunStatusLabel(status: WorkflowRunStatus): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'awaiting-confirm':
      return '等待确认'
    case 'completed':
      return '已完成'
    case 'error':
      return '错误'
    case 'aborted':
      return '已停止'
    case 'interrupted':
      return '已中断'
  }
}

export function stepStatusLabel(status: StepStatus): string {
  switch (status) {
    case 'pending':
      return '待运行'
    case 'running':
      return '运行中'
    case 'awaiting-confirm':
      return '等待确认'
    case 'done':
      return '完成'
    case 'stale':
      return '已过期'
    case 'error':
      return '错误'
  }
}
