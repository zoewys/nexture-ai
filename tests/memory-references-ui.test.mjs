import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')
const ipc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
const useRun = readFileSync(join(root, 'src/renderer/src/useRun.ts'), 'utf8')
const singleRun = readFileSync(join(root, 'src/renderer/src/SingleRunPanel.tsx'), 'utf8')
const workflowDetail = readFileSync(join(root, 'src/renderer/src/WorkflowRunDetail.tsx'), 'utf8')
const references = readFileSync(join(root, 'src/renderer/src/MemoryReferences.tsx'), 'utf8')
const styles = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')

test('single run contract carries agent id and returned injected memory ids', () => {
  assert.match(types, /agentId\?: string/)
  assert.match(types, /export interface RunStartResult \{[\s\S]*runId: string[\s\S]*injectedMemoryIds\?: string\[\]/)
})

test('run:start injects memory context for selected single run agents', () => {
  assert.match(ipc, /withSingleRunMemoryContext\(config, memoryInjector\)/)
  assert.match(ipc, /memoryInjector\.build\(config\.agentId, config\.cwd\)/)
  assert.match(ipc, /prompt: `\$\{text\}\\n\$\{config\.prompt\}`/)
  assert.match(ipc, /runManager\.start\(launchConfig, emit\)/)
  assert.match(ipc, /transcriptStore\.recordUserInput\(runId, launchConfig\.prompt\)/)
  assert.match(ipc, /return \{ runId, injectedMemoryIds \}/)
})

test('useRun stores and dedupes single run memory references across turns', () => {
  assert.match(useRun, /agentId: string \| null/)
  assert.match(useRun, /projectPath: string \| null/)
  assert.match(useRun, /injectedMemoryIds: string\[\]/)
  assert.match(useRun, /agentId: config\.agentId \?\? null/)
  assert.match(useRun, /projectPath: config\.cwd/)
  assert.match(useRun, /mergeMemoryIds\(prev\.injectedMemoryIds, injectedMemoryIds\)/)
  assert.match(useRun, /function mergeMemoryIds/)
})

test('single and workflow surfaces render the shared MemoryReferences component', () => {
  assert.match(singleRun, /import \{ MemoryReferences \}/)
  assert.match(singleRun, /agentId: selectedAgent\?\.id/)
  assert.match(singleRun, /<MemoryReferences[\s\S]*agentId=\{selectedAgentId\}[\s\S]*projectPath=\{cwd\}[\s\S]*memoryIds=\{selectedSession\?\.injectedMemoryIds\}/)

  assert.match(workflowDetail, /import \{ MemoryReferences \}/)
  assert.match(workflowDetail, /<MemoryReferences[\s\S]*agentId=\{selectedExecution\?\.agentId\}[\s\S]*projectPath=\{run\.projectPath\}[\s\S]*memoryIds=\{selectedExecution\?\.injectedMemoryIds\}/)
})

test('MemoryReferences supports collapsed summary, detail view, and missing memory fallback', () => {
  assert.match(references, /<details className="memory-references">/)
  assert.match(references, /\{uniqueIds\.length\} 条记忆引用/)
  assert.match(references, /按强度、类别权重和预算自动注入/)
  assert.match(references, /window\.api\.memoryList\(agentId, projectPath \?\? undefined\)/)
  assert.match(references, /dedupe\(memoryIds\)/)
  assert.match(references, /记忆已删除或不可用/)
  assert.match(references, /MemoryReferenceDetail/)
  assert.match(references, /injectionReason\(memory\)/)
  assert.match(references, /CATEGORY_WEIGHT/)
  assert.match(references, /memory\.evidence/)
  assert.match(references, /memory\.lastReinforcedAt/)
  assert.match(references, /memory\.reinforceCount/)
})

test('memory reference styles are defined for compact transcript display', () => {
  assert.match(styles, /\.memory-references\s*\{/)
  assert.match(styles, /\.memory-references-summary\s*\{/)
  assert.match(styles, /\.memory-references-rule/)
  assert.match(styles, /\.memory-reference-main/)
  assert.match(styles, /\.memory-reference-copy/)
  assert.match(styles, /\.memory-reference-meta/)
  assert.match(styles, /\.memory-reference-detail/)
  assert.match(styles, /\.memory-reference-missing/)
  assert.match(styles, /-webkit-line-clamp:\s*2/)
})
