/**
 * AgentQuickCreateDrawer.tsx — 画布内快速新建 Agent 的右侧抽屉
 *
 * 由 WorkflowCanvas 左侧 agent 列表头部的 "+" 按钮触发，从右侧滑入。
 * 在抽屉内完成名称/角色/供应商/模型/权限/System Prompt 后保存即生成新 agent，
 * 新 agent 会立刻出现在画布左侧的 agent 列表中可被拖入画布。
 */

import { useEffect, useRef, useState } from 'react'
import type {
  AgentDefinition,
  AgentVendor,
  CliCheckResult,
  ModelCatalog,
  PermissionMode
} from '@shared/types'
import type { AgentDraft } from './useAgents'
import { AgentEditForm } from './AgentEditForm'
import { Check, X } from 'lucide-react'

export interface AgentQuickCreateDrawerProps {
  modelCatalog: ModelCatalog | null
  clis: CliCheckResult | null
  onSave: (draft: AgentDraft) => Promise<AgentDefinition | null>
  onClose: () => void
}

function emptyDraft(): AgentDraft {
  return {
    name: '',
    role: '',
    vendor: 'claude' as AgentVendor,
    model: '',
    systemPrompt: '',
    permissionMode: 'bypassPermissions' as PermissionMode
  }
}

const colors = {
  bgPanel: 'var(--glass-bg)',
  border: 'var(--glass-border)',
  text: 'var(--neutral-text-primary)',
  textMuted: 'var(--neutral-text-secondary)',
  textDim: 'var(--neutral-text-muted)'
}

export function AgentQuickCreateDrawer({
  modelCatalog,
  clis,
  onSave,
  onClose
}: AgentQuickCreateDrawerProps): JSX.Element {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftRef = useRef<AgentDraft>(emptyDraft())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = async (draft: AgentDraft) => {
    setSaving(true)
    setError(null)
    try {
      const saved = await onSave(draft)
      if (saved) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleHeaderSave = () => {
    const draft = draftRef.current
    if (!draft.name.trim() || saving) return
    void handleSave(draft)
  }

  return (
    <div className="agent-quick-create-overlay" role="dialog" aria-label="Quick create agent">
      <div className="agent-quick-create-backdrop" onClick={onClose} />
      <aside
        className="agent-quick-create-drawer"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(440px, calc(100vw - 40px))',
          zIndex: 50,
          background: colors.bgPanel,
          borderLeft: `1px solid ${colors.border}`,
          boxShadow: '-24px 0 64px rgba(0, 0, 0, 0.32)',
          display: 'flex',
          flexDirection: 'column',
          backdropFilter: 'var(--glass-blur)'
        }}
      >
        <div
          className="agent-quick-create-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: `1px solid ${colors.border}`,
            minHeight: 44
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>新建智能体</span>
            <span style={{ fontSize: 10, color: colors.textDim }}>保存后可拖入画布使用</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              onClick={handleHeaderSave}
              disabled={saving}
              aria-label="保存"
              title="保存"
              style={{
                width: 28,
                height: 28,
                minHeight: 28,
                padding: 0,
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                color: saving ? colors.textDim : colors.text,
                cursor: saving ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: saving ? 0.5 : 1
              }}
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="取消"
              title="取消"
              style={{
                width: 28,
                height: 28,
                minHeight: 28,
                padding: 0,
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                color: colors.textMuted,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className="agent-quick-create-body"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          <AgentEditForm
            initialDraft={emptyDraft()}
            modelCatalog={modelCatalog}
            clis={clis}
            submitLabel="创建"
            saving={saving}
            hideActions
            onDraftChange={(draft) => {
              draftRef.current = draft
            }}
            onSave={handleSave}
            onCancel={onClose}
          />

          {error && (
            <div style={{ fontSize: 11, color: '#e5786e', lineHeight: 1.4 }}>{error}</div>
          )}
        </div>
      </aside>
    </div>
  )
}
