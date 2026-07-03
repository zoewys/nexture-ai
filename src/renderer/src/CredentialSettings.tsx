import { useState } from 'react'
import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { Credential } from '@shared/types'
import { CredentialDrawer } from './CredentialDrawer'
import type { CredentialSaveInput } from './useCredentials'

interface CredentialSettingsProps {
  credentials: Credential[]
  loading: boolean
  save: (input: CredentialSaveInput) => Promise<Credential>
  remove: (id: string) => Promise<void>
  reload: () => Promise<void>
}

export function CredentialSettings({
  credentials,
  loading,
  save,
  remove,
  reload
}: CredentialSettingsProps): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Credential | null>(null)
  const [message, setMessage] = useState('')

  const openNew = (): void => {
    setEditing(null)
    setMessage('')
    setDrawerOpen(true)
  }

  const openEdit = (credential: Credential): void => {
    setEditing(credential)
    setMessage('')
    setDrawerOpen(true)
  }

  const handleDelete = async (credential: Credential): Promise<void> => {
    if (!window.confirm(`删除凭据「${credential.name}」？`)) return
    setMessage('')
    try {
      await remove(credential.id)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="credential-settings">
      <div className="credential-settings-toolbar">
        <button type="button" className="btn" onClick={() => void reload()} disabled={loading}>
          <RefreshCw size={14} /> 刷新
        </button>
        <button type="button" className="btn primary" onClick={openNew}>
          <Plus size={14} /> 添加凭据
        </button>
      </div>

      {message ? <div className="credential-message">{message}</div> : null}

      {loading ? (
        <div className="credential-empty">加载中...</div>
      ) : credentials.length === 0 ? (
        <div className="credential-empty">
          <KeyRound size={20} />
          <span>暂无凭据</span>
          <button type="button" className="btn primary" onClick={openNew}>
            <Plus size={14} /> 添加第一个凭据
          </button>
        </div>
      ) : (
        <div className="credential-list">
          {credentials.map((credential) => (
            <div key={credential.id} className="credential-row">
              <div className="credential-row-main">
                <code>{credential.envKey}</code>
                <strong>{credential.name}</strong>
                <span>{formatCreatedAt(credential.createdAt)}</span>
              </div>
              <div className="credential-row-actions">
                <button type="button" title="编辑凭据" aria-label="编辑凭据" onClick={() => openEdit(credential)}>
                  <Pencil size={14} />
                </button>
                <button type="button" title="删除凭据" aria-label="删除凭据" onClick={() => void handleDelete(credential)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {drawerOpen && (
        <CredentialDrawer
          credential={editing}
          credentials={credentials}
          onSave={save}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}

function formatCreatedAt(value: number): string {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}
