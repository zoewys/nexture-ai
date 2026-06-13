import { ArrowDown, ArrowUp, Bot, Download, Eye, EyeOff, FlaskConical, Pencil, Plus, Save, Server, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ApiProviderConfig, ApiProviderFormat } from '@shared/types'
import { Select } from './Select'

interface ProviderSettingsProps {
  providers: ApiProviderConfig[]
  loading: boolean
  save: (input: Omit<ApiProviderConfig, 'id'> & { id?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<{ ok: boolean; message: string }>
  fetchModels: (provider: ApiProviderConfig, providerId?: string) => Promise<{ models: string[]; error?: string }>
  getDecrypted: (id: string) => Promise<ApiProviderConfig>
  reload: () => Promise<void>
}

interface ProviderDraft {
  name: string
  format: ApiProviderFormat
  apiKey: string
  baseUrl: string
  models: string[]
  defaultModel: string
}

const EMPTY_DRAFT: ProviderDraft = {
  name: '',
  format: 'openai-compatible',
  apiKey: '',
  baseUrl: '',
  models: [],
  defaultModel: ''
}

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
  { name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'] },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'TeleAI/TeleChat2'] }
]

export function ProviderSettings({ providers, loading, save, remove, testConnection, fetchModels, getDecrypted }: ProviderSettingsProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT)
  const [testMessage, setTestMessage] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])

  const suggestedModels = useMemo(
    () => [...new Set([...PRESETS.flatMap((p) => p.models), ...fetchedModels])],
    [fetchedModels]
  )

  const editingProvider = useMemo(
    () => providers.find((provider) => provider.id === editingId) ?? null,
    [editingId, providers]
  )

  const openNew = (): void => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setTestMessage('')
    setShowKey(false)
    setFetchedModels([])
    setFormOpen(true)
  }

  const openEdit = async (provider: ApiProviderConfig): Promise<void> => {
    setEditingId(provider.id)
    // Fetch the decrypted key so the user can see it (masked by default).
    let decryptedKey = ''
    try { decryptedKey = (await getDecrypted(provider.id)).apiKey } catch { /* keep empty */ }
    setDraft({
      name: provider.name,
      format: provider.format,
      apiKey: decryptedKey,
      baseUrl: provider.baseUrl ?? '',
      models: [...provider.models],
      defaultModel: provider.defaultModel ?? provider.models[0] ?? ''
    })
    setTestMessage('')
    setShowKey(false)
    setFetchedModels([])
    setFormOpen(true)
  }

  const closeForm = (): void => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setTestMessage('')
    setShowKey(false)
    setFetchedModels([])
    setFormOpen(false)
  }

  const submit = async (): Promise<void> => {
    const models = draft.models.map((m) => m.trim()).filter(Boolean)
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

  const handleFetchModels = async (): Promise<void> => {
    setFetchingModels(true)
    try {
      const result = await fetchModels({
        id: editingId ?? '',
        name: draft.name,
        format: draft.format,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl.trim() || undefined,
        models: [],
        defaultModel: ''
      }, editingId ?? undefined)
      if (result.models.length > 0) {
        setFetchedModels(result.models)
        setDraft((d) => ({
          ...d,
          models: [...new Set([...d.models, ...result.models])],
          defaultModel: d.defaultModel || result.models[0]
        }))
        setTestMessage(`获取到 ${result.models.length} 个模型，已合并到列表`)
      } else {
        setTestMessage(result.error || '未获取到模型，请检查 API Key 和 Base URL 是否正确')
      }
    } catch {
      setTestMessage('获取模型失败')
    } finally {
      setFetchingModels(false)
    }
  }

  const addEmptyModel = (): void => {
    setDraft((d) => ({ ...d, models: [...d.models, ''] }))
  }

  const updateModel = (index: number, value: string): void => {
    setDraft((d) => {
      const models = [...d.models]
      models[index] = value
      return { ...d, models }
    })
  }

  const removeModel = (index: number): void => {
    setDraft((d) => ({
      ...d,
      models: d.models.filter((_, i) => i !== index),
      defaultModel: d.defaultModel === d.models[index] ? '' : d.defaultModel
    }))
  }

  const moveModel = (index: number, direction: -1 | 1): void => {
    setDraft((d) => {
      const models = [...d.models]
      const target = index + direction
      if (target < 0 || target >= models.length) return d
      ;[models[index], models[target]] = [models[target], models[index]]
      return { ...d, models }
    })
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
            <div className="pf-input-wrap">
              <input
                className="pf-input"
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                placeholder={editingProvider ? '留空则沿用已保存的 Key' : 'sk-...'}
                onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
              />
              <button
                type="button"
                className="pf-input-btn"
                title={showKey ? '隐藏 API Key' : '显示 API Key'}
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
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
                    models: d.models.length === 0 ? preset.models : d.models,
                    defaultModel: d.defaultModel || preset.models[0]
                  }))}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </label>

          {/* Model list with reorder, add, remove, and auto-fetch */}
          <div className="pf-field">
            <div className="pf-label-row">
              <span className="pf-label">模型列表</span>
              <button
                type="button"
                className="pf-btn small"
                disabled={fetchingModels}
                onClick={() => void handleFetchModels()}
              >
                <Download size={12} /> {fetchingModels ? '获取中...' : '自动获取'}
              </button>
            </div>

            {/* Model rows */}
            <div className="model-list">
              {draft.models.length === 0 && (
                <div className="model-list-empty">暂未添加模型，请手动添加或点击"自动获取"</div>
              )}
              {draft.models.map((model, index) => (
                <div key={index} className="model-row">
                  <span className="model-row-index">{index + 1}</span>
                  <input
                    className="pf-input model-row-input"
                    value={model}
                    placeholder="输入模型名称"
                    onChange={(e) => updateModel(index, e.target.value)}
                  />
                  <Select
                    value=""
                    placeholder=""
                    onChange={(value) => updateModel(index, value)}
                  >
                    <Select.Item value="">— 选择 —</Select.Item>
                    {suggestedModels.map((m) => (
                      <Select.Item key={m} value={m}>{m}</Select.Item>
                    ))}
                  </Select>
                  <div className="model-row-actions">
                    <button
                      type="button"
                      title="上移"
                      aria-label="上移"
                      disabled={index === 0}
                      onClick={() => moveModel(index, -1)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      title="下移"
                      aria-label="下移"
                      disabled={index === draft.models.length - 1}
                      onClick={() => moveModel(index, 1)}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      title="移除"
                      aria-label="移除"
                      onClick={() => removeModel(index)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add model row */}
            <button type="button" className="pf-btn small model-add-btn" onClick={addEmptyModel}>
              <Plus size={12} /> 添加模型
            </button>
          </div>

          <label className="pf-field">
            <span className="pf-label">默认模型</span>
            <Select value={draft.defaultModel} onChange={(m) => setDraft((d) => ({ ...d, defaultModel: m }))}>
              <Select.Item value="">— 选择默认模型 —</Select.Item>
              {draft.models.filter(Boolean).map((m, i) => (
                <Select.Item key={`${m}-${i}`} value={m}>{m}</Select.Item>
              ))}
            </Select>
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

function maskKey(value: string): string {
  if (!value) return '未保存'
  return `••••${value.slice(-4)}`
}

function providerIconClass(provider: ApiProviderConfig): string {
  const value = `${provider.name} ${provider.baseUrl ?? ''}`.toLowerCase()
  if (value.includes('deepseek')) return 'icon-deepseek'
  if (value.includes('moonshot') || value.includes('kimi')) return 'icon-kimi'
  if (value.includes('mimo')) return 'icon-mimo'
  if (provider.format === 'anthropic') return 'icon-anthropic'
  if (provider.format === 'openai-compatible') return 'icon-openai'
  return 'icon-custom'
}
