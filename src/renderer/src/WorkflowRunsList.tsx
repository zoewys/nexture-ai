import { useState } from 'react'
import type { WorkflowRun } from '@shared/types'
import { Trash2 } from './Icons'
import {
  workflowRunDisplayName,
  workflowRunProgressSegments,
  workflowRunTailLines
} from './workflowRunView'

type WorkflowRunUiMeta = WorkflowRun & {
  listMeta?: string
}

type FilterKey = 'all' | 'running' | 'awaiting-confirm' | 'completed' | 'error'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Run' },
  { key: 'awaiting-confirm', label: 'Wait' },
  { key: 'completed', label: 'Done' },
  { key: 'error', label: 'Error' }
]

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
  const [filter, setFilter] = useState<FilterKey>('all')

  const filtered = filter === 'all'
    ? runs
    : runs.filter((r) => {
        if (filter === 'error') return r.status === 'error' || r.status === 'interrupted'
        return r.status === filter
      })

  return (
    <aside className="workflow-runs-list">
      <div className="workflow-runs-header">
        <div>
          <div className="workflow-runs-title">Workflow Runs</div>
          <p>按开始时间倒序；点击 run 卡片进入详情和确认。</p>
        </div>
        <div className="workflow-runs-actions">
          <button type="button" className="primary" onClick={onNewRun}>New Run</button>
        </div>
      </div>

      <div className="workflow-run-filters" aria-label="Workflow run filters">
        {FILTERS.map(({ key, label }) => (
          <button
            type="button"
            key={key}
            className={filter === key ? 'active' : ''}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="workflow-run-cards">
        {filtered.map((run) => (
          <button
            type="button"
            key={run.id}
            className={[
              'workflow-run-card',
              selectedRunId === run.id ? 'workflow-run-card-active' : '',
              run.status === 'awaiting-confirm' ? 'workflow-run-card-waiting' : '',
              run.status === 'error' || run.status === 'interrupted' ? 'workflow-run-card-error' : ''
            ].filter(Boolean).join(' ')}
            onClick={() => onSelectRun(run.id)}
          >
            <div className="workflow-run-card-main">
              <strong>{workflowRunDisplayName(run)}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`workflow-run-card-status workflow-run-card-status-${run.status}`}>
                  {runStatusShortLabel(run.status)}
                </span>
                <button
                  type="button"
                  className="icon-only"
                  style={{ width: 24, height: 24, minHeight: 24, padding: 0, opacity: 0.5 }}
                  title="删除此运行"
                  aria-label="删除此运行"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Delete run "${workflowRunDisplayName(run)}"?`)) {
                      onDeleteRun(run.id)
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <p>
              {(run as WorkflowRunUiMeta).listMeta ??
                `${new Date(run.startedAt).toLocaleTimeString()} · ${run.projectPath}`}
            </p>
            <div className="workflow-run-card-progress" aria-hidden="true">
              {workflowRunProgressSegments(run).map((segment, index) => (
                <span
                  key={`${run.id}-segment-${index}`}
                  className={`workflow-run-card-segment workflow-run-card-segment-${segment}`}
                />
              ))}
            </div>
            <div className="workflow-run-card-tail">
              {workflowRunTailLines(run, 2).map((line, index) => (
                <span key={`${run.id}-tail-${index}`}>{line}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}

function runStatusShortLabel(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running': return 'RUN'
    case 'awaiting-confirm': return 'WAIT'
    case 'completed': return 'DONE'
    case 'error': return 'ERROR'
    case 'aborted': return 'STOP'
    case 'interrupted': return 'INT'
  }
}
