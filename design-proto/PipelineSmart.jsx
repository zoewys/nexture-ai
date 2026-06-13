// 方向 B：智能流水线 Smart Pipeline
// 流程感强、步骤管道可视化、GitHub Actions 风格、操作突出

import React, { useState, useMemo } from 'react'

const MOCK_RUNS = [
  { id: 'r1', name: '需求分析 → 设计 → 开发', status: 'awaiting-confirm', step: 2, totalSteps: 5, project: '~/projects/acme-web', cost: 0.0042, budget: 0.1, model: 'claude-sonnet-4-6', time: '2m ago' },
  { id: 'r2', name: '后端 API 重构', status: 'running', step: 1, totalSteps: 3, project: '~/projects/api-v2', cost: 0.0018, budget: 0.05, model: 'deepseek-chat', time: '5m ago' },
  { id: 'r3', name: '定时数据清洗', status: 'completed', step: 4, totalSteps: 4, project: '~/projects/etl', cost: 0.012, budget: 0.02, model: 'codex', time: '1h ago' },
  { id: 'r4', name: '移动端适配 review', status: 'error', step: 2, totalSteps: 3, project: '~/projects/mobile', cost: 0.003, budget: 0.05, model: 'kimi-k2.5', time: '3h ago' },
]

const MOCK_STEPS = [
  { id: 's1', name: '需求分析', status: 'done', agent: 'Product Manager', time: '1m' },
  { id: 's2', name: '技术设计', status: 'awaiting-confirm', agent: 'Architect', time: '2m' },
  { id: 's3', name: '后端开发', status: 'pending', agent: 'Backend Dev', time: '' },
  { id: 's4', name: '前端开发', status: 'pending', agent: 'Frontend Dev', time: '' },
  { id: 's5', name: '测试验收', status: 'pending', agent: 'QA', time: '' },
]

const MOCK_EVENTS = [
  { kind: 'user', id: 'e1', text: '需要为 acme-web 添加 RBAC 鉴权' },
  { kind: 'assistant', id: 'e2', text: '已分析现有鉴权逻辑，建议引入 RBAC。\n\n请确认以下范围：\n1. 是否支持 OAuth2\n2. 角色粒度到菜单还是按钮' },
  { kind: 'handoff', id: 'e3', summary: '产出鉴权设计文档和修改后的入口文件', artifacts: 2 },
  { kind: 'usage', id: 'e4', tokens: '2,400 → 890', cost: '$0.0042' },
]

const MOCK_ARTIFACTS = [
  { path: 'design/auth-rbac.md', type: 'doc', preview: '# RBAC 设计\n\n## 角色定义\n- admin: ...' },
  { path: 'src/auth.ts', type: 'code', preview: 'export function checkPermission(...) {' },
]

const STATUS_META = {
  running: { color: '#22c55e', bg: '#dcfce7', label: '运行中' },
  'awaiting-confirm': { color: '#f59e0b', bg: '#fef3c7', label: '待确认' },
  'awaiting-input': { color: '#3b82f6', bg: '#dbeafe', label: '待输入' },
  completed: { color: '#22c55e', bg: '#dcfce7', label: '已完成' },
  error: { color: '#ef4444', bg: '#fee2e2', label: '错误' },
  interrupted: { color: '#6b7280', bg: '#f3f4f6', label: '中断' },
}

const STEP_STATUS = {
  done: { color: '#22c55e', icon: '✓' },
  running: { color: '#3b82f6', icon: '◐' },
  'awaiting-confirm': { color: '#f59e0b', icon: '◑' },
  'awaiting-input': { color: '#3b82f6', icon: '◒' },
  pending: { color: '#d1d5db', icon: '○' },
  error: { color: '#ef4444', icon: '✕' },
  stale: { color: '#9ca3af', icon: '⟳' },
}

