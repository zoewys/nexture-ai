/**
 * ModeRail.tsx — 左侧 workspace 模式导航栏
 *
 * 垂直排列四个模式按钮：Workflow / Templates / Agents / Single，
 * 控制 App 当前显示哪个工作面板。纯展示组件，无内部状态。
 */

export type WorkspaceMode = 'workflow' | 'templates' | 'agents' | 'single'

interface ModeRailProps {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
}

function modeIcon(mode: WorkspaceMode): string {
  switch (mode) {
    case 'workflow':
      return '⌘'
    case 'templates':
      return '▦'
    case 'agents':
      return '◎'
    case 'single':
      return '▶'
  }
}

export function ModeRail({ mode, onModeChange }: ModeRailProps): JSX.Element {
  return (
    <nav className="mode-rail" aria-label="Workspace modes">
      <button
        type="button"
        className={`mode-item ${mode === 'workflow' ? 'mode-item-active' : ''}`}
        onClick={() => onModeChange('workflow')}
      >
        <span className="mode-icon">{modeIcon('workflow')}</span>
        <span>Workflow</span>
      </button>
      <button
        type="button"
        className={`mode-item ${mode === 'templates' ? 'mode-item-active' : ''}`}
        onClick={() => onModeChange('templates')}
      >
        <span className="mode-icon">{modeIcon('templates')}</span>
        <span>Templates</span>
      </button>
      <button
        type="button"
        className={`mode-item ${mode === 'agents' ? 'mode-item-active' : ''}`}
        onClick={() => onModeChange(mode === 'agents' ? 'workflow' : 'agents')}
      >
        <span className="mode-icon">{modeIcon('agents')}</span>
        <span>Agents</span>
      </button>
      <button
        type="button"
        className={`mode-item ${mode === 'single' ? 'mode-item-active' : ''}`}
        onClick={() => onModeChange('single')}
      >
        <span className="mode-icon">{modeIcon('single')}</span>
        <span>Single</span>
      </button>
    </nav>
  )
}
