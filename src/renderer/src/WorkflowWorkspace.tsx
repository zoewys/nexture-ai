/**
 * WorkflowWorkspace.tsx — 工作流运行管理主工作区
 *
 * 对应 "Workflow" 模式的完整面板，组合了：
 *  - WorkflowRunsList：左侧运行列表（历史 + 进行中）
 *  - WorkflowRunDetail：中央运行详情（步骤导航、Transcript、Handoff、Composer）
 *  - NewWorkflowRunDrawer：新建运行抽屉（选择模板、填写 prompt、启动）
 *
 * 管理选中 run/step 的状态，以及 workflow composer 的输入与发送逻辑。
 */

import { useEffect, useRef, useState } from 'react'
import type { AgentDefinition, WorkflowRun } from '@shared/types'
import { WorkflowRunsList } from './WorkflowRunsList'
import { WorkflowRunDetail } from './WorkflowRunDetail'

import { NewWorkflowRunDrawer } from './NewWorkflowRunDrawer'
import type { NewWorkflowRunDefaults } from './NewWorkflowRunDrawer'
import { UiReviewMockNav } from './UiReviewMockNav'
import { workflowNotificationForRun } from './workflowRunView'
import { savePastedImageFiles } from './pastedImages'
import {
  playWorkflowNotificationSound,
  prepareWorkflowNotificationSound,
  readWorkflowNotificationSoundEnabled
} from './workflowNotificationSound'
import type { UseWorkflowsResult } from './useWorkflows'

interface WorkflowWorkspaceProps {
  agents: AgentDefinition[]
  workflows: UseWorkflowsResult
  newRunDefaults?: NewWorkflowRunDefaults
  uiReviewEnabled?: boolean
  onUiReviewSurfaceChange?: (surface: 'workflow' | 'new-run') => void
  openRunId?: string | null
  onOpenRunConsumed?: () => void
  showMemoryReferences?: boolean
}

