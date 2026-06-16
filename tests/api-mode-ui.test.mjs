import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

test('useProviders hook loads, saves, deletes, tests, and reloads API providers', () => {
  assert.equal(existsSync(join(root, 'src/renderer/src/useProviders.ts')), true)
  const hook = source('src/renderer/src/useProviders.ts')

  assert.match(hook, /providers: ApiProviderConfig\[\]/)
  assert.match(hook, /window\.api\.listProviders\(\)/)
  assert.match(hook, /window\.api\.saveProvider\(input\)/)
  assert.match(hook, /window\.api\.deleteProvider\(id\)/)
  assert.match(hook, /window\.api\.testProvider\(id\)/)
  assert.match(hook, /reload/)
})

test('settings panel embeds ProviderSettings between CLI and data management sections', () => {
  const settings = source('src/renderer/src/SettingsPanel.tsx')

  assert.match(settings, /import \{ ProviderSettings \} from '\.\/ProviderSettings'/)
  assert.match(settings, /import \{ useProviders \} from '\.\/useProviders'/)
  assert.match(settings, /const providerState = useProviders\(\)/)
  assert.match(settings, /API 供应商/)
  assert.match(settings, /<ProviderSettings \{\.\.\.providerState\} \/>/)
  assert.match(settings, /API 调用日志/)
  assert.match(settings, /listApiLogs\(\)/)
  assert.match(settings, /clearApiLogs\(\)/)
  assert.match(settings, /openApiLogDir\(\)/)
})

test('ProviderSettings implements compact provider list and inline form with lucide actions', () => {
  assert.equal(existsSync(join(root, 'src/renderer/src/ProviderSettings.tsx')), true)
  const component = source('src/renderer/src/ProviderSettings.tsx')

  assert.match(component, /provider-grid/)
  assert.match(component, /provider-card/)
  assert.match(component, /provider-form/)
  assert.match(component, /editingId/)
  assert.match(component, /formOpen/)
  assert.match(component, /testConnection/)
  assert.match(component, /Pencil/)
  assert.match(component, /Trash2/)
  assert.match(component, /Plus/)
  assert.match(component, /maxOutputTokens/)
  assert.match(component, /最大输出 Tokens/)
})

test('single run panel supports API vendor tabs, provider selection, and API run config', () => {
  const panel = source('src/renderer/src/SingleRunPanel.tsx')

  assert.match(panel, /import \{ useProviders \} from '\.\/useProviders'/)
  assert.match(panel, /vendor-tabs/)
  assert.match(panel, /vendor-tab/)
  assert.match(panel, /selectedProviderId/)
  assert.match(panel, /providerState\.providers/)
  assert.match(panel, /apiProviderId: vendor === 'api' \? selectedProviderId/)
  assert.match(panel, /vendor === 'codex' &&/)
  assert.match(panel, /vendor === 'api'/)
  assert.match(panel, /apiMaxSteps/)
  assert.match(panel, /apiTemperature/)
  assert.match(panel, /apiTopP/)
  assert.match(panel, /attachments: attachedFiles\.map/)
  assert.match(panel, /Max steps/)
  assert.match(panel, /Temperature/)
  assert.match(panel, /Top P/)
})

test('agent manager supports API vendor tabs and persists apiProviderId', () => {
  const manager = source('src/renderer/src/AgentManager.tsx')

  assert.match(manager, /import \{ useProviders \} from '\.\/useProviders'/)
  assert.match(manager, /vendor-tabs/)
  assert.match(manager, /apiProviderId/)
  assert.match(manager, /draft\.vendor === 'api'/)
  assert.match(manager, /providerState\.providers/)
  assert.match(manager, /setDraft\(\(d\) => \(\{[\s\S]*apiProviderId/)
  assert.match(manager, /apiTemperature/)
  assert.match(manager, /apiTopP/)
  assert.match(manager, /Temperature/)
  assert.match(manager, /Top P/)
})

test('transcript viewer renders permission request cards and responds through preload', () => {
  const transcript = source('src/renderer/src/TranscriptViewer.tsx')

  assert.match(transcript, /permission-request/)
  assert.match(transcript, /perm-block/)
  assert.match(transcript, /respondPermission\(requestId, allowed\)/)
  assert.match(transcript, /allowAllForRun/)
  assert.match(transcript, /LockKeyhole/)
  assert.match(transcript, /Check/)
  assert.match(transcript, /X/)
  assert.match(transcript, /renderTodoResult/)
  assert.match(transcript, /chat-todo/)
  assert.match(transcript, /todo_write/)
  assert.match(transcript, /ListTodo/)
})

test('styles define provider, vendor tab, and permission request classes', () => {
  const styles = source('src/renderer/src/styles.css')

  for (const className of [
    'provider-grid',
    'provider-card',
    'provider-form',
    'vendor-tabs',
    'vendor-tab',
    'perm-block',
    'perm-block-pending',
    'perm-badge-allowed'
  ]) {
    assert.match(styles, new RegExp(`\\.${className}`))
  }
})
