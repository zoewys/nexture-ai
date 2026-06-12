import { Bot, FlaskConical, Pencil, Plus, Save, Server, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ApiProviderConfig, ApiProviderFormat } from '@shared/types'
import { Select } from './Select'

interface ProviderSettingsProps {
  providers: ApiProviderConfig[]
  loading: boolean
  save: (input: Omit<ApiProviderConfig, 'id'> & { id?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<{ ok: boolean; message: string }>
  reload: () => Promise<void>
}

interface ProviderDraft {
  name: string
  format: ApiProviderFormat
  apiKey: string
  baseUrl: string
  modelsText: string
  defaultModel: string
}

const EMPTY_DRAFT: ProviderDraft = {
  name: '',
  format: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  modelsText: '',
  defaultModel: ''
}

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: 'deepseek-chat, deepseek-reasoner' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: 'moonshot-v1-8k, moonshot-v1-32k' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: 'deepseek-ai/DeepSeek-V3' }
]

export function ProviderSettings({ providers, loading, save, remove, testConnection }: ProviderSettingsProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)
  const [testMessage, setTestMessage] = useState('')

  const editingProvider = useMemo(
    () => providers.find((provider) => provider.id === editingId) ?? null,
    [editingId, providers]
  )

  const openNew = (): void => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setTestMessage('')
    setFormOpen(true)
  }

  const openEdit = (provider: ApiProviderConfig): void => {
    setEditingId(provider.id)
    setDraft({
      name: provider.name,
      format: provider.format,
      apiKey: '',
      baseUrl: provider.baseUrl ?? '',
      modelsText: provider.models.join(', '),
      defaultModel: provider.defaultModel ?? provider.models[0] ?? ''
    })
    setTestMessage('')
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setTestMessage('')
    setFormOpen(false)
  }

  const submit = async (): Promise<void> => {
    const models = parseModels(draft.modelsText)
    if (!draft.name.trim() || models.length === 0) return
    await save({
      id: editingId ?? undefined,
      name: draft.name.trim(),
      format: draft.format,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl.trim() || undefined,
      models,
      defaultModel: draft.defaultModel.trim() || models[0]
    })
    closeForm()
  }

  const testCurrent = async (): Promise<void> => {
    if (!editingId) {
      setTestMessage('请先保存供应商后再测试连接')
      return
    }
    const result = await testConnection(editingId)
    setTestMessage(result.message)
  }

  return (
    <div className="provider-grid">
      {loading && <div className="transcript-empty">Loading providers...</div>}
      {providers.map((provider) => (
        <div key={provider.id} className="provider-card">
          <div className={`provider-card-icon ${providerIconClass(provider)}`}>
            {provider.format === 'anthropic' ? <Bot size={16} /> : <Server size={16} />}
          </div>
          <div className="provider-card-body">
            <div className="provider-card-name">{provider.name}</div>
            <div className="provider-card-meta">
              <span className="key-badge">{maskKey(provider.apiKey)}</span>
              {provider.baseUrl ? <span>{provider.baseUrl}</span> : null}
            </div>
            <div>
              {provider.models.map((model) => (
                <span key={model} className="model-tag">{model}</span>
              ))}
            </div>
          </div>
          <div className="provider-card-actions">
            <button type="button" title="编辑供应商" aria-label="编辑供应商" onClick={() => openEdit(provider)}>
              <Pencil size={14} />
            </button>
            <button type="button" title="删除供应商" aria-label="删除供应商" onClick={() => void remove(provider.id)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}

      {!formOpen && (
        <button type="button" className="add-provider-btn" onClick={openNew}>
          <Plus size={14} /> 添加供应商
        </button>
      )}

      {formOpen && (
        <div className="provider-form">
          <div className="pf-title">{editingProvider ? '编辑供应商' : '添加新供应商'}</div>
          <div className="pf-row">
            <label className="pf-field">
              <span className="pf-label">格式</span>
              <Select value={draft.format} onChange={(format) => setDraft((d) => ({ ...d, format: format as ApiProviderFormat }))}>
                <Select.Item value="openai-compatible">OpenAI 兼容</Select.Item>
                <Select.Item value="anthropic">Anthropic</Select.Item>
              </Select>
            </label>
            <label className="pf-field">
              <span className="pf-label">名称</span>
              <input className="pf-input" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
          </div>

          <label className="pf-field">
            <span className="pf-label">API Key</span>
            <input
              className="pf-input"
              type="password"
              value={draft.apiKey}
              placeholder={editingProvider ? '留空则沿用已保存的 Key' : 'sk-...'}
              onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
            />
          </label>

          <label className="pf-field">
            <span className="pf-label">Base URL</span>
            <input className="pf-input" value={draft.baseUrl} onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))} />
            <div className="preset-row">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="preset-chip"
                  onClick={() => setDraft((d) => ({
                    ...d,
                    format: 'openai-compatible',
                    name: d.name || preset.name,
                    baseUrl: preset.baseUrl,
                    modelsText: d.modelsText || preset.models,
                    defaultModel: d.defaultModel || preset.models.split(',')[0].trim()
                  }))}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </label>

          <label className="pf-field">
            <span className="pf-label">模型列表</span>
            <input className="pf-input" value={draft.modelsText} onChange={(e) => setDraft((d) => ({ ...d, modelsText: e.target.value }))} />
            <span className="pf-hint">逗号分隔；默认模型为空时使用第一个模型。</span>
          </label>

          <label className="pf-field">
            <span className="pf-label">默认模型</span>
            <input className="pf-input" value={draft.defaultModel} onChange={(e) => setDraft((d) => ({ ...d, defaultModel: e.target.value }))} />
          </label>

          {testMessage ? <div className="pf-hint">{testMessage}</div> : null}

          <div className="pf-actions">
            <button type="button" className="pf-btn success" onClick={() => void testCurrent()}>
              <FlaskConical size={13} /> 测试连接
            </button>
            <button type="button" className="pf-btn" onClick={closeForm}>
              <X size={13} /> 取消
            </button>
            <button type="button" className="pf-btn primary" onClick={() => void submit()}>
              <Save size={13} /> 保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function parseModels(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function maskKey(value: string): string {
  if (!value) return '未保存'
  return `••••${value.slice(-4)}`
}

function providerIconClass(provider: ApiProviderConfig): string {
  const value = `${provider.name} ${provider.baseUrl ?? ''}`.toLowerCase()
  if (value.includes('deepseek')) return 'icon-deepseek'
  if (value.includes('moonshot') || value.includes('kimi')) return 'icon-kimi'
  if (provider.format === 'anthropic') return 'icon-anthropic'
  if (provider.format === 'openai-compatible') return 'icon-openai'
  return 'icon-custom'
}
