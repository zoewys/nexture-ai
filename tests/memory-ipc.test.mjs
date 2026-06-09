import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ipc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
const preloadTypes = readFileSync(join(root, 'src/preload/index.d.ts'), 'utf8')
const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')

test('main process exposes memory and reflection config ipc handlers', () => {
  assert.match(types, /memoryList: 'memory:list'/)
  assert.match(types, /memoryDelete: 'memory:delete'/)
  assert.match(types, /memoryMeta: 'memory:meta'/)
  assert.match(types, /reflectionConfigGet: 'reflection:config:get'/)
  assert.match(types, /reflectionConfigSave: 'reflection:config:save'/)

  assert.match(ipc, /type MemoryEntry/)
  assert.match(ipc, /type AgentMemoryMeta/)
  assert.match(ipc, /type ReflectionEngineConfig/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.memoryList/)
  assert.match(ipc, /memoryStore\.list\(agentId, projectPath\)/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.memoryDelete/)
  assert.match(ipc, /memoryStore\.remove\(memoryId\)/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.memoryMeta/)
  assert.match(ipc, /memoryStore\.getMeta\(agentId\)/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.reflectionConfigGet/)
  assert.match(ipc, /memoryStore\.getReflectionConfig\(\)/)
  assert.match(ipc, /ipcMain\.handle\(IPC\.reflectionConfigSave/)
  assert.match(ipc, /memoryStore\.saveReflectionConfig\(config\)/)
  assert.match(ipc, /IPC\.agentsDelete/)
  assert.match(ipc, /memoryStore\.removeByAgent\(id\)/)
})

test('preload exposes typed memory and reflection config api methods', () => {
  assert.match(preload, /type MemoryEntry/)
  assert.match(preload, /type AgentMemoryMeta/)
  assert.match(preload, /type ReflectionEngineConfig/)
  assert.match(preload, /memoryList: \(agentId: string, projectPath\?: string\): Promise<MemoryEntry\[]>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.memoryList, agentId, projectPath\)/)
  assert.match(preload, /memoryDelete: \(id: string\): Promise<void>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.memoryDelete, id\)/)
  assert.match(preload, /memoryMeta: \(agentId: string\): Promise<AgentMemoryMeta>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.memoryMeta, agentId\)/)
  assert.match(preload, /reflectionConfigGet: \(\): Promise<ReflectionEngineConfig>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.reflectionConfigGet\)/)
  assert.match(preload, /reflectionConfigSave: \(config: ReflectionEngineConfig\): Promise<void>/)
  assert.match(preload, /ipcRenderer\.invoke\(IPC\.reflectionConfigSave, config\)/)
  assert.match(preloadTypes, /AgentStudioApi/)
})
