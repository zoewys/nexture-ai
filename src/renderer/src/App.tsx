import { useEffect, useMemo, useState } from 'react'
import type { AgentDefinition, AgentVendor, CliCheckResult, RunConfig, WorkflowRun } from '@shared/types'
import { ALL_VENDORS } from '@shared/types'
import { useRun } from './useRun'
import { useAgents } from './useAgents'
import { useCliModels } from './useCliModels'
import { useWorkflows } from './useWorkflows'
import { AgentManager } from './AgentManager'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { TranscriptViewer } from './TranscriptViewer'
import { WorkflowPanel } from './WorkflowPanel'
import { GitBranch, Play, Bot, FolderOpen, Send, Plus, RotateCcw, CheckCircle } from './Icons'

type WorkspaceMode = 'workflow' | 'single' | 'agents'

export function App(): JSX.Element {
  const { state, start, continueSession, push, abort, reset } = useRun()
  const { agents, save: saveAgent, remove: removeAgent } = useAgents()
  const { models: modelCatalog, loading: modelsLoading } = useCliModels()
  const workflows = useWorkflows()
  const [clis, setClis] = useState<CliCheckResult | null>(null)
  const [mode, setMode] = useState<WorkspaceMode>('workflow')
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<RunConfig['codexReasoningEffort']>()
  const [codexServiceTier, setCodexServiceTier] = useState<string | undefined>()
  const [interjection, setInterjection] = useState('')
  const [workflowInput, setWorkflowInput] = useState('')
  const [workflowInputError, setWorkflowInputError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedWorkflowStep, setSelectedWorkflowStep] = useState(0)

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  )

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id || null)
    const agent = id ? agents.find((a) => a.id === id) : null
    if (agent) {
      setVendor(agent.vendor)
      setModel(agent.model ?? '')
      setCodexReasoningEffort(agent.codexReasoningEffort)
      setCodexServiceTier(agent.codexServiceTier)
    }
  }

  useEffect(() => {
    window.api.checkClis().then(setClis)
  }, [])

  useEffect(() => {
    if (workflows.currentRun) {
      setMode('workflow')
      setSelectedWorkflowStep(workflows.currentRun.currentStepIndex)
    }
  }, [workflows.currentRun?.id, workflows.currentRun?.currentStepIndex])

  const canStart = !state.running && cwd.trim() !== '' && prompt.trim() !== ''

  const handleStart = async (): Promise<void> => {
    const config: RunConfig = {
      vendor,
      prompt: prompt.trim(),
      cwd: cwd.trim(),
      model: model.trim() || undefined,
      codexReasoningEffort: vendor === 'codex' ? codexReasoningEffort : undefined,
      codexServiceTier: vendor === 'codex' ? codexServiceTier : undefined,
      appendSystemPrompt: selectedAgent?.systemPrompt,
      permissionMode: selectedAgent?.permissionMode
    }
    await start(config)
  }

  const handlePickDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) setCwd(dir)
  }

  const canResume = !state.running && state.sessionId !== null && vendor === 'claude'
  const canInterject = state.running && vendor === 'claude'
  const composerEnabled = canResume || canInterject
  const modelInfo = modelCatalog?.[vendor] ?? null

  const handleComposerSend = async (): Promise<void> => {
    const text = interjection.trim()
    if (!text) return
    setInterjection('')
    if (state.running) {
      await push(text)
    } else if (canResume) {
      const config: RunConfig = {
        vendor,
        prompt: text,
        cwd: cwd.trim(),
        model: model.trim() || undefined,
        resumeFrom: { sessionId: state.sessionId!, vendor },
        appendSystemPrompt: selectedAgent?.systemPrompt,
        permissionMode: selectedAgent?.permissionMode
      }
      await continueSession(config)
    }
  }

  const cliAvailable = clis ? clis[vendor] : true
  const selectedWorkflowExecution = workflows.currentRun
    ? workflows.currentRun.steps[selectedWorkflowStep]?.executions.at(-1) ?? null
    : null
  const selectedWorkflowHandoff = selectedWorkflowExecution?.handoff ?? null
  const selectedWorkflowStepState = workflows.currentRun?.steps[selectedWorkflowStep] ?? null
  const selectedWorkflowAgent = selectedWorkflowStepState
    ? agents.find((agent) => agent.id === selectedWorkflowStepState.agentId) ?? null
    : null
  const workflowComposerEnabled =
    !!workflows.currentRun &&
    selectedWorkflowAgent?.vendor === 'claude' &&
    selectedWorkflowStepState?.status !== 'pending' &&
    !!selectedWorkflowExecution?.sessionId
  const workflowComposerPlaceholder = !workflows.currentRun
    ? '请先启动一个工作流...'
    : selectedWorkflowAgent?.vendor !== 'claude'
        ? '仅 Claude 步骤支持实时对话'
        : !selectedWorkflowExecution?.sessionId
          ? '当前步骤暂无活跃会话'
          : selectedWorkflowStepState?.status === 'running'
            ? '向运行中的 agent 发送消息...'
            : selectedWorkflowStepState?.status === 'error'
              ? '输入修复指令，例如「请输出合法的 handoff JSON...」'
              : selectedWorkflowStepState?.status === 'done' ||
                  selectedWorkflowStepState?.status === 'stale'
                ? '继续此会话——下游步骤将被标记为过期...'
                : selectedWorkflowStepState?.status === 'awaiting-confirm'
                  ? '继续对话——handoff 将被重新生成...'
                  : '当前步骤无法对话'

  const startWorkflow = async (
    templateId: string,
    projectPath: string,
    initialPrompt: string
  ) => {
    const run = await workflows.start({ templateId, projectPath, initialPrompt })
    setMode('workflow')
    setSelectedWorkflowStep(0)
    return run
  }

  const handleWorkflowInputSend = async (): Promise<void> => {
    const text = workflowInput.trim()
    if (!text || !workflowComposerEnabled) return
    setWorkflowInput('')
    setWorkflowInputError(null)
    try {
      await workflows.pushInput(selectedWorkflowStep, text)
    } catch (err) {
      setWorkflowInputError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeleteAgent = (id: string) => {
    removeAgent(id)
    if (selectedAgentId === id) {
      setSelectedAgentId(null)
      setVendor('claude')
      setModel('')
    }
  }

  const subtitle = () => {
    switch (mode) {
      case 'agents':
        return `Agent Library · ${agents.length}`
      case 'workflow':
        return workflows.currentRun
          ? `Workflow · ${workflowRunStatusLabel(workflows.currentRun.status)}`
          : 'Workflow'
      case 'single':
        return `Single Run · ${vendor}`
    }
  }

  const isAgents = mode === 'agents'

  return (
    <div className="app">
      <header className="app-header">
        <h1>Agent Studio</h1>
        <span className="app-subtitle">{subtitle()}</span>
      </header>

      <div className="app-body">
        <nav className="mode-rail" aria-label="Workspace modes">
          <button
            type="button"
            className={`mode-item ${mode === 'workflow' ? 'mode-item-active' : ''}`}
            onClick={() => setMode('workflow')}
          >
            <span className="mode-icon"><GitBranch /></span>
            <span>Workflow</span>
          </button>
          <button
            type="button"
            className={`mode-item ${mode === 'single' ? 'mode-item-active' : ''}`}
            onClick={() => setMode('single')}
          >
            <span className="mode-icon"><Play /></span>
            <span>Single Run</span>
          </button>
          <button
            type="button"
            className={`mode-item ${isAgents ? 'mode-item-active' : ''}`}
            onClick={() => setMode(isAgents ? 'workflow' : 'agents')}
          >
            <span className="mode-icon"><Bot /></span>
            <span>Agents</span>
          </button>
        </nav>

        {isAgents ? (
          <div className="panel agent-page">
            <AgentManager
              agents={agents}
              clis={clis}
              modelCatalog={modelCatalog}
              onSave={saveAgent}
              onDelete={handleDeleteAgent}
              onClose={() => setMode('workflow')}
            />
          </div>
        ) : (
          <>
            <aside className="panel panel-config">
              <div className="workspace-panel-header">
                <span className="section-title">
                  {mode === 'workflow' ? 'Workflow Config' : 'Single Run Config'}
                </span>
                <h2>
                  {mode === 'workflow' ? 'Orchestrate multiple agents' : 'Run a single agent'}
                </h2>
                <p>
                  {mode === 'workflow'
                    ? 'Create a linear pipeline and review handoffs in the run panel.'
                    : 'Pick a preset agent or configure a one-shot CLI run.'}
                </p>
              </div>

              {mode === 'workflow' ? (
                <WorkflowPanel
                  agents={agents}
                  templates={workflows.templates}
                  onSave={workflows.save}
                  onDelete={workflows.remove}
                  onStart={startWorkflow}
                />
              ) : (
                <>
                  <label className="field">
                    <span>Agent</span>
                    <div className="field-row">
                      <select
                        value={selectedAgentId ?? ''}
                        onChange={(e) => handleSelectAgent(e.target.value)}
                      >
                        <option value="">None — manual config</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name || 'Unnamed'}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setMode('agents')} type="button">
                        Manage
                      </button>
                    </div>
                  </label>

                  <label className="field">
                    <span>CLI</span>
                    <select
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value as AgentVendor)}
                    >
                      {ALL_VENDORS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                          {clis && !clis[v] ? ' (not installed)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Model</span>
                    <ModelSelect
                      value={model}
                      loading={modelsLoading}
                      modelInfo={modelInfo}
                      onChange={setModel}
                    />
                  </label>

                  {vendor === 'codex' && (
                    <CodexOptions
                      model={model}
                      modelInfo={modelInfo}
                      reasoningEffort={codexReasoningEffort}
                      serviceTier={codexServiceTier}
                      onReasoningEffortChange={setCodexReasoningEffort}
                      onServiceTierChange={setCodexServiceTier}
                    />
                  )}

                  <label className="field">
                    <span>Project Directory</span>
                    <div className="field-row">
                      <input
                        value={cwd}
                        placeholder="/path/to/project"
                        onChange={(e) => setCwd(e.target.value)}
                      />
                      <button onClick={handlePickDir} type="button">
                        <FolderOpen size={14} /> Browse
                      </button>
                    </div>
                  </label>

                  <label className="field field-grow">
                    <span>Prompt</span>
                    <textarea
                      value={prompt}
                      placeholder="Describe the task for the agent..."
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </label>

                  {!cliAvailable && (
                    <div className="warn">
                      {vendor} CLI not found in PATH. Install it or pick another CLI.
                    </div>
                  )}

                  <div className="actions">
                    <button
                      className="primary"
                      disabled={!canStart}
                      onClick={handleStart}
                      type="button"
                    >
                      <Play size={14} /> {state.running ? 'Running...' : 'Start Run'}
                    </button>
                    {state.running && (
                      <button onClick={abort} type="button">
                        Stop
                      </button>
                    )}
                    {!state.running && state.events.length > 0 && (
                      <button onClick={reset} type="button">
                        <RotateCcw size={14} /> Clear
                      </button>
                    )}
                  </div>
                </>
              )}
            </aside>

            <main className="panel panel-runtime">
              {mode === 'workflow' ? (
                <WorkflowRuntime
                  agents={agents}
                  currentRun={workflows.currentRun}
                  selectedStepIndex={selectedWorkflowStep}
                  selectedExecution={selectedWorkflowExecution}
                  onSelectStep={setSelectedWorkflowStep}
                  onConfirm={workflows.confirmStep}
                  onRerun={workflows.rerunStep}
                  onAbort={workflows.abort}
                  onClearRun={workflows.clearRun}
                  composerValue={workflowInput}
                  composerEnabled={workflowComposerEnabled}
                  composerPlaceholder={workflowComposerPlaceholder}
                  composerError={workflowInputError}
                  onComposerChange={(value) => {
                    setWorkflowInput(value)
                    setWorkflowInputError(null)
                  }}
                  onComposerSend={handleWorkflowInputSend}
                />
              ) : (
                <>
                  <TranscriptViewer events={state.events} />

                  {state.events.length > 0 && (
                    <div className="interject">
                      <input
                        value={interjection}
                        disabled={!composerEnabled}
                        placeholder={
                          canInterject
                            ? 'Interject (only affects the current agent)...'
                            : canResume
                              ? 'Continue this session...'
                              : vendor === 'claude'
                                ? 'Start a run first to create a session...'
                                : 'Only claude supports session resume'
                        }
                        onChange={(e) => setInterjection(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleComposerSend()
                        }}
                      />
                      <button
                        onClick={handleComposerSend}
                        disabled={!composerEnabled}
                        type="button"
                      >
                        <Send size={14} /> Send
                      </button>
                    </div>
                  )}
                </>
              )}

              {mode === 'workflow' && selectedWorkflowHandoff && (
                <HandoffPanel handoff={selectedWorkflowHandoff} />
              )}
            </main>
          </>
        )}
      </div>
    </div>
  )
}

