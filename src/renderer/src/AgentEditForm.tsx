/**
 * AgentEditForm.tsx — 紧凑的 Agent 编辑表单
 *
 * 在两处复用：
 *  - AgentQuickCreateDrawer：画布左侧 "+" 按钮弹出的右侧抽屉（新建）
 *  - WorkflowCanvas 右侧 Inspector 的 agent-edit 模式（原地编辑）
 *
 * 表单保留完整的 draft 对象（包含 api/codex 等高级字段），因此原地编辑
 * 一个已存在的 agent 时，未在表单中展示的字段不会被丢弃。
 */

import { useEffect, useState } from 'react'
import type {
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  PermissionMode
} from '@shared/types'
import { ALL_VENDORS, PERMISSION_MODES } from '@shared/types'
import type { AgentDraft } from './useAgents'
import { ModelSelect } from './ModelSelect'
import { Select } from './Select'
import { useProviders } from './useProviders'

export interface AgentEditFormProps {
  initialDraft: AgentDraft
  modelCatalog: ModelCatalog | null
  clis: CliCheckResult | null
  submitLabel: string
  saving?: boolean
  /** When true, the bottom 取消/保存 action row is not rendered (parent renders header icons instead). */
  hideActions?: boolean
  /** Notifies parent of every draft change so a header Save icon can submit the latest draft. */
  onDraftChange?: (draft: AgentDraft) => void
  onSave: (draft: AgentDraft) => void
  onCancel?: () => void
}

export function AgentEditForm({
  initialDraft,
  modelCatalog,
  clis,
  submitLabel,
  saving = false,
  hideActions = false,
  onDraftChange,
  onSave,
  onCancel
}: AgentEditFormProps): JSX.Element {
  const [draft, setDraft] = useState<AgentDraft>(initialDraft)
  const providerState = useProviders()
  const selectedProvider =
    providerState.providers.find((p) => p.id === draft.apiProviderId) ??
    providerState.providers[0] ??
    null
  const apiModels = selectedProvider?.models ?? []

  useEffect(() => {
    onDraftChange?.(draft)
  }, [draft, onDraftChange])

  const cliAvailable = (v: AgentVendor) => (clis ? clis[v] : true)
  const modelInfo = modelCatalog?.[draft.vendor] ?? null

  const setVendor = (vendor: AgentVendor) => {
    setDraft((d) => ({
      ...d,
      vendor,
      model: '',
      apiProviderId: vendor === 'api' ? d.apiProviderId ?? providerState.providers[0]?.id : undefined
    }))
  }

  const canSubmit = draft.name.trim().length > 0 && !saving

  return (
    <>
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

      {draft.vendor === 'api' ? (
        <>
          <label className="field">
            <span>API 供应商</span>
            <Select
              value={selectedProvider?.id ?? ''}
              onChange={(apiProviderId) => {
                const provider = providerState.providers.find((item) => item.id === apiProviderId)
                setDraft((d) => ({
                  ...d,
                  apiProviderId,
                  model: provider?.defaultModel ?? provider?.models[0] ?? ''
                }))
              }}
              disabled={providerState.loading || providerState.providers.length === 0}
            >
              {providerState.providers.map((provider) => (
                <Select.Item key={provider.id} value={provider.id}>{provider.name}</Select.Item>
              ))}
            </Select>
          </label>

          <label className="field">
            <span>模型</span>
            <Select
              value={draft.model || selectedProvider?.defaultModel || apiModels[0] || ''}
              onChange={(model) =>
                setDraft((d) => ({ ...d, apiProviderId: selectedProvider?.id, model }))
              }
              disabled={apiModels.length === 0}
            >
              {apiModels.map((apiModel) => (
                <Select.Item key={apiModel} value={apiModel}>{apiModel}</Select.Item>
              ))}
            </Select>
          </label>
        </>
      ) : (
        <label className="field">
          <span>模型</span>
          <ModelSelect
            value={draft.model ?? ''}
            modelInfo={modelInfo}
            onChange={(model) => setDraft((d) => ({ ...d, model }))}
          />
        </label>
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
        <span>System Prompt</span>
        <textarea
          value={draft.systemPrompt}
          placeholder="You are a senior product manager. Your job is to..."
          onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
        />
      </label>

      {!hideActions && (
        <div className="agent-editor-actions detail-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onCancel && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>
              取消
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => canSubmit && onSave(draft)}
            disabled={!canSubmit}
          >
            {saving ? '保存中…' : submitLabel}
          </button>
        </div>
      )}
    </>
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
