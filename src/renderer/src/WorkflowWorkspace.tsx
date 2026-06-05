import { useState } from 'react'
import type { AgentDefinition, WorkflowRun } from '@shared/types'
import { WorkflowRunsList } from './WorkflowRunsList'
import { WorkflowRunDetail } from './WorkflowRunDetail'
import { WorkflowStepsPanel } from './WorkflowStepsPanel'
import type { UseWorkflowsResult } from './useWorkflows'

interface WorkflowWorkspaceProps {
  agents: AgentDefinition[]
  workflows: UseWorkflowsResult
}

export function WorkflowWorkspace({ agents, workflows }: WorkflowWorkspaceProps): JSX.Element {
  const [selectedStepByRunId, setSelectedStepByRunId] = useState<Record<string, number>>({})
  const [workflowInput, setWorkflowInput] = useState('')
  const [workflowInputError, setWorkflowInputError] = useState<string | null>(null)
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
    selectedAgent?.vendor === 'claude' && selectedStepState?.status === 'running'
  const workflowCanContinue =
    !!selectedExecution?.sessionId &&
    !!selectedStepState &&
    selectedStepState.status !== 'pending' &&
    selectedStepState.status !== 'running'
  const composerEnabled = !!selectedRun && (workflowCanInterject || workflowCanContinue)
  const composerEditable = !!selectedRun && !!selectedStepState
  const composerPlaceholder = buildWorkflowComposerPlaceholder(
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
    if (!selectedRun || !text || !composerEnabled) return
    setWorkflowInput('')
    setWorkflowInputError(null)
    try {
      await workflows.pushInput(selectedStepIndex, text)
    } catch (err) {
      setWorkflowInputError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="workflow-workspace">
      <WorkflowRunsList
        runs={workflows.runs}
        selectedRunId={workflows.selectedRunId}
        onSelectRun={workflows.selectRun}
        onNewRun={() => undefined}
      />
      <WorkflowRunDetail
        run={selectedRun}
        selectedStepIndex={selectedStepIndex}
        selectedExecution={selectedExecution}
        handoff={handoff}
        onConfirm={workflows.confirmStep}
        onRerun={workflows.rerunStep}
        onAbort={workflows.abort}
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
      />
      <WorkflowStepsPanel
        run={selectedRun}
        agents={agents}
        selectedStepIndex={selectedStepIndex}
        onSelectStep={setSelectedStepIndex}
      />
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
