import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseHandoff, tryParseHandoffFromText } from '../src/main/handoffParser.ts'

test('parses handoff JSON assembled only from message deltas', () => {
  const handoff = parseHandoff([
    { kind: 'session-started', sessionId: 'native-1', vendor: 'codex' },
    { kind: 'message-delta', text: '{"summary":"Implemented workflow parsing",' },
    { kind: 'message-delta', text: '"artifacts":[{"path":"src/main/handoffParser.ts",' },
    { kind: 'message-delta', text: '"description":"Parses streamed handoff output","type":"code"}]}' },
    { kind: 'turn-done', sessionId: 'native-1', reason: 'complete' }
  ])

  assert.deepEqual(handoff, {
    summary: 'Implemented workflow parsing',
    artifacts: [
      {
        path: 'src/main/handoffParser.ts',
        description: 'Parses streamed handoff output',
        type: 'code'
      }
    ],
    nextStepGuidance: undefined,
    routeSuggestion: undefined
  })
})

test('parses fenced handoff JSON with surrounding assistant prose', () => {
  const handoff = tryParseHandoffFromText([
    'Done. The final handoff is:',
    '```json',
    '{',
    '  "summary": "Ready for test.",',
    '  "artifacts": [],',
    '  "nextStepGuidance": "Run the workflow regression tests."',
    '}',
    '```'
  ].join('\n'))

  assert.deepEqual(handoff, {
    summary: 'Ready for test.',
    artifacts: [],
    nextStepGuidance: 'Run the workflow regression tests.',
    routeSuggestion: undefined
  })
})

test('skips earlier non-handoff JSON-looking text and parses the valid handoff object', () => {
  const handoff = tryParseHandoffFromText([
    'I inspected this example first: {"foo": "bar"}.',
    'Final:',
    '{',
    '  "summary": "The workflow can continue.",',
    '  "artifacts": [{"path":"docs/spec.md","description":"Updated spec","type":"invalid"}],',
    '  "routeSuggestion": {"action":"continue","reason":"handoff parsed"}',
    '}'
  ].join('\n'))

  assert.deepEqual(handoff, {
    summary: 'The workflow can continue.',
    artifacts: [
      {
        path: 'docs/spec.md',
        description: 'Updated spec',
        type: undefined
      }
    ],
    nextStepGuidance: undefined,
    routeSuggestion: {
      action: 'continue',
      reason: 'handoff parsed'
    }
  })
})

test('prefers the most recent assistant output when multiple turns contain handoffs', () => {
  const handoff = parseHandoff([
    { kind: 'message', role: 'assistant', text: '{"summary":"old","artifacts":[]}' },
    { kind: 'turn-done', sessionId: 'native-1', reason: 'complete' },
    { kind: 'message-delta', text: '{"summary":"new","artifacts":[]}' },
    { kind: 'turn-done', sessionId: 'native-2', reason: 'complete' }
  ])

  assert.equal(handoff?.summary, 'new')
})

test('rejects echoed handoff template placeholders', () => {
  const handoff = tryParseHandoffFromText([
    '{',
    '  "summary": "<one-paragraph summary of what you did and key decisions>",',
    '  "artifacts": [',
    '    {',
    '      "path": "<relative file path>",',
    '      "description": "<what this file contains and why it matters>",',
    '      "type": "requirement|design|code|test|other"',
    '    }',
    '  ],',
    '  "nextStepGuidance": "<optional: what the next agent should focus on>",',
    '  "routeSuggestion": { "action": "continue|retry-prev|skip-next|goto", "target": 0, "reason": "..." }',
    '}'
  ].join('\n'))

  assert.equal(handoff, null)
})

test('rejects placeholder artifacts even when the summary is non-placeholder', () => {
  const handoff = tryParseHandoffFromText([
    '{',
    '  "summary": "I am ready to hand off.",',
    '  "artifacts": [',
    '    { "path": "<relative file path>", "description": "placeholder copied from prompt" }',
    '  ]',
    '}'
  ].join('\n'))

  assert.equal(handoff, null)
})
