/**
 * AgentManager.tsx — Agent 定义管理页
 *
 * 对应 "Agents" 模式，提供 Agent 定义的完整 CRUD 界面：
 *  - 默认视图：卡片网格，展示所有已保存的 Agent（头像、名称、角色、模型、运行/记忆统计）
 *    支持搜索、按供应商筛选；末尾提供"新建 Agent"卡片
 *  - 编辑视图：点击卡片或"新建"后进入，提供名称、角色、vendor、model、system prompt、
 *    permission mode 等完整编辑表单
 *
 * Agent 定义被 workflow 模板的步骤引用，也可在 SingleRunPanel 中手动选择使用。
 */

import { useRef, useState } from 'react'
import type {
  AgentDefinition,
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  PermissionMode
} from '@shared/types'
import { ALL_VENDORS, PERMISSION_MODES } from '@shared/types'
import type { AgentDraft } from './useAgents'
import { useAgentMemoryMeta } from './useAgentMemoryMeta'
import { AgentMemoryPanel } from './AgentMemoryPanel'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { ReflectionSettingsPanel } from './ReflectionSettingsPanel'
import { Select } from './Select'
import { useProviders } from './useProviders'
import {
  ArrowLeft,
  Bot,
  Code2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Server,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react'

export interface AgentManagerProps {
  agents: AgentDefinition[]
  clis: CliCheckResult | null
  modelCatalog: ModelCatalog | null
  onSave: (draft: AgentDraft) => void
  onDelete: (id: string) => void
  onClose: () => void
}

type VendorFilter = 'all' | AgentVendor

const VENDOR_LABEL: Record<AgentVendor, string> = {
  claude: 'Claude',
  codex: 'Codex',
  api: 'API'
}

const VENDOR_FILTERS: Array<{ key: VendorFilter; label: string; dot: string }> = [
  { key: 'all', label: '全部', dot: 'var(--brand-primary)' },
  { key: 'claude', label: 'Claude', dot: '#cb774f' },
  { key: 'codex', label: 'Codex', dot: '#5b8ec9' },
  { key: 'api', label: 'API', dot: 'var(--brand-primary)' }
]

function emptyDraft(): AgentDraft {
  return { name: '', role: '', vendor: 'claude' as AgentVendor, model: '', systemPrompt: '', permissionMode: 'bypassPermissions' as PermissionMode }
}

function shortPermission(mode: PermissionMode | undefined): string {
  switch (mode) {
    case 'bypassPermissions':
      return 'bypass'
    case 'acceptEdits':
      return 'acceptEdits'
    case 'plan':
      return 'plan'
    default:
      return 'default'
  }
}

function permissionModeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'default':
      return 'Default'
    case 'acceptEdits':
      return 'Accept Edits'
    case 'bypassPermissions':
      return 'Bypass Permissions'
    case 'plan':
      return 'Plan Mode'
  }
}

