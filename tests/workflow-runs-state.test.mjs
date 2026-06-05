import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')

test('shared workflow contract supports multiple persisted runs', () => {
  assert.match(types, /interrupted/)
  assert.match(types, /runName\?: string/)
  assert.match(types, /WorkflowRunGitSafety/)
  assert.match(types, /workflowRunsList: 'workflow:runs:list'/)
  assert.match(types, /workflowDeleteRun: 'workflow:runs:delete'/)
  assert.match(types, /workflowGitSafety: 'workflow:git-safety'/)
})

const store = readFileSync(join(root, 'src/main/WorkflowStore.ts'), 'utf8')
const manager = readFileSync(join(root, 'src/main/WorkflowManager.ts'), 'utf8')

test('workflow store keeps permanent history and can delete one run', () => {
  assert.doesNotMatch(store, /slice\(0,\s*20\)/)
  assert.match(store, /deleteRun\(id: string\)/)
})

test('workflow manager marks restored running runs as interrupted', () => {
  assert.match(manager, /markInterruptedRunsOnStartup/)
  assert.match(manager, /status === 'running'/)
  assert.match(manager, /status: 'interrupted'/)
})
