import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDefinition,
  AgentEvent,
  AgentVendor,
  CliCheckResult,
  RunConfig
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
import { WorkflowWorkspace } from './WorkflowWorkspace'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import {
  GitBranch,
  Play,
  Bot,
  FolderOpen,
  Send,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal
} from './Icons'

type WorkspaceMode = 'workflow' | 'templates' | 'single' | 'agents'

export function App(): JSX.Element {
  const { state, start, continueSession, push, abort, reset } = useRun()
  const { agents, save: saveAgent, remove: removeAgent } = useAgents()
  const { models: modelCatalog, loading: modelsLoading } = useCliModels()
  const workflows = useWorkflows()
  const [clis, setClis] = useState<CliCheckResult | null>(null)
  const [mode, setMode] = useState<WorkspaceMode>('workflow')
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState(readLastProjectPath)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<RunConfig['codexReasoningEffort']>()
  const [codexServiceTier, setCodexServiceTier] = useState<string | undefined>()
  const [interjection, setInterjection] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
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
      case 'templates':
        return `Templates · ${workflows.templates.length}`
      case 'workflow':
        return `Workflow · ${workflows.runs.length} run(s)`
      case 'single':
        return `Single Run · ${vendor}`
    }
  }

  const isWorkflow = mode === 'workflow'
  const isTemplates = mode === 'templates'
  const isSingle = mode === 'single'
  const isAgents = mode === 'agents'

  return (
    <div className="app">
      <header className="app-header">
        <h1>Agent Studio</h1>
        <span className="app-subtitle">{subtitle()}</span>
      </header>

      <div
        className={[
          'app-body',
          isAgents ? 'app-body-agents' : '',
          !isAgents && !configOpen ? 'app-body-config-collapsed' : '',
          isWorkflow ? 'app-body-workflow' : isTemplates ? 'app-body-templates' : ''
        ].filter(Boolean).join(' ')}
      >
        <nav className="mode-rail" aria-label="Workspace modes">
          <button
            type="button"
            className={`mode-item ${isWorkflow ? 'mode-item-active' : ''}`}
            onClick={() => setMode('workflow')}
          >
            <span className="mode-icon"><GitBranch /></span>
            <span>Workflow</span>
          </button>
          <button
            type="button"
            className={`mode-item ${isTemplates ? 'mode-item-active' : ''}`}
            onClick={() => setMode('templates')}
          >
            <span className="mode-icon"><SlidersHorizontal /></span>
            <span>Templates</span>
          </button>
          <button
            type="button"
            className={`mode-item ${isSingle ? 'mode-item-active' : ''}`}
            onClick={() => setMode('single')}
          >
            <span className="mode-icon"><Play /></span>
            <span>Single</span>
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
        ) : isWorkflow ? (
          <WorkflowWorkspace agents={agents} workflows={workflows} />
        ) : isTemplates ? (
          <TemplatesView
            agents={agents}
            templates={workflows.templates}
            onSave={workflows.save}
            onDelete={workflows.remove}
          />
        ) : (
          <>
            <aside className={`panel panel-config ${configOpen ? '' : 'panel-config-collapsed'}`}>
              {configOpen ? (
                <>
                  <div className="workspace-panel-header">
                    <div className="panel-heading-line">
                      <span className="section-title">Single Run Config</span>
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
                    <h2>Run a single agent</h2>
                    <p>Pick a preset agent or configure a one-shot CLI run.</p>
                  </div>

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
                    <Send size={14} /> 发送
                  </button>
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  )
}

function buildSingleRunFollowUpPrompt(
  initialPrompt: string,
  events: AgentEvent[],
  nextText: string
): string {
  const transcript = events
    .flatMap((event): string[] => {
      if (event.kind === 'message') return [`Assistant: ${event.text}`]
      if (event.kind === 'system' && event.text.startsWith('↳ you: ')) {
        return [`User: ${event.text.slice('↳ you: '.length)}`]
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
