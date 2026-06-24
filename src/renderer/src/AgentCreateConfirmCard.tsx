/**
 * AgentCreateConfirmCard.tsx — 对话流内的内联预览卡片
 *
 * 当使用助手输出 nexture_create_agent 标记 JSON 时，useAgentCreateCapture 解析出
 * agent 草稿，本卡片在 transcript 下方内联弹出。三个操作：
 *  - 创建：确认写入 agent 列表
 *  - 继续调整：收起卡片回到对话，用户提修改意见、助手重出更新版会自动再弹
 *  - 编辑：手动编辑字段后再保存（复用 AgentEditForm 覆盖层，由父组件承载）
 */
import type { CSSProperties } from 'react'
import type { AgentDraftPayload } from '@shared/agentDefinitionParser'
import { Check, Pencil, Wand2, X } from 'lucide-react'

export interface AgentCreateConfirmCardProps {
  draft: AgentDraftPayload
  saving?: boolean
  onSave: (draft: AgentDraftPayload) => void
  onEdit: (draft: AgentDraftPayload) => void
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
  saving = false,
  onSave,
  onEdit,
  onDismiss
}: AgentCreateConfirmCardProps): JSX.Element {
  return (
    <div
      className="agent-create-card"
      style={{
        margin: '8px 0',
        padding: 12,
        borderRadius: 10,
        background: colors.bgPanel,
        border: `1px solid ${colors.border}`,
        backdropFilter: 'var(--glass-blur)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wand2 size={15} style={{ color: colors.accent }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
            检测到新 agent 定义
          </span>
          <span style={{ fontSize: 11, color: colors.textDim }}>
            确认后创建到 agent 列表，或继续调整
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 13, color: colors.text, fontWeight: 600 }}>
          {draft.name}
          <span style={{ color: colors.textDim, fontWeight: 400 }}> · {draft.role}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Pill label="vendor" value={draft.vendor} />
          <Pill label="model" value={draft.model || '默认'} />
          <Pill label="permission" value={draft.permissionMode || '默认'} />
        </div>
        <details style={{ color: colors.textMuted, fontSize: 11, lineHeight: 1.5 }}>
          <summary style={{ cursor: 'pointer', color: colors.textDim }}>system prompt 预览</summary>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontFamily: 'inherit' }}>
            {draft.systemPrompt}
          </pre>
        </details>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
          onClick={() => onEdit(draft)}
          title="手动编辑字段后再保存"
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
      </div>
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
