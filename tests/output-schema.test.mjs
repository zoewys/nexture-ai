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

test('workflow handoff hint describes the expected JSON structure in the prompt', () => {
  assert.match(workflowManager, /const HANDOFF_HINT = \[/)
  assert.match(workflowManager, /"summary":/)
  assert.match(workflowManager, /"artifacts":/)
  assert.match(workflowManager, /"path":/)
  assert.match(workflowManager, /"description":/)
  assert.match(workflowManager, /"type":/)
  assert.match(workflowManager, /"nextStepGuidance":/)
  assert.match(workflowManager, /Output ONLY the JSON object/)
})

test('claude adapter omits --json-schema to avoid StructuredOutput tool conflict with -p mode', () => {
  // Only the comment mentions --json-schema; the actual code must NOT pass it as a CLI arg.
  assert.doesNotMatch(claudeAdapter, /args\.push\('--json-schema'/)
  // The comment should explain why.
  assert.match(claudeAdapter, /--json-schema is intentionally NOT passed/)
  assert.match(claudeAdapter, /StructuredOutput tool when --json-schema is used/)
  assert.match(claudeAdapter, /HANDOFF_HINT/)
})

test('codex adapter writes a temporary schema file for exec mode', () => {
  assert.match(codexAdapter, /writeCodexOutputSchema/)
  assert.match(codexAdapter, /agent-studio-codex-schemas/)
  assert.match(codexAdapter, /buildCodexExecArgs\(\s*\{ \.\.\.input, outputSchemaPath, resumeFrom: input\.resumeFrom\?\.sessionId \},\s*prompt\s*\)/)
  assert.match(codexAdapter, /cleanupOutputSchema\(\)/)
})

test('codex exec args include output schema file path when present', () => {
  assert.match(codexArgs, /outputSchemaPath\?: string/)
  assert.match(codexArgs, /resumeFrom\?: string/)
  assert.match(codexArgs, /--output-schema/)
  assert.match(codexArgs, /input\.outputSchemaPath/)
  assert.match(codexArgs, /\['exec', 'resume', sessionId\]/)
})