// ── workflow runtime sub-components ─────────────────────────────────────

interface WorkflowRuntimeProps {
  agents: AgentDefinition[]
  currentRun: WorkflowRun | null
  selectedStepIndex: number
  selectedExecution: WorkflowRun['steps'][number]['executions'][number] | null
  onSelectStep: (index: number) => void
  onConfirm: () => Promise<void>
  onRerun: (stepIndex: number) => Promise<void>
  onAbort: () => Promise<void>
  onClearRun: () => void
  composerValue: string
  composerEnabled: boolean
  composerPlaceholder: string
  composerError: string | null
  onComposerChange: (value: string) => void
  onComposerSend: () => Promise<void>
}

function WorkflowRuntime({
  agents,
  currentRun,
  selectedStepIndex,
  selectedExecution,
  onSelectStep,
  onConfirm,
  onRerun,
  onAbort,
  onClearRun,
  composerValue,
  composerEnabled,
  composerPlaceholder,
  composerError,
  onComposerChange,
  onComposerSend
}: WorkflowRuntimeProps): JSX.Element {
  if (!currentRun) {
    return (
      <div className="runtime-empty">
        <strong>No workflow run in progress</strong>
        <span>Create or select a workflow on the left, then start a run.</span>
      </div>
    )
  }

  const selectedStep = currentRun.steps[selectedStepIndex]
  const awaitingConfirm =
    currentRun.status === 'awaiting-confirm' &&
    currentRun.steps[currentRun.currentStepIndex]?.status === 'awaiting-confirm'

  return (
    <div className="workflow-runtime">
      <aside className="workflow-run-sidebar">
        <div className="runtime-section-header">
          <span className="section-title">Active Run</span>
          <h2>{currentRun.templateName}</h2>
          <p>{workflowRunStatusLabel(currentRun.status)}</p>
        </div>

        <div className="workflow-step-list">
          {currentRun.steps.map((step, index) => {
            const agent = agents.find((candidate) => candidate.id === step.agentId)
            const latest = step.executions[step.executions.length - 1]
            return (
              <button
                type="button"
                key={`${currentRun.id}-${index}`}
                className={`workflow-step-card ${selectedStepIndex === index ? 'workflow-step-card-active' : ''}`}
                onClick={() => onSelectStep(index)}
              >
                <div className="workflow-step-main">
                  <span>{index + 1}. {agent?.name ?? 'Missing agent'}</span>
                  <strong>{stepStatusLabel(step.status)}</strong>
                </div>
                {latest?.handoff?.summary && <p>{latest.handoff.summary}</p>}
                {latest?.error && <p className="workflow-error">{latest.error}</p>}
              </button>
            )
          })}
        </div>

        <div className="workflow-run-actions">
          {awaitingConfirm && (
            <button type="button" className="primary" onClick={onConfirm}>
              <CheckCircle size={14} /> 确认并继续
            </button>
          )}
          <button type="button" onClick={() => onRerun(selectedStepIndex)}>
            <RotateCcw size={14} /> 重新运行
          </button>
          {currentRun.status === 'running' && (
            <button type="button" onClick={onAbort}>
              停止
            </button>
          )}
          <button type="button" onClick={onClearRun}>
            清空
          </button>
        </div>
      </aside>

      <section className="workflow-detail">
        <div className="workflow-detail-header">
          <strong>
            Step {selectedStepIndex + 1} · {selectedStep ? stepStatusLabel(selectedStep.status) : 'Unknown'}
          </strong>
          {selectedExecution?.error && (
            <span className="workflow-error">{selectedExecution.error}</span>
          )}
        </div>
        <TranscriptViewer events={selectedExecution?.events ?? []} />
        <div className="workflow-cli-composer">
          <div className="workflow-cli-prompt">›</div>
          <textarea
            value={composerValue}
            disabled={!composerEnabled}
            placeholder={composerPlaceholder}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onComposerSend()
              }
            }}
          />
          <button onClick={() => void onComposerSend()} disabled={!composerEnabled} type="button">
            <Send size={14} /> Send
          </button>
        </div>
        {composerError && <div className="workflow-input-error">{composerError}</div>}
      </section>
    </div>
  )
}

function HandoffPanel({
  handoff
}: {
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']>
}): JSX.Element {
  return (
    <div className="handoff-panel">
      <div className="section-title"><CheckCircle size={14} /> 移交摘要</div>
      <p>{handoff.summary}</p>
      {handoff.artifacts.length > 0 && (
        <ul>
          {handoff.artifacts.map((artifact, index) => (
            <li key={`${artifact.path}-${index}`}>
              <strong>{artifact.path}</strong> · {artifact.description}
            </li>
          ))}
        </ul>
      )}
      {handoff.nextStepGuidance && <p className="field-hint">{handoff.nextStepGuidance}</p>}
    </div>
  )
}

function workflowRunStatusLabel(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'awaiting-confirm':
      return 'Awaiting Confirmation'
    case 'completed':
      return 'Completed'
    case 'error':
      return 'Error'
    case 'aborted':
      return 'Aborted'
  }
}

function stepStatusLabel(status: WorkflowRun['steps'][number]['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'running':
      return 'Running'
    case 'awaiting-confirm':
      return 'Awaiting Confirm'
    case 'done':
      return 'Done'
    case 'stale':
      return 'Stale'
    case 'error':
      return 'Error'
  }
}
