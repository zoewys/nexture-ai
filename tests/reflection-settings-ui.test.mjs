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

test('agent manager renders reflection settings above the agent editor form', () => {
  assert.match(agentManager, /import \{ ReflectionSettingsPanel \}/)
  assert.match(agentManager, /<ReflectionSettingsPanel modelCatalog=\{modelCatalog\} \/>/)
})

test('useReflectionConfig loads and saves typed reflection config through preload', () => {
  assert.match(hook, /window\.api\.reflectionConfigGet\(\)/)
  assert.match(hook, /window\.api\.reflectionConfigSave\(normalized\)/)
  assert.match(hook, /DEFAULT_REFLECTION_CONFIG/)
  assert.match(hook, /normalizeConfig\(next\)/)
})

test('reflection settings panel edits enabled state, vendor, and model', () => {
  assert.match(panel, /useReflectionConfig\(\)/)
  assert.match(panel, /type="checkbox"/)
  assert.match(panel, /checked=\{draft\.enabled\}/)
  assert.match(panel, /ALL_VENDORS\.map/)
  assert.match(panel, /<Select/)
  assert.match(panel, /<ModelSelect/)
  assert.match(panel, /pickDefaultModel\(nextVendor, modelCatalog\)/)
  assert.match(panel, /disabled=\{loading \|\| saving \|\| !dirty \|\| !draft\.model\.trim\(\)\}/)
})

test('reflection settings styles keep the controls compact in agent manager', () => {
  assert.match(styles, /\.reflection-settings-panel/)
  assert.match(styles, /\.reflection-settings-header/)
  assert.match(styles, /\.reflection-settings-toggle input/)
  assert.match(styles, /\.reflection-settings-grid/)
  assert.match(styles, /\.reflection-settings-pill\.is-on/)
  assert.match(styles, /\.reflection-settings-pill\.is-off/)
})
