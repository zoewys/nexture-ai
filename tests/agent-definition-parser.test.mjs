import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseAgentDraftFromText, AGENT_CREATE_MARKER } from '../src/shared/agentDefinitionParser.ts'

test('parses an inline agent-definition JSON carrying the marker', () => {
  const draft = parseAgentDraftFromText(
    `好的，这是新 agent：{"${AGENT_CREATE_MARKER}": {"name":"代码评审员","role":"reviewer","vendor":"claude","permissionMode":"plan","systemPrompt":"你是一个代码评审员。"}}`
  )

  assert.deepEqual(draft, {
    name: '代码评审员',
    role: 'reviewer',
    vendor: 'claude',
    model: undefined,
    systemPrompt: '你是一个代码评审员。',
    permissionMode: 'plan'
  })
})

test('parses a fenced json block surrounded by assistant prose', () => {
  const draft = parseAgentDraftFromText([
    '需求已经清楚，下面是生成的 agent 定义：',
    '```json',
    '{',
    `  "${AGENT_CREATE_MARKER}": {`,
    '    "name": "文档撰写员",',
    '    "role": "docs",',
    '    "vendor": "claude",',
    '    "systemPrompt": "第一行\\n第二行"',
    '  }',
    '}',
    '```'
  ].join('\n'))

  assert.equal(draft?.name, '文档撰写员')
  assert.equal(draft?.systemPrompt, '第一行\n第二行')
  assert.equal(draft?.permissionMode, undefined)
  assert.equal(draft?.model, undefined)
})

test('falls back to vendor claude when vendor is invalid', () => {
  const draft = parseAgentDraftFromText(
    `{"${AGENT_CREATE_MARKER}": {"name":"A","role":"a","vendor":"gemini","systemPrompt":"x"}}`
  )
  assert.equal(draft?.vendor, 'claude')
})

test('drops an invalid permissionMode instead of rejecting the whole draft', () => {
  const draft = parseAgentDraftFromText(
    `{"${AGENT_CREATE_MARKER}": {"name":"A","role":"a","vendor":"codex","permissionMode":"yolo","systemPrompt":"x"}}`
  )
  assert.equal(draft?.vendor, 'codex')
  assert.equal(draft?.permissionMode, undefined)
})

test('returns null when no marker payload is present', () => {
  const draft = parseAgentDraftFromText('{"name":"A","role":"a","systemPrompt":"x"}')
  assert.equal(draft, null)
})

test('skips unrelated JSON and picks the object carrying the marker', () => {
  const draft = parseAgentDraftFromText([
    '先看个例子 {"foo": "bar"}。',
    '最终定义：',
    `{"${AGENT_CREATE_MARKER}": {"name":"真实","role":"r","vendor":"claude","systemPrompt":"s"}}`
  ].join('\n'))
  assert.equal(draft?.name, '真实')
})

test('rejects drafts missing required fields', () => {
  const noPrompt = `{"${AGENT_CREATE_MARKER}": {"name":"A","role":"a"}}`
  const noName = `{"${AGENT_CREATE_MARKER}": {"role":"a","systemPrompt":"x"}}`
  assert.equal(parseAgentDraftFromText(noPrompt), null)
  assert.equal(parseAgentDraftFromText(noName), null)
})

test('rejects placeholder field values echoed from the prompt template', () => {
  const draft = parseAgentDraftFromText(
    `{"${AGENT_CREATE_MARKER}": {"name":"<agent name>","role":"a","systemPrompt":"..."}}`
  )
  assert.equal(draft, null)
})

test('treats an empty/whitespace model as undefined', () => {
  const draft = parseAgentDraftFromText(
    `{"${AGENT_CREATE_MARKER}": {"name":"A","role":"a","vendor":"claude","model":"   ","systemPrompt":"x"}}`
  )
  assert.equal(draft?.model, undefined)
})
