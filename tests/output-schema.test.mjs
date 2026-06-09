import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflowManager = readFileSync(resolve(root, 'src/main/WorkflowManager.ts'), 'utf8')
const claudeAdapter = readFileSync(resolve(root, 'src/main/adapters/claudeAdapter.ts'), 'utf8')
const codexAdapter = readFileSync(resolve(root, 'src/main/adapters/codexAdapter.ts'), 'utf8')
const codexArgs = readFileSync(resolve(root, 'src/main/adapters/codexArgs.ts'), 'utf8')

test('workflow handoff steps provide a structured output schema', () => {
  assert.match(workflowManager, /const HANDOFF_OUTPUT_SCHEMA: JSONSchema = \{/)
  assert.match(workflowManager, /required: \['summary', 'artifacts'\]/)
  assert.match(workflowManager, /enum: \['requirement', 'design', 'code', 'test', 'other'\]/)
  assert.equal(
    [...workflowManager.matchAll(/outputSchema: HANDOFF_OUTPUT_SCHEMA/g)].length,
    2,
    'start and resumed workflow steps should both constrain handoff output'
  )
})

test('claude adapter passes json schema to the cli', () => {
  assert.match(claudeAdapter, /--json-schema/)
  assert.match(claudeAdapter, /JSON\.stringify\(input\.outputSchema\)/)
})

test('codex adapter writes a temporary schema file for exec mode', () => {
  assert.match(codexAdapter, /writeCodexOutputSchema/)
  assert.match(codexAdapter, /agent-studio-codex-schemas/)
  assert.match(codexAdapter, /buildCodexExecArgs\(\{ \.\.\.input, outputSchemaPath \}, prompt\)/)
  assert.match(codexAdapter, /cleanupOutputSchema\(\)/)
})

test('codex exec args include output schema file path when present', () => {
  assert.match(codexArgs, /outputSchemaPath\?: string/)
  assert.match(codexArgs, /--output-schema/)
  assert.match(codexArgs, /input\.outputSchemaPath/)
})
