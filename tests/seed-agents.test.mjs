import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ensureSeedAgents,
  BUILTIN_HELPER_ID,
  CURRENT_HELPER_VERSION,
  HELPER_SYSTEM_PROMPT
} from '../src/shared/seedAgents.ts'

test('seeds a fresh helper at the front when the list is empty', () => {
  const result = ensureSeedAgents([])
  assert.equal(result.length, 1)
  assert.equal(result[0].id, BUILTIN_HELPER_ID)
  assert.equal(result[0].builtin, true)
  assert.equal(result[0].builtinVersion, CURRENT_HELPER_VERSION)
  assert.equal(result[0].systemPrompt, HELPER_SYSTEM_PROMPT)
})

test('prepends the helper without dropping existing user agents', () => {
  const userAgent = {
    id: 'user-1',
    name: '我的 agent',
    role: 'dev',
    vendor: 'claude',
    systemPrompt: 'x'
  }
  const result = ensureSeedAgents([userAgent])
  assert.equal(result.length, 2)
  assert.equal(result[0].id, BUILTIN_HELPER_ID)
  assert.equal(result[1].id, 'user-1')
})

test('upgrades product fields on an outdated helper but keeps user-tuned env fields', () => {
  const outdated = {
    id: BUILTIN_HELPER_ID,
    name: '旧名',
    role: 'old-role',
    vendor: 'codex',
    model: 'gpt-5',
    systemPrompt: '旧 prompt',
    permissionMode: 'acceptEdits',
    builtin: true,
    builtinVersion: 0
  }
  const result = ensureSeedAgents([outdated])
  const helper = result[0]

  assert.equal(helper.name, '使用助手')
  assert.equal(helper.role, 'helper')
  assert.equal(helper.systemPrompt, HELPER_SYSTEM_PROMPT)
  assert.equal(helper.builtinVersion, CURRENT_HELPER_VERSION)
  // 环境字段保留
  assert.equal(helper.vendor, 'codex')
  assert.equal(helper.model, 'gpt-5')
  assert.equal(helper.permissionMode, 'acceptEdits')
})

test('returns the same array reference when the helper is already current', () => {
  const current = {
    id: BUILTIN_HELPER_ID,
    name: '使用助手',
    role: 'helper',
    vendor: 'claude',
    systemPrompt: HELPER_SYSTEM_PROMPT,
    permissionMode: 'plan',
    builtin: true,
    builtinVersion: CURRENT_HELPER_VERSION
  }
  const list = [current]
  assert.equal(ensureSeedAgents(list), list)
})
