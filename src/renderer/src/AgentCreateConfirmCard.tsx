/**
 * AgentCreateConfirmCard.tsx — 检测到新 agent 定义时从右侧滑出的确认抽屉
 *
 * 当助手输出 nexture_create_agent 标记 JSON 时，useAgentCreateCapture 解析出
 * agent 草稿，本组件从窗口右侧滑入。默认展示只读预览，点「编辑」在抽屉内原地
 * 展开输入字段（复用 AgentEditForm），不再弹出第二个窗口。
 *  - 创建：把（可能编辑过的）草稿写入 agent 列表
 *  - 继续调整：收起抽屉回到对话，用户提修改意见、助手重出更新版会自动再弹
 *  - 编辑：在抽屉内切换为表单编辑
 */
import { useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AgentDraftPayload } from '@shared/agentDefinitionParser'
import type { AgentDraft } from './useAgents'
import type { CliCheckResult, ModelCatalog } from '@shared/types'
import { AgentEditForm } from './AgentEditForm'
import { Check, Pencil, Wand2, X } from 'lucide-react'

export interface AgentCreateConfirmCardProps {
  draft: AgentDraftPayload
  modelCatalog: ModelCatalog | null
  clis: CliCheckResult | null
  saving?: boolean
  onSave: (draft: AgentDraftPayload) => void
  onDismiss: () => void
}

const colors = {
  bgPanel: 'var(--glass-bg)',
  border: 'var(--glass-border)',
  text: 'var(--neutral-text-primary)',
  textMuted: 'var(--neutral-text-secondary)',
  textDim: 'var(--neutral-text-muted)',
  accent: 'var(--accent-color, #6c8aff)'
}

export function AgentCreateConfirmCard({
  draft,
  modelCatalog,
  clis,
  saving = false,
  onSave,
  onDismiss
}: AgentCreateConfirmCardProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [formDraft, setFormDraft] = useState<AgentDraftPayload>(draft)

  // 用 useCallback 固定引用，避免 AgentEditForm 内部 useEffect 因回调变化反复触发。
  const handleDraftChange = useCallback((d: AgentDraft) => {
    setFormDraft((prev) => ({ ...prev, ...d }))
  }, [])

  const saveEdited = () => {
    if (!formDraft.name.trim() || saving) return
    onSave(formDraft)
  }

  return (
    <div className="agent-confirm-overlay" role="dialog" aria-label="确认新建 agent">
      <div className="agent-confirm-backdrop" onClick={onDismiss} />
      <aside
        className="agent-confirm-drawer"
        style={{
          background: colors.bgPanel,
          borderLeft: `1px solid ${colors.border}`,
          boxShadow: '-24px 0 64px rgba(0, 0, 0, 0.32)',
          backdropFilter: 'var(--glass-blur)'
        }}
      >
        <div className="agent-confirm-head">
          <Wand2 size={15} style={{ color: colors.accent, flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
            <span className="agent-confirm-head-title">
              {editing ? '编辑 agent 定义' : '检测到新 agent 定义'}
            </span>
            <span className="agent-confirm-head-sub">
              {editing ? '调整字段后创建到 agent 列表' : '确认后创建到 agent 列表，或继续调整'}
            </span>
          </div>
          <button
            type="button"
            className="agent-confirm-close"
            onClick={onDismiss}
            aria-label="收起"
            title="收起，回到对话继续提修改意见"
          >
            <X size={16} />
          </button>
        </div>

        <div className="agent-confirm-body">
          {editing ? (
            <div className="agent-confirm-edit">
              <AgentEditForm
                initialDraft={draft}
                modelCatalog={modelCatalog}
                clis={clis}
                submitLabel="创建"
                hideActions
                onDraftChange={handleDraftChange}
                onSave={(d) => onSave({ ...draft, ...d })}
              />
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: colors.text, fontWeight: 600 }}>
                {draft.name}
                <span style={{ color: colors.textDim, fontWeight: 400 }}> · {draft.role}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <Pill label="vendor" value={draft.vendor} />
                <Pill label="model" value={draft.model || '默认'} />
                <Pill label="permission" value={draft.permissionMode || '默认'} />
              </div>
              <div className="agent-confirm-prompt">
                <span className="agent-confirm-prompt-label">System Prompt</span>
                <pre className="agent-confirm-prompt-body">{draft.systemPrompt}</pre>
              </div>
            </>
          )}
        </div>

        <div className="agent-confirm-foot">
          {editing ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={saveEdited}
                disabled={saving || !formDraft.name.trim()}
              >
                <Check size={13} /> {saving ? '创建中…' : '创建'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onDismiss}
                title="收起，回到对话继续提修改意见"
              >
                <X size={13} /> 继续调整
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditing(true)}
                title="在抽屉内编辑字段"
              >
                <Pencil size={13} /> 编辑
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onSave(draft)}
                disabled={saving}
              >
                <Check size={13} /> {saving ? '创建中…' : '创建'}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function Pill({ label, value }: { label: string; value: string }): JSX.Element {
  const pillStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 6,
    background: 'var(--glass-border)',
    fontSize: 11
  }
  return (
    <span style={pillStyle}>
      <span style={{ color: colors.textDim }}>{label}</span>
      <span style={{ color: colors.text }}>{value}</span>
    </span>
  )
}
