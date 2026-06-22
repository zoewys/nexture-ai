import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AgentVendor, ModelCatalog, ReflectionEngineConfig } from '@shared/types'
import { ALL_VENDORS, DEFAULT_REFLECTION_CONFIG } from '@shared/types'
import { ModelSelect } from './ModelSelect'
import { Select } from './Select'
import { useReflectionConfig } from './useReflectionConfig'

export interface ReflectionSettingsPanelProps {
  modelCatalog: ModelCatalog | null
}

export function ReflectionSettingsPanel({ modelCatalog }: ReflectionSettingsPanelProps): JSX.Element {
  const { config, loading, save } = useReflectionConfig()
  const [draft, setDraft] = useState<ReflectionEngineConfig>(config)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(config)
  }, [config])

  const dirty =
    draft.enabled !== config.enabled ||
    draft.vendor !== config.vendor ||
    draft.model !== config.model
  const modelInfo = modelCatalog?.[draft.vendor] ?? null

  const handleVendorChange = (vendor: string): void => {
    const nextVendor = vendor as AgentVendor
    setDraft((current) => ({
      ...current,
      vendor: nextVendor,
      model: pickDefaultModel(nextVendor, modelCatalog)
    }))
  }

  const handleSave = async (): Promise<void> => {
    if (!dirty || !draft.model.trim()) return

    setSaving(true)
    try {
      await save(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="reflection-settings-panel" aria-label="Memory reflection settings">
      <summary className="reflection-settings-summary">
        <ChevronRight size={15} className="reflection-settings-chevron" aria-hidden="true" />
        <span>记忆 / 反思设置</span>
        <span className={`reflection-settings-pill ${draft.enabled ? 'is-on' : 'is-off'}`}>
          {draft.enabled ? '启用' : '关闭'}
        </span>
      </summary>

      <div className="reflection-settings-body">
        <div className="reflection-settings-header">
          <label className="reflection-settings-toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={loading || saving}
              onChange={(e) => setDraft((current) => ({ ...current, enabled: e.target.checked }))}
            />
            <span>启用记忆系统</span>
          </label>
          <button
            className="primary"
            type="button"
            disabled={loading || saving || !dirty || !draft.model.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中' : dirty ? '保存' : '已保存'}
          </button>
        </div>

        <div className="reflection-settings-grid">
          <label className="field">
            <span>Vendor</span>
            <Select
              value={draft.vendor}
              disabled={loading || saving}
              onChange={handleVendorChange}
            >
              {ALL_VENDORS.map((vendor) => (
                <Select.Item key={vendor} value={vendor}>
                  {vendor}
                </Select.Item>
              ))}
            </Select>
          </label>

          <label className="field">
            <span>Model</span>
            <ModelSelect
              value={draft.model}
              loading={loading || saving}
              modelInfo={modelInfo}
              onChange={(model) => setDraft((current) => ({ ...current, model }))}
            />
          </label>
        </div>
      </div>
    </details>
  )
}

function pickDefaultModel(vendor: AgentVendor, modelCatalog: ModelCatalog | null): string {
  const catalogDefault = modelCatalog?.[vendor]?.models[0]?.id
  if (catalogDefault) return catalogDefault
  if (vendor === DEFAULT_REFLECTION_CONFIG.vendor) return DEFAULT_REFLECTION_CONFIG.model
  return ''
}
