import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

test('shared contract exposes API vendor, provider config, run fields, agent fields, and IPC channels', () => {
  const types = source('src/shared/types.ts')

  assert.match(types, /export type AgentVendor = 'claude' \| 'codex' \| 'api'/)
  assert.match(types, /export const ALL_VENDORS: AgentVendor\[\] = \['claude', 'codex', 'api'\]/)
  assert.match(types, /export type ApiProviderFormat = 'anthropic' \| 'openai-compatible'/)
  assert.match(types, /export interface ApiProviderConfig/)
  assert.match(types, /format: ApiProviderFormat/)
  assert.match(types, /apiKey: string/)
  assert.match(types, /baseUrl\?: string/)
  assert.match(types, /models: string\[\]/)
  assert.match(types, /defaultModel\?: string/)
  assert.match(types, /apiProviderId\?: string/)
  assert.match(types, /apiMaxSteps\?: number/)
  assert.match(types, /providersList: 'providers:list'/)
  assert.match(types, /providersSave: 'providers:save'/)
  assert.match(types, /providersDelete: 'providers:delete'/)
  assert.match(types, /providersTest: 'providers:test'/)
  assert.match(types, /permissionRequest: 'permission:request'/)
  assert.match(types, /permissionRespond: 'permission:respond'/)
})

test('main process provider plumbing is wired through store, model catalog, factory, run manager, and ipc', () => {
  assert.equal(existsSync(join(root, 'src/main/ProviderStore.ts')), true)
  assert.equal(existsSync(join(root, 'src/main/adapters/apiAdapter.ts')), true)
  assert.equal(existsSync(join(root, 'src/main/adapters/api-tools/PermissionGuard.ts')), true)

  const factory = source('src/main/adapters/factory.ts')
  const runManager = source('src/main/RunManager.ts')
  const ipc = source('src/main/ipc.ts')
  const cliModels = source('src/main/cliModels.ts')
  const workflowManager = source('src/main/WorkflowManager.ts')

  assert.match(factory, /export interface AdapterContext/)
  assert.match(factory, /providerStore\?: ProviderStore/)
  assert.match(factory, /runConfig\?: RunConfig/)
  assert.match(factory, /case 'api':/)
  assert.match(factory, /getDecrypted\(ctx\.runConfig\.apiProviderId\)/)
  assert.match(factory, /new ApiAdapter\(/)

  assert.match(runManager, /providerStore\?: ProviderStore/)
  assert.match(runManager, /createAdapter\(config\.vendor, \{/)
  assert.match(runManager, /emitEvent: \(ev\) => onEvent\(id, ev\)/)

  assert.match(ipc, /new ProviderStore\(/)
  assert.match(ipc, /new RunManager\(transcriptStore, providerStore\)/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.providersList/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.providersSave/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.providersDelete/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.providersTest/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.permissionRespond/)
  assert.match(ipc, /listCliModels\(providerStore\)/)

  assert.match(cliModels, /listApiModels\(providerStore\)/)
  assert.match(cliModels, /return \{ claude, codex, api \}/)

  assert.match(workflowManager, /apiProviderId: agent\.apiProviderId/)
})

test('preload exposes provider and permission methods to renderer', () => {
  const preload = source('src/preload/index.ts')

  assert.match(preload, /listProviders: \(\)/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.providersList\)/)
  assert.match(preload, /saveProvider: \(input:/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.providersSave, input\)/)
  assert.match(preload, /deleteProvider: \(id: string\)/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.providersDelete, id\)/)
  assert.match(preload, /testProvider: \(id: string\)/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.providersTest, id\)/)
  assert.match(preload, /respondPermission: \(requestId: string, allowed: boolean\)/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.permissionRespond, requestId, allowed\)/)
})
