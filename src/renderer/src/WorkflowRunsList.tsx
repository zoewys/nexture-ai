/**
 * WorkflowRunsList.tsx — 工作流运行列表侧栏
 *
 * 展示所有 workflow run 实例的列表（按时间倒序），每项显示：
 * 运行名称、模板名、状态徽标、开始时间。支持选中高亮和删除操作。
 */

import { useMemo, useState } from 'react'
import type { WorkflowRun, WorkflowRunStep } from '@shared/types'
import { Activity, Clock3, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import {
  workflowRunDisplayName,
  workflowRunProgressSegments,
  type WorkflowRunProgressSegment
} from './workflowRunView'
import { Select } from './Select'

type WorkflowRunUiMeta = WorkflowRun & {
  listMeta?: string
}

interface WorkflowRunsListProps {
  runs: WorkflowRun[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onNewRun: () => void
  onDeleteRun: (runId: string) => void
  onRefresh?: () => Promise<void>
}

type RunFilter = 'all' | 'running' | 'completed' | 'error' | 'awaiting'
type SortMode = 'newest' | 'oldest' | 'name'

export function WorkflowRunsList({
  runs,
  selectedRunId,
  onSelectRun,
  onNewRun,
  onDeleteRun,
  onRefresh
}: WorkflowRunsListProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RunFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const filteredRuns = useMemo(
    () => filterRuns(runs, query, filter, sortMode),
    [filter, query, runs, sortMode]
  )
  const counts = useMemo(() => runFilterCounts(runs), [runs])

  return (
    <section className="workflow-runs-list workflow-dashboard-page">
      <div className="page-header workflow-runs-header">
        <div className="page-title-block">
          <h2 className="page-title">全部运行记录</h2>
          <p>点击 workflow run 卡片进入详情。</p>
        </div>
        <div className="page-actions workflow-runs-actions">
          {onRefresh && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onRefresh()} title="刷新运行记录">
              <RefreshCw size={14} />
              刷新
            </button>
          )}
          <button type="button" className="new-run-btn" onClick={onNewRun}>
            <Plus size={14} /> 新建运行
          </button>
        </div>
      </div>

      <div className="toolbar workflow-dashboard-toolbar">
        <label className="search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索运行名称、模板..."
          />
        </label>
        <div className="filter-chips" role="group" aria-label="Run filters">
          {runFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={[
                'filter-chip',
                option.className,
                filter === option.key ? 'active' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
              <span className="filter-chip-count">{counts[option.key]}</span>
            </button>
          ))}
        </div>
        <div className="workflow-sort-select">
          <Select
            value={sortMode}
            onChange={(value) => setSortMode(value as SortMode)}
            ariaLabel="运行排序"
          >
            <Select.Item value="newest">按时间倒序</Select.Item>
            <Select.Item value="oldest">按时间正序</Select.Item>
            <Select.Item value="name">按名称</Select.Item>
          </Select>
        </div>
      </div>

      <div className="workflow-run-cards cards-grid">
        {filteredRuns.length === 0 && (
          <div className="workflow-dashboard-empty">
            <Activity size={18} />
            <span>暂无匹配的运行记录</span>
          </div>
        )}
        {filteredRuns.map((run, index) => (
          <WorkflowRunCard
            key={run.id}
            run={run}
            selected={selectedRunId === run.id}
            index={index}
            onSelectRun={onSelectRun}
            onDeleteRun={onDeleteRun}
          />
        ))}
      </div>
    </section>
  )
}

function WorkflowRunCard({
  run,
  selected,
  index,
  onSelectRun,
  onDeleteRun
}: {
  run: WorkflowRun
  selected: boolean
  index: number
  onSelectRun: (runId: string) => void
  onDeleteRun: (runId: string) => void
}): JSX.Element {
  const displayName = workflowRunCardTitle(run)
  const status = runStatusUi(run.status)
  const progressSegments = workflowRunProgressSegments(run)
  const currentStepCount = visibleStepCount(run)

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'workflow-run-card',
        status.cardClass,
        selected ? 'workflow-run-card-active' : '',
        run.status === 'awaiting-input' || run.status === 'awaiting-confirm' ? 'workflow-run-card-waiting' : '',
        run.status === 'error' || run.status === 'interrupted' ? 'workflow-run-card-error' : ''
      ].filter(Boolean).join(' ')}
      style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
      onClick={() => onSelectRun(run.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelectRun(run.id)
        }
      }}
    >
      <div className="workflow-run-card-top">
        <div className="workflow-run-card-title-wrap">
          <div className="workflow-run-card-title" title={displayName}>
            {run.scheduledBy && <span className="workflow-run-scheduled-badge">[scheduled]</span>}
            <strong>{displayName}</strong>
          </div>
          <span className="workflow-run-card-template">{run.templateName}</span>
        </div>
        <div className="workflow-run-card-actions">
          <span className={`workflow-run-card-status workflow-run-card-status-${run.status}`}>
            {status.label}
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
        {(run as WorkflowRunUiMeta).listMeta ?? run.projectPath}
      </p>

      <div className="workflow-run-card-steps">
        <div className="workflow-run-card-steps-header">
          <span>步骤</span>
          <span>{currentStepCount} / {Math.max(run.steps.length, 1)}</span>
        </div>
        <div className="workflow-run-card-progress" aria-label="Workflow step progress">
          {progressSegments.map((segment, segmentIndex) => (
            <span
              key={`${run.id}-segment-${segmentIndex}`}
              className={`workflow-run-card-segment workflow-run-card-segment-${segment}`}
            />
          ))}
        </div>
        <div className="workflow-run-card-step-pills">
          {run.steps.map((step, stepIndex) => (
            <span
              key={`${run.id}-step-${stepIndex}`}
              className={`workflow-run-card-step-pill workflow-run-card-step-pill-${stepPillStatus(step)}`}
              title={step.displayName || step.role || step.agentId}
            >
              <span className="workflow-run-card-step-pill-label">
                {step.displayName || step.role || `Step ${stepIndex + 1}`}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="workflow-run-card-footer">
        <div className="workflow-run-card-time" title={(run as WorkflowRunUiMeta).listMeta ?? run.projectPath}>
          <Clock3 size={14} />
          <span className="workflow-run-card-duration">{formatRunDuration(run)}</span>
        </div>
        <div className="workflow-run-card-time">
          <Activity size={14} />
          <span>{formatRunAge(run.startedAt)}</span>
        </div>
      </div>
    </div>
  )
}

const runFilterOptions: Array<{ key: RunFilter; label: string; className?: string }> = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中', className: 'running' },
  { key: 'completed', label: '已完成', className: 'success' },
  { key: 'error', label: '出错', className: 'error' },
  { key: 'awaiting', label: '待处理', className: 'awaiting' }
]

