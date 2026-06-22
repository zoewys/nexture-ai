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
import { AgentMemoryPanel } from './AgentMemoryPanel'
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'
import { ReflectionSettingsPanel } from './ReflectionSettingsPanel'
import { Select } from './Select'
import { useProviders } from './useProviders'
import { Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react'

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

export function AgentManager({ agents, clis, modelCatalog, onSave, onDelete, onClose }: AgentManagerProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft)
  const promptFileRef = useRef<HTMLInputElement>(null)
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
                System Prompt
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
          </>
        )}
      </div>
    </div>
  )
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
