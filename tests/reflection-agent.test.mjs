import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src/main/memory/ReflectionAgent.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const {
  ReflectionAgent,
  ReflectionParseError,
  buildReflectionPrompt,
  parseReflectionResults
} = await import(moduleUrl)

const agent = {
  id: 'agent-product',
  name: 'Product Agent',
  role: 'product',
  vendor: 'claude',
  systemPrompt: 'You write concise requirements.'
}

const signal = {
  type: 'negative',
  source: 'user-rerun',
  runId: 'child-run-1',
  workflowRunId: 'workflow-run-1',
  stepIndex: 0,
  agentId: 'agent-product',
  projectPath: '/tmp/agent-studio',
  timestamp: 123,
  transcript: '[用户输入]\n↳ 重新分析需求\n\n[Agent 输出]\n遗漏了验收标准',
  userAction: '补上验收标准'
}

const existingMemory = {
  id: 'memory-1',
  agentId: 'agent-product',
  scope: 'global',
  category: 'method',
  content: '需求分析时先列验收标准。',
  evidence: 'run-1',
  strength: 1,
  createdAt: 1,
  lastReinforcedAt: 1,
  reinforceCount: 0
}

test('builds reflection prompt with agent, signal, transcript, and existing memories', () => {
  const prompt = buildReflectionPrompt(signal, agent, [existingMemory])

  assert.match(prompt, /你是一个 agent 经验提取器/)
  assert.match(prompt, /名称: Product Agent/)
  assert.match(prompt, /角色: product/)
  assert.match(prompt, /You write concise requirements\./)
  assert.match(prompt, /信号类型: negative \(来源: user-rerun\)/)
  assert.match(prompt, /用户的修复指令: 补上验收标准/)
  assert.match(prompt, /\[用户输入\]/)
  assert.match(prompt, /- \[method\] 需求分析时先列验收标准。/)
  assert.match(prompt, /严格输出 JSON 数组/)
})

test('parses fenced reflection JSON and filters low confidence results', () => {
  const results = parseReflectionResults([
    {
      kind: 'message',
      role: 'assistant',
      text: [
        '```json',
        '[',
        '{"category":"method","scope":"global","content":"先确认验收标准。","confidence":0.9},',
        '{"category":"avoidance","scope":"project","content":"不要漏掉错误状态。","confidence":0.59}',
        ']',
        '```'
      ].join('\n')
    },
    { kind: 'turn-done', sessionId: 'session-1', reason: 'complete' }
  ])

  assert.deepEqual(results, [
    {
      category: 'method',
      scope: 'global',
      content: '先确认验收标准。',
      confidence: 0.9
    }
  ])
})

test('reflect runs through RunManager with safe config and returns parsed memories', async () => {
  const runManager = createRunManager([
    [
      {
        kind: 'message',
        role: 'assistant',
        text: '[{"category":"preference","scope":"project","content":"用户偏好直接列出待办。","confidence":0.8}]'
      },
      { kind: 'turn-done', sessionId: 'session-1', reason: 'complete' }
    ]
  ])
  const memoryStore = createMemoryStore()
  const reflectionAgent = new ReflectionAgent(runManager, memoryStore)

  const results = await reflectionAgent.reflect(signal, agent, [existingMemory])

  assert.equal(runManager.calls.length, 1)
  assert.equal(runManager.calls[0].vendor, 'claude')
  assert.equal(runManager.calls[0].model, 'claude-haiku-test')
  assert.equal(runManager.calls[0].cwd, '/tmp/agent-studio-memories')
  assert.equal(runManager.calls[0].permissionMode, 'default')
  assert.match(runManager.calls[0].prompt, /补上验收标准/)
  assert.deepEqual(results, [
    {
      category: 'preference',
      scope: 'project',
      content: '用户偏好直接列出待办。',
      confidence: 0.8
    }
  ])
})

test('reflect retries one parse failure before succeeding', async () => {
  const runManager = createRunManager([
    [
      { kind: 'message', role: 'assistant', text: 'not json' },
      { kind: 'turn-done', sessionId: 'session-1', reason: 'complete' }
    ],
    [
      {
        kind: 'message',
        role: 'assistant',
        text: '[{"category":"avoidance","scope":"global","content":"不要输出 markdown 包裹 JSON。","confidence":0.7}]'
      },
      { kind: 'turn-done', sessionId: 'session-2', reason: 'complete' }
    ]
  ])
  const reflectionAgent = new ReflectionAgent(runManager, createMemoryStore())

  const results = await reflectionAgent.reflect(signal, agent, [])

  assert.equal(runManager.calls.length, 2)
  assert.equal(results[0].content, '不要输出 markdown 包裹 JSON。')
})

test('reflect rethrows after repeated parse failure so callers can persist the signal', async () => {
  const runManager = createRunManager([
    [
      { kind: 'message', role: 'assistant', text: 'not json' },
      { kind: 'turn-done', sessionId: 'session-1', reason: 'complete' }
    ],
    [
      { kind: 'message', role: 'assistant', text: '{"not":"an array"}' },
      { kind: 'turn-done', sessionId: 'session-2', reason: 'complete' }
    ]
  ])
  const reflectionAgent = new ReflectionAgent(runManager, createMemoryStore())

  await assert.rejects(
    () => reflectionAgent.reflect(signal, agent, []),
    (err) => err instanceof ReflectionParseError
  )
  assert.equal(runManager.calls.length, 2)
})

test('reflect returns no memories when reflection is disabled', async () => {
  const runManager = createRunManager([])
  const memoryStore = createMemoryStore({ enabled: false })
  const reflectionAgent = new ReflectionAgent(runManager, memoryStore)

  const results = await reflectionAgent.reflect(signal, agent, [])

  assert.deepEqual(results, [])
  assert.equal(runManager.calls.length, 0)
})

function createRunManager(sequences) {
  const calls = []
  return {
    calls,
    start(config, onEvent) {
      calls.push(config)
      const events = sequences.shift() ?? []
      queueMicrotask(() => {
        for (const event of events) onEvent(`reflection-run-${calls.length}`, event)
      })
      return `reflection-run-${calls.length}`
    }
  }
}

function createMemoryStore(patch = {}) {
  return {
    getReflectionConfig() {
      return {
        vendor: 'claude',
        model: 'claude-haiku-test',
        enabled: true,
        ...patch
      }
    },
    getReflectionCwd() {
      return '/tmp/agent-studio-memories'
    }
  }
}
