// 方向 C：编辑器融合 Editor Fusion
// VS Code / Cursor 风格、Activity Bar、Panel、Sidebar、标签页

import React, { useState, useMemo } from 'react'

const MOCK_RUNS = [
  { id: 'r1', name: '需求分析 → 设计 → 开发', status: 'awaiting-confirm', step: 2, totalSteps: 5, project: '~/projects/acme-web', cost: 0.0042, budget: 0.1, model: 'claude-sonnet-4-6', time: '2m ago' },
  { id: 'r2', name: '后端 API 重构', status: 'running', step: 1, totalSteps: 3, project: '~/projects/api-v2', cost: 0.0018, budget: 0.05, model: 'deepseek-chat', time: '5m ago' },
  { id: 'r3', name: '定时数据清洗', status: 'completed', step: 4, totalSteps: 4, project: '~/projects/etl', cost: 0.012, budget: 0.02, model: 'codex', time: '1h ago' },
  { id: 'r4', name: '移动端适配 review', status: 'error', step: 2, totalSteps: 3, project: '~/projects/mobile', cost: 0.003, budget: 0.05, model: 'kimi-k2.5', time: '3h ago' },
]

const MOCK_EVENTS = [
  { kind: 'system', id: 'e0', text: '[system] Step 2/5: Architect · 技术设计' },
  { kind: 'message', id: 'e1', text: '已分析现有鉴权逻辑。建议引入 RBAC，支持角色继承。' },
  { kind: 'thinking', id: 'e2', text: '用户是否允许引入第三方 auth 库？' },
  { kind: 'tool-call', id: 'e3', text: 'file_read src/auth.ts (312 lines)' },
  { kind: 'tool-result', id: 'e4', text: 'exit 0' },
  { kind: 'file-changed', id: 'e5', text: 'M src/auth.ts (+45, -12)' },
  { kind: 'message', id: 'e6', text: '请确认：是否需要支持 OAuth2 登录？' },
]

const MOCK_ARTIFACTS = [
  { path: 'design/auth-rbac.md', type: 'markdown' },
  { path: 'src/auth.ts', type: 'typescript' },
]

const STATUS_COLOR = {
  running: '#4ade80',
  'awaiting-confirm': '#fbbf24',
  'awaiting-input': '#60a5fa',
  completed: '#4ade80',
  error: '#f87171',
  interrupted: '#9ca3af',
}

