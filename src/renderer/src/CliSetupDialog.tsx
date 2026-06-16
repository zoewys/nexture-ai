/**
 * CliSetupDialog.tsx — 启动时 CLI 环境检测 & 安装弹窗
 *
 * 检测 claude / codex CLI 是否可用：
 *  - 全部缺失 → 显示完整安装弹窗
 *  - 部分缺失 → 弹窗可最小化到顶栏指示器，后台安装
 *  - 全部就绪 → 不显示，直接进入
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Check, Code2, Zap } from 'lucide-react'

type CliName = 'claude' | 'codex'

interface CliState {
  found: boolean
  status: 'pending' | 'installing' | 'done' | 'error'
  message: string
}

interface CliSetupDialogProps {
  onDone: () => void
}

const CLI_INFO: Record<CliName, { name: string; desc: string; Icon: typeof Bot }> = {
  claude: { name: 'Claude Code', desc: 'Anthropic 官方 CLI，支持流式双向交互', Icon: Bot },
  codex: { name: 'Codex CLI', desc: 'OpenAI 官方 CLI，高性能单次执行', Icon: Code2 }
}

export function CliSetupDialog({ onDone }: CliSetupDialogProps): JSX.Element {
  const [clis, setClis] = useState<Record<CliName, CliState>>({
    claude: { found: false, status: 'pending', message: '' },
    codex: { found: false, status: 'pending', message: '' }
  })
  const [installing, setInstalling] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [minimized, setMinimized] = useState(false)

  // Check CLIs on mount
  useEffect(() => {
    (async () => {
      const result = await window.api.checkClis()
      const updated = {
        claude: { found: result.claude, status: result.claude ? 'done' as const : 'pending' as const, message: '' },
        codex: { found: result.codex, status: result.codex ? 'done' as const : 'pending' as const, message: '' }
      }
      setClis(updated)
      // Auto-minimize if at least one CLI is already installed
      if (result.claude || result.codex) {
        setMinimized(true)
      }
    })()
  }, [])

  // Listen for install progress
  useEffect(() => {
    return window.api.onCliInstallProgress((cli, message) => {
      setClis(prev => ({ ...prev, [cli]: { ...prev[cli], message } }))
    })
  }, [])

  const install = useCallback(async (cli: CliName) => {
    setClis(prev => ({ ...prev, [cli]: { ...prev[cli], status: 'installing', message: '准备安装…' } }))
    try {
      const result = await window.api.installCli(cli)
      if (result.ok) {
        setClis(prev => ({ ...prev, [cli]: { ...prev[cli], status: 'done', found: true, message: '安装完成' } }))
      } else {
        setClis(prev => ({ ...prev, [cli]: { ...prev[cli], status: 'error', message: result.message } }))
      }
    } catch (err) {
      setClis(prev => ({ ...prev, [cli]: { ...prev[cli], status: 'error', message: err instanceof Error ? err.message : String(err) } }))
    }
  }, [])

  const installAll = useCallback(async () => {
    setInstalling(true)
    for (const cli of ['claude', 'codex'] as CliName[]) {
      if (!clis[cli].found && clis[cli].status !== 'done') {
        await install(cli)
      }
    }
    setInstalling(false)
    setAllDone(true)
  }, [clis, install])

  const missing = useMemo(
    () => (Object.keys(CLI_INFO) as CliName[]).filter(c => !clis[c].found && clis[c].status !== 'done'),
    [clis]
  )
  const hasMissing = missing.length > 0
  const anyInstalling = Object.values(clis).some(c => c.status === 'installing')

  // ── Minimized indicator ──
  if (minimized && (hasMissing || anyInstalling)) {
    return (
      <div className="cli-mini-indicator" onClick={() => setMinimized(false)} title="展开 CLI 安装面板">
        <span className="cli-mini-dot" />
        <span className="cli-mini-text">
          {anyInstalling ? '正在安装 CLI…' : `${missing.length} 个 CLI 待安装`}
        </span>
      </div>
    )
  }

  // ── Full dialog ──
  return (
    <div className="cli-setup-overlay">
      <div className="cli-setup-dialog">
        <div className="cli-setup-header">
          <div className="cli-setup-icon"><Zap size={28} /></div>
          <h2>{allDone && !hasMissing ? '环境就绪' : '准备工作环境'}</h2>
          <p>
            {allDone && !hasMissing
              ? '所有 CLI 已安装完毕，开始使用 Agent Studio 吧。'
              : 'Agent Studio 需要本地 CLI 来驱动 AI Agent。'}
          </p>
        </div>

        <div className="cli-setup-body">
          {(Object.entries(CLI_INFO) as [CliName, typeof CLI_INFO['claude']][]).map(([key, info]) => {
            const state = clis[key]
            return (
              <div
                key={key}
                className={`cli-setup-row ${state.status === 'done' && state.found ? 'cli-setup-row-done' : ''} ${state.status === 'installing' ? 'cli-setup-row-installing' : ''}`}
              >
                <div className={`cli-setup-row-icon ${key}`}><info.Icon size={18} /></div>
                <div className="cli-setup-row-info">
                  <div className="cli-setup-row-name">{info.name}</div>
                  <div className="cli-setup-row-desc">{info.desc}</div>
                  {state.status === 'installing' && (
                    <>
                      <div className="cli-progress-bar">
                        <div className="cli-progress-fill cli-progress-indeterminate" />
                      </div>
                      {state.message && <div className="cli-progress-log">{state.message}</div>}
                    </>
                  )}
                  {state.status === 'error' && (
                    <div className="cli-progress-log cli-progress-error">{state.message}</div>
                  )}
                </div>
                <div className="cli-setup-row-status">
                  <StatusBadge state={state} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="cli-setup-footer">
          {!allDone && Object.values(clis).some(c => c.found) && (
            <button type="button" onClick={() => setMinimized(true)}>
              最小化
            </button>
          )}
          <button type="button" onClick={onDone} disabled={!allDone}>
            {allDone ? '开始使用' : '跳过'}
          </button>
          {hasMissing && !allDone && (
            <button
              type="button"
              className="primary"
              disabled={installing}
              onClick={() => void installAll()}
            >
              {installing ? '安装中…' : `安装全部 (${missing.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ state }: { state: CliState }): JSX.Element {
  if (state.status === 'done' && state.found) {
    return <span className="cli-status-badge cli-status-found"><Check size={12} /> 已就绪</span>
  }
  if (state.status === 'installing') {
    return <span className="cli-status-badge cli-status-installing">安装中…</span>
  }
  if (state.status === 'error') {
    return <span className="cli-status-badge cli-status-error">安装失败</span>
  }
  return <span className="cli-status-badge cli-status-missing">未安装</span>
}
