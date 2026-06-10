/**
 * ModeRail.tsx — 左侧 workspace 模式导航栏
 */

import { Bot, Layers, Play, Settings, Workflow } from 'lucide-react'

export type WorkspaceMode = 'workflow' | 'templates' | 'agents' | 'single' | 'settings'

interface ModeRailProps {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
}

function railIcon(mode: WorkspaceMode, size = 20) {
  switch (mode) {
    case 'workflow': return <Workflow size={size} />
    case 'templates': return <Layers size={size} />
    case 'agents': return <Bot size={size} />
    case 'single': return <Play size={size} />
    case 'settings': return <Settings size={size} />
  }
}

export function ModeRail({ mode, onModeChange }: ModeRailProps): JSX.Element {
  const modes: { key: WorkspaceMode; label: string }[] = [
    { key: 'workflow', label: 'Workflow' },
    { key: 'templates', label: 'Templates' },
    { key: 'agents', label: 'Agents' },
    { key: 'single', label: 'Single' }
  ]

  return (
    <nav className="mode-rail" aria-label="Workspace modes">
      {modes.map(m => (
        <button
          key={m.key}
          type="button"
          className={`mode-item ${mode === m.key ? 'mode-item-active' : ''}`}
          onClick={() => onModeChange(m.key)}
        >
          <span className="mode-icon">{railIcon(m.key)}</span>
          <span>{m.label}</span>
        </button>
      ))}

      <div className="mode-rail-spacer" />

      <button
        type="button"
        className={`mode-item ${mode === 'settings' ? 'mode-item-active' : ''}`}
        onClick={() => onModeChange('settings')}
      >
        <span className="mode-icon">{railIcon('settings')}</span>
        <span>Settings</span>
      </button>
    </nav>
  )
}
