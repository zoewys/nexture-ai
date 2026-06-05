import type { WorkflowRun } from '@shared/types'
import { CheckCircle, RotateCcw, Send } from './Icons'
import { HandoffPanel } from './HandoffPanel'
import { TranscriptViewer } from './TranscriptViewer'

export interface WorkflowRunDetailProps {
  run: WorkflowRun | null
  selectedStepIndex: number
  selectedExecution: WorkflowRun['steps'][number]['executions'][number] | null
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']> | null
  onConfirm: () => Promise<void>
  onRerun: (stepIndex: number) => Promise<void>
  onAbort: () => Promise<void>
  composerValue: string
  composerEditable: boolean
  composerEnabled: boolean
  composerPlaceholder: string
  composerError: string | null
  onComposerChange: (value: string) => void
  onComposerSend: () => Promise<void>
}

export function WorkflowRunDetail({
  run,
  selectedStepIndex,
  selectedExecution,
  handoff,
  onConfirm,
  onRerun,
  onAbort,
  composerValue,
  composerEditable,
  composerEnabled,
  composerPlaceholder,
  composerError,
  onComposerChange,
  onComposerSend
}: WorkflowRunDetailProps): JSX.Element {
  if (!run) {
    return (
      <main className="workflow-run-detail workflow-run-detail-empty">
        <strong>暂无工作流运行</strong>
        <span>点击左侧 New Run 从模板启动一个 workflow。</span>
      </main>
    )
  }

  const selectedStep = run.steps[selectedStepIndex]
  const awaitingConfirm =
    run.status === 'awaiting-confirm' &&
    run.steps[run.currentStepIndex]?.status === 'awaiting-confirm'

  return (
    <main className="workflow-run-detail">
      <div className="workflow-run-detail-header">
        <div>
          <h2>{run.runName || run.templateName}</h2>
          <p>{run.projectPath}</p>
        </div>
        <div className="workflow-run-detail-actions">
          {awaitingConfirm && (
            <button type="button" className="primary" onClick={onConfirm}>
              <CheckCircle size={14} /> 确认并继续
            </button>
          )}
          <button type="button" onClick={() => onRerun(selectedStepIndex)}>
            <RotateCcw size={14} /> 重新运行
          </button>
          {run.status === 'running' && <button type="button" onClick={onAbort}>停止</button>}
        </div>
      </div>

      <div className="workflow-detail-header">
        <strong>
          步骤 {selectedStepIndex + 1} · {selectedStep ? stepStatusLabel(selectedStep.status) : '未知'}
        </strong>
        {selectedExecution?.error && (
          <span className="workflow-error">{selectedExecution.error}</span>
        )}
      </div>

      <TranscriptViewer events={selectedExecution?.events ?? []} />

      {handoff && run.status === 'awaiting-confirm' && (
        <div className="workflow-detail-handoff">
          <HandoffPanel handoff={handoff} />
        </div>
      )}

      <div className="workflow-cli-composer">
        <div className="workflow-cli-prompt">›</div>
        <textarea
          value={composerValue}
          disabled={!composerEditable}
          placeholder={composerPlaceholder}
          onChange={(e) => onComposerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void onComposerSend()
            }
          }}
        />
        <button
          onClick={() => void onComposerSend()}
          disabled={!composerEnabled || composerValue.trim() === ''}
          type="button"
        >
          <Send size={14} /> 发送
        </button>
      </div>
      {composerError && <div className="workflow-input-error">{composerError}</div>}
    </main>
  )
}

function stepStatusLabel(status: WorkflowRun['steps'][number]['status']): string {
  switch (status) {
    case 'pending': return '待运行'
    case 'running': return '运行中'
    case 'awaiting-confirm': return '等待确认'
    case 'done': return '完成'
    case 'stale': return '已过期'
    case 'error': return '错误'
  }
}
