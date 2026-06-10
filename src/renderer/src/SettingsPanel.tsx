import type { AppSettings } from '@shared/types'

interface SettingsPanelProps {
  settings: AppSettings
  loading: boolean
  onSave: (settings: AppSettings) => Promise<void>
}

export function SettingsPanel({ settings, loading, onSave }: SettingsPanelProps): JSX.Element {
  const handleToggle = (key: keyof AppSettings, value: boolean): void => {
    void onSave({ ...settings, [key]: value })
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">设置</h2>

      <section className="settings-section">
        <h3 className="settings-section-title">记忆系统</h3>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.showMemoryReferences}
            disabled={loading}
            onChange={(e) => handleToggle('showMemoryReferences', e.target.checked)}
          />
          <span>在会话中展示记忆引用</span>
        </label>
        <p className="settings-hint">开启后，运行 agent 时会展示本次注入的历史记忆列表</p>
      </section>
    </div>
  )
}
