import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importProviderStore(userDataDir, safeStorageOverrides = {}) {
  const electronMock = {
    app: { getPath: () => userDataDir },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`safe:${value}`, 'utf8'),
      decryptString: (value) => value.toString('utf8').replace(/^safe:/, ''),
      ...safeStorageOverrides
    }
  }
  globalThis.__providerStoreElectron = electronMock

  const absPath = join(root, 'src/main/ProviderStore.ts')
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const output = transpiled.outputText.replace(
    /import\s+\{\s*app,\s*safeStorage\s*\}\s+from\s+['"]electron['"];?/,
    'const { app, safeStorage } = globalThis.__providerStoreElectron;'
  )
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}-${Math.random()}`
  return import(dataUrl)
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-studio-provider-store-'))
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('save creates a provider with an id and stores an encrypted API key', () =>
  withTempDir(async (dir) => {
    const { ProviderStore } = await importProviderStore(dir)
    const store = new ProviderStore()

    const saved = store.save({
      name: 'DeepSeek',
      format: 'openai-compatible',
      apiKey: 'sk-live-secret',
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-chat'],
      defaultModel: 'deepseek-chat'
    })

    assert.ok(saved.id)
    assert.notEqual(saved.apiKey, 'sk-live-secret')
    assert.equal(saved.name, 'DeepSeek')
    assert.equal(saved.format, 'openai-compatible')

    const raw = readFileSync(join(dir, 'providers.json'), 'utf8')
    assert.doesNotMatch(raw, /sk-live-secret/)
  }))

test('list returns all saved providers without decrypting API keys', () =>
  withTempDir(async (dir) => {
    const { ProviderStore } = await importProviderStore(dir)
    const store = new ProviderStore()

    store.save({ name: 'One', format: 'anthropic', apiKey: 'sk-one', models: ['claude-3-5'] })
    store.save({ name: 'Two', format: 'openai-compatible', apiKey: 'sk-two', models: ['gpt-4o'] })

    const list = store.list()
    assert.equal(list.length, 2)
    assert.deepEqual(
      list.map((provider) => provider.name),
      ['Two', 'One']
    )
    assert.equal(list.some((provider) => provider.apiKey === 'sk-one' || provider.apiKey === 'sk-two'), false)
  }))

test('save updates an existing provider instead of duplicating it', () =>
  withTempDir(async (dir) => {
    const { ProviderStore } = await importProviderStore(dir)
    const store = new ProviderStore()

    const saved = store.save({
      name: 'Original',
      format: 'anthropic',
      apiKey: 'sk-original',
      models: ['claude-3-haiku']
    })
    const updated = store.save({
      id: saved.id,
      name: 'Updated',
      format: 'openai-compatible',
      apiKey: 'sk-updated',
      baseUrl: 'https://example.com/v1',
      models: ['custom-model'],
      defaultModel: 'custom-model'
    })

    assert.equal(updated.id, saved.id)
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].name, 'Updated')
    assert.equal(store.getDecrypted(saved.id).apiKey, 'sk-updated')
  }))

test('save persists API generation limits such as maxOutputTokens', () =>
  withTempDir(async (dir) => {
    const { ProviderStore } = await importProviderStore(dir)
    const store = new ProviderStore()

    const saved = store.save({
      name: 'Long Output Provider',
      format: 'openai-compatible',
      apiKey: 'sk-limit',
      baseUrl: 'https://example.com/v1',
      models: ['long-model'],
      defaultModel: 'long-model',
      maxOutputTokens: 16384
    })

    assert.equal(store.list()[0].maxOutputTokens, 16384)
    assert.equal(store.getDecrypted(saved.id).maxOutputTokens, 16384)
  }))

test('remove deletes a provider by id', () =>
  withTempDir(async (dir) => {
    const { ProviderStore } = await importProviderStore(dir)
    const store = new ProviderStore()

    const saved = store.save({ name: 'Remove me', format: 'anthropic', apiKey: 'sk-remove', models: ['claude'] })
    store.remove(saved.id)

    assert.deepEqual(store.list(), [])
  }))

test('getDecrypted returns a provider with the plaintext API key', () =>
  withTempDir(async (dir) => {
    const { ProviderStore } = await importProviderStore(dir)
    const store = new ProviderStore()

    const saved = store.save({ name: 'Decrypt me', format: 'anthropic', apiKey: 'sk-plain', models: ['claude'] })
    const decrypted = store.getDecrypted(saved.id)

    assert.equal(decrypted.id, saved.id)
    assert.equal(decrypted.apiKey, 'sk-plain')
  }))

test('base64 fallback is used when safeStorage encryption is unavailable', () =>
  withTempDir(async (dir) => {
    const warnings = []
    const originalWarn = console.warn
    console.warn = (message) => warnings.push(String(message))

    try {
      const { ProviderStore } = await importProviderStore(dir, {
        isEncryptionAvailable: () => false
      })
      const store = new ProviderStore()

      const saved = store.save({ name: 'Fallback', format: 'anthropic', apiKey: 'sk-fallback', models: ['claude'] })

      assert.match(saved.apiKey, /^base64:/)
      assert.equal(store.getDecrypted(saved.id).apiKey, 'sk-fallback')
      assert.equal(warnings.some((message) => message.includes('safeStorage encryption unavailable')), true)
    } finally {
      console.warn = originalWarn
    }
  }))
