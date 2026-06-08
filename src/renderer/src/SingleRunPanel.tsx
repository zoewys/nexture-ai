/**
 * SingleRunPanel.tsx — 单次 Agent 运行面板
 *
 * 对应 UI 中 "Single" 模式的整个工作区，包含：
 *  - 左侧配置栏：Agent 选择、CLI/Model 选择、项目路径、Prompt 输入、运行控制按钮
 *  - 右侧运行时区域：TranscriptViewer（实时输出流）+ 底部 Composer（插话/跟进输入框）
 *
 * 所有单次运行相关的局部状态（vendor、model、cwd、prompt、interjection 等）
 * 都封装在此组件内部，App.tsx 只传入全局依赖（agents 列表、CLI 状态、运行回调）。
 */

import { useMemo, useState } from 'react'
import type {
  AgentDefinition,
  AgentEvent,
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  RunConfig
} from '@shared/types'
import { ALL_VENDORS } from '@shared/types'
import type { RunState } from './useRun'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { TranscriptViewer } from './TranscriptViewer'
import { readLastProjectPath, rememberProjectPath } from './projectPathMemory'
import {
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal
} from './Icons'

interface SingleRunPanelProps {
  agents: AgentDefinition[]
  clis: CliCheckResult | null
  modelCatalog: ModelCatalog | null
  modelsLoading: boolean
  runState: RunState
  configOpen: boolean
  onConfigOpenChange: (open: boolean) => void
  onStart: (config: RunConfig) => Promise<void>
  onContinueSession: (config: RunConfig, displayText?: string) => Promise<void>
  onPush: (text: string) => Promise<void>
  onAbort: () => Promise<void>
  onReset: () => void
  onModeAgents: () => void
}

export function SingleRunPanel({
  agents,
  clis,
  modelCatalog,
  modelsLoading,
  runState: state,
  configOpen,
  onConfigOpenChange,
  onStart,
  onContinueSession,
  onPush,
  onAbort,
  onReset,
  onModeAgents
}: SingleRunPanelProps): JSX.Element {
  const [vendor, setVendor] = useState<AgentVendor>('claude')
  const [cwd, setCwd] = useState(readLastProjectPath)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<RunConfig['codexReasoningEffort']>()
  const [codexServiceTier, setCodexServiceTier] = useState<string | undefined>()
  const [interjection, setInterjection] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  )

  const modelInfo = modelCatalog?.[vendor] ?? null

  const canStart = !state.running && cwd.trim() !== '' && prompt.trim() !== ''
  const canFollowUp = !state.running && state.events.length > 0
  const canResume = canFollowUp && state.sessionId !== null
  const canInterject = state.running && vendor === 'claude'
  const composerEnabled = canFollowUp || canInterject
  const cliAvailable = clis ? clis[vendor] : true

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
    rememberProjectPath(cwd)
    await onStart(config)
  }

  const handlePickDir = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (dir) {
      setCwd(dir)
      rememberProjectPath(dir)
    }
  }

  const handleComposerSend = async (): Promise<void> => {
    const text = interjection.trim()
    if (!text || !composerEnabled) return
    if (canInterject) {
      setInterjection('')
      await onPush(text)
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
      await onContinueSession(config, text)
    }
  }

  return (
    <>
      <aside className={`panel panel-config ${configOpen ? '' : 'panel-config-collapsed'}`}>
        {configOpen ? (
          <>
            <div className="workspace-panel-header">
              <div className="panel-heading-line">
                <span className="section-title">Single Run</span>
                <button
                  type="button"
                  className="icon-only panel-collapse-button"
                  title="收起配置栏"
                  aria-label="收起配置栏"
                  onClick={() => onConfigOpenChange(false)}
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
                  <button onClick={onModeAgents} type="button">
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
                  {vendor} CLI not found. Auto-installing...
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
                  <button onClick={onAbort} type="button">
                    Stop
                  </button>
                )}
                {!state.running && state.events.length > 0 && (
                  <button onClick={onReset} type="button">
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
            onClick={() => onConfigOpenChange(true)}
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
              发送
            </button>
          </div>
        )}
      </main>
    </>
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
