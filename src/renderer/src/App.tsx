import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDefinition,
  AgentEvent,
  AgentVendor,
  CliCheckResult,
  RunConfig,
  WorkflowRun
} from '@shared/types'
import { ALL_VENDORS } from '@shared/types'
import { useRun } from './useRun'
import { useAgents } from './useAgents'
import { useCliModels } from './useCliModels'
import { useWorkflows } from './useWorkflows'
import { AgentManager } from './AgentManager'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { TranscriptViewer } from './TranscriptViewer'
import { TemplatesView } from './TemplatesView'
import { UiReviewMockNav } from './UiReviewMockNav'
import { WorkflowWorkspace } from './WorkflowWorkspace'
import { formatHandoffDisplay } from './handoffDisplay'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import { useUiReviewFixture } from './uiReviewFixture'
import { prepareWorkflowNotificationSound } from './workflowNotificationSound'
import {
  Play,
  FolderOpen,
  Send,
  RotateCcw,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ClipboardCheck
} from './Icons'

type WorkspaceMode = 'workflow' | 'templates' | 'agents' | 'single'
type UiReviewWorkflowSurface = 'workflow' | 'new-run'

export function App(): JSX.Element {
  const { state, start, continueSession, push, abort, reset } = useRun()
  const { agents: savedAgents, save: saveAgent, remove: removeAgent } = useAgents()
  const { models: modelCatalog, loading: modelsLoading } = useCliModels()
  const savedWorkflows = useWorkflows()
  const uiReview = useUiReviewFixture()
  const agents = uiReview.enabled ? uiReview.agents : savedAgents
  const workflows = uiReview.enabled ? uiReview.workflows : savedWorkflows
  const [clis, setClis] = useState<CliCheckResult | null>(null)
  const [mode, setMode] = useState<WorkspaceMode>('workflow')
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState(readLastProjectPath)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<RunConfig['codexReasoningEffort']>()
  const [codexServiceTier, setCodexServiceTier] = useState<string | undefined>()
  const [interjection, setInterjection] = useState('')
  const [workflowInput, setWorkflowInput] = useState('')
  const [workflowInputError, setWorkflowInputError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedWorkflowStep, setSelectedWorkflowStep] = useState(0)
  const [uiReviewWorkflowSurface, setUiReviewWorkflowSurface] =
    useState<UiReviewWorkflowSurface>('workflow')
  const [configOpen, setConfigOpen] = useState(true)

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
    rememberProjectPath(cwd)
  }, [cwd])

  useEffect(() => {
    if (workflows.currentRun) {
      setMode('workflow')
      setSelectedWorkflowStep(workflows.currentRun.currentStepIndex)
    }
  }, [workflows.currentRun?.id, workflows.currentRun?.currentStepIndex])

  useEffect(() => {
    const prepareSound = () => prepareWorkflowNotificationSound()
    window.addEventListener('pointerdown', prepareSound, { once: true })
    window.addEventListener('keydown', prepareSound, { once: true })
    return () => {
      window.removeEventListener('pointerdown', prepareSound)
      window.removeEventListener('keydown', prepareSound)
    }
  }, [])

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

  const canFollowUp = !state.running && state.events.length > 0
  const canResume = canFollowUp && state.sessionId !== null
  const canInterject = state.running && vendor === 'claude'
  const composerEnabled = canFollowUp || canInterject
  const modelInfo = modelCatalog?.[vendor] ?? null

  const handleComposerSend = async (): Promise<void> => {
    const text = interjection.trim()
    if (!text || !composerEnabled) return
    if (canInterject) {
      setInterjection('')
      await push(text)
    } else if (canFollowUp) {
      setInterjection('')
      const resumeFrom = state.sessionId ? { sessionId: state.sessionId, vendor } : undefined
      const config: RunConfig = {
        vendor,
        prompt: resumeFrom ? text : buildSingleRunFollowUpPrompt(prompt, state.events, text),
        cwd: cwd.trim(),
        model: model.trim() || undefined,
        resumeFrom,
        appendSystemPrompt: selectedAgent?.systemPrompt,
        permissionMode: selectedAgent?.permissionMode
      }
      await continueSession(config, text)
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
  const workflowStepStatus = selectedWorkflowStepState?.status ?? null
  const workflowCanInterject =
    selectedWorkflowAgent?.vendor === 'claude' && workflowStepStatus === 'running'
  const workflowCanContinue =
    !!selectedWorkflowExecution?.sessionId &&
    workflowStepStatus !== null &&
    workflowStepStatus !== 'pending' &&
    workflowStepStatus !== 'running'
  const workflowComposerEnabled =
    !!workflows.currentRun && (workflowCanInterject || workflowCanContinue)
  const workflowComposerEditable = !!workflows.currentRun && !!selectedWorkflowStepState
  const workflowComposerPlaceholder = !workflows.currentRun
    ? '请先启动一个工作流...'
    : !selectedWorkflowAgent
        ? '当前步骤没有可用 agent'
        : selectedWorkflowStepState?.status === 'running' && selectedWorkflowAgent.vendor !== 'claude'
          ? `${selectedWorkflowAgent.vendor} 运行中不支持实时插话，可先输入草稿，步骤完成后发送`
        : !selectedWorkflowExecution?.sessionId
          ? '当前步骤暂无可继续的会话'
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
    prepareWorkflowNotificationSound()
    rememberProjectPath(projectPath)
    const run = await workflows.start({ templateId, projectPath, initialPrompt })
    setMode('workflow')
    setSelectedWorkflowStep(0)
    return run
  }

  const handleWorkflowConfirm = async (): Promise<void> => {
    prepareWorkflowNotificationSound()
    await workflows.confirmStep()
  }

  const handleWorkflowInputSend = async (): Promise<void> => {
    const text = workflowInput.trim()
    if (!text || !workflowComposerEnabled) return
    prepareWorkflowNotificationSound()
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
        return 'Agents'
      case 'templates':
        return 'Templates'
      case 'workflow':
        return uiReview.enabled && uiReviewWorkflowSurface === 'new-run'
          ? 'Workflow · New Run Drawer'
          : 'Workflow'
      case 'single':
        return 'Single Agent'
    }
  }

  const isAgents = mode === 'agents'
  const isWorkflow = mode === 'workflow'
  const isTemplates = mode === 'templates'
  const topbarChips = uiReview.enabled
    ? uiReview.topbarChips[mode]
    : buildTopbarChips(
        mode,
        workflows.runs.filter((run) => run.status === 'running').length,
        workflows.runs.filter((run) => run.status === 'awaiting-confirm').length,
        workflows.templates.length,
        agents.length
      )

  return (
    <div className={['app', uiReview.enabled ? 'app-ui-review' : ''].filter(Boolean).join(' ')}>
      <header className="app-header">
        <div className="app-brand">
          <h1>Agent Studio</h1>
          <span className="app-subtitle">{subtitle()}</span>
        </div>
        <div className="topbar-chips" aria-label="Workspace summary">
          {topbarChips.map((chip) => (
            <span className="topbar-chip" key={chip}>{chip}</span>
          ))}
        </div>
      </header>

      <div
        className={[
          'app-body',
          isAgents || isTemplates ? 'app-body-agents' : '',
          isWorkflow ? 'app-body-workflow' : '',
          !isAgents && !isTemplates && !isWorkflow && !configOpen ? 'app-body-config-collapsed' : ''
        ].filter(Boolean).join(' ')}
      >
        <nav className="mode-rail" aria-label="Workspace modes">
          <button
            type="button"
            className={`mode-item ${mode === 'workflow' ? 'mode-item-active' : ''}`}
            onClick={() => setMode('workflow')}
          >
            <span className="mode-icon">
              {reviewModeIcon('workflow')}
            </span>
            <span>Workflow</span>
          </button>
          <button
            type="button"
            className={`mode-item ${isTemplates ? 'mode-item-active' : ''}`}
            onClick={() => setMode('templates')}
          >
            <span className="mode-icon">
              {reviewModeIcon('templates')}
            </span>
            <span>Templates</span>
          </button>
          <button
            type="button"
            className={`mode-item ${isAgents ? 'mode-item-active' : ''}`}
            onClick={() => setMode(isAgents ? 'workflow' : 'agents')}
          >
            <span className="mode-icon">
              {reviewModeIcon('agents')}
            </span>
            <span>Agents</span>
          </button>
          <button
            type="button"
            className={`mode-item ${mode === 'single' ? 'mode-item-active' : ''}`}
            onClick={() => setMode('single')}
          >
            <span className="mode-icon">
              {reviewModeIcon('single')}
            </span>
            <span>Single</span>
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
        ) : isTemplates ? (
          <div className="panel templates-page">
            <TemplatesView
              agents={agents}
              templates={workflows.templates}
              onSave={workflows.save}
              onDelete={workflows.remove}
            />
          </div>
        ) : isWorkflow ? (
          <main className="panel panel-runtime panel-runtime-workflow">
            <WorkflowWorkspace
              agents={agents}
              workflows={workflows}
              newRunDefaults={uiReview.enabled ? uiReview.newRunDefaults : undefined}
              uiReviewEnabled={uiReview.enabled}
              onUiReviewSurfaceChange={setUiReviewWorkflowSurface}
            />
          </main>
        ) : (
          <>
            <aside className={`panel panel-config ${configOpen ? '' : 'panel-config-collapsed'}`}>
              {configOpen ? (
                <>
                  <div className="workspace-panel-header">
                    <div className="panel-heading-line">
                      <span className="section-title">
                        Single Run
                      </span>
                      <button
                        type="button"
                        className="icon-only panel-collapse-button"
                        title="收起配置栏"
                        aria-label="收起配置栏"
                        onClick={() => setConfigOpen(false)}
                      >
                        <ChevronLeft size={15} />
                      </button>
                    </div>
                    <h2>Single Run</h2>
                    <p>保留独立入口；不参与 workflow 多运行队列。</p>
                  </div>

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
                            Agent
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
                          {state.running ? 'Running...' : 'Start Run'}
                        </button>
                        {state.running && (
                          <button onClick={abort} type="button">
                            Stop
                          </button>
                        )}
                        {!state.running && state.events.length > 0 && (
                          <button onClick={reset} type="button">
                            Clear
                          </button>
                        )}
                      </div>
                  </>
                </>
              ) : (
                <button
                  type="button"
                  className="panel-vertical-toggle"
                  title="展开配置栏"
                  aria-label="展开配置栏"
                  onClick={() => setConfigOpen(true)}
                >
                  <ChevronRight size={16} />
                  <SlidersHorizontal size={16} />
                </button>
              )}
            </aside>

            <main className="panel panel-runtime">
              <>
                <TranscriptViewer events={state.events} />

                {state.events.length > 0 && (
                  <div className="interject">
                    <input
                      value={interjection}
                      disabled={!composerEnabled}
                      placeholder={
                        canInterject
                          ? '向运行中的 agent 发送消息...'
                          : canResume
                            ? '继续此会话...'
                            : canFollowUp
                              ? '继续对话（将基于当前 transcript 重建上下文）...'
                              : vendor === 'claude'
                                ? '先启动一次运行以创建会话...'
                                : state.running
                                  ? `${vendor} 运行中暂不支持实时输入`
                                  : '先启动一次运行以创建对话...'
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
                      发送
                    </button>
                  </div>
                )}
              </>
            </main>
          </>
        )}
      </div>

      {uiReview.enabled && mode !== 'workflow' && <UiReviewMockNav active={mode} />}
    </div>
  )
}

