import { useCallback, useEffect, useState } from 'react'
import { Bot, Code2, Download, RefreshCw, Upload } from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { ExportDialog } from './ExportDialog'
import { ImportDialog } from './ImportDialog'

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
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importPreview, setImportPreview] = useState<any>(null)
  const [importFilePath, setImportFilePath] = useState('')

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
                  <div className="cli-progress-bar"><div className="cli-progress-fill" /></div>
                )}
                {isInstalling && info?.message && (
                  <div className="cli-progress-log">{info.message}</div>
                )}

                <div className="cli-card-bottom">
                  {isInstalled ? (
                    <button type="button" className="cli-install-btn" disabled>已安装</button>
                  ) : (
                    <button type="button" className="cli-install-btn primary" disabled={isInstalling} onClick={() => void handleInstall(def.key)}>
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

      {/* ── Data Management ── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <h3 className="settings-section-title">数据管理</h3>
            <p className="settings-section-desc">导出 Agent、模板、运行历史和设置，方便迁移到新机器或备份。</p>
          </div>
        </div>
        <div className="settings-btn-group" style={{ marginTop: 8 }}>
          <button type="button" className="btn primary" onClick={() => setShowExport(true)}>
            <Download size={14} /> 导出数据
          </button>
          <button type="button" className="btn" onClick={async () => {
            const result = await window.api.pickFiles()
            if (result && result.length > 0) {
              setImportFilePath(result[0])
              const preview = await window.api.previewImport(result[0])
              setImportPreview(preview)
              setShowImport(true)
            }
          }}>
            <Upload size={14} /> 导入数据
          </button>
        </div>
      </section>

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
            <p>开启后，每次运行 agent 时会展示注入的历史记忆列表。</p>
          </div>
          <button type="button" className={`settings-switch${settings.showMemoryReferences ? ' on' : ''}`} disabled={loading}
            onClick={() => onSave({ ...settings, showMemoryReferences: !settings.showMemoryReferences })}
            role="switch" aria-checked={settings.showMemoryReferences} />
        </div>
      </section>

      <hr className="settings-divider" />

      {/* ── Tray ── */}
      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <h3 className="settings-section-title">后台运行</h3>
            <p className="settings-section-desc">关闭窗口后保留 Tray 中的定时任务调度器。</p>
          </div>
        </div>
        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <h4>关闭窗口时最小化到 Tray</h4>
            <p>开启后，定时 workflow 会在后台继续触发。</p>
          </div>
          <button type="button" className={`settings-switch${settings.minimizeToTray ? ' on' : ''}`} disabled={loading}
            onClick={() => onSave({ ...settings, minimizeToTray: !settings.minimizeToTray })}
            role="switch" aria-checked={settings.minimizeToTray} />
        </div>
      </section>

      {showExport && (
        <ExportDialog
          items={[
            { key: 'agents', label: 'Agent 定义', desc: '所有自定义的 AI Agent 角色和配置', count: '', required: true },
            { key: 'workflows', label: 'Workflow 模板', desc: 'DAG 画布上编排的所有模板', count: '', required: true },
            { key: 'workflowRuns', label: 'Workflow 运行历史', desc: '已执行的 workflow 记录，便于复盘', count: '', required: true },
            { key: 'schedules', label: '定时任务', desc: '已配置的 workflow 定时调度', count: '', required: false },
            { key: 'settings', label: 'App 设置', desc: '界面偏好和功能开关', count: '—', required: false },
            { key: 'memories', label: '记忆库', desc: 'Agent 学习的历史经验', count: '', required: false }
          ]}
          onExport={async (selected) => {
            const result = await window.api.exportData(makeExportOptions(selected))
            if (result.ok) setShowExport(false)
          }}
          onClose={() => setShowExport(false)}
        />
      )}

      {showImport && importPreview && (
        <ImportDialog
          filePath={importFilePath}
          preview={importPreview}
          onImport={async (selected) => {
            await window.api.importData(importFilePath, makeExportOptions(selected))
            setShowImport(false)
          }}
          onClose={() => { setShowImport(false); setImportPreview(null) }}
        />
      )}
    </div>
  )
}

function makeExportOptions(selected: Set<string>) {
  return {
    agents: true as const, workflows: true as const, workflowRuns: true as const,
    schedules: selected.has('schedules'),
    settings: selected.has('settings'),
    memories: selected.has('memories')
  }
}