export default function PipelineSmart() {
  const [selectedRunId, setSelectedRunId] = useState('r1')
  const [selectedArtifact, setSelectedArtifact] = useState(0)
  const [composerText, setComposerText] = useState('')

  const selectedRun = useMemo(() => MOCK_RUNS.find((r) => r.id === selectedRunId) || MOCK_RUNS[0], [selectedRunId])
  const meta = STATUS_META[selectedRun.status]

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#ffffff', color: '#111827', fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 14 }}>
      {/* Top Nav */}
      <div style={{ height: 48, borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 20, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Agent Studio</div>
        <div style={{ display: 'flex', gap: 16, color: '#6b7280', fontSize: 13 }}>
          <span style={{ color: '#111827', fontWeight: 600, cursor: 'pointer' }}>Workflow</span>
          <span style={{ cursor: 'pointer' }}>Templates</span>
          <span style={{ cursor: 'pointer' }}>Agents</span>
          <span style={{ cursor: 'pointer' }}>Single</span>
          <span style={{ cursor: 'pointer' }}>Settings</span>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar */}
        <div style={{ width: 240, borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Runs</span>
            <button style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ New Run</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {MOCK_RUNS.map((run) => {
              const active = run.id === selectedRunId
              const st = STATUS_META[run.status]
              return (
                <div
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    marginBottom: 6,
                    cursor: 'pointer',
                    background: active ? '#f3f4f6' : 'transparent',
                    border: active ? '1px solid #d1d5db' : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{run.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: st.bg, color: st.color, fontWeight: 600 }}>{st.label}</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{run.time}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Center */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Pipeline Steps */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {MOCK_STEPS.map((step, idx) => {
                const st = STEP_STATUS[step.status]
                return (
                  <React.Fragment key={step.id}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 90 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: step.status === 'pending' ? '#f3f4f6' : st.bg || '#fff',
                        border: `2px solid ${st.color}`,
                        color: st.color, fontWeight: 700, fontSize: 13
                      }}>
                        {st.icon}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', textAlign: 'center' }}>{step.name}</div>
                      <div style={{ fontSize: 10, color: '#9ca3af' }}>{step.agent}</div>
                    </div>
                    {idx < MOCK_STEPS.length - 1 && (
                      <div style={{ width: 24, height: 2, background: step.status === 'done' ? '#22c55e' : '#e5e7eb', marginTop: -16 }} />
                    )}
                  </React.Fragment>
                )
              })}
            </div>
          </div>

          {/* Transcript */}
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {MOCK_EVENTS.map((ev) => {
              if (ev.kind === 'user') return (
                <div key={ev.id} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <div style={{ maxWidth: '70%', padding: '12px 16px', background: '#111827', color: '#fff', borderRadius: '16px 16px 4px 16px', fontSize: 13, lineHeight: 1.5 }}>{ev.text}</div>
                </div>
              )
              if (ev.kind === 'assistant') return (
                <div key={ev.id} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 12, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🤖</div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Architect</span>
                  </div>
                  <div style={{ padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '4px 16px 16px 16px', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ev.text}</div>
                </div>
              )
              if (ev.kind === 'handoff') return (
                <div key={ev.id} style={{ margin: '16px 0', padding: '14px 16px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>📋 Handoff: {ev.summary}</div>
                  <div style={{ fontSize: 11, color: '#b45309' }}>{ev.artifacts} 个产物待查看 →</div>
                </div>
              )
              if (ev.kind === 'usage') return (
                <div key={ev.id} style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', padding: '4px 12px', background: '#f3f4f6', borderRadius: 12 }}>{ev.tokens} · {ev.cost}</span>
                </div>
              )
              return null
            })}
          </div>

          {/* Floating Action Bar for confirm */}
          {selectedRun.status === 'awaiting-confirm' && (
            <div style={{ position: 'sticky', bottom: 0, padding: '12px 20px', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 10 }}>
              <button style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>确认继续</button>
              <button style={{ background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>重跑此步</button>
              <button style={{ background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>跳至下一步</button>
              <button style={{ marginLeft: 'auto', background: '#fff', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>停止</button>
            </div>
          )}

          {/* Composer */}
          {selectedRun.status !== 'awaiting-confirm' && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  placeholder="发送消息..."
                  style={{ flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, outline: 'none' }}
                />
                <button style={{ background: '#111827', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>发送</button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Artifacts + Budget */}
        <div style={{ width: 300, borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 12 }}>Artifacts</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MOCK_ARTIFACTS.map((art, i) => (
                <div
                  key={art.path}
                  onClick={() => setSelectedArtifact(i)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: selectedArtifact === i ? '1px solid #3b82f6' : '1px solid #e5e7eb',
                    background: selectedArtifact === i ? '#eff6ff' : '#fff',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{art.path}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{art.type}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 12 }}>Preview</div>
            <div style={{ padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {MOCK_ARTIFACTS[selectedArtifact].preview}
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: '#6b7280' }}>Budget</span>
              <span style={{ fontWeight: 600 }}>${selectedRun.cost} / ${selectedRun.budget}</span>
            </div>
            <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(selectedRun.cost / selectedRun.budget) * 100}%`, height: '100%', background: selectedRun.cost > selectedRun.budget * 0.8 ? '#ef4444' : '#22c55e', borderRadius: 3 }} />
            </div>
            {selectedRun.cost > selectedRun.budget * 0.8 && (
              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6, fontWeight: 600 }}>⚠️ 预算即将耗尽</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
