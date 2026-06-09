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
  assert.match(panel, /<details className="agent-memory-panel">/)
  assert.match(panel, /记忆 \(\{globalCount\} 条全局 \+ \{projectCount\} 条项目\)/)
  assert.match(panel, /项目: \{shortProjectName\(group\.path\)\}/)
  assert.match(panel, /computeStrength\(memory\)/)
  assert.match(panel, /strength \{strength\.toFixed\(2\)\}/)
  assert.match(panel, /onDelete=\{\(\) => void remove\(memory\.id\)\}/)
  assert.match(panel, /暂无记忆/)
})

test('agent memory styles keep the panel compact inside the editor', () => {
  assert.match(styles, /\.agent-memory-panel/)
  assert.match(styles, /\.agent-memory-tabs/)
  assert.match(styles, /\.agent-memory-tab-active/)
  assert.match(styles, /\.agent-memory-item/)
  assert.match(styles, /\.agent-memory-empty/)
})

test('memory list without project path returns all memories for the agent', () => {
  assert.match(memoryStore, /if \(!projectPath\) return this\.listAll\(agentId\)/)
})
