// 方向 A：工业控制台 Industrial Console
// 极致密度、暗色终端风格、状态色块、类 IDE 布局

import React, { useState, useMemo } from 'react'

const MOCK_RUNS = [
  { id: 'r1', name: '需求分析 → 设计 → 开发', status: 'awaiting-confirm', step: 2, totalSteps: 5, project: '~/projects/acme-web', cost: 0.0042, budget: 0.1, model: 'claude-sonnet-4-6', time: '2m ago' },
  { id: 'r2', name: '后端 API 重构', status: 'running', step: 1, totalSteps: 3, project: '~/projects/api-v2', cost: 0.0018, budget: 0.05, model: 'deepseek-chat', time: '5m ago' },
  { id: 'r3', name: '定时数据清洗', status: 'completed', step: 4, totalSteps: 4, project: '~/projects/etl', cost: 0.012, budget: 0.02, model: 'codex', time: '1h ago' },
  { id: 'r4', name: '移动端适配 review', status: 'error', step: 2, totalSteps: 3, project: '~/projects/mobile', cost: 0.003, budget: 0.05, model: 'kimi-k2.5', time: '3h ago' },
  { id: 'r5', name: '文档自动生成', status: 'interrupted', step: 1, totalSteps: 2, project: '~/projects/docs', cost: 0.0005, budget: 0.01, model: 'gpt-4o', time: '5h ago' },
]

const MOCK_EVENTS = [
  { kind: 'session-started', id: 'e1', text: '' },
  { kind: 'message-delta', id: 'e2', text: '分析需求文档...' },
  { kind: 'thinking', id: 'e3', text: '需要确认用户鉴权模块的范围' },
  { kind: 'tool-call', id: 'e4', text: 'file_read: src/auth.ts' },
  { kind: 'tool-result', id: 'e5', text: '✓ 读取成功 (312 lines)' },
  { kind: 'file-changed', id: 'e6', text: 'modified: src/auth.ts' },
  { kind: 'message', id: 'e7', text: '已分析现有鉴权逻辑，建议引入 RBAC。请确认是否需要支持 OAuth2？' },
  { kind: 'usage', id: 'e8', text: 'input: 2,400 | output: 890 | cost: $0.0042' },
  { kind: 'turn-done', id: 'e9', text: '' },
  { kind: 'system', id: 'e10', text: '↳ Step 2 完成，等待确认' },
]

const MOCK_ARTIFACTS = [
  { path: 'design/auth-rbac.md', type: 'requirement', desc: '鉴权模块 RBAC 设计文档' },
  { path: 'src/auth.ts', type: 'code', desc: '修改后的鉴权入口' },
]

const STATUS_STYLES = {
  running: { bg: '#1a3a2f', text: '#4ade80', label: '运行中' },
  'awaiting-confirm': { bg: '#3a2e1a', text: '#fbbf24', label: '待确认' },
  'awaiting-input': { bg: '#1a2a3a', text: '#60a5fa', label: '待输入' },
  completed: { bg: '#1a3a2f', text: '#4ade80', label: '已完成' },
  error: { bg: '#3a1a1a', text: '#f87171', label: '错误' },
  interrupted: { bg: '#2a2a2a', text: '#9ca3af', label: '中断' },
}

