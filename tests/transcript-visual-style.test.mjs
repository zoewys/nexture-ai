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

function lastBlock(selector) {
  const matches = [...css.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))]
  assert.ok(matches.length, `Expected ${selector} style block`)
  return matches.at(-1)[1]
}

function lastRootBlock(selector) {
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))]
  assert.ok(matches.length, `Expected root ${selector} style block`)
  return matches.at(-1)[1]
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

test('assistant code blocks stay readable in the light workflow transcript', () => {
  const pre = block('.cli-msg pre')
  const code = block('.cli-msg pre code')

  assert.doesNotMatch(pre, /background:\s*#1a1b1e;/)
  assert.match(pre, /background:\s*rgba\(61, 142, 134, 0\.035\);/)
  assert.match(pre, /color:\s*var\(--neutral-text-primary,\s*var\(--text-strong\)\);/)
  assert.match(pre, /max-height:\s*min\(440px, 52vh\);/)
  assert.match(pre, /white-space:\s*pre-wrap;/)
  assert.match(pre, /overflow-wrap:\s*anywhere;/)
  assert.match(code, /display:\s*block;/)
  assert.match(code, /background:\s*transparent;/)
  assert.match(code, /color:\s*inherit;/)
  assert.match(css, /\[data-theme="dark"\] \.cli-msg pre\s*\{[\s\S]*background:\s*rgba\(10, 15, 26, 0\.78\) !important;[\s\S]*color:\s*var\(--neutral-text-primary\) !important;/)
})

test('chat error messages wrap fully instead of truncating', () => {
  const row = lastRootBlock('.chat-v2-error')
  const text = lastBlock('.chat-v2-error-text')

  assert.match(row, /align-items:\s*flex-start;/)
  assert.match(text, /overflow:\s*visible;/)
  assert.match(text, /text-overflow:\s*clip;/)
  assert.match(text, /white-space:\s*pre-wrap;/)
  assert.match(text, /overflow-wrap:\s*anywhere;/)
  assert.doesNotMatch(text, /white-space:\s*nowrap;/)
  assert.doesNotMatch(text, /text-overflow:\s*ellipsis;/)
})

test('chat system messages keep height and wrap when transcript grows', () => {
  const row = block('.transcript-chat-v2 .chat-row')
  const sharedMeta = block('.chat-v2-tool,\n.chat-v2-file,\n.chat-v2-error,\n.chat-v2-system,\n.chat-v2-think')
  const system = lastRootBlock('.chat-v2-system')

  assert.match(row, /flex:\s*0 0 auto !important;/)
  assert.match(sharedMeta, /flex:\s*0 0 auto;/)
  assert.match(system, /overflow:\s*visible;/)
  assert.match(system, /text-overflow:\s*clip;/)
  assert.match(system, /white-space:\s*pre-wrap;/)
  assert.match(system, /overflow-wrap:\s*anywhere;/)
  assert.doesNotMatch(system, /white-space:\s*nowrap;/)
  assert.doesNotMatch(system, /text-overflow:\s*ellipsis;/)
})

test('workflow card dashboard keeps runs, detail, and step chips readable', () => {
  const runTime = lastRootBlock('.workflow-run-card-time')
  const stepNav = block('.workflow-step-nav')

  assert.match(css, /\.workflow-workspace,\s*\n\.schedule-workspace\s*\{[\s\S]*display:\s*flex !important;/)
  assert.doesNotMatch(runsList, /workflowRunTailLines/)
  assert.doesNotMatch(runsList, /workflow-run-card-tail/)
  assert.match(css, /\.workflow-run-card,\s*\n\.schedule-card\s*\{[\s\S]*min-height:\s*218px !important;[\s\S]*flex-direction:\s*column !important;/)
  assert.match(css, /\.workflow-run-card-top,\s*\n\.schedule-card-header\s*\{[\s\S]*justify-content:\s*space-between !important;/)
  assert.match(runTime, /display:\s*inline-flex(?:\s*!important)?;/)
  assert.match(stepNav, /overflow-x:\s*auto;/)
})
