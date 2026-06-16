/**
 * ModeRail.tsx — 左侧 workspace 模式导航栏
 */

import { Bot, Layers, LayoutGrid, MessageCircle, Settings } from 'lucide-react'

export type WorkspaceMode = 'workflow' | 'templates' | 'agents' | 'single' | 'settings'

interface ModeRailProps {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
}

function railIcon(mode: WorkspaceMode, size = 20) {
  switch (mode) {
    case 'workflow': return <LayoutGrid size={size} />
    case 'templates': return <Layers size={size} />
    case 'agents': return <Bot size={size} />
    case 'single': return <MessageCircle size={size} />
    case 'settings': return <Settings size={size} />
  }
}

const modes: { key: WorkspaceMode; label: string }[] = [
  { key: 'workflow', label: 'Workflow' },
  { key: 'templates', label: 'Templates' },
  { key: 'agents', label: 'Agents' },
  { key: 'single', label: 'Single' },
  { key: 'settings', label: 'Settings' }
]

export function ModeRail({ mode, onModeChange }: ModeRailProps): JSX.Element {
  return (
    <nav className="mode-rail" aria-label="Workspace modes">
      {modes.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`mode-rail-btn ${mode === item.key ? 'active' : ''}`}
          onClick={() => onModeChange(item.key)}
          title={item.label}
          aria-label={item.label}
        >
          {railIcon(item.key)}
        </button>
      ))}
    </nav>
  )
}
