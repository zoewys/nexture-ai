/**
 * Interactive workflow step tests.
 *
 * The Electron app is expensive to instantiate in node:test, so these tests
 * follow the repository's existing source-contract style for orchestration and
 * renderer integration points.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const types = source('src/shared/types.ts')
const manager = source('src/main/WorkflowManager.ts')
const runManager = source('src/main/RunManager.ts')
const adapterTypes = source('src/main/adapters/types.ts')
const claudeAdapter = source('src/main/adapters/claudeAdapter.ts')
const ipc = source('src/main/ipc.ts')
const preload = source('src/preload/index.ts')
const useWorkflows = source('src/renderer/src/useWorkflows.ts')
const labels = source('src/renderer/src/workflowLabels.ts')
const runView = source('src/renderer/src/workflowRunView.ts')
const runsList = source('src/renderer/src/WorkflowRunsList.tsx')
const canvas = source('src/renderer/src/canvas/WorkflowCanvas.tsx')
const serializer = source('src/renderer/src/canvas/canvasSerializer.ts')
const workspace = source('src/renderer/src/WorkflowWorkspace.tsx')
const detail = source('src/renderer/src/WorkflowRunDetail.tsx')
const styles = source('src/renderer/src/styles.css')

test('shared contract exposes interactive steps, failure strategies, and IPC channel', () => {
  assert.match(types, /export type FailureStrategyType = 'stop' \| 'retry-then-notify' \| 'retry-then-goto'/)
  assert.match(types, /export interface FailureStrategy/)
  assert.match(types, /maxRetries\?: number/)
  assert.match(types, /gotoTarget\?: number/)
  assert.match(types, /interactive\?: boolean/)
  assert.match(types, /failureStrategy\?: FailureStrategy/)
  assert.match(types, /\| 'awaiting-input'[\s\S]*\| 'awaiting-confirm'/)
  assert.match(types, /workflowFinishInteractive: 'workflow:finish-interactive'/)
})

test('interactive manager flow enters awaiting-input, resumes, and can finish manually', () => {
  assert.match(manager, /const INTERACTIVE_HINT = \[/)
  assert.match(manager, /# Interaction mode/)
  assert.match(manager, /keepStdinOpenAfterTurnDone: templateStep\?\.interactive === true/)
  assert.match(manager, /private enterAwaitingInput/)
  assert.match(manager, /execution\.status = 'awaiting-input'/)
  assert.match(manager, /step\.status = 'awaiting-input'/)
  assert.match(manager, /run\.status = 'awaiting-input'/)
  assert.match(manager, /finishInteractiveStep\(runId: string, stepIndex: number\): WorkflowRun/)
  assert.match(manager, /this\.extractConversationSummary\(execution\.events\)/)
  assert.match(manager, /step\.status === 'awaiting-input'/)
  assert.match(manager, /execution\.status = 'running'/)
  assert.match(manager, /!this\.runManager\.hasLiveRun\(live\.childRunId\)/)
  assert.match(manager, /this\.removeLiveStep\(run\.id, live\.executionId\)/)
  assert.match(manager, /await this\.runManager\.push\(live\.childRunId, clean\)/)
  assert.match(manager, /this\.completeLiveStep\(run\.id, execution\.id, true\)/)
})

test('failureStrategy retries after rules and can jump after retries are exhausted', () => {
  assert.match(manager, /const rule = this\.evaluateRules\(run, stepIndex, trigger\)/)
  assert.match(manager, /const strategy = templateStep\?\.failureStrategy/)
  assert.match(manager, /strategy\.type !== 'stop'/)
  assert.match(manager, /strategy\.maxRetries \?\? 3/)
  assert.match(manager, /strategy\.type === 'retry-then-goto'/)
  assert.match(manager, /strategy\.gotoTarget !== undefined/)
  assert.match(manager, /markDownstreamStale\(run, strategy\.gotoTarget\)/)
  assert.match(manager, /this\.startNextNode\(run\.id, strategy\.gotoTarget\)/)
})

test('RunManager and Claude adapter can keep stdin open for interactive turns', () => {
  assert.match(types, /keepStdinOpenAfterTurnDone\?: boolean/)
  assert.match(adapterTypes, /keepStdinOpenAfterTurnDone\?: boolean/)
  assert.match(runManager, /keepStdinOpenAfterTurnDone: config\.keepStdinOpenAfterTurnDone/)
  assert.match(runManager, /closeInput\(id: string\): void/)
  assert.match(claudeAdapter, /if \(ev\.kind === 'turn-done' && !input\.keepStdinOpenAfterTurnDone\) handle\.endStdin\(\)/)
  assert.match(claudeAdapter, /closeInput\(\): void/)
})

test('IPC, preload, and useWorkflows expose finishInteractiveStep', () => {
  assert.match(ipc, /IPC\.workflowFinishInteractive/)
  assert.match(ipc, /workflowManager\.finishInteractiveStep\(runId, stepIndex\)/)
  assert.match(preload, /finishInteractiveStep: \(runId: string, stepIndex: number\)/)
  assert.match(preload, /IPC\.workflowFinishInteractive/)
  assert.match(useWorkflows, /finishInteractiveStep/)
  assert.match(useWorkflows, /window\.api\.finishInteractiveStep\(selectedRun\.id, stepIndex\)/)
})

test('canvas preserves interactive and failureStrategy settings', () => {
  assert.match(serializer, /interactive\?: boolean/)
  assert.match(serializer, /failureStrategy\?: FailureStrategy/)
  assert.match(serializer, /interactive: member\.interactive/)
  assert.match(serializer, /failureStrategy: member\.failureStrategy/)
  assert.match(serializer, /interactive: single\.interactive/)
  assert.match(serializer, /failureStrategy: single\.failureStrategy/)
  assert.match(serializer, /if \(d\?\.interactive\) step\.interactive = true/)
  assert.match(serializer, /if \(d\?\.failureStrategy\) step\.failureStrategy = d\.failureStrategy/)
  assert.match(canvas, /允许步骤内对话/)
  assert.match(canvas, /失败策略/)
  assert.match(canvas, /retry-then-notify/)
  assert.match(canvas, /retry-then-goto/)
  assert.match(canvas, /gotoTarget/)
})

test('renderer shows awaiting-input status and enables replies', () => {
  assert.match(labels, /case 'awaiting-input':\s*return '等待回复'/)
  assert.match(runView, /case 'awaiting-input':\s*return 'awaiting-input'/)
  assert.match(runView, /run\.status === 'awaiting-input'/)
  assert.match(runsList, /'awaiting-input'/)
  assert.match(runsList, /case 'awaiting-input': return '待回复'/)
  assert.match(workspace, /selectedExecution\?\.status === 'awaiting-input'/)
  assert.match(workspace, /return '回复 Agent\.\.\.'/)
  assert.match(detail, /workflow-awaiting-input-bar/)
  assert.match(detail, /Agent 正在等待你的回复/)
  assert.match(detail, /结束对话，进入下一步/)
  assert.match(detail, /onFinishInteractiveStep\(selectedStepIndex\)/)
  assert.match(styles, /\.workflow-step-chip-awaiting-input/)
  assert.match(styles, /\.workflow-run-status-awaiting-input/)
  assert.match(styles, /\.workflow-awaiting-input-bar/)
  assert.match(styles, /\.workflow-run-card-segment-awaiting-input/)
})