export function WorkflowWorkspace({
  agents,
  workflows,
  newRunDefaults,
  uiReviewEnabled = false,
  onUiReviewSurfaceChange,
  openRunId = null,
  onOpenRunConsumed,
  showMemoryReferences = false
}: WorkflowWorkspaceProps): JSX.Element {
  const [workflowView, setWorkflowView] = useState<'runs' | 'run-detail'>('runs')
  const [newRunDrawerOpen, setNewRunDrawerOpen] = useState(false)
  const [soundEnabled] = useState(readWorkflowNotificationSoundEnabled)
  const [selectedStepByRunId, setSelectedStepByRunId] = useState<Record<string, number>>({})
  const [workflowInput, setWorkflowInput] = useState('')
  const [workflowInputError, setWorkflowInputError] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])

  const handlePickFiles = async () => {
    const files = await window.api.pickFiles()
    if (files && files.length > 0) {
      setWorkflowInputError(null)
      setAttachedFiles(prev => [...prev, ...files])
    }
  }

  const handlePasteImages = async (files: File[]): Promise<void> => {
    setWorkflowInputError(null)
    try {
      const paths = await savePastedImageFiles(files)
      setAttachedFiles(prev => [...prev, ...paths])
    } catch (err) {
      setWorkflowInputError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRemoveFile = (file: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== file))
  }
  const playedNotificationKeys = useRef<Set<string> | null>(null)
  if (playedNotificationKeys.current === null) {
    const initial = new Set<string>()
    for (const run of workflows.runs) {
      const n = workflowNotificationForRun(run)
      if (n) initial.add(n.key)
    }
    playedNotificationKeys.current = initial
  }
  const selectedRun = workflows.selectedRun
  const selectedStepIndex = selectedRun
    ? selectedStepByRunId[selectedRun.id] ?? selectedRun.currentStepIndex
    : 0
  const selectedExecution = selectedRun
    ? selectedRun.steps[selectedStepIndex]?.executions.at(-1) ?? null
    : null
  const selectedStepState = selectedRun?.steps[selectedStepIndex] ?? null
  const selectedAgent = selectedStepState
    ? agents.find((agent) => agent.id === selectedStepState.agentId) ?? null
    : null
  const handoff = selectedExecution?.handoff ?? null

  const workflowCanInterject =
    (selectedAgent?.vendor === 'claude' && selectedStepState?.status === 'running') ||
    selectedExecution?.status === 'awaiting-input'
  const workflowCanContinue =
    !!selectedExecution?.sessionId &&
    !!selectedStepState &&
    selectedStepState.status !== 'pending' &&
    selectedStepState.status !== 'running'
  const composerEnabled = !!selectedRun && (workflowCanInterject || workflowCanContinue)
  const composerEditable = !!selectedRun && !!selectedStepState
  const composerPlaceholder = uiReviewEnabled
    ? '向当前 workflow / step 发送消息...'
    : buildWorkflowComposerPlaceholder(
        selectedRun,
        selectedAgent,
        selectedStepState,
        selectedExecution
      )

  const setSelectedStepIndex = (index: number): void => {
    if (!selectedRun) return
    setSelectedStepByRunId((prev) => ({ ...prev, [selectedRun.id]: index }))
  }

  const sendWorkflowInput = async (): Promise<void> => {
    const text = workflowInput.trim()
    if (!selectedRun || (!text && attachedFiles.length === 0) || !composerEnabled) return
    const fullText = attachedFiles.length > 0
      ? text + '\n\n[Attached files:\n' + attachedFiles.map(f => `  ${f}`).join('\n') + '\n]'
      : text
    setWorkflowInput('')
    setAttachedFiles([])
    setWorkflowInputError(null)
    try {
      await workflows.pushInput(selectedStepIndex, fullText)
    } catch (err) {
      setWorkflowInputError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (soundEnabled) prepareWorkflowNotificationSound()
  }, [soundEnabled])

  useEffect(() => {
    if (!soundEnabled) return
    const played = playedNotificationKeys.current!
    for (const run of workflows.runs) {
      const notification = workflowNotificationForRun(run)
      if (!notification || played.has(notification.key)) continue
      played.add(notification.key)
      playWorkflowNotificationSound(notification.sound)
    }
  }, [soundEnabled, workflows.runs])

  useEffect(() => {
    if (!uiReviewEnabled) return
    onUiReviewSurfaceChange?.(newRunDrawerOpen ? 'new-run' : 'workflow')
  }, [newRunDrawerOpen, onUiReviewSurfaceChange, uiReviewEnabled])

  useEffect(() => {
    if (!openRunId) return
    workflows.selectRun(openRunId)
    setWorkflowView('run-detail')
    onOpenRunConsumed?.()
  }, [openRunId, onOpenRunConsumed, workflows])

  useEffect(() => {
    if (workflowView === 'run-detail' && !selectedRun) setWorkflowView('runs')
  }, [selectedRun, workflowView])

  const selectRun = (runId: string): void => {
    workflows.selectRun(runId)
    setWorkflowView('run-detail')
  }

  const onBack = (): void => setWorkflowView('runs')

  const startWorkflow = async (input: Parameters<typeof workflows.start>[0]): Promise<WorkflowRun> => {
    const run = await workflows.start(input)
    setWorkflowView('run-detail')
    return run
  }

  return (
    <section className="workflow-workspace">
      {workflowView === 'runs' ? (
        <WorkflowRunsList
          agents={agents}
          runs={workflows.runs}
          selectedRunId={workflows.selectedRunId}
          onSelectRun={selectRun}
          onNewRun={() => setNewRunDrawerOpen(true)}
          onDeleteRun={workflows.deleteRun}
          onRefresh={workflows.reloadRuns}
        />
      ) : (
        <section className="workflow-detail-page">
          <WorkflowRunDetail
            agents={agents}
            run={selectedRun}
            onBack={onBack}
            selectedStepIndex={selectedStepIndex}
            onSelectStep={setSelectedStepIndex}
            selectedExecution={selectedExecution}
            handoff={handoff}
            uiReviewEnabled={uiReviewEnabled}
            onConfirm={workflows.confirmStep}
            onFinishInteractiveStep={workflows.finishInteractiveStep}
            onRerun={workflows.rerunStep}
            onAbort={workflows.abort}
            onSkipStep={workflows.skipStep}
            onGotoStep={workflows.gotoStep}
            composerValue={workflowInput}
            composerEditable={composerEditable}
            composerEnabled={composerEnabled}
            composerPlaceholder={composerPlaceholder}
            composerError={workflowInputError}
            onComposerChange={(value) => {
              setWorkflowInput(value)
              setWorkflowInputError(null)
            }}
            onComposerSend={sendWorkflowInput}
            onUpdatePrompt={workflows.updatePrompt}
            onPickFiles={handlePickFiles}
            onPasteImages={handlePasteImages}
            onRemoveFile={handleRemoveFile}
            attachedFiles={attachedFiles}
            showMemoryReferences={showMemoryReferences}
          />
        </section>
      )}
      {newRunDrawerOpen && (
        <NewWorkflowRunDrawer
          agents={agents}
          templates={workflows.templates}
          onStart={startWorkflow}
          onInspectGitSafety={workflows.inspectGitSafety}
          runningRunCount={workflows.runs.filter((run) => run.status === 'running' || run.status === 'awaiting-input').length}
          newRunDefaults={newRunDefaults}
          uiReviewEnabled={uiReviewEnabled}
          onClose={() => setNewRunDrawerOpen(false)}
        />
      )}
      {uiReviewEnabled && (
        <UiReviewMockNav active={newRunDrawerOpen ? 'new-run' : 'workflow'} />
      )}
    </section>
  )
}

function buildWorkflowComposerPlaceholder(
  selectedRun: WorkflowRun | null,
  selectedAgent: AgentDefinition | null,
  selectedStepState: WorkflowRun['steps'][number] | null,
  selectedExecution: WorkflowRun['steps'][number]['executions'][number] | null
): string {
  if (!selectedRun) return '请先启动一个工作流...'
  if (!selectedAgent) return '当前步骤没有可用 agent'
  if (selectedStepState?.status === 'running' && selectedAgent.vendor !== 'claude') {
    return `${selectedAgent.vendor} 运行中不支持实时插话，可先输入草稿，步骤完成后发送`
  }
  if (!selectedExecution?.sessionId) return '当前步骤暂无可继续的会话'
  if (selectedExecution?.status === 'awaiting-input' || selectedStepState?.status === 'awaiting-input') {
    return '回复 Agent...'
  }
  if (selectedStepState?.status === 'running') return '向运行中的 agent 发送消息...'
  if (selectedStepState?.status === 'error') {
    return '输入修复指令，例如「请输出合法的 handoff JSON...」'
  }
  if (selectedStepState?.status === 'done' || selectedStepState?.status === 'stale') {
    return '继续此会话——下游步骤将被标记为过期...'
  }
  if (selectedStepState?.status === 'awaiting-confirm') {
    return '继续对话——handoff 将被重新生成...'
  }
  return '当前步骤无法对话'
}
