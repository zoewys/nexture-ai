import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, KeyRound, Save, SlidersHorizontal, X } from 'lucide-react'
import type { Credential } from '@shared/types'
import type { CredentialSaveInput } from './useCredentials'

interface CredentialDrawerProps {
  credential: Credential | null
  credentials: Credential[]
  saving?: boolean
  title?: string
  onSave: (input: CredentialSaveInput) => Promise<Credential | void>
  onClose: () => void
}

interface CredentialPreset {
  name: string
  envKey: string
  kind: 'key' | 'param'
}

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/

const PRESETS: CredentialPreset[] = [
  { kind: 'key', name: 'Google SA', envKey: 'GOOGLE_SERVICE_ACCOUNT_JSON' },
  { kind: 'key', name: 'Semrush', envKey: 'SEMRUSH_API_KEY' },
  { kind: 'key', name: 'Mixpanel Secret', envKey: 'MIXPANEL_API_SECRET' },
  { kind: 'key', name: 'Bing Webmaster', envKey: 'MS_WEBMASTER_API_KEY' },
  { kind: 'param', name: 'GA Property', envKey: 'GA_PROPERTY_ID' },
  { kind: 'param', name: 'GSC Property', envKey: 'GSC_PROPERTY' },
  { kind: 'param', name: 'Semrush DB', envKey: 'SEMRUSH_DB' },
  { kind: 'param', name: 'Mixpanel ID', envKey: 'MIXPANEL_ID' },
  { kind: 'param', name: 'Project Domain', envKey: 'PROJECT_DOMAIN' }
]

export function CredentialDrawer({
  credential,
  credentials,
  saving = false,
  title,
  onSave,
  onClose
}: CredentialDrawerProps): JSX.Element {
  const [name, setName] = useState('')
  const [envKey, setEnvKey] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isEditing = Boolean(credential)
  const duplicateEnvKey = useMemo(
    () => credentials.some((item) => item.envKey === envKey.trim() && item.id !== credential?.id),
    [credential?.id, credentials, envKey]
  )

  useEffect(() => {
    setName(credential?.name ?? '')
    setEnvKey(credential?.envKey ?? '')
    setValue('')
    setShowValue(false)
    setError('')
  }, [credential])

  const applyPreset = (preset: CredentialPreset): void => {
    setEnvKey(preset.envKey)
    setName((current) => current || preset.name)
    setError('')
  }

  const submit = async (): Promise<void> => {
    const cleanName = name.trim()
    const cleanEnvKey = envKey.trim()
    if (!cleanName) {
      setError('请输入名称')
      return
    }
    if (!ENV_KEY_PATTERN.test(cleanEnvKey)) {
      setError('环境变量名只能包含大写字母、数字和下划线，且不能以数字开头')
      return
    }
    if (duplicateEnvKey) {
      setError(`环境变量名已存在：${cleanEnvKey}`)
      return
    }
    if (!isEditing && !value) {
      setError('请输入凭据值')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onSave({
        id: credential?.id,
        name: cleanName,
        envKey: cleanEnvKey,
        value
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const drawer = (
    <div className="credential-drawer-overlay" onMouseDown={onClose}>
      <aside
        className="credential-drawer workflow-new-run-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Credential Drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="workflow-new-run-header">
          <div>
            <strong>{title ?? (isEditing ? '编辑凭据' : '添加凭据')}</strong>
            <span>保存后可在 Workflow 模板里勾选注入</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="workflow-new-run-body credential-drawer-body">
          <label className="field">
            <span>名称</span>
            <input
              value={name}
              placeholder="Google SA (主账号)"
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
            />
          </label>

          <label className="field">
            <span>环境变量名</span>
            <input
              className={duplicateEnvKey ? 'credential-input-error' : ''}
              value={envKey}
              placeholder="GOOGLE_SERVICE_ACCOUNT_JSON"
              onChange={(event) => {
                setEnvKey(event.target.value.toUpperCase())
                setError('')
              }}
            />
          </label>

          <div className="credential-preset-box">
            <div className="credential-preset-title">
              <KeyRound size={13} />
              <span>密钥类</span>
            </div>
            <div className="credential-preset-grid">
              {PRESETS.filter((preset) => preset.kind === 'key').map((preset) => (
                <button key={preset.envKey} type="button" onClick={() => applyPreset(preset)}>
                  {preset.envKey}
                </button>
              ))}
            </div>
            <div className="credential-preset-title">
              <SlidersHorizontal size={13} />
              <span>参数类</span>
            </div>
            <div className="credential-preset-grid">
              {PRESETS.filter((preset) => preset.kind === 'param').map((preset) => (
                <button key={preset.envKey} type="button" onClick={() => applyPreset(preset)}>
                  {preset.envKey}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>值</span>
            <div className="credential-value-wrap">
              <textarea
                className={showValue ? '' : 'credential-value-secret'}
                rows={7}
                value={value}
                placeholder={isEditing ? '留空则保留已保存的值' : '粘贴 API Key、JSON 或项目参数'}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError('')
                }}
              />
              <button
                type="button"
                className="credential-value-toggle"
                title={showValue ? '隐藏值' : '显示值'}
                aria-label={showValue ? '隐藏值' : '显示值'}
                onClick={() => setShowValue((current) => !current)}
              >
                {showValue ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          {error ? <div className="credential-form-error">{error}</div> : null}
        </div>

        <div className="workflow-new-run-actions">
          <button type="button" onClick={onClose}>
            <X size={14} /> 取消
          </button>
          <button type="button" className="primary" disabled={saving || submitting} onClick={() => void submit()}>
            <Save size={14} />
            {saving || submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </aside>
    </div>
  )

  if (typeof document === 'undefined') return drawer
  return createPortal(drawer, document.body)
}
