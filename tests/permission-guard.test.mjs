import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importPermissionGuard() {
  const absPath = join(root, 'src/main/adapters/api-tools/PermissionGuard.ts')
  const outDir = mkdtempSync(join(tmpdir(), 'agent-studio-permission-'))
  const outPath = join(outDir, `PermissionGuard-${Date.now()}-${Math.random()}.mjs`)
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  writeFileSync(outPath, transpiled.outputText, 'utf8')
  return import(`${pathToFileURL(outPath).href}?cache=${Date.now()}-${Math.random()}`)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('bypassPermissions allows all requests', async () => {
  const { PermissionGuard } = await importPermissionGuard()
  const guard = new PermissionGuard('bypassPermissions', () => {})

  assert.equal(await guard.request('bash', 'echo hi'), true)
  assert.equal(await guard.request('file_write', '/tmp/a'), true)
})

test('plan mode rejects all requests', async () => {
  const { PermissionGuard } = await importPermissionGuard()
  const guard = new PermissionGuard('plan', () => {})

  assert.equal(await guard.request('bash', 'echo hi'), false)
  assert.equal(await guard.request('file_write', '/tmp/a'), false)
})

test('acceptEdits allows edit tools and waits for bash approval', async () => {
  const { PermissionGuard } = await importPermissionGuard()
  const events = []
  const guard = new PermissionGuard('acceptEdits', (event) => events.push(event))

  assert.equal(await guard.request('file_edit', '/tmp/a'), true)

  const pending = guard.request('bash', 'npm test')
  assert.equal(await Promise.race([pending.then(() => 'resolved'), delay(20).then(() => 'pending')]), 'pending')
  const payload = JSON.parse(events[0].text)
  guard.respond(payload.requestId, true)
  assert.equal(await pending, true)
})

test('default mode emits a permission request and resolves true or false from respond', async () => {
  const { PermissionGuard } = await importPermissionGuard()
  const events = []
  const guard = new PermissionGuard('default', (event) => events.push(event))

  const allowed = guard.request('bash', 'pnpm test')
  const first = JSON.parse(events[0].text)
  assert.equal(events[0].kind, 'system')
  assert.equal(first.type, 'permission-request')
  assert.equal(first.toolName, 'bash')
  assert.equal(first.description, 'pnpm test')
  guard.respond(first.requestId, true)
  assert.equal(await allowed, true)

  const denied = guard.request('file_write', '/tmp/a')
  const second = JSON.parse(events[1].text)
  guard.respond(second.requestId, false)
  assert.equal(await denied, false)
})

test('permission requests time out as denied', async () => {
  const { PermissionGuard } = await importPermissionGuard()
  const guard = new PermissionGuard('default', () => {})
  guard.timeoutMs = 20

  assert.equal(await guard.request('bash', 'sleep'), false)
})

test('global permission responder routes approvals to the matching guard', async () => {
  const { PermissionGuard, respondToPermissionRequest } = await importPermissionGuard()
  const events = []
  const guard = new PermissionGuard('default', (event) => events.push(event))

  const pending = guard.request('bash', 'pnpm test')
  const payload = JSON.parse(events[0].text)
  respondToPermissionRequest(payload.requestId, true)

  assert.equal(await pending, true)
})
