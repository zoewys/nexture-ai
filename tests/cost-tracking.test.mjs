/**
 * Cost / Token Tracking Tests
 *
 * Source-assertion tests verifying the cost tracking implementation.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')
const workflowManager = readFileSync(join(root, 'src/main/WorkflowManager.ts'), 'utf8')
const runDetail = readFileSync(join(root, 'src/renderer/src/WorkflowRunDetail.tsx'), 'utf8')
const templatesView = readFileSync(join(root, 'src/renderer/src/TemplatesView.tsx'), 'utf8')
const styles = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')
const ipc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')

// ── Types ──────────────────────────────────────────────────────────────────

test('WorkflowStepExecution includes cost tracking fields', () => {
  assert.match(types, /totalInputTokens: number/)
  assert.match(types, /totalOutputTokens: number/)
  assert.match(types, /totalCostUsd: number/)
})

test('WorkflowRun includes aggregated cost fields and optional budget cap', () => {
  assert.match(types, /totalInputTokens: number/)
  assert.match(types, /totalOutputTokens: number/)
  assert.match(types, /totalCostUsd: number/)
  assert.match(types, /budgetUsd\?: number/)
})

test('WorkflowTemplate includes optional budget cap', () => {
  assert.match(types, /budgetUsd\?: number/)
})

// ── WorkflowManager ────────────────────────────────────────────────────────

test('handleAgentEvent accumulates usage events into execution totals', () => {
  assert.match(workflowManager, /execution\.totalInputTokens \+= event\.inputTokens/)
  assert.match(workflowManager, /execution\.totalOutputTokens \+= event\.outputTokens/)
  assert.match(workflowManager, /execution\.totalCostUsd \+= event\.costUsd/)
})

test('aggregateStepCost rolls up execution cost into run totals', () => {
  assert.match(workflowManager, /run\.totalInputTokens \+= execution\.totalInputTokens/)
  assert.match(workflowManager, /run\.totalOutputTokens \+= execution\.totalOutputTokens/)
  assert.match(workflowManager, /run\.totalCostUsd \+= execution\.totalCostUsd/)
})

test('aggregateStepCost is called from finishStepWithHandoff and finishStepWithError', () => {
  const aggregateCalls = [...workflowManager.matchAll(/this\.aggregateStepCost\(run, execution\)/g)]
  assert.ok(aggregateCalls.length >= 2, 'aggregateStepCost should be called in at least 2 places')
})

test('budget check prevents launching a step when cap is exceeded', () => {
  assert.match(workflowManager, /Budget exceeded/)
  assert.match(workflowManager, /run\.budgetUsd !== undefined && run\.totalCostUsd >= run\.budgetUsd/)
})

test('new WorkflowRun and WorkflowStepExecution objects initialize cost fields to 0', () => {
  assert.match(workflowManager, /totalInputTokens: 0/)
  assert.match(workflowManager, /totalOutputTokens: 0/)
  assert.match(workflowManager, /totalCostUsd: 0/)
})

test('budgetUsd is inherited from template when creating a new run', () => {
  assert.match(workflowManager, /budgetUsd: template\.budgetUsd/)
})

// ── UI ─────────────────────────────────────────────────────────────────────

test('WorkflowRunDetail renders cost summary when tokens are non-zero', () => {
  assert.match(runDetail, /totalInputTokens > 0 \|\| run\.totalOutputTokens > 0/)
  assert.match(runDetail, /formatTokens/)
  assert.match(runDetail, /totalCostUsd\.toFixed\(2\)/)
})

test('WorkflowRunDetail renders budget cap info when set', () => {
  assert.match(runDetail, /budgetUsd !== undefined/)
})

test('WorkflowRunDetail shows budget exceeded warning with special styling', () => {
  assert.match(runDetail, /Budget exceeded/)
  assert.match(runDetail, /workflow-budget-exceeded/)
})

test('WorkflowRunDetail step chips include per-step cost tooltip', () => {
  assert.match(runDetail, /stepTokens > 0/)
  assert.match(runDetail, /totalCostUsd/)
})

test('formatTokens helper formats large token counts readably', () => {
  assert.match(runDetail, /function formatTokens/)
  assert.match(runDetail, /1_000_000/)
  assert.match(runDetail, /1_000/)
})

test('TemplatesView includes optional budget input field', () => {
  assert.match(templatesView, /Budget.*USD.*optional/)
  assert.match(templatesView, /budgetUsd/)
})

test('TemplatesView saves budgetUsd in template draft', () => {
  assert.match(templatesView, /budgetUsd: budgetUsd\.trim\(\)/)
})

test('cost display styles are defined', () => {
  assert.match(styles, /workflow-run-cost/)
  assert.match(styles, /workflow-budget-exceeded/)
})
