import type { MemoryCategory, MemoryEntry } from '@shared/types'
import type { MemoryStore } from './MemoryStore'
import { computeStrength } from './forgettingCurve'

type MemoryInjectorStore = Pick<MemoryStore, 'list'>

const MIN_STRENGTH = 0.3
const CATEGORY_WEIGHT: Record<MemoryCategory, number> = {
  avoidance: 1.2,
  preference: 1.1,
  method: 1,
  knowledge: 0.9
}
const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  avoidance: '⚠️ 避免',
  preference: '✓ 偏好',
  method: '→ 方法',
  knowledge: '📌 知识'
}

interface ScoredMemory {
  entry: MemoryEntry
  strength: number
  score: number
}

export interface MemoryInjection {
  text: string
  injectedMemoryIds: string[]
}

export class MemoryInjector {
  constructor(private readonly memoryStore: MemoryInjectorStore) {}

  build(agentId: string, projectPath: string, tokenBudget = 1500): MemoryInjection {
    const scored = this.memoryStore
      .list(agentId, projectPath)
      .map(scoreMemory)
      .filter((item) => item.strength >= MIN_STRENGTH)
      .sort(compareScoredMemories)

    const selected: MemoryEntry[] = []
    for (const item of scored) {
      const next = [...selected, item.entry]
      if (estimateTokens(formatMemoryText(next)) > tokenBudget) continue
      selected.push(item.entry)
    }

    if (selected.length === 0) return { text: '', injectedMemoryIds: [] }
    return {
      text: formatMemoryText(selected),
      injectedMemoryIds: selected.map((entry) => entry.id)
    }
  }
}

function scoreMemory(entry: MemoryEntry): ScoredMemory {
  const strength = computeStrength(entry)
  return {
    entry,
    strength,
    score: strength * CATEGORY_WEIGHT[entry.category]
  }
}

function compareScoredMemories(a: ScoredMemory, b: ScoredMemory): number {
  if (b.score !== a.score) return b.score - a.score
  return b.entry.lastReinforcedAt - a.entry.lastReinforcedAt
}

function formatMemoryText(memories: MemoryEntry[]): string {
  if (memories.length === 0) return ''
  return [
    '# 你的积累经验',
    ...memories.map((memory) => `${CATEGORY_LABEL[memory.category]}：${memory.content}`),
    '',
    '请参考以上经验，但根据当前具体情况灵活应用。',
    ''
  ].join('\n')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}
