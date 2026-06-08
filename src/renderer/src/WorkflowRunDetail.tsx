import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentDefinition, WorkflowRun } from '@shared/types'
import { CheckCircle, ChevronLeft } from './Icons'
import { HandoffPanel } from './HandoffPanel'
import { TranscriptViewer } from './TranscriptViewer'

type WorkflowRunUiMeta = WorkflowRun & {
  displayPath?: string
  gitSafetyMessage?: string
}

export interface WorkflowRunDetailProps {
  agents: AgentDefinition[]
  run: WorkflowRun | null
  selectedStepIndex: number
  onSelectStep: (stepIndex: number) => void
  selectedExecution: WorkflowRun['steps'][number]['executions'][number] | null
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']> | null
  uiReviewEnabled?: boolean
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
  agents,
  run,
  selectedStepIndex,
  onSelectStep,
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
  const [handoffOpen, setHandoffOpen] = useState(true)
  const [handoffWidth, setHandoffWidth] = useState(340)
  const resizing = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current || !bodyRef.current) return
      const rect = bodyRef.current.getBoundingClientRect()
      const w = rect.right - e.clientX
      setHandoffWidth(Math.max(240, Math.min(600, w)))
    }
    const onUp = () => {
      if (!resizing.current) return
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!run) {
    return (
      <main className="workflow-run-detail workflow-run-detail-empty">
        <strong>暂无工作流运行</strong>
        <span>点击左侧 New Run 从模板启动一个 workflow。</span>
      </main>
    )
  }

  const selectedStep = run.steps[selectedStepIndex]
  const selectedAgent = selectedStep
    ? agents.find((agent) => agent.id === selectedStep.agentId) ?? null
    : null
  const awaitingConfirm =
    run.status === 'awaiting-confirm' &&
    run.steps[run.currentStepIndex]?.status === 'awaiting-confirm'
  const { displayPath, gitSafetyMessage } = run as WorkflowRunUiMeta

  return (
    <main className="workflow-run-detail">
      {/* ── top bar: run title + status + actions ── */}
      <div className="workflow-run-detail-header">
        <div className="workflow-detail-title">
          <h2>{run.runName || run.templateName}</h2>
          <span className={`workflow-run-status workflow-run-status-${run.status}`}>
            {runStatusLabel(run.status)}
          </span>
        </div>
        <div className="workflow-run-detail-actions">
          {awaitingConfirm && (
            <button type="button" className="primary workflow-confirm-step" onClick={onConfirm}>
              <CheckCircle size={14} /> 确认并继续
            </button>
          )}
          <button type="button" onClick={() => onRerun(selectedStepIndex)}>
            Rerun Step
          </button>
          {(run.status === 'running' || run.status === 'awaiting-confirm') && (
            <button type="button" className="danger" onClick={onAbort}>Stop</button>
          )}
        </div>
      </div>

      {/* ── step navigation: compact inline bar ── */}
      <div className="workflow-step-nav">
        {run.steps.map((step, index) => {
          const agent = agents.find((candidate) => candidate.id === step.agentId)
          return (
            <button
              type="button"
              key={`${run.id}-step-${index}`}
              className={`workflow-step-chip ${selectedStepIndex === index ? 'workflow-step-chip-active' : ''} workflow-step-chip-${step.status}`}
              onClick={() => onSelectStep(index)}
            >
              <span className="workflow-step-chip-num">{index + 1}</span>
              <span className="workflow-step-chip-name">{step.role || step.displayName || agent?.name || agent?.role || `Step ${index + 1}`}</span>
            </button>
          )
        })}
      </div>

      {gitSafetyMessage && (
        <div className="workflow-run-warning">{gitSafetyMessage}</div>
      )}

      {selectedExecution?.error && (
        <div className="workflow-detail-error">{selectedExecution.error}</div>
      )}

      {/* ── body: transcript | resize handle | handoff ── */}
      <div
        ref={bodyRef}
        className={[
          'workflow-detail-body',
          handoff ? 'workflow-detail-body-with-handoff' : '',
          handoff && !handoffOpen ? 'workflow-detail-body-handoff-collapsed' : ''
        ].filter(Boolean).join(' ')}
        style={handoff && handoffOpen ? { gridTemplateColumns: `minmax(0, 1fr) 6px ${handoffWidth}px` } : undefined}
      >
        <TranscriptViewer events={selectedExecution?.events ?? []} />

        {handoff && handoffOpen && (
          <>
            <div className="handoff-resize-handle" onMouseDown={onResizeStart} />
            <aside className="handoff-dock" aria-label="结构化交接物">
              <HandoffPanel handoff={handoff} onCollapse={() => setHandoffOpen(false)} />
            </aside>
          </>
        )}

        {handoff && !handoffOpen && (
          <aside className="handoff-dock-collapsed" aria-label="已收起的交接物面板">
            <button
              type="button"
              className="handoff-toggle-collapsed"
              title="展开交接物"
              aria-label="展开交接物"
              onClick={() => setHandoffOpen(true)}
            >
              <span className="handoff-toggle-label">交接物</span>
            </button>
          </aside>
        )}
      </div>

      <div className="workflow-cli-composer">
        <div className="workflow-cli-prompt">›</div>
        <input
          value={composerValue}
          disabled={!composerEditable}
          placeholder={composerPlaceholder}
          onChange={(e) => onComposerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
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
          发送
        </button>
      </div>
      {composerError && <div className="workflow-input-error">{composerError}</div>}
    </main>
  )
}

function runStatusLabel(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running': return '运行中'
    case 'awaiting-confirm': return '等待确认'
    case 'completed': return '已完成'
    case 'error': return '错误'
    case 'aborted': return '已停止'
    case 'interrupted': return '已中断'
  }
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
