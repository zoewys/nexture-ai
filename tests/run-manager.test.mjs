import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importRunManager(factoryOverrides = {}) {
  globalThis.__runManagerFactory = {
    createAdapter: () => {
      throw new Error('adapter creation failed')
    },
    getAdapterCapabilities: () => ({
      bidirectionalStdin: false,
      nativeResume: false,
      structuredOutputSchema: false,
      partialTokenStream: false
    }),
    ...factoryOverrides
  }

  const absPath = join(root, 'src/main/RunManager.ts')
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const output = transpiled.outputText.replace(
    /import\s+\{\s*createAdapter,\s*getAdapterCapabilities\s*\}\s+from\s+['"]\.\/adapters\/factory['"];?/,
    'const { createAdapter, getAdapterCapabilities } = globalThis.__runManagerFactory;'
  )
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}-${Math.random()}`
  return import(dataUrl)
}

function createTranscriptStore() {
  return {
    buildResumePrompt: () => '',
    getTranscriptPath: () => ''
  }
}

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('start emits adapter creation failures as run events instead of throwing', async () => {
  const { RunManager } = await importRunManager()
  const manager = new RunManager(createTranscriptStore())
  const events = []
  let runId = ''

  assert.doesNotThrow(() => {
    runId = manager.start(
      { vendor: 'api', prompt: 'hello', cwd: '/tmp', apiProviderId: 'provider-1' },
      (id, event) => events.push({ id, event })
    )
  })

  assert.ok(runId)
  assert.deepEqual(events, [])

  await nextTick()

  assert.deepEqual(
    events.map((item) => item.id),
    [runId, runId]
  )
  assert.equal(events[0].event.kind, 'error')
  assert.equal(events[0].event.message, 'adapter creation failed')
  assert.equal(events[0].event.recoverable, false)
  assert.deepEqual(events[1].event, {
    kind: 'turn-done',
    sessionId: '',
    reason: 'error'
  })
})
