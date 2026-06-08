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
import { CodexOptions } from './CodexOptions'
import { ModelSelect } from './ModelSelect'

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

  const isNew = editingId === null
  const cliAvailable = (v: AgentVendor) => (clis ? clis[v] : true)
  const modelInfo = modelCatalog?.[draft.vendor] ?? null

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
          <span>Agents</span>
          <button className="primary" onClick={startNew} type="button">
            New
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
            <div className="agent-item-name">{a.name || 'Unnamed'}</div>
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
            <label className="field">
              <span>Name</span>
              <input
                value={draft.name}
                placeholder='e.g. "Senior Product Manager"'
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Role</span>
              <input
                value={draft.role}
                placeholder='e.g. "product", "dev", "test"'
                onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
              />
            </label>

            <div className="field-row">
              <label className="field field-grow">
                <span>CLI</span>
                <select
                  value={draft.vendor}
                  onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value as AgentVendor }))}
                >
                  {ALL_VENDORS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                      {!cliAvailable(v) ? ' (not installed)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field-grow">
                <span>Model</span>
                <ModelSelect
                  value={draft.model ?? ''}
                  modelInfo={modelInfo}
                  onChange={(model) => setDraft((d) => ({ ...d, model }))}
                />
              </label>
            </div>

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
              <span>Permission Mode</span>
              <select
                value={draft.permissionMode ?? 'bypassPermissions'}
                onChange={(e) => setDraft((d) => ({ ...d, permissionMode: e.target.value as PermissionMode }))}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>{permissionModeLabel(m)}</option>
                ))}
              </select>
            </label>

            <label className="field field-grow">
              <span>System Prompt</span>
              <textarea
                value={draft.systemPrompt}
                placeholder="You are a senior product manager. Your job is to..."
                onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              />
            </label>

            <div className="actions">
              <button className="primary" onClick={handleSave} disabled={!draft.name.trim()} type="button">
                {isNew ? 'Create' : 'Save'}
              </button>
              {!isNew && (
                <button onClick={handleDelete} type="button" className="danger">
                  Delete
                </button>
              )}
            </div>
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
