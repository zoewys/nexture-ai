import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const css = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')

function block(selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `Expected ${selector} style block`)
  return match[1]
}

function rgbaAlpha(styles, property) {
  const match = styles.match(new RegExp(`${property}:\\s*rgba\\([^,]+,[^,]+,[^,]+,\\s*([0-9.]+)\\)`))
  assert.ok(match, `Expected ${property} rgba alpha`)
  return Number(match[1])
}

test('tool calls use compact emphasis instead of a large green card', () => {
  const tool = block('.cli-tool')
  const exec = block('.cli-tool-exec')

  assert.match(tool, /padding:\s*4px 0 4px 18px;/)
  assert.match(tool, /background:\s*transparent;/)
  assert.match(tool, /position:\s*relative;/)
  assert.ok(rgbaAlpha(exec, 'background') <= 0.025)
})

test('assistant messages are the primary transcript reading surface', () => {
  const message = block('.cli-msg')
  const marker = block('.cli-msg::before')

  assert.match(message, /color:\s*var\(--text-strong\);/)
  assert.match(message, /font-size:\s*15px;/)
  assert.match(message, /line-height:\s*1\.72;/)
  assert.match(message, /white-space:\s*normal;/)
  assert.match(marker, /background:\s*var\(--text-strong\);/)
})

test('multi workflow layout keeps runs, detail, and steps readable', () => {
  const workspace = block('.workflow-workspace')
  const runTail = block('.workflow-run-card-tail')
  const steps = block('.workflow-steps-panel')

  assert.match(workspace, /grid-template-columns:\s*400px minmax\(0,\s*1fr\) 250px;/)
  assert.match(runTail, /max-height:\s*62px;/)
  assert.match(steps, /border-left:\s*1px solid var\(--border\);/)
})