function parseOptionalFloat(value: string): number | undefined {
  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function resolveApiProviderId(
  id: string | undefined,
  providers: Array<{ id: string }>
): string | undefined {
  return providers.find((provider) => provider.id === id)?.id ?? providers[0]?.id
}

export function AgentManager({ agents, clis, modelCatalog, onSave, onDelete, onClose }: AgentManagerProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft)
  const [editorOpen, setEditorOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>('all')
  const promptFileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const providerState = useProviders()

  const importPromptFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setDraft((d) => ({ ...d, systemPrompt: text }))
    }
    reader.readAsText(file)
  }

  const importAgentPrompt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setEditingId(null)
      setDraft({ ...emptyDraft(), systemPrompt: text })
      setEditorOpen(true)
    }
    reader.readAsText(file)
  }

  const isNew = editingId === null
  const cliAvailable = (v: AgentVendor) => (clis ? clis[v] : true)
  const modelInfo = modelCatalog?.[draft.vendor] ?? null
  const selectedProvider = providerState.providers.find((provider) => provider.id === draft.apiProviderId) ?? providerState.providers[0] ?? null
  const effectiveApiProviderId = selectedProvider?.id
  const apiModels = selectedProvider?.models ?? []

  const setVendor = (vendor: AgentVendor): void => {
    setDraft((d) => ({
      ...d,
      vendor,
      model: '',
      apiProviderId: vendor === 'api' ? resolveApiProviderId(d.apiProviderId, providerState.providers) : undefined
    }))
  }

  const select = (agent: AgentDefinition) => {
    setEditingId(agent.id)
    setDraft({ ...agent })
    setEditorOpen(true)
  }

  const startNew = () => {
    setEditingId(null)
    setDraft(emptyDraft())
    setEditorOpen(true)
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setEditingId(null)
    setDraft(emptyDraft())
  }

  const handleSave = () => {
    if (!draft.name.trim()) return
    const nextDraft: AgentDraft = draft.vendor === 'api'
      ? { ...draft, apiProviderId: effectiveApiProviderId }
      : { ...draft, apiProviderId: undefined }
    onSave(isNew ? nextDraft : { ...nextDraft, id: editingId! })
    setEditorOpen(false)
    setEditingId(null)
    setDraft(emptyDraft())
  }

  const handleDelete = () => {
    if (editingId) {
      onDelete(editingId)
      setEditorOpen(false)
      setEditingId(null)
      setDraft(emptyDraft())
    }
  }

  const filteredAgents = agents.filter((a) => {
    const matchesVendor = vendorFilter === 'all' || a.vendor === vendorFilter
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q)
    return matchesVendor && matchesQuery
  })

  if (editorOpen) {
    return (
      <div className="agent-manager-body">
        <div className="agent-editor agent-editor-full">
          <div className="agent-editor-header">
            <div className="detail-title detail-title-with-back">
              <button type="button" className="agent-back-btn" onClick={closeEditor} title="返回列表" aria-label="返回列表">
                <ArrowLeft size={16} />
              </button>
              {isNew ? '新建智能体' : '编辑智能体'}
            </div>
            <div className="agent-editor-actions detail-actions">
              {!isNew && !agents.find((a) => a.id === editingId)?.builtin && (
                <button onClick={handleDelete} type="button" className="btn btn-danger btn-sm">
                  <Trash2 size={14} /> 删除
                </button>
              )}
              <button
                onClick={() => {
                  const current = agents.find((a) => a.id === editingId)
                  setDraft(isNew || !current ? emptyDraft() : { ...current })
                }}
                type="button"
                className="btn btn-secondary btn-sm"
              >
                <RotateCcw size={14} /> 重置
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!draft.name.trim()} type="button">
                <Save size={14} /> {isNew ? '创建' : '保存'}
              </button>
            </div>
          </div>

          <label className="field">
            <span>名称</span>
            <input
              value={draft.name}
              placeholder='e.g. "Senior Product Manager"'
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>角色</span>
            <input
              value={draft.role}
              placeholder='e.g. "product", "dev", "test"'
              onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>供应商</span>
            <div className="vendor-tabs">
              {ALL_VENDORS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`vendor-tab${draft.vendor === v ? ' active' : ''}`}
                  onClick={() => setVendor(v)}
                >
                  {v === 'claude' ? 'Claude CLI' : v === 'codex' ? 'Codex CLI' : 'API'}
                  {!cliAvailable(v) ? ' (not installed)' : ''}
                </button>
              ))}
            </div>
          </label>

          {draft.vendor !== 'api' && (
            <label className="field">
              <span>模型</span>
              <ModelSelect
                value={draft.model ?? ''}
                modelInfo={modelInfo}
                onChange={(model) => setDraft((d) => ({ ...d, model }))}
              />
            </label>
          )}

          {draft.vendor === 'api' && (
            <>
              <div className="field-row">
                <label className="field field-grow">
                  <span>API 供应商</span>
                  <Select
                    value={effectiveApiProviderId ?? ''}
                    onChange={(apiProviderId) => {
                      const provider = providerState.providers.find((item) => item.id === apiProviderId)
                      setDraft((d) => ({ ...d, apiProviderId, model: provider?.defaultModel ?? provider?.models[0] ?? '' }))
                    }}
                    disabled={providerState.loading || providerState.providers.length === 0}
                  >
                    {providerState.providers.map((provider) => (
                      <Select.Item key={provider.id} value={provider.id}>{provider.name}</Select.Item>
                    ))}
                  </Select>
                </label>
                <label className="field field-grow">
                  <span>Model</span>
                  <Select
                    value={draft.model || selectedProvider?.defaultModel || apiModels[0] || ''}
                    onChange={(model) => setDraft((d) => ({ ...d, model }))}
                    disabled={apiModels.length === 0}
                  >
                    {apiModels.map((apiModel) => (
                      <Select.Item key={apiModel} value={apiModel}>{apiModel}</Select.Item>
                    ))}
                  </Select>
                </label>
              </div>
              <div className="field-row">
                <label className="field field-grow">
                  <span>Temperature</span>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={draft.apiTemperature ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, apiTemperature: parseOptionalFloat(e.target.value) }))}
                    placeholder="Default"
                  />
                </label>
                <label className="field field-grow">
                  <span>Top P</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={draft.apiTopP ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, apiTopP: parseOptionalFloat(e.target.value) }))}
                    placeholder="Default"
                  />
                </label>
              </div>
            </>
          )}

          {draft.vendor === 'codex' && (
            <CodexOptions
              model={draft.model ?? ''}
              modelInfo={modelInfo}
              reasoningEffort={draft.codexReasoningEffort}
              serviceTier={draft.codexServiceTier}
              onReasoningEffortChange={(codexReasoningEffort) =>
                setDraft((d) => ({ ...d, codexReasoningEffort }))
              }
              onServiceTierChange={(codexServiceTier) =>
                setDraft((d) => ({ ...d, codexServiceTier }))
              }
            />
          )}

          <label className="field">
            <span>权限模式</span>
            <Select
              value={draft.permissionMode ?? 'bypassPermissions'}
              onChange={(mode) => setDraft((d) => ({ ...d, permissionMode: mode as PermissionMode }))}
            >
              {PERMISSION_MODES.map((mode) => (
                <Select.Item key={mode} value={mode}>{permissionModeLabel(mode)}</Select.Item>
              ))}
            </Select>
          </label>

          <label className="field field-grow">
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>System Prompt</span>
              <button
                type="button"
                className="agent-prompt-import-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => promptFileRef.current?.click()}
                title="从 .md 文件导入到 System Prompt"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--neutral-text-secondary)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--neutral-border)',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                <Upload size={12} />
                导入 .md
              </button>
            </span>
            <textarea
              value={draft.systemPrompt}
              placeholder="You are a senior product manager. Your job is to..."
              onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
            />
            <input
              ref={promptFileRef}
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={importPromptFile}
              style={{ display: 'none' }}
            />
          </label>

          <ReflectionSettingsPanel modelCatalog={modelCatalog} />

          <div className="agent-memory-card">
            <div>
              <div className="form-label">记忆与反思</div>
              <p>查看该智能体积累的项目经验，或调整自动反思配置。</p>
            </div>
          </div>
          <AgentMemoryPanel agentId={editingId} />
        </div>
      </div>
    )
  }

  return (
    <div className="agent-manager-body agent-grid-view">
      {/* 页面头部 */}
      <div className="agent-page-header">
        <div className="agent-page-head-text">
          <h2 className="agent-page-title">Agents</h2>
          <p className="agent-page-subtitle">管理你的 AI Agent，配置角色、模型和系统提示词</p>
        </div>
        <div className="agent-page-actions">
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => importRef.current?.click()}>
            <Upload size={14} /> 导入
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={startNew}>
            <Plus size={14} /> 新建 Agent
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={importAgentPrompt}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* 工具栏 */}
      <div className="agent-toolbar">
        <div className="agent-search-box">
          <Search size={14} className="agent-search-icon" aria-hidden="true" />
          <input
            type="text"
            placeholder="搜索 Agent 名称或角色..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="agent-filter-group">
          {VENDOR_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`agent-filter-chip${vendorFilter === f.key ? ' active' : ''}`}
              onClick={() => setVendorFilter(f.key)}
            >
              <span className="agent-filter-dot" style={{ background: f.dot }} />
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 卡片网格 */}
      <div className="agent-cards-grid">
        {agents.length > 0 && filteredAgents.length === 0 && (
          <div className="transcript-empty agent-grid-empty">没有匹配的 Agent。</div>
        )}
        {filteredAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onOpen={() => select(agent)}
            onDelete={() => onDelete(agent.id)}
          />
        ))}

        {/* 新建 Agent */}
        <button type="button" className="agent-card agent-card-new" onClick={startNew}>
          <div className="agent-card-new-icon">
            <Plus size={20} />
          </div>
          <div className="agent-card-new-title">新建 Agent</div>
          <div className="agent-card-new-desc">配置一个新的 AI Agent</div>
        </button>
      </div>
    </div>
  )
}

