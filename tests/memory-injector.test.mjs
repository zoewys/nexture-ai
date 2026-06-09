import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src/main/memory/MemoryInjector.ts'), 'utf8')
  .replace(
    "import { computeStrength } from './forgettingCurve'\n",
    [
      'function computeStrength(entry) {',
      '  const days = Math.max(0, (Date.now() - entry.lastReinforcedAt) / (1000 * 60 * 60 * 24))',
      '  const stability = 1 + entry.reinforceCount * 0.5',
      '  const decay = Math.exp(-days / (stability * 7))',
      '  return Math.max(0, Math.min(1, entry.strength * decay))',
      '}',
      ''
    ].join('\n')
  )
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { MemoryInjector } = await import(moduleUrl)

test('orders alive memories by decayed strength and category weight', () => {
  const memories = [
    memory({ id: 'knowledge', category: 'knowledge', content: '项目使用 React。' }),
    memory({ id: 'method', category: 'method', content: '先列边界条件。' }),
    memory({ id: 'preference', category: 'preference', content: '用户偏好短清单。' }),
    memory({ id: 'avoidance', category: 'avoidance', content: '不要遗漏安全风险。' }),
    memory({ id: 'expired', category: 'avoidance', content: '旧经验不要出现。', ageDays: 40, strength: 0.2 })
  ]
  const injector = new MemoryInjector(createMemoryStore(memories))

  const result = injector.build('agent-product', '/tmp/project')

  assert.deepEqual(result.injectedMemoryIds, ['avoidance', 'preference', 'method', 'knowledge'])
  assert.match(result.text, /^# 你的积累经验/)
  assert.ok(result.text.indexOf('⚠️ 避免：不要遗漏安全风险。') < result.text.indexOf('✓ 偏好：用户偏好短清单。'))
  assert.ok(result.text.indexOf('✓ 偏好：用户偏好短清单。') < result.text.indexOf('→ 方法：先列边界条件。'))
  assert.ok(result.text.indexOf('→ 方法：先列边界条件。') < result.text.indexOf('📌 知识：项目使用 React。'))
  assert.doesNotMatch(result.text, /旧经验不要出现/)
  assert.match(result.text, /请参考以上经验，但根据当前具体情况灵活应用。/)
})

test('respects token budget while keeping highest ranked memories', () => {
  const injector = new MemoryInjector(createMemoryStore([
    memory({ id: 'top', category: 'avoidance', content: 'A'.repeat(60) }),
    memory({ id: 'second', category: 'preference', content: 'B'.repeat(60) })
  ]))

  const result = injector.build('agent-product', '/tmp/project', 45)

  assert.deepEqual(result.injectedMemoryIds, ['top'])
  assert.match(result.text, /A{20}/)
  assert.doesNotMatch(result.text, /B{20}/)
})

test('returns empty injection when no memories are alive or within budget', () => {
  const expiredOnly = new MemoryInjector(createMemoryStore([
    memory({ id: 'expired', ageDays: 60, strength: 0.1 })
  ]))
  const overBudget = new MemoryInjector(createMemoryStore([
    memory({ id: 'huge', content: 'X'.repeat(500) })
  ]))

  assert.deepEqual(expiredOnly.build('agent-product', '/tmp/project'), {
    text: '',
    injectedMemoryIds: []
  })
  assert.deepEqual(overBudget.build('agent-product', '/tmp/project', 10), {
    text: '',
    injectedMemoryIds: []
  })
})

function createMemoryStore(memories) {
  return {
    list(agentId, projectPath) {
      assert.equal(agentId, 'agent-product')
      assert.equal(projectPath, '/tmp/project')
      return memories
    }
  }
}

function memory(overrides = {}) {
  const now = Date.now()
  const ageDays = overrides.ageDays ?? 0
  return {
    id: overrides.id ?? 'memory-1',
    agentId: 'agent-product',
    scope: overrides.scope ?? 'global',
    category: overrides.category ?? 'method',
    content: overrides.content ?? '默认经验。',
    evidence: 'run=1',
    strength: overrides.strength ?? 1,
    createdAt: now,
    lastReinforcedAt: now - ageDays * 24 * 60 * 60 * 1000,
    reinforceCount: overrides.reinforceCount ?? 0
  }
}
