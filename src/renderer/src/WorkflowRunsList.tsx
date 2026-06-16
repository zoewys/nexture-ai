/**
 * WorkflowRunsList.tsx — 工作流运行列表侧栏
 *
 * 展示所有 workflow run 实例的列表（按时间倒序），每项显示：
 * 运行名称、模板名、状态徽标、开始时间。支持选中高亮和删除操作。
 */

import type { WorkflowRun } from '@shared/types'
import { Clock3, Plus, Trash2 } from 'lucide-react'
import {
  workflowRunDisplayName,
  workflowRunProgressSegments
} from './workflowRunView'

type WorkflowRunUiMeta = WorkflowRun & {
  listMeta?: string
}

interface WorkflowRunsListProps {
  runs: WorkflowRun[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onNewRun: () => void
  onDeleteRun: (runId: string) => void
}

export function WorkflowRunsList({
  runs,
  selectedRunId,
  onSelectRun,
  onNewRun,
  onDeleteRun
}: WorkflowRunsListProps): JSX.Element {
  return (
    <aside className="workflow-runs-list">
      <div className="workflow-runs-header">
        <div>
          <div className="workflow-runs-title">运行</div>
          <p>按开始时间倒序；点击 run 卡片进入详情。</p>
        </div>
        <div className="workflow-runs-actions">
          <button type="button" className="new-run-btn" onClick={onNewRun}>
            <Plus size={14} /> 新建运行
          </button>
        </div>
      </div>

      <div className="workflow-run-cards">
        {runs.map((run) => (
          <WorkflowRunCard
            key={run.id}
            run={run}
            selected={selectedRunId === run.id}
            onSelectRun={onSelectRun}
            onDeleteRun={onDeleteRun}
          />
        ))}
      </div>
    </aside>
  )
}

function WorkflowRunCard({
  run,
  selected,
  onSelectRun,
  onDeleteRun
}: {
  run: WorkflowRun
  selected: boolean
  onSelectRun: (runId: string) => void
  onDeleteRun: (runId: string) => void
}): JSX.Element {
  const displayName = workflowRunCardTitle(run)

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'workflow-run-card',
        selected ? 'workflow-run-card-active' : '',
        run.status === 'awaiting-input' || run.status === 'awaiting-confirm' ? 'workflow-run-card-waiting' : '',
        run.status === 'error' || run.status === 'interrupted' ? 'workflow-run-card-error' : ''
      ].filter(Boolean).join(' ')}
      onClick={() => onSelectRun(run.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectRun(run.id)
        }
      }}
    >
      <div className="workflow-run-card-top">
        <div className="workflow-run-card-title" title={displayName}>
          {run.scheduledBy && <span className="workflow-run-scheduled-badge">[scheduled]</span>}
          <strong>{displayName}</strong>
        </div>
        <div className="workflow-run-card-actions">
          <span className={`workflow-run-card-status workflow-run-card-status-${run.status}`}>
            {runStatusShortLabel(run.status)}
          </span>
          <button
            type="button"
            className="workflow-run-card-delete icon-only"
            title="删除此运行"
            aria-label="删除此运行"
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Delete run "${displayName}"?`)) {
                onDeleteRun(run.id)
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <p className="workflow-run-card-meta" title={run.projectPath}>
        {(run as WorkflowRunUiMeta).listMeta ?? workflowRunCardMeta(run)}
      </p>
      <div className="workflow-run-card-progress" aria-label="Workflow step progress">
        {workflowRunProgressSegments(run).map((segment, index) => (
          <span
            key={`${run.id}-segment-${index}`}
            className={`workflow-run-card-segment workflow-run-card-segment-${segment}`}
          />
        ))}
      </div>
      <div className="workflow-run-card-time">
        <Clock3 size={14} />
        <span>{formatRunAge(run.startedAt)}</span>
      </div>
    </div>
  )
}

function workflowRunCardTitle(run: WorkflowRun): string {
  const rawName = workflowRunDisplayName(run)
  if (!run.scheduledBy) return rawName
  return rawName.replace(/^\s*\[scheduled\]\s*/i, '').trim() || run.templateName
}

function workflowRunCardMeta(run: WorkflowRun): string {
  const total = Math.max(run.steps.length, 1)
  const done = run.steps.filter((step) => step.status === 'done' || step.status === 'stale').length
  const visibleStep = run.status === 'completed'
    ? total
    : Math.min(total, Math.max(done, run.currentStepIndex + 1))
  const activeStep = run.steps[run.currentStepIndex] ?? run.steps[0]
  const agentLabel = activeStep?.displayName || activeStep?.role || activeStep?.agentId || run.templateName
  return `步骤 ${visibleStep}/${total} · ${agentLabel}`
}

function formatRunAge(startedAt: number): string {
  const elapsedMs = Math.max(0, Date.now() - startedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsedMs < minute) return 'just now'
  if (elapsedMs < hour) return `${Math.floor(elapsedMs / minute)}m ago`
  if (elapsedMs < day) return `${Math.floor(elapsedMs / hour)}h ago`
  if (elapsedMs < 7 * day) return `${Math.floor(elapsedMs / day)}d ago`
  return new Date(startedAt).toLocaleDateString()
}

function runStatusShortLabel(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running': return '运行中'
    case 'awaiting-input': return '待回复'
    case 'awaiting-confirm': return '待确认'
    case 'completed': return '已完成'
    case 'error': return '出错'
    case 'aborted': return '已停止'
    case 'interrupted': return '中断'
  }
}
