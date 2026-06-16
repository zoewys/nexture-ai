/**
 * SingleRunPanel.tsx — Single Agent 会话型工作区
 *
 * Single 模式现在由产品级 SingleSession 驱动：左侧是逻辑会话列表，
 * 主区显示当前会话 transcript，header 内直接承载 route / model / cwd 配置。
 */

import { useEffect, useMemo, useState } from 'react'
import type {
  AgentDefinition,
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  RunConfig,
  RunAttachment,
  SessionRoute,
  SingleSession,
  SingleSessionCreateInput,
  SingleSessionDetail,
  SingleSessionSendInput
} from '@shared/types'
import { ALL_VENDORS } from '@shared/types'
import { Select } from './Select'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { TranscriptViewer } from './TranscriptViewer'
import { MemoryReferences } from './MemoryReferences'
import { ComposerBar } from './ComposerBar'
import { SingleSessionSidebar } from './SingleSessionSidebar'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import { Bot, FolderOpen, GitBranch, MessageSquare, Square } from 'lucide-react'
import { useProviders } from './useProviders'

interface SingleRunPanelProps {
  agents: AgentDefinition[]
  clis: CliCheckResult | null
  modelCatalog: ModelCatalog | null
  modelsLoading: boolean
  sessions: SingleSession[]
  selectedSession: SingleSessionDetail | null
  selectedSessionId: string | null
  onCreateSession: (input: SingleSessionCreateInput) => Promise<SingleSession>
  onSelectSession: (id: string) => void
  onSendMessage: (
    text: string,
    route: SessionRoute,
    options?: Partial<Omit<SingleSessionSendInput, 'sessionId' | 'text' | 'route'>>,
    sessionIdOverride?: string
  ) => Promise<SingleSessionDetail>
  onAbortSession: () => Promise<SingleSessionDetail | null>
  onDeleteSession: (id: string) => Promise<void>
  onModeAgents: () => void
  showMemoryReferences?: boolean
}