function reviewModeIcon(mode: WorkspaceMode): string {
  switch (mode) {
    case 'workflow':
      return '⌘'
    case 'templates':
      return '▦'
    case 'agents':
      return '◎'
    case 'single':
      return '▶'
  }
}

function buildTopbarChips(
  mode: WorkspaceMode,
  runningCount: number,
  waitingCount: number,
  templateCount: number,
  agentCount: number
): string[] {
  switch (mode) {
    case 'workflow':
      return [`${runningCount} running`, `${waitingCount} waiting`, 'sound per run']
    case 'templates':
      return [`${templateCount} templates`, 'node canvas later', 'linear V1']
    case 'agents':
      return [`${agentCount} agents`, '2 CLIs', 'templates linked']
    case 'single':
      return ['single run', 'follow-up', 'transcript']
  }
}

function buildSingleRunFollowUpPrompt(
  initialPrompt: string,
  events: AgentEvent[],
  nextText: string
): string {
  const transcript = events
    .flatMap((event): string[] => {
      if (event.kind === 'message') return [`Assistant: ${event.text}`]
      if (event.kind === 'system' && event.text.startsWith('↳ ')) {
        return [`User: ${event.text.slice(2).trim()}`]
      }
      return []
    })
    .join('\n\n')

  return [
    'Continue the earlier conversation. The CLI did not provide a resumable session id, so use this transcript as context.',
    '',
    initialPrompt.trim() ? `User: ${initialPrompt.trim()}` : '',
    transcript,
    '',
    '---',
    '',
    `Now respond to this new message:\n${nextText}`
  ]
    .filter((part) => part.trim())
    .join('\n\n')
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
  composerEditable: boolean
  composerEnabled: boolean
  composerPlaceholder: string
  composerError: string | null
  onComposerChange: (value: string) => void
  onComposerSend: () => Promise<void>
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']> | null
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
  composerEditable,
  composerEnabled,
  composerPlaceholder,
  composerError,
  onComposerChange,
  onComposerSend,
  handoff
}: WorkflowRuntimeProps): JSX.Element {
  const [handoffOpen, setHandoffOpen] = useState(true)
  const [runSidebarOpen, setRunSidebarOpen] = useState(true)

  if (!currentRun) {
    return (
      <div className="runtime-empty">
        <strong>暂无工作流运行</strong>
        <span>在左侧选择或创建工作流，然后启动运行。</span>
      </div>
    )
  }

  const selectedStep = currentRun.steps[selectedStepIndex]
  const awaitingConfirm =
    currentRun.status === 'awaiting-confirm' &&
    currentRun.steps[currentRun.currentStepIndex]?.status === 'awaiting-confirm'

  return (
    <div
      className={[
        'workflow-runtime',
        runSidebarOpen ? '' : 'workflow-runtime-run-collapsed',
        handoff ? 'workflow-runtime-with-handoff' : '',
        handoff && !handoffOpen ? 'workflow-runtime-handoff-collapsed' : ''
      ].filter(Boolean).join(' ')}
    >
      {runSidebarOpen ? (
        <aside className="workflow-run-sidebar">
          <div className="runtime-section-header">
            <div className="panel-heading-line">
              <span className="section-title">Active Run</span>
              <button
                type="button"
                className="icon-only panel-collapse-button"
                title="收起运行栏"
                aria-label="收起运行栏"
                onClick={() => setRunSidebarOpen(false)}
              >
                <ChevronLeft size={15} />
              </button>
            </div>
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
      ) : (
        <aside className="workflow-run-sidebar-collapsed">
          <button
            type="button"
            className="panel-vertical-toggle"
            title="展开运行栏"
            aria-label="展开运行栏"
            onClick={() => setRunSidebarOpen(true)}
          >
            <ChevronRight size={16} />
            <Play size={16} />
          </button>
        </aside>
      )}

      <section className="workflow-detail">
        <div className="workflow-detail-header">
          <strong>
            步骤 {selectedStepIndex + 1} · {selectedStep ? stepStatusLabel(selectedStep.status) : '未知'}
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
      </section>

      {handoff && handoffOpen && (
        <aside className="handoff-dock" aria-label="结构化交接物">
          <HandoffPanel handoff={handoff} onCollapse={() => setHandoffOpen(false)} />
        </aside>
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
            <ChevronLeft size={16} />
            <ClipboardCheck size={16} />
          </button>
        </aside>
      )}
    </div>
  )
}

