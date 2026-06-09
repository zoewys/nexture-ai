import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const types = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')
const store = readFileSync(join(root, 'src/main/memory/MemoryStore.ts'), 'utf8')

test('shared memory contract exposes entries, signals, config, and IPC channels', () => {
  assert.match(types, /export interface MemoryEntry/)
  assert.match(types, /export type MemoryCategory = 'method' \| 'knowledge' \| 'preference' \| 'avoidance'/)
  assert.match(types, /export interface MemorySignal/)
  assert.match(types, /export interface ReflectionEngineConfig/)
  assert.match(types, /DEFAULT_REFLECTION_CONFIG/)
  assert.match(types, /memoryList: 'memory:list'/)
  assert.match(types, /memoryDelete: 'memory:delete'/)
  assert.match(types, /memoryMeta: 'memory:meta'/)
  assert.match(types, /reflectionConfigGet: 'reflection:config:get'/)
  assert.match(types, /reflectionConfigSave: 'reflection:config:save'/)
})

test('memory store persists global, project, raw signal, meta, and config files', () => {
  assert.match(store, /export function hashProjectPath/)
  assert.match(store, /createHash\('sha256'\)/)
  assert.match(store, /app\.getPath\('userData'\).*'memories'/s)
  assert.match(store, /global\.json/)
  assert.match(store, /projects/)
  assert.match(store, /raw/)
  assert.match(store, /config\.json/)
})

test('memory store implements core add list remove reinforce and config APIs', () => {
  assert.match(store, /list\(agentId: string, projectPath\?: string\): MemoryEntry\[\]/)
  assert.match(store, /listAll\(agentId: string\): MemoryEntry\[\]/)
  assert.match(store, /add\(input: MemoryAddInput\): MemoryEntry/)
  assert.match(store, /remove\(memoryId: string\): void/)
  assert.match(store, /removeByAgent\(agentId: string\): void/)
  assert.match(store, /reinforce\(memoryId: string\): void/)
  assert.match(store, /getMeta\(agentId: string\): AgentMemoryMeta/)
  assert.match(store, /updateMeta\(agentId: string, patch: Partial<AgentMemoryMeta>\): void/)
  assert.match(store, /saveRawSignal\(signal: MemorySignal\): void/)
  assert.match(store, /removeRawSignal\(signal: MemorySignal\): void/)
  assert.match(store, /popRawSignals\(\): MemorySignal\[\]/)
  assert.match(store, /getReflectionConfig\(\): ReflectionEngineConfig/)
  assert.match(store, /getReflectionCwd\(\): string/)
  assert.match(store, /saveReflectionConfig\(config: ReflectionEngineConfig\): void/)
})
