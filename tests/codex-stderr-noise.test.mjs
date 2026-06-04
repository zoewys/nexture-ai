import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adapterSource = readFileSync(resolve(repoRoot, 'src/main/adapters/codexAdapter.ts'), 'utf8')
const isCodexStderrNoise = extractFunction(adapterSource, 'isCodexStderrNoise')

const pluginIconWarning = [
  '2026-06-04T14:55:36.146981Z  WARN',
  'codex_core_skills::loader: ignoring',
  "interface.icon_small: icon path with '..' must",
  'resolve under plugin assets/'
].join('\n')

const pluginIconLargeWarning = pluginIconWarning.replace('icon_small', 'icon_large')

assert.equal(
  isCodexStderrNoise(pluginIconWarning),
  true,
  'Codex plugin asset icon warnings should be treated as stderr noise'
)

assert.equal(
  isCodexStderrNoise(pluginIconLargeWarning),
  true,
  'Codex plugin large-icon asset warnings should also be treated as stderr noise'
)

assert.equal(
  isCodexStderrNoise('2026-06-04T14:55:36Z WARN Missing or invalid access token'),
  true,
  'existing MCP auth noise should remain filtered'
)

assert.equal(
  isCodexStderrNoise('fatal: not a git repository'),
  false,
  'unrelated stderr should still be visible'
)

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist in codexAdapter.ts`)

  const open = source.indexOf('{', start)
  assert.notEqual(open, -1, `${name} must have a function body`)

  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      const body = source.slice(open + 1, i)
      return new Function('text', body)
    }
  }

  throw new Error(`Could not find end of ${name}`)
}
