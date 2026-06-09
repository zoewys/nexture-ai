import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src/main/memory/SignalCollector.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { SignalCollector } = await import(moduleUrl)

const workflowManager = readFileSync(join(root, 'src/main/WorkflowManager.ts'), 'utf8')
const ipc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')

const agent = {
  id: 'agent-product',
  name: 'Product Agent',
  role: 'product',
  vendor: 'claude',
  systemPrompt: 'Write product analysis.'
}

const signal = {
  type: 'positive',
  source: 'user-confirmed',
  runId: 'child-run-1',
  workflowRunId: 'workflow-run-1',
  stepIndex: 0,
  agentId: 'agent-product',
  projectPath: '/tmp/agent-studio',
  timestamp: 123,
  injectedMemoryIds: ['memory-injected-1', 'memory-injected-2'],
  transcript: '[Agent 输出]\n完成需求分析'
}

const existingMemory = {
  id: 'memory-1',
  agentId: 'agent-product',
  scope: 'global',
  category: 'method',
  content: '先列验收标准。',
  evidence: 'run=old',
  strength: 1,
  createdAt: 1,
  lastReinforcedAt: 1,
  reinforceCount: 0
}

test('collect persists raw signal and reinforces injected memories immediately', () => {
  const reflectionAgent = createReflectionAgent([])
  const memoryStore = createMemoryStore()
  const collector = new SignalCollector(reflectionAgent, memoryStore, createAgentStore())

  collector.collect(signal)

  assert.deepEqual(memoryStore.savedRawSignals, [signal])
  assert.deepEqual(memoryStore.reinforcedIds, ['memory-injected-1', 'memory-injected-2'])
  // Reflection is debounced — not fired synchronously
  assert.equal(reflectionAgent.calls.length, 0)
})

test('drainRawSignals batches signals by agent and stores memories', async () => {
  const reflectionAgent = createReflectionAgent([
    { category: 'method', scope: 'project', content: '需求分析要补充验收标准。', confidence: 0.9 },
    { category: 'preference', scope: 'global', content: '用户偏好直接给待办清单。', confidence: 0.8 }
  ])
  const memoryStore = createMemoryStore({ rawSignals: [signal] })
  const agentStore = createAgentStore()
  const collector = new SignalCollector(reflectionAgent, memoryStore, agentStore)

  await collector.drainRawSignals()

  // One batch call for the single agent
  assert.equal(reflectionAgent.calls.length, 1)
  assert.equal(reflectionAgent.calls[0].agent.id, agent.id)
  assert.deepEqual(reflectionAgent.calls[0].existingMemories, [existingMemory])
  assert.equal(memoryStore.added.length, 2)
  assert.equal(memoryStore.added[0].scope, 'project')
  assert.equal(memoryStore.added[0].projectPath, signal.projectPath)
  assert.equal(memoryStore.added[0].strength, 1)
  assert.match(memoryStore.added[0].evidence, /workflow=workflow-run-1/)
  assert.equal(memoryStore.metaPatch.totalRuns, 4)
  assert.equal(typeof memoryStore.metaPatch.lastReflectionAt, 'number')
  // Raw signal is removed after successful reflection
  assert.deepEqual(memoryStore.removedRawSignals, [signal])
})

test('drainRawSignals re-saves raw signals when reflection fails', async () => {
  const reflectionAgent = createReflectionAgent(null, new Error('still failing'))
  const memoryStore = createMemoryStore({ rawSignals: [signal] })
  const collector = new SignalCollector(reflectionAgent, memoryStore, createAgentStore())

  await collector.drainRawSignals()

  assert.equal(memoryStore.popRawSignalsCalled, 1)
  assert.deepEqual(memoryStore.savedRawSignals, [signal])
  assert.equal(reflectionAgent.calls.length, 1)
})

test('disabled reflection does not persist, drain, or run signals', async () => {
  const reflectionAgent = createReflectionAgent([])
  const memoryStore = createMemoryStore({ enabled: false, rawSignals: [signal] })
  const collector = new SignalCollector(reflectionAgent, memoryStore, createAgentStore())

  collector.collect(signal)
  await collector.drainRawSignals()

  assert.deepEqual(memoryStore.savedRawSignals, [])
  assert.deepEqual(memoryStore.reinforcedIds, ['memory-injected-1', 'memory-injected-2'])
  assert.equal(memoryStore.popRawSignalsCalled, 0)
  assert.equal(reflectionAgent.calls.length, 0)
})

test('workflow manager and ipc wire memory signals into workflow lifecycle', () => {
  assert.match(workflowManager, /private readonly signalCollector\?: SignalCollector/)
  assert.match(workflowManager, /private readonly memoryInjector\?: MemoryInjector/)
  assert.match(workflowManager, /summarizeTranscript\(execution\.events\)/)
  assert.match(workflowManager, /injectedMemoryIds: execution\.injectedMemoryIds/)
  assert.match(workflowManager, /collectMemorySignal\('positive', 'user-confirmed'/)
  assert.match(workflowManager, /collectMemorySignal\('negative', 'user-rerun'/)
  assert.match(workflowManager, /collectMemorySignal\(\s*'format-error',\s*'handoff-failed'/)
  assert.match(workflowManager, /collectMemorySignal\('completion', 'workflow-done'/)
  assert.match(ipc, /new MemoryStore\(\)/)
  assert.match(ipc, /new ReflectionAgent\(runManager, memoryStore\)/)
  assert.match(ipc, /new SignalCollector\(reflectionAgent, memoryStore, agentStore\)/)
  assert.match(ipc, /new MemoryInjector\(memoryStore\)/)
  assert.match(ipc, /void signalCollector\.drainRawSignals\(\)/)
})

function createReflectionAgent(results, error = null) {
  return {
    calls: [],
    async reflect(signals, agentArg, existingMemories) {
      this.calls.push({ signals, agent: agentArg, existingMemories })
      if (error) throw error
      return results
    }
  }
}

function createMemoryStore({ enabled = true, rawSignals = [] } = {}) {
  return {
    added: [],
    reinforcedIds: [],
    savedRawSignals: [],
    removedRawSignals: [],
    metaPatch: null,
    popRawSignalsCalled: 0,
    add(input) {
      this.added.push(input)
    },
    getMeta() {
      return { agentId: agent.id, totalRuns: 3, totalMemories: 1 }
    },
    getReflectionConfig() {
      return { vendor: 'claude', model: 'claude-haiku-test', enabled }
    },
    list(agentId, projectPath) {
      assert.equal(agentId, agent.id)
      assert.equal(projectPath, signal.projectPath)
      return [existingMemory]
    },
    popRawSignals() {
      this.popRawSignalsCalled += 1
      return rawSignals.splice(0)
    },
    removeRawSignal(signalToRemove) {
      this.removedRawSignals.push(signalToRemove)
    },
    reinforce(memoryId) {
      this.reinforcedIds.push(memoryId)
    },
    saveRawSignal(signalToSave) {
      this.savedRawSignals.push(signalToSave)
    },
    updateMeta(agentId, patch) {
      assert.equal(agentId, agent.id)
      this.metaPatch = patch
    }
  }
}

function createAgentStore() {
  return {
    list() {
      return [agent]
    }
  }
}
