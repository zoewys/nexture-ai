import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const css = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')
const runsList = readFileSync(join(root, 'src/renderer/src/WorkflowRunsList.tsx'), 'utf8')

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
  assert.match(message, /font-size:\s*13px;/)
  assert.match(message, /line-height:\s*1\.65;/)
  assert.match(message, /white-space:\s*normal;/)
  assert.match(marker, /background:\s*var\(--text-strong\);/)
})

test('multi workflow layout keeps runs, detail, and step chips readable', () => {
  const workspace = block('.workflow-workspace')
  const runTail = block('.workflow-run-card-tail')
  const runTailLine = block('.workflow-run-card-tail span')
  const stepNav = block('.workflow-step-nav')

  assert.match(workspace, /grid-template-columns:\s*400px minmax\(0,\s*1fr\);/)
  assert.match(runsList, /workflowRunTailLines\(run,\s*2\)/)
  assert.match(runTail, /max-height:\s*4\.5em;/)
  assert.match(runTailLine, /white-space:\s*nowrap;/)
  assert.match(runTailLine, /text-overflow:\s*ellipsis;/)
  assert.match(stepNav, /overflow-x:\s*auto;/)
})
