import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const agentManager = readFileSync(join(root, 'src/renderer/src/AgentManager.tsx'), 'utf8')
const panel = readFileSync(join(root, 'src/renderer/src/ReflectionSettingsPanel.tsx'), 'utf8')
const hook = readFileSync(join(root, 'src/renderer/src/useReflectionConfig.ts'), 'utf8')
const styles = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')

test('agent manager renders reflection settings below the system prompt field', () => {
  assert.match(agentManager, /import \{ ReflectionSettingsPanel \}/)
  assert.match(agentManager, /<ReflectionSettingsPanel modelCatalog=\{modelCatalog\} \/>/)

  const systemPromptIndex = agentManager.indexOf('<span>System Prompt</span>')
  const settingsIndex = agentManager.indexOf('<ReflectionSettingsPanel modelCatalog={modelCatalog} />')
  const memoriesIndex = agentManager.indexOf('<AgentMemoryPanel agentId={editingId} />')

  assert.ok(systemPromptIndex > -1)
  assert.ok(settingsIndex > systemPromptIndex)
  assert.ok(memoriesIndex > settingsIndex)
})

test('useReflectionConfig loads and saves typed reflection config through preload', () => {
  assert.match(hook, /window\.api\.reflectionConfigGet\(\)/)
  assert.match(hook, /window\.api\.reflectionConfigSave\(normalized\)/)
  assert.match(hook, /DEFAULT_REFLECTION_CONFIG/)
  assert.match(hook, /normalizeConfig\(next\)/)
})

test('reflection settings panel edits enabled state, vendor, and model', () => {
  assert.match(panel, /import \{ ChevronRight \} from 'lucide-react'/)
  assert.match(panel, /useReflectionConfig\(\)/)
  assert.match(panel, /className="reflection-settings-chevron"/)
  assert.match(panel, /type="checkbox"/)
  assert.match(panel, /checked=\{draft\.enabled\}/)
  assert.match(panel, /ALL_VENDORS\.map/)
  assert.match(panel, /<Select/)
  assert.match(panel, /<ModelSelect/)
  assert.match(panel, /pickDefaultModel\(nextVendor, modelCatalog\)/)
  assert.match(panel, /disabled=\{loading \|\| saving \|\| !dirty \|\| !draft\.model\.trim\(\)\}/)
})

test('reflection settings styles keep the controls compact in agent manager', () => {
  assert.match(styles, /Agent memory panel light-theme QA overrides/)
  assert.match(styles, /\.agent-editor \.reflection-settings-panel,\s*\n\.agent-editor \.agent-memory-panel\s*\{[\s\S]*background:\s*rgba\(255, 255, 255, 0\.66\) !important;/)
  assert.match(styles, /\.agent-editor \.reflection-settings-summary::before,\s*\n\.agent-editor \.agent-memory-summary::before\s*\{[\s\S]*content:\s*none !important;/)
  assert.match(styles, /\.agent-editor \.reflection-settings-chevron,\s*\n\.agent-editor \.agent-memory-chevron\s*\{[\s\S]*color:\s*var\(--brand-primary\) !important;/)
  assert.match(styles, /\.reflection-settings-panel/)
  assert.match(styles, /\.reflection-settings-header/)
  assert.match(styles, /\.reflection-settings-toggle input/)
  assert.match(styles, /\.reflection-settings-grid/)
  assert.match(styles, /\.reflection-settings-pill\.is-on/)
  assert.match(styles, /\.reflection-settings-pill\.is-off/)
})
