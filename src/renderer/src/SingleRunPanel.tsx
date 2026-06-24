/**
 * SingleRunPanel.tsx — Single Agent 会话型工作区
 *
 * Single 模式现在由产品级 SingleSession 驱动：左侧是逻辑会话列表，
 * 主区显示当前会话 transcript，header 内直接承载 route / model / cwd 配置。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentDefinition,
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  RunConfig,
  RunAttachment,
  SessionRoute,
  SkillSummary,
  SingleSession,
  SingleSessionCreateInput,
  SingleSessionDetail,
  SingleSessionSendInput
} from '@shared/types'
import { Select } from './Select'
import { CodexOptions } from './CodexOptions'
import { RuntimeModelCascade } from './RuntimeModelCascade'
import { TranscriptViewer } from './TranscriptViewer'
import { MemoryReferences } from './MemoryReferences'
import { ComposerBar } from './ComposerBar'
import { SingleSessionSidebar } from './SingleSessionSidebar'
import { savePastedImageFiles } from './pastedImages'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import { Bot, ChevronDown, FolderOpen, MessageSquare, Settings2, Square } from 'lucide-react'
import { useProviders } from './useProviders'
import { useSkills } from './useSkills'
import { useAgentCreateCapture } from './useAgentCreateCapture'
import { AgentCreateConfirmCard } from './AgentCreateConfirmCard'
import type { AgentDraftPayload } from '@shared/agentDefinitionParser'
import type { AgentDraft } from './useAgents'

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
  onSaveAgentDraft: (draft: AgentDraft) => Promise<AgentDefinition>
  onAgentsChanged: () => Promise<void> | void
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
  onSaveAgentDraft,
  onAgentsChanged,
  showMemoryReferences = false
}: SingleRunPanelProps): JSX.Element {
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState(readLastProjectPath)
  const [model, setModel] = useState('')
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<RunConfig['codexReasoningEffort']>()
  const [codexServiceTier, setCodexServiceTier] = useState<string | undefined>()
  const [message, setMessage] = useState('')
  const [composerError, setComposerError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [apiMaxSteps, setApiMaxSteps] = useState('10')
  const [apiTemperature, setApiTemperature] = useState('')
  const [apiTopP, setApiTopP] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [lastRouteSwitch, setLastRouteSwitch] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const providerState = useProviders()
  const skillState = useSkills()

  const capture = useAgentCreateCapture(
    selectedSession?.conversation.events ?? [],
    selectedSession?.running ?? false,
    selectedSession?.id
  )
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback(() => {
    setToastVisible(true)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 4000)
  }, [])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  const handleCreateAgent = async (draft: AgentDraftPayload): Promise<void> => {
    setCreatingAgent(true)
    try {
      await onSaveAgentDraft(draft)
      await onAgentsChanged()
      capture.dismiss()
      showToast()
    } finally {
      setCreatingAgent(false)
    }
  }

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  )

  const modelInfo = modelCatalog?.[vendor] ?? null
  const selectedProvider = useMemo(
    () => providerState.providers.find((provider) => provider.id === selectedProviderId) ?? providerState.providers[0] ?? null,
    [providerState.providers, selectedProviderId]
  )
  const projectFolderName = folderDisplayName(cwd)
  const apiModels = selectedProvider?.models ?? []
  const effectiveProviderId = selectedProvider?.id ?? ''
  const effectiveModel = vendor === 'api'
    ? (model || selectedProvider?.defaultModel || apiModels[0] || '')
    : model
  const currentRoute: SessionRoute = {
    vendor,
    agentId: selectedAgent?.id,
    model: effectiveModel.trim() || undefined,
    apiProviderId: vendor === 'api' ? effectiveProviderId : undefined,
    apiTemperature: vendor === 'api' ? parseOptionalFloat(apiTemperature) : undefined,
    apiTopP: vendor === 'api' ? parseOptionalFloat(apiTopP) : undefined,
    codexReasoningEffort: vendor === 'codex' ? codexReasoningEffort : undefined,
    codexServiceTier: vendor === 'codex' ? codexServiceTier : undefined,
    permissionMode: selectedAgent?.permissionMode
  }
  const routeChanged = !!selectedSession?.route && !routesEqual(selectedSession.route, currentRoute)
  const cliAvailable = clis ? clis[vendor] : true
  const selectedSkills = useMemo(
    () => selectedSkillIds
      .map((id) => skillState.skills.find((skill) => skill.id === id))
      .filter((skill): skill is SkillSummary => skill !== undefined),
    [selectedSkillIds, skillState.skills]
  )

  useEffect(() => {
    if (!selectedSession) return
    setCwd(selectedSession.cwd)
    setShowAdvanced(false)
    if (!selectedSession.route) return
    setVendor(selectedSession.route.vendor)
    setModel(selectedSession.route.model ?? '')
    setSelectedAgentId(selectedSession.route.agentId ?? null)
    setSelectedProviderId(selectedSession.route.apiProviderId ?? '')
    setCodexReasoningEffort(selectedSession.route.codexReasoningEffort)
    setCodexServiceTier(selectedSession.route.codexServiceTier)
    setApiTemperature(selectedSession.route.apiTemperature != null ? String(selectedSession.route.apiTemperature) : '')
    setApiTopP(selectedSession.route.apiTopP != null ? String(selectedSession.route.apiTopP) : '')
  }, [selectedSession?.id])

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id || null)
    const agent = id ? agents.find((a) => a.id === id) : null
    if (agent) {
      setVendor(agent.vendor)
      setModel(agent.model ?? '')
      setSelectedProviderId(agent.apiProviderId ?? '')
      setCodexReasoningEffort(agent.codexReasoningEffort)
      setCodexServiceTier(agent.codexServiceTier)
      setApiTemperature(agent.apiTemperature != null ? String(agent.apiTemperature) : '')
      setApiTopP(agent.apiTopP != null ? String(agent.apiTopP) : '')
    }
  }

  const handleVendorChange = (nextVendor: AgentVendor): void => {
    setVendor(nextVendor)
    setModel('')
    if (nextVendor !== 'api') setSelectedProviderId('')
    if (nextVendor === 'claude') setShowAdvanced(false)
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
    if (files && files.length > 0) {
      setComposerError(null)
      setAttachedFiles(prev => [...prev, ...files])
    }
  }

  const handlePasteImages = async (files: File[]): Promise<void> => {
    setComposerError(null)
    try {
      const paths = await savePastedImageFiles(files)
      setAttachedFiles(prev => [...prev, ...paths])
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err))
    }
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
    const parsedMessage = parseSkillCommand(message, skillState.skills, selectedSkillIds)
    if (parsedMessage.onlySelectedSkill) {
      setMessage('')
      setComposerError(null)
      setSelectedSkillIds(parsedMessage.skillIds)
      return
    }
    const text = parsedMessage.text.trim()
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
    setSelectedSkillIds([])
    rememberProjectPath(cwd)
    const updated = await onSendMessage(
      fullText,
      currentRoute,
      {
        cwd: cwd.trim(),
        appendSystemPrompt: selectedAgent?.systemPrompt,
        apiMaxSteps: vendor === 'api' ? parseOptionalPositiveInt(apiMaxSteps) ?? 10 : undefined,
        attachments: attachedFiles.map((path) => ({
          path,
          kind: inferAttachmentKind(path),
          name: fileName(path)
        })),
        skillIds: parsedMessage.skillIds
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
  const hasAdvancedControls = vendor === 'api' || vendor === 'codex'
  const showInlineCodexOptions = showAdvanced && vendor === 'codex'
  const advancedSummaryChips = vendor === 'api'
    ? [
        compactNumericLabel(parseOptionalPositiveInt(apiMaxSteps) ?? 10, 'steps')
      ]
    : []

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
            <h2>{selectedSession?.title ?? 'New Session'}</h2>
            <div className="single-session-meta">
              <span><Bot size={13} /> {routeLabel(selectedSession?.route ?? currentRoute)}</span>
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
          <div className={`single-session-toolbar-main${showInlineCodexOptions ? ' single-session-toolbar-main-codex-advanced' : ''}`}>
            <section className="single-session-toolbar-cluster single-session-toolbar-runtime">
              <span className="single-session-toolbar-label">Runtime</span>
              <div className="single-session-toolbar-inline">
                <div className="single-session-toolbar-input">
                  <Select value={selectedAgentId ?? ''} onChange={(v) => handleSelectAgent(v)} placeholder="Agent or manual">
                    <Select.Item value="">None — manual config</Select.Item>
                    {agents.map((a) => (
                      <Select.Item key={a.id} value={a.id}>{a.name || 'Unnamed'}</Select.Item>
                    ))}
                  </Select>
                </div>
                <button
                  className="single-session-toolbar-quiet single-session-agent-icon-button"
                  onClick={onModeAgents}
                  type="button"
                  title="管理智能体"
                  aria-label="打开智能体管理"
                >
                  <Bot size={14} />
                </button>
              </div>
            </section>

            <section className="single-session-toolbar-cluster single-session-toolbar-model">
              <span className="single-session-toolbar-label">Model</span>
              <div className="single-session-toolbar-inline">
                <div className="single-session-toolbar-input single-session-toolbar-input-wide">
                  <RuntimeModelCascade
                    vendor={vendor}
                    apiProviderId={effectiveProviderId}
                    model={effectiveModel}
                    apiProviders={providerState.providers}
                    claudeCatalog={modelCatalog?.claude ?? null}
                    codexCatalog={modelCatalog?.codex ?? null}
                    apiProvidersLoading={providerState.loading}
                    modelsLoading={modelsLoading}
                    cliAvailability={clis ?? undefined}
                    onChange={(selection) => {
                      if (selection.vendor !== vendor) {
                        handleVendorChange(selection.vendor)
                      }
                      if (selection.vendor === 'api') {
                        const nextProviderId = selection.apiProviderId ?? ''
                        if (nextProviderId !== selectedProviderId) {
                          handleProviderChange(nextProviderId)
                        }
                      }
                      setModel(selection.model)
                    }}
                  />
                </div>
              </div>
            </section>

            <section className="single-session-toolbar-cluster single-session-toolbar-context">
              <span className="single-session-toolbar-label">Context</span>
              <div className="single-session-toolbar-inline single-session-toolbar-inline-context">
                <div className="single-session-path-shell" title={cwd || 'No project selected'}>
                  <span className="single-session-path-name">{projectFolderName}</span>
                  <button
                    type="button"
                    className="single-session-path-picker"
                    onClick={handlePickDir}
                    title={cwd || '选择项目文件夹'}
                    aria-label="重新选择项目文件夹"
                  >
                    <FolderOpen size={14} />
                  </button>
                </div>
                <div className="single-session-toolbar-meta">
                  {advancedSummaryChips.map((chip) => (
                    <span key={chip} className="single-session-toolbar-chip">{chip}</span>
                  ))}
                  {hasAdvancedControls ? (
                    <button
                      type="button"
                      className={`single-session-toolbar-advanced-toggle${showAdvanced ? ' active' : ''}`}
                      aria-expanded={showAdvanced}
                      onClick={() => setShowAdvanced((value) => !value)}
                    >
                      <Settings2 size={13} />
                      Advanced
                      <ChevronDown size={13} className="single-session-toolbar-advanced-icon" />
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {showInlineCodexOptions ? (
              <section className="single-session-inline-advanced-controls">
                <CodexOptions
                  model={model}
                  modelInfo={modelInfo}
                  reasoningEffort={codexReasoningEffort}
                  serviceTier={codexServiceTier}
                  onReasoningEffortChange={setCodexReasoningEffort}
                  onServiceTierChange={setCodexServiceTier}
                />
              </section>
            ) : null}
          </div>

          {showAdvanced && vendor === 'api' ? (
            <div className="single-session-advanced-panel">
              <div className="api-advanced-controls">
                <label className="field compact-field">
                  <span>Max steps</span>
                  <input type="number" min="1" max="50" value={apiMaxSteps} onChange={(e) => setApiMaxSteps(e.target.value)} />
                </label>
                <label className="field compact-field">
                  <span>Temperature</span>
                  <input type="number" min="0" max="2" step="0.1" value={apiTemperature} onChange={(e) => setApiTemperature(e.target.value)} placeholder="Default" />
                </label>
                <label className="field compact-field">
                  <span>Top P</span>
                  <input type="number" min="0" max="1" step="0.05" value={apiTopP} onChange={(e) => setApiTopP(e.target.value)} placeholder="Default" />
                </label>
              </div>
            </div>
          ) : null}
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
          onChange={(value) => {
            setMessage(value)
            setComposerError(null)
          }}
          onSend={handleSend}
          disabled={!cwd.trim() || (vendor === 'api' && !selectedProvider)}
          placeholder={
            selectedSession
              ? '继续当前逻辑会话...'
              : '发送第一条消息并创建会话...'
          }
          attachedFiles={attachedFiles}
          onPickFiles={handlePickFiles}
          onPasteImages={handlePasteImages}
          onRemoveFile={(f) => setAttachedFiles(prev => prev.filter(x => x !== f))}
          skills={skillState.skills}
          selectedSkills={selectedSkills}
          onAddSkill={(skill) => {
            setComposerError(null)
            setSelectedSkillIds((prev) => prev.includes(skill.id) ? prev : [...prev, skill.id])
          }}
          onRemoveSkill={(skillId) => setSelectedSkillIds((prev) => prev.filter((id) => id !== skillId))}
        />
        {composerError && <div className="workflow-input-error">{composerError}</div>}
      </main>

      {capture.pendingDraft && (
        <AgentCreateConfirmCard
          draft={capture.pendingDraft}
          modelCatalog={modelCatalog}
          clis={clis}
          saving={creatingAgent}
          onSave={handleCreateAgent}
          onDismiss={capture.dismiss}
        />
      )}

      {toastVisible && (
        <div className="agent-create-toast" role="status">
          <span className="agent-create-toast-text">创建成功，可以在 agents 列表查看</span>
          <button
            type="button"
            className="agent-create-toast-action"
            onClick={() => { setToastVisible(false); onModeAgents() }}
          >
            查看
          </button>
        </div>
      )}
    </>
  )
}

function routesEqual(a: SessionRoute, b: SessionRoute): boolean {
  return (
    a.vendor === b.vendor &&
    empty(a.model) === empty(b.model) &&
    empty(a.agentId) === empty(b.agentId) &&
    empty(a.apiProviderId) === empty(b.apiProviderId) &&
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

function parseOptionalPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseOptionalFloat(value: string): number | undefined {
  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function compactNumericLabel(value: number, unit: string): string {
  return `${value} ${unit}`
}

function inferAttachmentKind(path: string): RunAttachment['kind'] {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ? 'image' : 'file'
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function folderDisplayName(path: string): string {
  const clean = path.trim()
  if (!clean) return 'No project selected'
  const withoutTrailingSlash = clean.replace(/[\\/]+$/, '')
  return fileName(withoutTrailingSlash) || clean
}

function parseSkillCommand(
  rawText: string,
  skills: SkillSummary[],
  selectedSkillIds: string[]
): { text: string; skillIds: string[]; onlySelectedSkill: boolean } {
  const text = rawText.trim()
  const currentSkillIds = [...selectedSkillIds]
  if (!text.startsWith('/')) {
    return { text: rawText, skillIds: currentSkillIds, onlySelectedSkill: false }
  }

  const match = text.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/)
  if (!match) return { text: rawText, skillIds: currentSkillIds, onlySelectedSkill: false }

  const skill = findSkillBySlashToken(skills, match[1])
  if (!skill) return { text: rawText, skillIds: currentSkillIds, onlySelectedSkill: false }

  const skillIds = currentSkillIds.includes(skill.id) ? currentSkillIds : [...currentSkillIds, skill.id]
  const remainingText = match[2]?.trim() ?? ''
  return {
    text: remainingText,
    skillIds,
    onlySelectedSkill: remainingText === ''
  }
}

function findSkillBySlashToken(skills: SkillSummary[], token: string): SkillSummary | undefined {
  const normalized = token.trim().toLowerCase()
  return skills.find((skill) => (
    skill.id.toLowerCase() === normalized ||
    skill.name.trim().toLowerCase() === normalized
  ))
}