export function SingleRunPanel({
  agents,
  clis,
  modelCatalog,
  modelsLoading,
  sessions,
  selectedSession,
  selectedSessionId,
  onCreateSession,
  onSelectSession,
  onSendMessage,
  onAbortSession,
  onDeleteSession,
  onModeAgents,
  showMemoryReferences = false
}: SingleRunPanelProps): JSX.Element {
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState(readLastProjectPath)
  const [model, setModel] = useState('')
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<RunConfig['codexReasoningEffort']>()
  const [codexServiceTier, setCodexServiceTier] = useState<string | undefined>()
  const [message, setMessage] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [apiMaxSteps, setApiMaxSteps] = useState('10')
  const [apiTemperature, setApiTemperature] = useState('0.2')
  const [apiTopP, setApiTopP] = useState('1')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [lastRouteSwitch, setLastRouteSwitch] = useState<string | null>(null)
  const providerState = useProviders()

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  )

  const modelInfo = modelCatalog?.[vendor] ?? null
  const selectedProvider = useMemo(
    () => providerState.providers.find((provider) => provider.id === selectedProviderId) ?? providerState.providers[0] ?? null,
    [providerState.providers, selectedProviderId]
  )
  const apiModels = selectedProvider?.models ?? []
  const effectiveModel = vendor === 'api'
    ? (model || selectedProvider?.defaultModel || apiModels[0] || '')
    : model
  const currentRoute: SessionRoute = {
    vendor,
    agentId: selectedAgent?.id,
    model: effectiveModel.trim() || undefined,
    apiProviderId: vendor === 'api' ? selectedProviderId || selectedProvider?.id : undefined,
    apiTemperature: vendor === 'api' ? parseOptionalFloat(apiTemperature) : undefined,
    apiTopP: vendor === 'api' ? parseOptionalFloat(apiTopP) : undefined,
    codexReasoningEffort: vendor === 'codex' ? codexReasoningEffort : undefined,
    codexServiceTier: vendor === 'codex' ? codexServiceTier : undefined,
    permissionMode: selectedAgent?.permissionMode
  }
  const routeChanged = !!selectedSession?.route && !routesEqual(selectedSession.route, currentRoute)
  const cliAvailable = clis ? clis[vendor] : true

  useEffect(() => {
    if (!selectedSession) return
    setCwd(selectedSession.cwd)
    if (!selectedSession.route) return
    setVendor(selectedSession.route.vendor)
    setModel(selectedSession.route.model ?? '')
    setSelectedAgentId(selectedSession.route.agentId ?? null)
    setSelectedProviderId(selectedSession.route.apiProviderId ?? '')
    setApiTemperature(selectedSession.route.apiTemperature !== undefined ? String(selectedSession.route.apiTemperature) : '0.2')
    setApiTopP(selectedSession.route.apiTopP !== undefined ? String(selectedSession.route.apiTopP) : '1')
    setCodexReasoningEffort(selectedSession.route.codexReasoningEffort)
    setCodexServiceTier(selectedSession.route.codexServiceTier)
  }, [selectedSession?.id])

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id || null)
    const agent = id ? agents.find((a) => a.id === id) : null
    if (agent) {
      setVendor(agent.vendor)
      setModel(agent.model ?? '')
      setSelectedProviderId(agent.apiProviderId ?? '')
      setApiTemperature(agent.apiTemperature !== undefined ? String(agent.apiTemperature) : '0.2')
      setApiTopP(agent.apiTopP !== undefined ? String(agent.apiTopP) : '1')
      setCodexReasoningEffort(agent.codexReasoningEffort)
      setCodexServiceTier(agent.codexServiceTier)
    }
  }

  const handleVendorChange = (nextVendor: AgentVendor): void => {
    setVendor(nextVendor)
    setModel('')
    if (nextVendor !== 'api') setSelectedProviderId('')
  }

  const handleProviderChange = (providerId: string): void => {
    setSelectedProviderId(providerId)
    const provider = providerState.providers.find((item) => item.id === providerId)
    setModel(provider?.defaultModel ?? provider?.models[0] ?? '')
  }

  const handlePickDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) {
      setCwd(dir)
      rememberProjectPath(dir)
    }
  }

  const handlePickFiles = async () => {
    const files = await window.api.pickFiles()
    if (files && files.length > 0) setAttachedFiles(prev => [...prev, ...files])
  }

  const handleCreateSession = async (): Promise<SingleSession> => {
    const projectPath = cwd.trim()
    if (!projectPath) throw new Error('Project directory is required')
    rememberProjectPath(projectPath)
    return onCreateSession({
      cwd: projectPath,
      route: currentRoute
    })
  }

  const handleSelectSession = (id: string): void => {
    if (selectedSession?.running && selectedSession.id !== id) {
      const confirmed = window.confirm('当前会话仍有 live run。停止或完成后再切换，或确认切换并保留后台运行。')
      if (!confirmed) return
    }
    onSelectSession(id)
  }

  const handleDeleteSession = (id: string): void => {
    const session = sessions.find((item) => item.id === id)
    const runningHint = selectedSession?.id === id && selectedSession.running
      ? '\n\n当前 live run 会被停止。'
      : ''
    const title = session?.title || 'this session'
    if (!window.confirm(`删除 session "${title}"?${runningHint}`)) return
    void onDeleteSession(id)
  }

  const handleSend = async (): Promise<void> => {
    const text = message.trim()
    if ((!text && attachedFiles.length === 0) || (vendor === 'api' && !selectedProvider)) return
    const fullText = vendor === 'api'
      ? (text || 'Please review the attached files.')
      : attachedFiles.length > 0
        ? text + '\n\n[Attached files:\n' + attachedFiles.map(f => `  ${f}`).join('\n') + '\n]'
        : text
    const session = selectedSession ?? await handleCreateSession()
    const previousRoute = session.route
    setMessage('')
    setAttachedFiles([])
    rememberProjectPath(cwd)
    const updated = await onSendMessage(
      fullText,
      currentRoute,
      {
        cwd: cwd.trim(),
        appendSystemPrompt: selectedAgent?.systemPrompt,
        apiMaxSteps: vendor === 'api' ? parseOptionalPositiveInt(apiMaxSteps) ?? 10 : undefined,
        apiTemperature: vendor === 'api' ? parseOptionalFloat(apiTemperature) : undefined,
        apiTopP: vendor === 'api' ? parseOptionalFloat(apiTopP) : undefined,
        attachments: attachedFiles.map((path) => ({
          path,
          kind: inferAttachmentKind(path),
          name: fileName(path)
        }))
      },
      session.id
    )
    if (previousRoute && !routesEqual(previousRoute, currentRoute)) {
      setLastRouteSwitch(`${routeLabel(previousRoute)} -> ${routeLabel(currentRoute)}`)
    } else if (updated.activeSegment?.continuationStrategy === 'logic-replay') {
      setLastRouteSwitch(`${routeLabel(previousRoute ?? currentRoute)} -> ${routeLabel(currentRoute)}`)
    }
  }

  const pendingSwitchLabel = selectedSession?.route && routeChanged
    ? `${routeLabel(selectedSession.route)} -> ${routeLabel(currentRoute)}`
    : null
  const bannerText = pendingSwitchLabel
    ? `当前话题不变，后续由新模型接手：${pendingSwitchLabel}`
    : lastRouteSwitch
      ? `模型已切换，会话保持不变：${lastRouteSwitch}`
      : null

  return (
    <>
      <SingleSessionSidebar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onNewSession={() => { void handleCreateSession() }}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />

      <main className="panel panel-runtime single-session-main">
        <div className="single-session-header">
          <div className="single-session-title-block">
            <span className="section-title">Single Agent</span>
            <h2>{selectedSession?.title ?? 'New Session'}</h2>
            <div className="single-session-meta">
              <span><Bot size={13} /> {routeLabel(selectedSession?.route ?? currentRoute)}</span>
              <span><GitBranch size={13} /> {cwd || 'No project selected'}</span>
              <span className={selectedSession?.running ? 'single-session-status-running' : ''}>
                {selectedSession?.running ? 'LIVE' : 'READY'}
              </span>
            </div>
          </div>
          <div className="single-session-actions">
            {selectedSession?.running && (
              <button type="button" onClick={() => { void onAbortSession() }}>
                <Square size={13} /> Stop
              </button>
            )}
          </div>
        </div>

        {bannerText && (
          <div className="single-session-banner single-session-banner-active-route">
            <MessageSquare size={15} />
            <div>
              <strong>{bannerText}</strong>
              <span className="single-session-banner-meta">
                逻辑会话 ID 不变；跨模型不会复用旧模型的原生 session。
              </span>
            </div>
          </div>
        )}

        <div className="single-session-route-panel">
          <label className="field compact-field">
            <span>Agent</span>
            <div className="field-row">
              <Select value={selectedAgentId ?? ''} onChange={(v) => handleSelectAgent(v)} placeholder="None — manual config">
                <Select.Item value="">None — manual config</Select.Item>
                {agents.map((a) => (
                  <Select.Item key={a.id} value={a.id}>{a.name || 'Unnamed'}</Select.Item>
                ))}
              </Select>
              <button onClick={onModeAgents} type="button">Agent</button>
            </div>
          </label>

          <label className="field compact-field">
            <span>Mode</span>
            <div className="vendor-tabs">
              {ALL_VENDORS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`vendor-tab${vendor === v ? ' active' : ''}`}
                  onClick={() => handleVendorChange(v)}
                >
                  {v === 'claude' ? 'Claude CLI' : v === 'codex' ? 'Codex CLI' : 'API'}
                  {clis && !clis[v] ? ' (not installed)' : ''}
                </button>
              ))}
            </div>
          </label>

          {vendor === 'api' ? (
            <>
              <label className="field compact-field">
                <span>API 供应商</span>
                <Select value={selectedProvider?.id ?? ''} onChange={handleProviderChange} disabled={providerState.loading || providerState.providers.length === 0}>
                  {providerState.providers.map((provider) => (
                    <Select.Item key={provider.id} value={provider.id}>{provider.name}</Select.Item>
                  ))}
                </Select>
              </label>
              <label className="field compact-field">
                <span>Model</span>
                <Select value={effectiveModel} onChange={setModel} disabled={apiModels.length === 0}>
                  {apiModels.map((apiModel) => (
                    <Select.Item key={apiModel} value={apiModel}>{apiModel}</Select.Item>
                  ))}
                </Select>
              </label>
              <div className="api-advanced-controls">
                <label className="field compact-field">
                  <span>Max steps</span>
                  <input type="number" min="1" max="50" value={apiMaxSteps} onChange={(e) => setApiMaxSteps(e.target.value)} />
                </label>
                <label className="field compact-field">
                  <span>Temperature</span>
                  <input type="number" min="0" max="2" step="0.1" value={apiTemperature} onChange={(e) => setApiTemperature(e.target.value)} />
                </label>
                <label className="field compact-field">
                  <span>Top P</span>
                  <input type="number" min="0" max="1" step="0.05" value={apiTopP} onChange={(e) => setApiTopP(e.target.value)} />
                </label>
              </div>
            </>
          ) : (
            <label className="field compact-field">
              <span>Model</span>
              <ModelSelect
                value={model}
                loading={modelsLoading}
                modelInfo={modelInfo}
                onChange={setModel}
              />
            </label>
          )}

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

          <label className="field compact-field single-session-cwd-field">
            <span>Project Directory</span>
            <div className="field-row">
              <input value={cwd} placeholder="/path/to/project" onChange={(e) => setCwd(e.target.value)} />
              <button onClick={handlePickDir} type="button">
                <FolderOpen size={14} /> Browse
              </button>
            </div>
          </label>
        </div>

        {!cliAvailable && <div className="warn">{vendor} CLI not found. Auto-installing...</div>}

        <div className="single-session-transcript">
          {selectedSession ? (
            <TranscriptViewer events={selectedSession.conversation.events} variant="chat" />
          ) : (
            <div className="single-session-empty-state">
              <MessageSquare size={26} />
              <strong>Create a session to start chatting</strong>
              <span>Pick a project directory, choose a route, then send the first message.</span>
            </div>
          )}
          {showMemoryReferences && selectedAgentId && (
            <MemoryReferences
              agentId={selectedAgentId}
              projectPath={cwd}
              memoryIds={selectedSession?.injectedMemoryIds}
            />
          )}
        </div>

        <ComposerBar
          value={message}
          onChange={setMessage}
          onSend={handleSend}
          disabled={!cwd.trim() || (vendor === 'api' && !selectedProvider)}
          placeholder={
            selectedSession
              ? '继续当前逻辑会话...'
              : '发送第一条消息并创建会话...'
          }
          attachedFiles={attachedFiles}
          onPickFiles={handlePickFiles}
          onRemoveFile={(f) => setAttachedFiles(prev => prev.filter(x => x !== f))}
        />
      </main>
    </>
  )
}

function routesEqual(a: SessionRoute, b: SessionRoute): boolean {
  return (
    a.vendor === b.vendor &&
    empty(a.model) === empty(b.model) &&
    empty(a.agentId) === empty(b.agentId) &&
    empty(a.apiProviderId) === empty(b.apiProviderId) &&
    numberEmpty(a.apiTemperature) === numberEmpty(b.apiTemperature) &&
    numberEmpty(a.apiTopP) === numberEmpty(b.apiTopP) &&
    empty(a.codexReasoningEffort) === empty(b.codexReasoningEffort) &&
    empty(a.codexServiceTier) === empty(b.codexServiceTier) &&
    empty(a.permissionMode) === empty(b.permissionMode)
  )
}

function empty(value: string | undefined): string {
  return value?.trim() ?? ''
}

function routeLabel(route: SessionRoute): string {
  return [route.vendor, route.model].filter(Boolean).join(' · ') || route.vendor
}

function numberEmpty(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function parseOptionalFloat(value: string): number | undefined {
  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function inferAttachmentKind(path: string): RunAttachment['kind'] {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ? 'image' : 'file'
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