export default function ConsoleIndustrial() {
  const [selectedRunId, setSelectedRunId] = useState('r1')
  const [confirming, setConfirming] = useState(false)
  const [composerText, setComposerText] = useState('')

  const selectedRun = useMemo(() => MOCK_RUNS.find((r) => r.id === selectedRunId) || MOCK_RUNS[0], [selectedRunId])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0b0d12', color: '#e2e4e9', fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif', fontSize: 13 }}>
      {/* Top Bar */}
      <div style={{ height: 40, borderBottom: '1px solid #1f232e', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>Agent Studio</div>
        <div style={{ width: 1, height: 18, background: '#1f232e' }} />
        <div style={{ display: 'flex', gap: 12, color: '#6b7280' }}>
          <span style={{ color: '#e2e4e9', cursor: 'pointer' }}>Workflow</span>
          <span style={{ cursor: 'pointer' }}>Templates</span>
          <span style={{ cursor: 'pointer' }}>Agents</span>
          <span style={{ cursor: 'pointer' }}>Single</span>
          <span style={{ cursor: 'pointer' }}>Settings</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#6b7280' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#4ade80' }} />
          Claude OK
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#4ade80' }} />
          Codex OK
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#fbbf24' }} />
          API: Kimi
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Runs List */}
        <div style={{ width: 260, borderRight: '1px solid #1f232e', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f232e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>Runs</span>
            <button style={{ background: 'transparent', border: '1px solid #1f232e', color: '#9ca3af', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>+ New</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {MOCK_RUNS.map((run) => {
              const st = STATUS_STYLES[run.status]
              const active = run.id === selectedRunId
              return (
                <div
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #151821',
                    cursor: 'pointer',
                    background: active ? '#151921' : 'transparent',
                    borderLeft: active ? '2px solid #60a5fa' : '2px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: active ? '#e2e4e9' : '#9ca3af' }}>{run.name}</span>
                    <span style={{ fontSize: 10, color: '#4b5563' }}>{run.time}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: st.bg, color: st.text, fontWeight: 600 }}>{st.label}</span>
                    <span style={{ fontSize: 10, color: '#4b5563' }}>Step {run.step}/{run.totalSteps}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#374151', fontFamily: 'ui-monospace, SFMono, monospace' }}>{run.project}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Center: Transcript */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ height: 36, borderBottom: '1px solid #1f232e', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Transcript</span>
            <span style={{ fontSize: 11, color: '#374151' }}>{selectedRun.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#374151' }}>
              Cost: <span style={{ color: '#e2e4e9' }}>${selectedRun.cost}</span> / ${selectedRun.budget}
            </span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 14, fontFamily: 'ui-monospace, SFMono, monospace', fontSize: 12, lineHeight: 1.6 }}>
            {MOCK_EVENTS.map((ev) => {
              if (ev.kind === 'session-started') return <div key={ev.id} style={{ color: '#374151', marginBottom: 8 }}>─── session started ───</div>
              if (ev.kind === 'message-delta') return <span key={ev.id} style={{ color: '#e2e4e9' }}>{ev.text}</span>
              if (ev.kind === 'thinking') return <div key={ev.id} style={{ color: '#a78bfa', margin: '6px 0', padding: '6px 8px', background: '#1a1630', borderRadius: 4, borderLeft: '2px solid #a78bfa' }}>💭 {ev.text}</div>
              if (ev.kind === 'tool-call') return <div key={ev.id} style={{ color: '#60a5fa', margin: '4px 0' }}>🔧 {ev.text}</div>
              if (ev.kind === 'tool-result') return <div key={ev.id} style={{ color: '#4ade80', margin: '4px 0', paddingLeft: 16 }}>↳ {ev.text}</div>
              if (ev.kind === 'file-changed') return <div key={ev.id} style={{ color: '#fbbf24', margin: '4px 0' }}>📝 {ev.text}</div>
              if (ev.kind === 'message') return <div key={ev.id} style={{ color: '#e2e4e9', margin: '8px 0', whiteSpace: 'pre-wrap' }}>{ev.text}</div>
              if (ev.kind === 'usage') return <div key={ev.id} style={{ color: '#6b7280', margin: '8px 0', fontSize: 11 }}>📊 {ev.text}</div>
              if (ev.kind === 'turn-done') return <div key={ev.id} style={{ color: '#374151', margin: '8px 0' }}>─── turn done ───</div>
              if (ev.kind === 'system') return <div key={ev.id} style={{ color: '#9ca3af', margin: '6px 0', fontStyle: 'italic' }}>{ev.text}</div>
              return null
            })}
          </div>

          {/* Composer */}
          <div style={{ borderTop: '1px solid #1f232e', padding: 10, flexShrink: 0 }}>
            {selectedRun.status === 'awaiting-confirm' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button onClick={() => setConfirming(true)} style={{ background: '#1a3a2f', border: '1px solid #22c55e', color: '#4ade80', padding: '6px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ 确认继续</button>
                <button style={{ background: '#3a2e1a', border: '1px solid #f59e0b', color: '#fbbf24', padding: '6px 14px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>↻ 重跑此步</button>
                <button style={{ background: 'transparent', border: '1px solid #1f232e', color: '#9ca3af', padding: '6px 14px', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>⏭ 跳过下一步</button>
                <button style={{ background: '#3a1a1a', border: '1px solid #ef4444', color: '#f87171', padding: '6px 14px', borderRadius: 5, fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}>✕ 停止</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder={selectedRun.status === 'awaiting-input' ? '回复 agent...' : '发送消息 / 指令...'}
                style={{ flex: 1, background: '#151921', border: '1px solid #1f232e', color: '#e2e4e9', padding: '8px 10px', borderRadius: 5, fontSize: 12, outline: 'none' }}
              />
              <button style={{ background: '#2563eb', border: 'none', color: '#fff', padding: '8px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>➤</button>
            </div>
          </div>
        </div>

        {/* Right: Detail + Artifacts */}
        <div style={{ width: 280, borderLeft: '1px solid #1f232e', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f232e' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 10 }}>Step Detail</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#6b7280' }}>Status</span>
                <span style={{ color: STATUS_STYLES[selectedRun.status].text, fontWeight: 600 }}>{STATUS_STYLES[selectedRun.status].label}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#6b7280' }}>Model</span>
                <span style={{ color: '#e2e4e9', fontFamily: 'monospace' }}>{selectedRun.model}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: '#6b7280' }}>Budget</span>
                <span style={{ color: selectedRun.cost > selectedRun.budget * 0.8 ? '#f87171' : '#e2e4e9' }}>${selectedRun.cost} / ${selectedRun.budget}</span>
              </div>
            </div>
          </div>

          <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f232e', flex: 1, overflow: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 10 }}>Artifacts</div>
            {MOCK_ARTIFACTS.map((art) => (
              <div key={art.path} style={{ padding: '8px', background: '#151921', border: '1px solid #1f232e', borderRadius: 5, marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e4e9', marginBottom: 2 }}>{art.path}</div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>{art.desc}</div>
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#1f232e', color: '#9ca3af', textTransform: 'uppercase' }}>{art.type}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', marginBottom: 8 }}>Memory</div>
            <div style={{ fontSize: 10, color: '#6b7280', padding: '6px 8px', background: '#151921', borderRadius: 4, borderLeft: '2px solid #a78bfa' }}>
              已注入 3 条记忆: auth-pattern, rbac-rules, error-handling
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
