import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { test, after } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// ── Setup: create temp directory to isolate filesystem side effects ────────
const tmpDir = mkdtempSync(join(root, 'tests', '.tmp-memory-store-'))
after(() => rmSync(tmpDir, { recursive: true, force: true }))

// ── Compile MemoryStore with mocked dependencies ───────────────────────────
const originalSource = readFileSync(join(root, 'src/main/memory/MemoryStore.ts'), 'utf8')

const DEFAULT_REFLECTION_CONFIG_INLINE = `{ vendor: 'claude', model: 'claude-haiku-4-5-20251001', enabled: true }`

const source = originalSource
  .replace(
    "import { app } from 'electron'",
    `const app = { getPath: () => ${JSON.stringify(tmpDir)} }`
  )
  .replace(
    "import { DEFAULT_REFLECTION_CONFIG } from '@shared/types'",
    `const DEFAULT_REFLECTION_CONFIG = ${DEFAULT_REFLECTION_CONFIG_INLINE}`
  )

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022
  }
}).outputText

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { MemoryStore, hashProjectPath } = await import(moduleUrl)

// ── Helpers ────────────────────────────────────────────────────────────────
const MEMORIES_DIR = join(tmpDir, 'memories')
const AGENTS_DIR = join(MEMORIES_DIR, 'agents')
const RAW_DIR = join(MEMORIES_DIR, 'raw')

/** Nuke all persisted state so each test starts clean. */
function resetState() {
  rmSync(AGENTS_DIR, { recursive: true, force: true })
  rmSync(RAW_DIR, { recursive: true, force: true })
  mkdirSync(AGENTS_DIR, { recursive: true })
  mkdirSync(RAW_DIR, { recursive: true })
  // Also remove config if present
  const configPath = join(MEMORIES_DIR, 'config.json')
  try { rmSync(configPath, { force: true }) } catch {}
}

function freshStore() {
  resetState()
  return new MemoryStore()
}

const AGENT_A = 'agent-alpha'
const AGENT_B = 'agent-beta'
const PROJECT = '/tmp/test-project'