interface AgentCardProps {
  agent: AgentDefinition
  onOpen: () => void
  onDelete: () => void
}

function AgentCard({ agent, onOpen, onDelete }: AgentCardProps): JSX.Element {
  const { meta } = useAgentMemoryMeta(agent.id)

  const VendorIcon = agent.builtin
    ? Sparkles
    : agent.vendor === 'codex' ? Code2 : agent.vendor === 'api' ? Server : Bot
  const modelValue = agent.model || '—'

  return (
    <div
      className={`agent-card agent-card-${agent.vendor}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="agent-card-body">
        <div className="agent-card-top">
          <div className={`agent-avatar agent-avatar-${agent.builtin ? 'builtin' : agent.vendor}`}>
            <VendorIcon size={20} />
          </div>
          <div className="agent-card-title-wrap">
            <div className="agent-card-name">{agent.name || 'Unnamed'}</div>
            <div className="agent-card-subtitle">
              <span>{agent.role || '—'}</span>
              <span className="agent-subtitle-sep" />
              <span>{VENDOR_LABEL[agent.vendor]}</span>
              <span className="agent-subtitle-sep" />
              <span>{shortPermission(agent.permissionMode)}</span>
            </div>
          </div>
        </div>

        {agent.systemPrompt ? (
          <p className="agent-card-prompt">{agent.systemPrompt}</p>
        ) : (
          <p className="agent-card-prompt agent-card-prompt-empty">未配置系统提示词</p>
        )}

        <div className="agent-card-models">
          <span className="agent-model-pill">
            <span className="agent-model-key">model</span>
            <span className="agent-model-val">{modelValue}</span>
          </span>
          {agent.vendor === 'codex' && agent.codexReasoningEffort && (
            <span className="agent-model-pill">
              <span className="agent-model-key">effort</span>
              <span className="agent-model-val">{agent.codexReasoningEffort}</span>
            </span>
          )}
          {agent.vendor === 'api' && agent.apiTemperature !== undefined && (
            <span className="agent-model-pill">
              <span className="agent-model-key">temp</span>
              <span className="agent-model-val">{agent.apiTemperature}</span>
            </span>
          )}
        </div>
      </div>

      <div className="agent-card-footer">
        <div className="agent-card-stats">
          <span className="agent-card-stat">
            <span className="agent-card-stat-num">{meta?.totalRuns ?? 0}</span> 次运行
          </span>
          <span className="agent-card-stat">
            <span className="agent-card-stat-num">{meta?.totalMemories ?? 0}</span> 条记忆
          </span>
        </div>
        {!agent.builtin && (
          <button
            type="button"
            className="agent-card-delete"
            title="删除"
            aria-label="删除"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
