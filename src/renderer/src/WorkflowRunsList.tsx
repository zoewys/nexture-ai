import type { WorkflowRun } from '@shared/types'
import {
  workflowRunDisplayName,
  workflowRunProgressSegments,
  workflowRunTailLines
} from './workflowRunView'

type WorkflowRunUiMeta = WorkflowRun & {
  listMeta?: string
}

interface WorkflowRunsListProps {
  runs: WorkflowRun[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onNewRun: () => void
}

export function WorkflowRunsList({
  runs,
  selectedRunId,
  onSelectRun,
  onNewRun
}: WorkflowRunsListProps): JSX.Element {
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
        <button type="button" className="active">All</button>
        <button type="button">Run</button>
        <button type="button">Wait</button>
        <button type="button">Done</button>
        <button type="button">Error</button>
      </div>

      <div className="workflow-run-cards">
        {runs.map((run) => (
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
              <span className={`workflow-run-card-status workflow-run-card-status-${run.status}`}>
                {runStatusShortLabel(run.status)}
              </span>
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
