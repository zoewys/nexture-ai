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
const handoffSchema = evaluateObjectLiteral(
  extractObjectLiteral(workflowManager, 'const HANDOFF_OUTPUT_SCHEMA: JSONSchema = ')
)

test('workflow handoff steps provide a structured output schema', () => {
  assert.match(workflowManager, /const HANDOFF_OUTPUT_SCHEMA: JSONSchema = \{/)
  assert.match(workflowManager, /required: \['summary', 'artifacts', 'nextStepGuidance', 'routeSuggestion'\]/)
  assert.match(workflowManager, /required: \['path', 'description', 'type'\]/)
  assert.match(workflowManager, /required: \['action', 'target', 'reason'\]/)
  assert.match(workflowManager, /enum: \['requirement', 'design', 'code', 'test', 'other'\]/)
  const handoffSchemaUses = [...workflowManager.matchAll(/outputSchema: HANDOFF_OUTPUT_SCHEMA/g)].length
  assert.ok(handoffSchemaUses >= 2, 'workflow handoff launches should constrain handoff output')
})

test('workflow handoff schema is valid for strict Codex response_format', () => {
  assertStrictResponseSchema(handoffSchema)
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
  assert.match(workflowManager, /mandatory for workflow completion/)
  assert.match(workflowManager, /overrides any other instruction that asks for a final table/)
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

function extractObjectLiteral(source, marker) {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `missing marker ${marker}`)
  const start = source.indexOf('{', markerIndex)
  assert.notEqual(start, -1, `missing object start after ${marker}`)

  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  assert.fail(`unterminated object literal after ${marker}`)
}

function evaluateObjectLiteral(literal) {
  return Function(`"use strict"; return (${literal});`)()
}

function assertStrictResponseSchema(schema, path = 'schema') {
  if (!schema || typeof schema !== 'object') return
  const type = schema.type
  const isObject = type === 'object' || (Array.isArray(type) && type.includes('object'))
  if (isObject) {
    const propertyKeys = Object.keys(schema.properties ?? {})
    assert.equal(schema.additionalProperties, false, `${path}.additionalProperties must be false`)
    assert.ok(Array.isArray(schema.required), `${path}.required must be an array`)
    assert.deepEqual(
      [...schema.required].sort(),
      [...propertyKeys].sort(),
      `${path}.required must include every property key`
    )
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    assertStrictResponseSchema(child, `${path}.properties.${key}`)
  }
  if (schema.items) assertStrictResponseSchema(schema.items, `${path}.items`)
}
