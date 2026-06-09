import { useEffect, useMemo, useState } from 'react'
import type { MemoryCategory, MemoryEntry } from '@shared/types'
import { useAgentMemories } from './useAgentMemories'

interface AgentMemoryPanelProps {
  agentId: string | null
}

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  avoidance: '⚠️ 避免',
  preference: '✓ 偏好',
  method: '→ 方法',
  knowledge: '📌 知识'
}

export function AgentMemoryPanel({ agentId }: AgentMemoryPanelProps): JSX.Element | null {
  const { global, byProject, meta, remove } = useAgentMemories(agentId)
  const projectGroups = useMemo(() => [...byProject.values()], [byProject])
  const [selectedKey, setSelectedKey] = useState('global')

  useEffect(() => {
    setSelectedKey('global')
  }, [agentId])

  if (!agentId) return null

  const currentProject = selectedKey.startsWith('project:')
    ? projectGroups.find((group) => `project:${group.path}` === selectedKey)
    : null
  const activeMemories = selectedKey === 'global'
    ? global
    : currentProject?.memories ?? []
  const globalCount = global.length
  const projectCount = projectGroups.reduce((sum, group) => sum + group.memories.length, 0)

  return (
    <details className="agent-memory-panel">
      <summary className="agent-memory-summary">
        <span>记忆 ({globalCount} 条全局 + {projectCount} 条项目)</span>
        {meta ? <span className="agent-memory-meta">{meta.totalRuns} runs · {meta.totalMemories} total</span> : null}
      </summary>

      <div className="agent-memory-tabs" role="tablist" aria-label="Agent memories">
        <button
          type="button"
          className={selectedKey === 'global' ? 'agent-memory-tab agent-memory-tab-active' : 'agent-memory-tab'}
          onClick={() => setSelectedKey('global')}
        >
          全局
        </button>
        {projectGroups.map((group) => {
          const key = `project:${group.path}`
          return (
            <button
              key={key}
              type="button"
              className={selectedKey === key ? 'agent-memory-tab agent-memory-tab-active' : 'agent-memory-tab'}
              onClick={() => setSelectedKey(key)}
              title={group.path}
            >
              项目: {shortProjectName(group.path)}
            </button>
          )
        })}
      </div>

      <div className="agent-memory-list">
        {activeMemories.length === 0 ? (
          <div className="agent-memory-empty">暂无记忆</div>
        ) : (
          activeMemories.map((memory) => (
            <MemoryItem key={memory.id} memory={memory} onDelete={() => void remove(memory.id)} />
          ))
        )}
      </div>
    </details>
  )
}

function MemoryItem({ memory, onDelete }: { memory: MemoryEntry; onDelete: () => void }): JSX.Element {
  const strength = computeStrength(memory)
  return (
    <article className="agent-memory-item">
      <div className="agent-memory-item-head">
        <span>{CATEGORY_LABEL[memory.category]}</span>
        <span>strength {strength.toFixed(2)}</span>
        <span>强化 {memory.reinforceCount}次</span>
      </div>
      <p>{memory.content}</p>
      <div className="agent-memory-item-foot">
        <span>来源: {memory.evidence || 'unknown'} · {relativeTime(memory.createdAt)}</span>
        <button type="button" className="danger" onClick={onDelete}>
          删除
        </button>
      </div>
    </article>
  )
}

function computeStrength(entry: MemoryEntry, now = Date.now()): number {
  const dayMs = 1000 * 60 * 60 * 24
  const days = Math.max(0, (now - entry.lastReinforcedAt) / dayMs)
  const stability = 1 + entry.reinforceCount * 0.5
  const decay = Math.exp(-days / (stability * 7))
  return Math.max(0, Math.min(1, entry.strength * decay))
}

function relativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  const days = Math.floor(diffMs / day)
  if (days < 7) return `${days} 天前`
  return `${Math.floor(days / 7)} 周前`
}

function shortProjectName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
