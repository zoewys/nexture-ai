/**
 * WorkflowRunDetail.tsx — 单个工作流运行的详情视图
 *
 * 展示选中 run 的：
 *  - 顶部标题栏（运行名称、状态、操作按钮：确认/重跑/停止/删除）
 *  - 步骤导航 chips（快速切换当前查看的步骤）
 *  - TranscriptViewer（当前步骤的 agent 输出流）
 *  - HandoffPanel（结构化交接物：summary + artifacts + guidance，可拖拽调宽）
 *  - 底部 Composer（向运行中的 step 插话，或对已完成的 step 继续对话）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentDefinition, WorkflowRun } from '@shared/types'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { CheckCircle, ChevronLeft } from './Icons'
import { HandoffPanel } from './HandoffPanel'
import { TranscriptViewer } from './TranscriptViewer'
import { workflowRunStatusLabel } from './workflowLabels'

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
            {workflowRunStatusLabel(run.status)}
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
      <PanelGroup orientation="horizontal" className="workflow-detail-body">
        <Panel minSize={30}>
          <TranscriptViewer events={selectedExecution?.events ?? []} />
        </Panel>

        {handoff && handoffOpen && (
          <>
            <PanelResizeHandle className="panel-resize-handle" />
            <Panel defaultSize={35} minSize={20} maxSize={50}>
              <aside className="handoff-dock" aria-label="结构化交接物">
                <HandoffPanel handoff={handoff} onCollapse={() => setHandoffOpen(false)} />
              </aside>
            </Panel>
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
      </PanelGroup>

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

