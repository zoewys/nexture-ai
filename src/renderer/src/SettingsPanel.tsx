import { useCallback, useEffect, useState } from 'react'
import { Bot, Code2, RefreshCw } from 'lucide-react'
import type { AppSettings } from '@shared/types'

interface SettingsPanelProps {
  settings: AppSettings
  loading: boolean
  onSave: (settings: AppSettings) => Promise<void>
}

interface CliInfo {
  installed: boolean
  version: string | null
  installing: boolean
  message: string
}

const CLI_DEFS = [
  { key: 'claude' as const, name: 'Claude Code', Icon: Bot, pkg: '@anthropic-ai/claude-code' },
  { key: 'codex' as const, name: 'Codex', Icon: Code2, pkg: '@openai/codex' }
]

export function SettingsPanel({ settings, loading, onSave }: SettingsPanelProps): JSX.Element {
  const [clis, setClis] = useState<Record<string, CliInfo>>({})
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const [check, versions] = await Promise.all([
      window.api.checkClis(),
      window.api.getCliVersions()
    ])
    setClis({
      claude: { installed: check.claude, version: versions.claude, installing: false, message: '' },
      codex: { installed: check.codex, version: versions.codex, installing: false, message: '' }
    })
    setRefreshing(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    return window.api.onCliInstallProgress((cli, message) => {
      setClis(prev => ({ ...prev, [cli]: { ...prev[cli], message } }))
    })
  }, [])

  const handleInstall = useCallback(async (cli: 'claude' | 'codex') => {
    setClis(prev => ({ ...prev, [cli]: { ...prev[cli], installing: true, message: '准备安装…' } }))
    await window.api.installCli(cli)
    await refresh()
  }, [refresh])

  return (
    <div className="settings-panel">
      {/* ── CLI Management ── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <h3 className="settings-section-title">CLI 工具</h3>
            <p className="settings-section-desc">Agent Studio 依赖本地 CLI 驱动 AI Agent。缺失的工具可以在此安装。</p>
          </div>
          <button type="button" className="settings-refresh-btn" onClick={() => void refresh()} disabled={refreshing} title="刷新 CLI 状态">
            <RefreshCw size={20} />
          </button>
        </div>

        <div className="cli-grid">
          {CLI_DEFS.map(def => {
            const info = clis[def.key]
            const isInstalled = info?.installed
            const isInstalling = info?.installing

            return (
              <div key={def.key} className={`cli-card${isInstalled ? ' installed' : ''}${isInstalling ? ' installing' : ''}`}>
                <div className="cli-card-top">
                  <div className="cli-card-identity">
                    <div className={`cli-card-icon ${def.key}`}><def.Icon size={18} /></div>
                    <div>
                      <div className="cli-card-name">{def.name}</div>
                      <div className="cli-card-pkg">{def.pkg}</div>
                    </div>
                  </div>
                  <span className={`cli-status-badge ${isInstalling ? 'installing' : isInstalled ? 'ok' : 'missing'}`}>
                    {isInstalling ? '安装中' : isInstalled ? '已安装' : '未安装'}
                  </span>
                </div>

                <div className="cli-card-meta">
                  <span className="cli-platform-tag">macOS</span>
                  {isInstalled && info?.version ? (
                    <span className="cli-version-text">{info.version}</span>
                  ) : !isInstalling ? (
                    <span className="cli-missing-text">未安装或无法执行</span>
                  ) : (
                    <span className="cli-missing-text">正在通过 npm 安装…</span>
                  )}
                </div>

                {isInstalling && (
                  <div className="cli-progress-bar">
                    <div className="cli-progress-fill" />
                  </div>
                )}
                {isInstalling && info?.message && (
                  <div className="cli-progress-log">{info.message}</div>
                )}

                <div className="cli-card-bottom">
                  {isInstalled ? (
                    <button type="button" className="cli-install-btn" disabled>已安装</button>
                  ) : (
                    <button
                      type="button"
                      className="cli-install-btn primary"
                      disabled={isInstalling}
                      onClick={() => void handleInstall(def.key)}
                    >
                      {isInstalling ? '安装中…' : '安装'}
                    </button>
                  )}
                  <span className="cli-install-hint">npm install -g</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── divider ── */}
      <hr className="settings-divider" />

      {/* ── Memory ── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <h3 className="settings-section-title">记忆系统</h3>
            <p className="settings-section-desc">Agent 跨 workflow 积累经验，越用越懂你的项目。</p>
          </div>
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <h4>在会话中展示记忆引用</h4>
            <p>开启后，每次运行 agent 时会展示注入的历史记忆列表，帮助你了解 agent 基于哪些经验在行动。</p>
          </div>
          <button
            type="button"
            className={`settings-switch${settings.showMemoryReferences ? ' on' : ''}`}
            disabled={loading}
            onClick={() => onSave({ ...settings, showMemoryReferences: !settings.showMemoryReferences })}
            role="switch"
            aria-checked={settings.showMemoryReferences}
          />
        </div>
      </section>
    </div>
  )
}
