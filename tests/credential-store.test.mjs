import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importCredentialStore(userDataDir, safeStorageOverrides = {}) {
  const electronMock = {
    app: { getPath: () => userDataDir },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`safe:${value}`, 'utf8'),
      decryptString: (value) => value.toString('utf8').replace(/^safe:/, ''),
      ...safeStorageOverrides
    }
  }
  globalThis.__credentialStoreElectron = electronMock

  const absPath = join(root, 'src/main/CredentialStore.ts')
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
    'const { app, safeStorage } = globalThis.__credentialStoreElectron;'
  )
  const dataUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Date.now()}-${Math.random()}`
  return import(dataUrl)
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-studio-credential-store-'))
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }))
}

test('CredentialStore saves encrypted values and decrypts on demand', () =>
  withTempDir(async (dir) => {
    const { CredentialStore } = await importCredentialStore(dir)
    const store = new CredentialStore()

    const saved = store.save({
      name: 'Google SA',
      envKey: 'GOOGLE_SERVICE_ACCOUNT_JSON',
      value: '{"client_email":"bot@example.com"}'
    })

    assert.ok(saved.id)
    assert.equal(saved.name, 'Google SA')
    assert.equal(saved.envKey, 'GOOGLE_SERVICE_ACCOUNT_JSON')
    assert.notEqual(saved.value, '{"client_email":"bot@example.com"}')

    const raw = readFileSync(join(dir, 'credentials.json'), 'utf8')
    assert.doesNotMatch(raw, /bot@example\.com/)
    assert.equal(store.getDecrypted(saved.id).value, '{"client_email":"bot@example.com"}')
  }))

test('CredentialStore validates envKey and enforces uniqueness', () =>
  withTempDir(async (dir) => {
    const { CredentialStore } = await importCredentialStore(dir)
    const store = new CredentialStore()

    store.save({ name: 'Semrush', envKey: 'SEMRUSH_API_KEY', value: 'secret' })

    assert.throws(
      () => store.save({ name: 'Bad', envKey: 'semrush_api_key', value: 'secret' }),
      /环境变量名只能包含/
    )
    assert.throws(
      () => store.save({ name: 'Duplicate', envKey: 'SEMRUSH_API_KEY', value: 'secret-2' }),
      /环境变量名已存在/
    )
  }))

test('CredentialStore keeps the existing encrypted value when editing with a blank value', () =>
  withTempDir(async (dir) => {
    const { CredentialStore } = await importCredentialStore(dir)
    const store = new CredentialStore()

    const saved = store.save({ name: 'Main GA', envKey: 'MAIN_GA_PROPERTY_ID', value: 'G-OLD' })
    store.save({ id: saved.id, name: 'Main GA Updated', envKey: 'MAIN_GA_PROPERTY_ID', value: '' })

    const updated = store.getDecrypted(saved.id)
    assert.equal(updated.name, 'Main GA Updated')
    assert.equal(updated.value, 'G-OLD')
  }))

test('CredentialStore uses base64 fallback when safeStorage is unavailable', () =>
  withTempDir(async (dir) => {
    const warnings = []
    const originalWarn = console.warn
    console.warn = (message) => warnings.push(String(message))

    try {
      const { CredentialStore } = await importCredentialStore(dir, {
        isEncryptionAvailable: () => false
      })
      const store = new CredentialStore()
      const saved = store.save({ name: 'Fallback', envKey: 'PROJECT_DOMAIN', value: 'example.com' })

      assert.match(saved.value, /^base64:/)
      assert.equal(store.getDecrypted(saved.id).value, 'example.com')
      assert.equal(warnings.some((message) => message.includes('safeStorage encryption unavailable')), true)
    } finally {
      console.warn = originalWarn
    }
  }))
