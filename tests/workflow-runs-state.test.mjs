import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')
const store = readFileSync(join(root, 'src/main/WorkflowStore.ts'), 'utf8')
const manager = readFileSync(join(root, 'src/main/WorkflowManager.ts'), 'utf8')
const ipc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')

test('shared workflow contract supports multiple persisted runs', () => {
  assert.match(types, /interrupted/)
  assert.match(types, /runName\?: string/)
  assert.match(types, /WorkflowRunGitSafety/)
  assert.match(types, /workflowRunsList: 'workflow:runs:list'/)
  assert.match(types, /workflowDeleteRun: 'workflow:runs:delete'/)
  assert.match(types, /workflowGitSafety: 'workflow:git-safety'/)
})

test('workflow store keeps permanent history and can delete one run', () => {
  assert.doesNotMatch(store, /slice\(0,\s*20\)/)
  assert.match(store, /deleteRun\(id: string\)/)
})

test('workflow manager marks restored running runs as interrupted', () => {
  assert.match(manager, /markInterruptedRunsOnStartup/)
  assert.match(manager, /status === 'running'/)
  assert.match(manager, /status = 'interrupted'/)
})

test('ipc and preload expose workflow run list, delete, and git safety', () => {
  assert.match(ipc, /IPC\.workflowRunsList/)
  assert.match(ipc, /workflowManager\.listRuns/)
  assert.match(ipc, /IPC\.workflowDeleteRun/)
  assert.match(ipc, /workflowManager\.deleteRun/)
  assert.match(ipc, /IPC\.workflowGitSafety/)
  assert.match(preload, /listWorkflowRuns/)
  assert.match(preload, /deleteWorkflowRun/)
  assert.match(preload, /inspectWorkflowGitSafety/)
})
