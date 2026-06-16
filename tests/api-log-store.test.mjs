import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importApiCallLogStore(userDataDir) {
  globalThis.__apiLogElectron = {
    app: { getPath: () => userDataDir },
    shell: { openPath: async (target) => `opened:${target}` }
  }
  const absPath = join(root, 'src/main/ApiCallLogStore.ts')
  const outDir = mkdtempSync(join(tmpdir(), 'agent-studio-api-log-test-'))
  const outPath = join(outDir, `ApiCallLogStore-${Date.now()}-${Math.random()}.mjs`)
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const output = transpiled.outputText.replace(
    /import\s+\{\s*app,\s*shell\s*\}\s+from\s+['"]electron['"];?/,
    'const { app, shell } = globalThis.__apiLogElectron;'
  )
  writeFileSync(outPath, output, 'utf8')
  return import(`${pathToFileURL(outPath).href}?cache=${Date.now()}-${Math.random()}`)
}

test('ApiCallLogStore writes JSONL logs, redacts secrets, lists, gets, clears, and opens the log dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-studio-api-log-'))
  try {
    const { ApiCallLogStore } = await importApiCallLogStore(dir)
    const store = new ApiCallLogStore()

    const entry = store.record({
      source: 'single',
      providerId: 'provider-1',
      providerName: 'DeepSeek',
      format: 'openai-compatible',
      baseUrl: 'https://api.example/v1',
      apiKey: 'sk-live-secret',
      model: 'deepseek-chat',
      cwd: '/repo',
      messagesSummary: 'Authorization: Bearer sk-live-secret\nUser asked for a change.',
      systemSummary: 'System prompt with sk-live-secret inside.',
      toolNames: ['bash', 'file_edit'],
      apiMaxSteps: 10,
      temperature: 0.2,
      topP: 1,
      durationMs: 1234,
      status: 'success',
      usage: { inputTokens: 10, outputTokens: 20 },
      structuredOutput: 'fallback'
    })

    assert.ok(entry.id)
    assert.equal(entry.status, 'success')
    assert.doesNotMatch(JSON.stringify(entry), /sk-live-secret/)
    assert.doesNotMatch(JSON.stringify(entry), /Authorization/i)

    const listed = store.list({ limit: 5 })
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, entry.id)
    assert.deepEqual(store.get(entry.id), listed[0])

    const raw = readFileSync(join(dir, 'api-call-logs', `${new Date().toISOString().slice(0, 10)}.jsonl`), 'utf8')
    assert.doesNotMatch(raw, /sk-live-secret/)
    assert.doesNotMatch(raw, /Authorization/i)

    assert.match(await store.openDir(), /opened:/)
    store.clear()
    assert.deepEqual(store.list(), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