const ACTIVITY_ITEMS = [
  { id: 'explorer', icon: '📁', label: 'Explorer' },
  { id: 'workflow', icon: '⚡', label: 'Workflow' },
  { id: 'templates', icon: '📐', label: 'Templates' },
  { id: 'agents', icon: '🤖', label: 'Agents' },
  { id: 'memory', icon: '🧠', label: 'Memory' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

export default function EditorFusion() {
  const [activity, setActivity] = useState('workflow')
  const [selectedRunId, setSelectedRunId] = useState('r1')
  const [activeTab, setActiveTab] = useState('transcript')
  const [composerText, setComposerText] = useState('')
  const [sidebarVisible, setSidebarVisible] = useState(true)

  const selectedRun = useMemo(() => MOCK_RUNS.find((r) => r.id === selectedRunId) || MOCK_RUNS[0], [selectedRunId])

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#1e1e1e', color: '#cccccc', fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13 }}>
      {/* Activity Bar */}
      <div style={{ width: 48, background: '#333333', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', gap: 4, flexShrink: 0 }}>
        {ACTIVITY_ITEMS.map((item) => (
          <div
            key={item.id}
            onClick={() => setActivity(item.id)}
            style={{
              width: 40, height: 40, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 20,
              background: activity === item.id ? '#1e1e1e' : 'transparent',
              borderLeft: activity === item.id ? '2px solid #007acc' : '2px solid transparent',
            }}
            title={item.label}
          >
            {item.icon}
          </div>
        ))}
        <div style={{ marginTop: 'auto', marginBottom: 8, fontSize: 18, cursor: 'pointer' }}>👤</div>
      </div>

      {/* Sidebar */}
      {sidebarVisible && (
        <div style={{ width: 260, background: '#252526', borderRight: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#bbbbbb' }}>{ACTIVITY_ITEMS.find((i) => i.id === activity)?.label}</div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {activity === 'workflow' && MOCK_RUNS.map((run) => {
              const active = run.id === selectedRunId
              return (
                <div
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  style={{
                    padding: '6px 12px 6px 20px',
                    cursor: 'pointer',
                    background: active ? '#37373d' : 'transparent',
                    borderLeft: active ? '1px solid #007acc' : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: STATUS_COLOR[run.status] }}>●</span>
                    <span style={{ fontSize: 12, color: active ? '#fff' : '#ccc' }}>{run.name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#858585', paddingLeft: 16, marginTop: 2 }}>{run.project}</div>
                </div>
              )
            })}
            {activity === 'explorer' && (
              <div style={{ padding: '4px 12px' }}>
                <div style={{ padding: '4px 8px', fontSize: 12, color: '#858585' }}>📁 Agent Studio</div>
                <div style={{ paddingLeft: 16 }}>
                  <div style={{ padding: '2px 8px', fontSize: 12 }}>📁 Workflows</div>
                  <div style={{ padding: '2px 8px', fontSize: 12 }}>📁 Agents</div>
                  <div style={{ padding: '2px 8px', fontSize: 12 }}>📁 Memory</div>
                  <div style={{ padding: '2px 8px', fontSize: 12 }}>⚙️ Settings</div>
                </div>
              </div>
            )}
            {activity === 'agents' && (
              <div style={{ padding: '4px 12px' }}>
                {['Product Manager', 'Architect', 'Backend Dev', 'Frontend Dev', 'QA'].map((a) => (
                  <div key={a} style={{ padding: '6px 8px', fontSize: 12, cursor: 'pointer' }}>🤖 {a}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Tab Bar */}
        <div style={{ height: 35, background: '#2d2d2d', display: 'flex', alignItems: 'center', overflowX: 'auto', flexShrink: 0 }}>
          {[
            { id: 'transcript', label: 'Transcript', icon: '📝' },
            { id: 'artifacts', label: 'Artifacts', icon: '📦' },
            { id: 'output', label: 'Output', icon: '📤' },
          ].map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '0 16px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                background: activeTab === tab.id ? '#1e1e1e' : '#2d2d2d',
                borderTop: activeTab === tab.id ? '1px solid #007acc' : '1px solid transparent',
                borderRight: '1px solid #252526',
                fontSize: 12,
                color: activeTab === tab.id ? '#fff' : '#969696',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.id === 'transcript' && selectedRun.status === 'awaiting-confirm' && (
                <span style={{ width: 6, height: 6, borderRadius: 3, background: '#fbbf24', marginLeft: 4 }} />
              )}
            </div>
          ))}
          <div style={{ marginLeft: 'auto', padding: '0 12px', display: 'flex', gap: 8 }}>
            <button onClick={() => setSidebarVisible((v) => !v)} style={{ background: 'transparent', border: 'none', color: '#858585', cursor: 'pointer', fontSize: 12 }}>📂</button>
          </div>
        </div>

        {/* Editor Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace", fontSize: 12, lineHeight: 1.6 }}>
          {activeTab === 'transcript' && MOCK_EVENTS.map((ev) => {
            if (ev.kind === 'system') return <div key={ev.id} style={{ color: '#858585', marginBottom: 4 }}>// {ev.text}</div>
            if (ev.kind === 'message') return <div key={ev.id} style={{ color: '#d4d4d4', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{ev.text}</div>
            if (ev.kind === 'thinking') return <div key={ev.id} style={{ color: '#c586c0', marginBottom: 6, paddingLeft: 12, borderLeft: '2px solid #c586c0' }}>// 🤔 {ev.text}</div>
            if (ev.kind === 'tool-call') return <div key={ev.id} style={{ color: '#4ec9b0', marginBottom: 2 }}>// → {ev.text}</div>
            if (ev.kind === 'tool-result') return <div key={ev.id} style={{ color: '#4ec9b0', marginBottom: 6, paddingLeft: 12 }}>//   ✓ {ev.text}</div>
            if (ev.kind === 'file-changed') return <div key={ev.id} style={{ color: '#ce9178', marginBottom: 4 }}>// {ev.text}</div>
            return null
          })}

          {activeTab === 'artifacts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MOCK_ARTIFACTS.map((art) => (
                <div key={art.path} style={{ padding: 10, background: '#252526', borderRadius: 4, cursor: 'pointer', border: '1px solid #333' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#dcdcaa' }}>{art.path}</span>
                    <span style={{ color: '#858585', fontSize: 10 }}>{art.type}</span>
                  </div>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>Click to preview in editor...</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'output' && (
            <div style={{ color: '#858585' }}>No additional output.</div>
          )}
        </div>

        {/* Panel (Composer / Status) */}
        <div style={{ height: 140, background: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 28, background: '#2d2d2d', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12, fontSize: 11, color: '#858585' }}>
            <span style={{ color: '#fff' }}>Composer</span>
            <span>Problems</span>
            <span>Debug</span>
            <span style={{ marginLeft: 'auto' }}>Ln 12, Col 34</span>
          </div>
          <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedRun.status === 'awaiting-confirm' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>⚠️ Step 2 完成，等待确认</span>
                <button style={{ background: '#0e639c', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 3, fontSize: 11, cursor: 'pointer' }}>继续</button>
                <button style={{ background: '#333', border: '1px solid #555', color: '#ccc', padding: '4px 12px', borderRadius: 3, fontSize: 11, cursor: 'pointer' }}>重跑</button>
                <button style={{ background: '#333', border: '1px solid #555', color: '#ccc', padding: '4px 12px', borderRadius: 3, fontSize: 11, cursor: 'pointer' }}>跳过</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder="Type a message or command..."
                style={{ flex: 1, background: '#3c3c3c', border: '1px solid #555', color: '#ccc', padding: '6px 10px', borderRadius: 3, fontSize: 12, outline: 'none' }}
              />
              <button style={{ background: '#0e639c', border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 3, fontSize: 12, cursor: 'pointer' }}>▶</button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar: Status */}
      <div style={{ width: 240, background: '#252526', borderLeft: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', fontSize: 11, fontWeight: 600, color: '#bbbbbb' }}>Status</div>
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: '#858585', marginBottom: 2 }}>Status</div>
            <div style={{ fontSize: 12, color: STATUS_COLOR[selectedRun.status], fontWeight: 600 }}>{selectedRun.status}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#858585', marginBottom: 2 }}>Model</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>{selectedRun.model}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#858585', marginBottom: 2 }}>Cost</div>
            <div style={{ fontSize: 12, color: '#ccc' }}>${selectedRun.cost}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#858585', marginBottom: 2 }}>Budget</div>
            <div style={{ height: 4, background: '#333', borderRadius: 2 }}>
              <div style={{ width: `${(selectedRun.cost / selectedRun.budget) * 100}%`, height: '100%', background: selectedRun.cost > selectedRun.budget * 0.8 ? '#f87171' : '#4ade80', borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 10, color: '#858585', marginTop: 2 }}>${selectedRun.cost} / ${selectedRun.budget}</div>
          </div>
          <div style={{ marginTop: 8, padding: '8px', background: '#1e1e1e', borderRadius: 4, border: '1px solid #333' }}>
            <div style={{ fontSize: 10, color: '#858585', marginBottom: 4 }}>Git Safety</div>
            <div style={{ fontSize: 11, color: '#4ade80' }}>✓ Safe</div>
            <div style={{ fontSize: 10, color: '#858585', marginTop: 2 }}>main · clean</div>
          </div>
          <div style={{ marginTop: 8, padding: '8px', background: '#1e1e1e', borderRadius: 4, border: '1px solid #333' }}>
            <div style={{ fontSize: 10, color: '#858585', marginBottom: 4 }}>Memory</div>
            <div style={{ fontSize: 11, color: '#c586c0' }}>3 memories injected</div>
          </div>
        </div>
      </div>
    </div>
  )
}
