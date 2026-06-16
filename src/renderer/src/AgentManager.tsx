/**
 * AgentManager.tsx — Agent 定义管理页
 *
 * 对应 "Agents" 模式，提供 Agent 定义的完整 CRUD 界面：
 *  - 左侧列表：所有已保存的 Agent（名称 + vendor 标签）
 *  - 右侧编辑表单：名称、角色、vendor、model、system prompt、permission mode
 *  - 支持新建、编辑、删除 Agent 定义
 *
 * Agent 定义被 workflow 模板的步骤引用，也可在 SingleRunPanel 中手动选择使用。
 */

import { useState } from 'react'
import type {
  AgentDefinition,
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  PermissionMode
} from '@shared/types'
import { ALL_VENDORS, PERMISSION_MODES } from '@shared/types'
import type { AgentDraft } from './useAgents'
import { AgentMemoryPanel } from './AgentMemoryPanel'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { ReflectionSettingsPanel } from './ReflectionSettingsPanel'
import { Select } from './Select'
import { useProviders } from './useProviders'
import { Plus, RotateCcw, Save, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react'

export interface AgentManagerProps {
  agents: AgentDefinition[]
  clis: CliCheckResult | null
  modelCatalog: ModelCatalog | null
  onSave: (draft: AgentDraft) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function emptyDraft(): AgentDraft {
  return { name: '', role: '', vendor: 'claude' as AgentVendor, model: '', systemPrompt: '', permissionMode: 'bypassPermissions' as PermissionMode }
}

const permissionIcons: Record<PermissionMode, typeof ShieldQuestion> = {
  default: ShieldQuestion,
  acceptEdits: ShieldCheck,
  bypassPermissions: ShieldAlert,
  plan: ShieldQuestion
}

export function AgentManager({ agents, clis, modelCatalog, onSave, onDelete, onClose }: AgentManagerProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft)
  const providerState = useProviders()

  const isNew = editingId === null
  const cliAvailable = (v: AgentVendor) => (clis ? clis[v] : true)
  const modelInfo = modelCatalog?.[draft.vendor] ?? null
  const selectedProvider = providerState.providers.find((provider) => provider.id === draft.apiProviderId) ?? providerState.providers[0] ?? null
  const apiModels = selectedProvider?.models ?? []

  const setVendor = (vendor: AgentVendor): void => {
    setDraft((d) => ({
      ...d,
      vendor,
      model: '',
      apiProviderId: vendor === 'api' ? d.apiProviderId || providerState.providers[0]?.id : undefined
    }))
  }

  const select = (agent: AgentDefinition) => {
    setEditingId(agent.id)
    setDraft({ ...agent })
  }

  const startNew = () => {
    setEditingId(null)
    setDraft(emptyDraft())
  }

  const handleSave = () => {
    if (!draft.name.trim()) return
    onSave(isNew ? draft : { ...draft, id: editingId! })
    setEditingId(null)
    setDraft(emptyDraft())
  }

  const handleDelete = () => {
    if (editingId) {
      onDelete(editingId)
      setEditingId(null)
      setDraft(emptyDraft())
    }
  }

  return (
    <div className="agent-manager-body">
      <aside className="agent-list">
        <div className="agent-list-header">
          <span>智能体</span>
          <button className="btn btn-primary btn-sm" onClick={startNew} type="button">
            <Plus size={14} /> 新建
          </button>
        </div>
        {agents.length === 0 && (
          <div className="transcript-empty">No agents defined yet.</div>
        )}
        {agents.map((a) => (
          <button
            key={a.id}
            className={`agent-item ${editingId === a.id ? 'agent-item-active' : ''}`}
            onClick={() => select(a)}
          type="button"
        >
            <div className="agent-item-title-row">
              <span className="agent-item-name">{a.name || 'Unnamed'}</span>
              <span className={a.permissionMode === 'bypassPermissions' ? 'tag-red' : 'tag-green'}>
                {a.permissionMode === 'bypassPermissions' ? '自动' : '询问'}
              </span>
            </div>
            <div className="agent-item-meta">
              {a.role} · {a.vendor}
              {a.model ? ` · ${a.model}` : ''}
            </div>
          </button>
        ))}
      </aside>

      <div className="agent-editor">
        {editingId === null && !isNew ? (
          <div className="transcript-empty">Select an agent or create one.</div>
        ) : (
          <>
            <div className="agent-editor-header">
              <div className="detail-title">{isNew ? '新建智能体' : '编辑智能体'}</div>
              <div className="agent-editor-actions detail-actions">
                {!isNew && (
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

            <div className="field-row">
              <label className="field field-grow">
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
                <label className="field field-grow">
                  <span>模型</span>
                  <ModelSelect
                    value={draft.model ?? ''}
                    modelInfo={modelInfo}
                    onChange={(model) => setDraft((d) => ({ ...d, model }))}
                  />
                </label>
              )}
            </div>

            {draft.vendor === 'api' && (
              <>
                <div className="field-row">
                  <label className="field field-grow">
                    <span>API 供应商</span>
                    <Select
                      value={selectedProvider?.id ?? ''}
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
                      placeholder="0.2"
                      onChange={(e) => setDraft((d) => ({ ...d, apiTemperature: parseOptionalFloat(e.target.value) }))}
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
                      placeholder="1"
                      onChange={(e) => setDraft((d) => ({ ...d, apiTopP: parseOptionalFloat(e.target.value) }))}
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

            <div className="field">
              <span>权限模式</span>
              <div className="permission-grid">
                {PERMISSION_MODES.map((mode) => {
                  const Icon = permissionIcons[mode]
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={`permission-card ${(draft.permissionMode ?? 'bypassPermissions') === mode ? 'active' : ''}`}
                      onClick={() => setDraft((d) => ({ ...d, permissionMode: mode }))}
                    >
                      <Icon size={16} />
                      <span className="permission-card-title">{permissionModeLabel(mode)}</span>
                      <span className="permission-card-desc">{permissionModeDescription(mode)}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="field field-grow">
              <span>System Prompt</span>
              <textarea
                value={draft.systemPrompt}
                placeholder="You are a senior product manager. Your job is to..."
                onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
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
          </>
        )}
      </div>
    </div>
  )
}

function parseOptionalFloat(value: string): number | undefined {
  const parsed = Number.parseFloat(value.trim())
  return Number.isFinite(parsed) ? parsed : undefined
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

function permissionModeDescription(mode: PermissionMode): string {
  switch (mode) {
    case 'default':
      return '按 CLI 默认策略请求确认'
    case 'acceptEdits':
      return '自动接受编辑，命令仍询问'
    case 'bypassPermissions':
      return '自动执行，适合受信任务'
    case 'plan':
      return '仅规划，不写入文件'
  }
}
