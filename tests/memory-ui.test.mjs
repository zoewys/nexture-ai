import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const agentManager = readFileSync(join(root, 'src/renderer/src/AgentManager.tsx'), 'utf8')
const panel = readFileSync(join(root, 'src/renderer/src/AgentMemoryPanel.tsx'), 'utf8')
const hook = readFileSync(join(root, 'src/renderer/src/useAgentMemories.ts'), 'utf8')
const styles = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')
const memoryStore = readFileSync(join(root, 'src/main/memory/MemoryStore.ts'), 'utf8')

function lastRootBlock(selector) {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g')
  const matches = [...styles.matchAll(pattern)]
  return matches.at(-1)?.[1] ?? ''
}

test('agent editor renders memory panel for the selected agent', () => {
  assert.match(agentManager, /import \{ AgentMemoryPanel \}/)
  assert.match(agentManager, /<AgentMemoryPanel agentId=\{editingId\} \/>/)
})

test('useAgentMemories loads, groups, refreshes, and deletes memories', () => {
  assert.match(hook, /window\.api\.memoryList\(agentId\)/)
  assert.match(hook, /window\.api\.memoryMeta\(agentId\)/)
  assert.match(hook, /window\.api\.memoryDelete\(memoryId\)/)
  assert.match(hook, /byProject: Map<string, ProjectMemoryGroup>/)
  assert.match(hook, /entry\.scope !== 'project'/)
  assert.match(hook, /entry\.projectPath \?\? entry\.projectHash/)
})

test('agent memory panel supports global and project tabs, strength, and deletion', () => {
  assert.match(panel, /import \{ ChevronRight \} from 'lucide-react'/)
  assert.match(panel, /<details className="agent-memory-panel">/)
  assert.match(panel, /className="agent-memory-chevron"/)
  assert.match(panel, /记忆 \(\{globalCount\} 条全局 \+ \{projectCount\} 条项目\)/)
  assert.match(panel, /项目: \{shortProjectName\(group\.path\)\}/)
  assert.match(panel, /computeStrength\(memory\)/)
  assert.match(panel, /strength \{strength\.toFixed\(2\)\}/)
  assert.match(panel, /onDelete=\{\(\) => void remove\(memory\.id\)\}/)
  assert.match(panel, /暂无记忆/)
})

test('agent memory styles keep the panel compact inside the editor', () => {
  assert.match(styles, /\.agent-editor\b/)
  assert.match(styles, /Agent memory panel light-theme QA overrides/)
  assert.match(styles, /\.agent-editor \.agent-memory-panel\s*\{[\s\S]*background:\s*rgba\(255, 255, 255, 0\.66\) !important;/)
  assert.match(styles, /\.agent-editor \.agent-memory-summary::before\s*\{[\s\S]*content:\s*none !important;/)
  assert.match(styles, /\.agent-editor \.agent-memory-chevron\s*\{[\s\S]*color:\s*var\(--brand-primary\) !important;/)
  assert.match(styles, /\.agent-editor \.agent-memory-empty\s*\{[\s\S]*background:\s*rgba\(255, 255, 255, 0\.52\) !important;/)
  assert.match(styles, /\.agent-memory-panel/)
  assert.match(styles, /\.agent-memory-tabs/)
  assert.match(styles, /\.agent-memory-tab-active/)
  assert.match(styles, /\.agent-memory-item/)
  assert.match(styles, /\.agent-memory-empty/)
})

test('agent memory panel matches the green light card treatment', () => {
  const panelBlock = lastRootBlock('.agent-memory-panel')
  const summaryBlock = lastRootBlock('.agent-memory-summary')
  const metaBlock = lastRootBlock('.agent-memory-meta')
  const tabsBlock = lastRootBlock('.agent-memory-tabs')
  const emptyBlock = lastRootBlock('.agent-memory-empty')

  assert.match(panelBlock, /background:\s*rgba\(255, 255, 255, 0\.62\) !important;/)
  assert.match(panelBlock, /border:\s*1px solid var\(--neutral-border\) !important;/)
  assert.match(panelBlock, /box-shadow:\s*none !important;/)
  assert.match(panelBlock, /outline:\s*none !important;/)
  assert.match(summaryBlock, /color:\s*var\(--neutral-ink\) !important;/)
  assert.match(summaryBlock, /min-height:\s*48px !important;/)
  assert.match(metaBlock, /color:\s*var\(--neutral-muted\) !important;/)
  assert.match(tabsBlock, /background:\s*rgba\(255, 255, 255, 0\.36\) !important;/)
  assert.match(emptyBlock, /color:\s*var\(--neutral-muted\) !important;/)
  assert.match(styles, /\.agent-memory-panel:focus,\s*\n\.agent-memory-panel:focus-visible\s*\{[\s\S]*outline:\s*none !important;/)
  assert.match(styles, /\.agent-memory-summary:focus-visible\s*\{[\s\S]*outline:\s*2px solid rgba\(61, 142, 134, 0\.45\) !important;/)
})

test('memory list without project path returns all memories for the agent', () => {
  assert.match(memoryStore, /if \(!projectPath\) return this\.listAll\(agentId\)/)
})