function HandoffPanel({
  handoff,
  onCollapse
}: {
  handoff: NonNullable<WorkflowRun['steps'][number]['executions'][number]['handoff']>
  onCollapse: () => void
}): JSX.Element {
  const display = formatHandoffDisplay(handoff)

  return (
    <div className="handoff-panel">
      <div className="handoff-panel-header">
        <div className="section-title"><CheckCircle size={14} /> 结构化交接物</div>
        <div className="handoff-panel-header-actions">
          <span className="handoff-panel-status">等待确认</span>
          <button
            type="button"
            className="icon-only handoff-toggle"
            title="收起交接物"
            aria-label="收起交接物"
            onClick={onCollapse}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <section className="handoff-section">
        <h3>{display.summary.label}</h3>
        <p>{display.summary.text}</p>
      </section>

      <section className="handoff-section">
        <h3>{display.artifacts.label}</h3>
        {display.artifacts.rows.length > 0 ? (
          <div className="handoff-artifact-table" role="table" aria-label="Handoff artifacts">
            <div className="handoff-artifact-row handoff-artifact-head" role="row">
              {display.artifacts.headers.map((header) => (
                <span key={header} role="columnheader">{header}</span>
              ))}
            </div>
            {display.artifacts.rows.map((artifact, index) => (
              <div className="handoff-artifact-row" role="row" key={`${artifact.path}-${index}`}>
                <span className="handoff-artifact-type" role="cell">{artifact.type}</span>
                <code role="cell">{artifact.path}</code>
                <span role="cell">{artifact.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="handoff-empty">{display.artifacts.emptyText}</p>
        )}
      </section>

      {display.guidance && (
        <section className="handoff-section">
          <h3>{display.guidance.label}</h3>
          <p>{display.guidance.text}</p>
        </section>
      )}
    </div>
  )
}

function workflowRunStatusLabel(status: WorkflowRun['status']): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'awaiting-confirm':
      return '等待确认'
    case 'completed':
      return '已完成'
    case 'error':
      return '错误'
    case 'aborted':
      return '已停止'
    case 'interrupted':
      return '已中断'
  }
}

function stepStatusLabel(status: WorkflowRun['steps'][number]['status']): string {
  switch (status) {
    case 'pending':
      return '待运行'
    case 'running':
      return '运行中'
    case 'awaiting-confirm':
      return '等待确认'
    case 'done':
      return '完成'
    case 'stale':
      return '已过期'
    case 'error':
      return '错误'
  }
}