function filterRuns(
  runs: WorkflowRun[],
  query: string,
  filter: RunFilter,
  sortMode: SortMode
): WorkflowRun[] {
  const cleanQuery = query.trim().toLowerCase()
  const filtered = runs.filter((run) => {
    const matchesQuery =
      !cleanQuery ||
      workflowRunCardTitle(run).toLowerCase().includes(cleanQuery) ||
      run.templateName.toLowerCase().includes(cleanQuery) ||
      run.projectPath.toLowerCase().includes(cleanQuery)
    if (!matchesQuery) return false
    if (filter === 'all') return true
    if (filter === 'awaiting') return run.status === 'awaiting-confirm' || run.status === 'awaiting-input'
    if (filter === 'error') return run.status === 'error' || run.status === 'interrupted' || run.status === 'aborted'
    return run.status === filter
  })

  return [...filtered].sort((a, b) => {
    if (sortMode === 'oldest') return a.startedAt - b.startedAt
    if (sortMode === 'name') return workflowRunCardTitle(a).localeCompare(workflowRunCardTitle(b))
    return b.startedAt - a.startedAt
  })
}

function runFilterCounts(runs: WorkflowRun[]): Record<RunFilter, number> {
  return {
    all: runs.length,
    running: runs.filter((run) => run.status === 'running').length,
    completed: runs.filter((run) => run.status === 'completed').length,
    error: runs.filter((run) => run.status === 'error' || run.status === 'interrupted' || run.status === 'aborted').length,
    awaiting: runs.filter((run) => run.status === 'awaiting-confirm' || run.status === 'awaiting-input').length
  }
}

function workflowRunCardTitle(run: WorkflowRun): string {
  const rawName = workflowRunDisplayName(run)
  if (!run.scheduledBy) return rawName
  return rawName.replace(/^\s*\[scheduled\]\s*/i, '').trim() || run.templateName
}

function visibleStepCount(run: WorkflowRun): number {
  const total = Math.max(run.steps.length, 1)
  const done = run.steps.filter((step) => step.status === 'done' || step.status === 'stale').length
  if (run.status === 'completed') return total
  return Math.min(total, Math.max(done, run.currentStepIndex + 1))
}

function stepPillStatus(step: WorkflowRunStep): WorkflowRunProgressSegment {
  switch (step.status) {
    case 'done':
    case 'stale':
      return 'done'
    case 'running':
      return 'running'
    case 'awaiting-confirm':
    case 'awaiting-input':
      return 'awaiting-input'
    case 'error':
      return 'error'
    case 'pending':
      return 'idle'
  }
}

function formatRunDuration(run: WorkflowRun): string {
  const end = run.finishedAt ?? Date.now()
  const totalSeconds = Math.max(0, Math.round((end - run.startedAt) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 1) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 1) return `${minutes}m ${seconds}s`
  return `${hours}h ${restMinutes}m`
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

function runStatusUi(status: WorkflowRun['status']): {
  label: string
  className: string
  cardClass: string
} {
  switch (status) {
    case 'running':
      return { label: '运行中', className: 'running', cardClass: 'workflow-run-card-running' }
    case 'awaiting-input':
      return { label: '待回复', className: 'awaiting', cardClass: 'workflow-run-card-awaiting' }
    case 'awaiting-confirm':
      return { label: '待确认', className: 'awaiting', cardClass: 'workflow-run-card-awaiting' }
    case 'completed':
      return { label: '已完成', className: 'success', cardClass: 'workflow-run-card-success' }
    case 'error':
      return { label: '出错', className: 'error', cardClass: 'workflow-run-card-error' }
    case 'aborted':
      return { label: '已停止', className: 'aborted', cardClass: 'workflow-run-card-aborted' }
    case 'interrupted':
      return { label: '中断', className: 'error', cardClass: 'workflow-run-card-error' }
  }
}
