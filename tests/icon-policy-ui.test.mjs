import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const rendererRoot = join(root, 'src/renderer/src')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const sourceFiles = walk(rendererRoot)
  .filter((path) => ['.ts', '.tsx', '.css'].includes(extname(path)))
  .map((path) => ({
    path,
    text: readFileSync(path, 'utf8')
  }))

test('renderer production UI uses lucide icons instead of inline SVG helpers or character icons', () => {
  const tsx = sourceFiles.filter((file) => file.path.endsWith('.tsx'))
  for (const file of tsx) {
    assert.doesNotMatch(file.text, /function\s+SvgIcon\b/, `${file.path} defines a local SvgIcon helper`)
    assert.doesNotMatch(file.text, /<svg\b/, `${file.path} contains inline icon svg markup`)
  }

  const bannedCharacterIcons = [
    '+ New',
    'Open ▾',
    '▲',
    '▼',
    '⟳',
    '✓ 已就绪',
    "content: '✓'"
  ]

  for (const file of sourceFiles) {
    for (const banned of bannedCharacterIcons) {
      assert.equal(
        file.text.includes(banned),
        false,
        `${file.path} contains banned icon-like text: ${banned}`
      )
    }
  }
})