function makeInput(overrides = {}) {
  return {
    agentId: AGENT_A,
    scope: 'global',
    category: 'method',
    content: 'Prefer small tested changes.',
    evidence: 'run-1/step-0/positive',
    strength: 1,
    ...overrides
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// hashProjectPath (pure function)
// ═══════════════════════════════════════════════════════════════════════════

test('hashProjectPath: produces stable 16-char hex hash', () => {
  const a = hashProjectPath(PROJECT)
  const b = hashProjectPath(PROJECT)
  assert.equal(a, b)
  assert.equal(a.length, 16)
  assert.match(a, /^[0-9a-f]{16}$/)
})

test('hashProjectPath: different paths produce different hashes', () => {
  assert.notEqual(hashProjectPath('/tmp/project-a'), hashProjectPath('/tmp/project-b'))
})

test('hashProjectPath: resolves relative paths before hashing', () => {
  assert.equal(
    hashProjectPath('/tmp/foo/../test-project'),
    hashProjectPath('/tmp/test-project')
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// Construction & directory layout
// ═══════════════════════════════════════════════════════════════════════════

test('constructor creates memories/ directory structure', () => {
  resetState()
  // Remove the dirs that resetState just created, to verify constructor creates them
  rmSync(MEMORIES_DIR, { recursive: true, force: true })

  new MemoryStore() // eslint-disable-line no-new

  assert.ok(existsSync(MEMORIES_DIR))
  assert.ok(existsSync(AGENTS_DIR))
  assert.ok(existsSync(RAW_DIR))
})

test('constructor is idempotent — creating multiple stores does not throw', () => {
  resetState()
  assert.doesNotThrow(() => new MemoryStore())
  assert.doesNotThrow(() => new MemoryStore())
})

// ═══════════════════════════════════════════════════════════════════════════
// add
// ═══════════════════════════════════════════════════════════════════════════

test('add: creates a global memory entry with generated id and timestamps', () => {
  const store = freshStore()
  const before = Date.now()
  const entry = store.add(makeInput())
  const after = Date.now()

  assert.ok(entry.id)
  assert.equal(entry.id.length, 36) // UUID
  assert.equal(entry.agentId, AGENT_A)
  assert.equal(entry.scope, 'global')
  assert.equal(entry.category, 'method')
  assert.equal(entry.content, 'Prefer small tested changes.')
  assert.equal(entry.strength, 1)
  assert.equal(entry.reinforceCount, 0)
  assert.ok(entry.createdAt >= before && entry.createdAt <= after)
  assert.equal(entry.lastReinforcedAt, entry.createdAt)

  // Verify on disk
  const diskEntries = JSON.parse(
    readFileSync(join(AGENTS_DIR, AGENT_A, 'global.json'), 'utf8')
  )
  assert.equal(diskEntries.length, 1)
  assert.equal(diskEntries[0].id, entry.id)
})

test('add: creates a project-scoped memory with projectHash', () => {
  const store = freshStore()
  const entry = store.add(makeInput({ scope: 'project', projectPath: PROJECT }))

  assert.equal(entry.scope, 'project')
  assert.equal(entry.projectPath, PROJECT)
  assert.ok(entry.projectHash)
  assert.equal(entry.projectHash, hashProjectPath(PROJECT))

  // Verify on disk under the hashed project file
  const diskEntries = JSON.parse(
    readFileSync(
      join(AGENTS_DIR, AGENT_A, 'projects', `${entry.projectHash}.json`),
      'utf8'
    )
  )
  assert.equal(diskEntries.length, 1)
  assert.equal(diskEntries[0].projectPath, PROJECT)
})

test('add: prepends to the list (newest first)', () => {
  const store = freshStore()
  store.add(makeInput({ content: 'first' }))
  store.add(makeInput({ content: 'second' }))

  const entries = store.listAll(AGENT_A)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].content, 'second')
  assert.equal(entries[1].content, 'first')
})

test('add: updates agent meta with total count', () => {
  const store = freshStore()
  store.add(makeInput())
  store.add(makeInput())

  const meta = store.getMeta(AGENT_A)
  assert.equal(meta.totalMemories, 2)
})

// ═══════════════════════════════════════════════════════════════════════════
// list / listAll
// ═══════════════════════════════════════════════════════════════════════════

test('list: without projectPath returns all memories (delegates to listAll)', () => {
  const store = freshStore()
  store.add(makeInput({ content: 'global-one', scope: 'global' }))
  store.add(makeInput({ content: 'global-two', scope: 'global' }))

  assert.equal(store.list(AGENT_A).length, 2)
})

test('list: with projectPath returns global + matching project entries only', () => {
  const store = freshStore()
  store.add(makeInput({ content: 'global', scope: 'global' }))
  store.add(makeInput({ content: 'proj-match', scope: 'project', projectPath: PROJECT }))
  store.add(makeInput({ content: 'proj-other', scope: 'project', projectPath: '/tmp/other' }))

  const results = store.list(AGENT_A, PROJECT)
  assert.equal(results.length, 2)
  assert.ok(results.some((e) => e.content === 'global'))
  assert.ok(results.some((e) => e.content === 'proj-match'))
  assert.ok(!results.some((e) => e.content === 'proj-other'))
})

test('listAll: returns all memories across global and all projects', () => {
  const store = freshStore()
  store.add(makeInput({ content: 'g', scope: 'global' }))
  store.add(makeInput({ content: 'p1', scope: 'project', projectPath: '/a' }))
  store.add(makeInput({ content: 'p2', scope: 'project', projectPath: '/b' }))

  assert.equal(store.listAll(AGENT_A).length, 3)
})

test('listAll: returns only global entries when no projects directory exists', () => {
  const store = freshStore()
  store.add(makeInput({ content: 'only-global', scope: 'global' }))

  const all = store.listAll(AGENT_A)
  assert.equal(all.length, 1)
  assert.equal(all[0].content, 'only-global')
})

// ═══════════════════════════════════════════════════════════════════════════
// remove
// ═══════════════════════════════════════════════════════════════════════════

test('remove: deletes a specific memory by id', () => {
  const store = freshStore()
  const e1 = store.add(makeInput({ content: 'keep' }))
  const e2 = store.add(makeInput({ content: 'delete-me' }))

  store.remove(e2.id)

  const remaining = store.listAll(AGENT_A)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, e1.id)
})

test('remove: updates meta after deletion', () => {
  const store = freshStore()
  const e = store.add(makeInput())
  store.add(makeInput())
  assert.equal(store.getMeta(AGENT_A).totalMemories, 2)

  store.remove(e.id)
  assert.equal(store.getMeta(AGENT_A).totalMemories, 1)
})

test('remove: is a no-op for non-existent id (no error thrown)', () => {
  const store = freshStore()
  store.add(makeInput())
  assert.doesNotThrow(() => store.remove('non-existent-id'))
  assert.equal(store.listAll(AGENT_A).length, 1)
})

// ═══════════════════════════════════════════════════════════════════════════
// removeByAgent
// ═══════════════════════════════════════════════════════════════════════════

test('removeByAgent: deletes all memories for an agent, leaves other agents intact', () => {
  const store = freshStore()
  store.add(makeInput({ agentId: AGENT_A }))
  store.add(makeInput({ agentId: AGENT_A }))
  store.add(makeInput({ agentId: AGENT_B }))

  store.removeByAgent(AGENT_A)

  assert.ok(!existsSync(join(AGENTS_DIR, AGENT_A)))
  assert.equal(store.listAll(AGENT_B).length, 1)
})

test('removeByAgent: is a no-op for non-existent agent (no error thrown)', () => {
  const store = freshStore()
  assert.doesNotThrow(() => store.removeByAgent('ghost-agent'))
})

// ═══════════════════════════════════════════════════════════════════════════
// reinforce
// ═══════════════════════════════════════════════════════════════════════════

test('reinforce: sets strength to 1, bumps reinforceCount, updates timestamp', () => {
  const store = freshStore()
  const entry = store.add(makeInput({ strength: 0.3 }))

  const before = Date.now()
  store.reinforce(entry.id)
  const after = Date.now()

  const all = store.listAll(AGENT_A)
  const reinforced = all.find((e) => e.id === entry.id)
  assert.equal(reinforced.strength, 1)
  assert.equal(reinforced.reinforceCount, 1)
  assert.ok(reinforced.lastReinforcedAt >= before && reinforced.lastReinforcedAt <= after)
})

test('reinforce: is a no-op for non-existent id (no error thrown)', () => {
  const store = freshStore()
  store.add(makeInput())
  assert.doesNotThrow(() => store.reinforce('non-existent-id'))
})

test('reinforce: accumulates reinforceCount over multiple calls', () => {
  const store = freshStore()
  const entry = store.add(makeInput())
  store.reinforce(entry.id)
  store.reinforce(entry.id)
  store.reinforce(entry.id)

  assert.equal(store.listAll(AGENT_A)[0].reinforceCount, 3)
})

// ═══════════════════════════════════════════════════════════════════════════
// getMeta / updateMeta
// ═══════════════════════════════════════════════════════════════════════════

test('getMeta: returns defaults for a never-seen agent', () => {
  const store = freshStore()
  const meta = store.getMeta('new-agent')
  assert.equal(meta.agentId, 'new-agent')
  assert.equal(meta.totalRuns, 0)
  assert.equal(meta.totalMemories, 0)
})

test('getMeta: reflects current memory count after add and remove', () => {
  const store = freshStore()
  store.add(makeInput())
  store.add(makeInput())
  assert.equal(store.getMeta(AGENT_A).totalMemories, 2)

  const e = store.add(makeInput())
  assert.equal(store.getMeta(AGENT_A).totalMemories, 3)

  store.remove(e.id)
  assert.equal(store.getMeta(AGENT_A).totalMemories, 2)
})

test('updateMeta: persists and retrieves custom fields', () => {
  const store = freshStore()
  store.updateMeta(AGENT_A, { totalRuns: 5, lastReflectionAt: 1717977600000 })

  const meta = store.getMeta(AGENT_A)
  assert.equal(meta.totalRuns, 5)
  assert.equal(meta.lastReflectionAt, 1717977600000)
})

// ═══════════════════════════════════════════════════════════════════════════
// Raw signals
// ═══════════════════════════════════════════════════════════════════════════

function makeSignal(overrides = {}) {
  return {
    type: 'positive',
    source: 'user-confirmed',
    runId: 'run-1',
    workflowRunId: 'wf-1',
    stepIndex: 0,
    agentId: AGENT_A,
    projectPath: PROJECT,
    timestamp: Date.now(),
    transcript: 'User confirmed the output.',
    handoff: undefined,
    error: undefined,
    userAction: undefined,
    ...overrides
  }
}

test('saveRawSignal / popRawSignals: round-trips signals and cleans up file', () => {
  const store = freshStore()
  store.saveRawSignal(makeSignal())

  const popped = store.popRawSignals()
  assert.equal(popped.length, 1)
  assert.equal(popped[0].type, 'positive')
  assert.equal(popped[0].workflowRunId, 'wf-1')

  // File cleaned up after pop
  assert.ok(!existsSync(join(RAW_DIR, 'wf-1.json')))
})

test('saveRawSignal: appends multiple signals to the same workflow run file', () => {
  const store = freshStore()
  store.saveRawSignal(makeSignal({ timestamp: 1000 }))
  store.saveRawSignal(makeSignal({ timestamp: 2000 }))

  assert.equal(store.popRawSignals().length, 2)
})

test('removeRawSignal: removes a specific signal and deletes file when empty', () => {
  const store = freshStore()
  const sig = makeSignal({ type: 'negative', source: 'user-rerun', workflowRunId: 'wf-3' })
  store.saveRawSignal(sig)
  store.removeRawSignal(sig)

  assert.equal(store.popRawSignals().length, 0)
  assert.ok(!existsSync(join(RAW_DIR, 'wf-3.json')))
})

test('removeRawSignal: is a no-op for non-existent file (no error thrown)', () => {
  const store = freshStore()
  assert.doesNotThrow(() =>
    store.removeRawSignal(makeSignal({ workflowRunId: 'ghost-wf' }))
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// Reflection config
// ═══════════════════════════════════════════════════════════════════════════

test('getReflectionConfig: returns sensible defaults when nothing saved', () => {
  const store = freshStore()
  const config = store.getReflectionConfig()
  assert.equal(config.vendor, 'claude')
  assert.equal(config.model, 'claude-haiku-4-5-20251001')
  assert.equal(config.enabled, true)
})

test('saveReflectionConfig / getReflectionConfig: round-trips custom config', () => {
  const store = freshStore()
  const custom = { vendor: 'codex', model: 'gpt-5', enabled: false }
  store.saveReflectionConfig(custom)
  assert.deepEqual(store.getReflectionConfig(), custom)
})

test('getReflectionConfig: falls back to default when saved config is malformed', () => {
  const store = freshStore()
  // Write partially broken config directly to disk (only vendor, no model / enabled)
  const configPath = join(MEMORIES_DIR, 'config.json')
  mkdirSync(MEMORIES_DIR, { recursive: true })
  writeFileSync(configPath, JSON.stringify({ vendor: 'claude' }))

  const config = store.getReflectionConfig()
  assert.deepEqual(config, { vendor: 'claude', model: 'claude-haiku-4-5-20251001', enabled: true })
})

test('getReflectionCwd: returns the memories directory path', () => {
  const store = freshStore()
  assert.equal(store.getReflectionCwd(), MEMORIES_DIR)
})

// ═══════════════════════════════════════════════════════════════════════════
// Cross-agent isolation
// ═══════════════════════════════════════════════════════════════════════════

test('agents are isolated: memories for agent A do not leak to agent B', () => {
  const store = freshStore()
  store.add(makeInput({ agentId: AGENT_A, content: 'a-memory' }))
  store.add(makeInput({ agentId: AGENT_B, content: 'b-memory' }))

  assert.equal(store.listAll(AGENT_A).length, 1)
  assert.equal(store.listAll(AGENT_A)[0].content, 'a-memory')
  assert.equal(store.listAll(AGENT_B).length, 1)
  assert.equal(store.listAll(AGENT_B)[0].content, 'b-memory')
})
