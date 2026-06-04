import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, '.agent-studio/codex-options-test')
rmSync(outDir, { recursive: true, force: true })
execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.codex-options-test.json'], {
  cwd: root,
  stdio: 'inherit'
})

const { buildCodexExecArgs } = await import(
  pathToFileURL(resolve(outDir, 'src/main/adapters/codexArgs.js')).href
)

const args = buildCodexExecArgs(
  {
    model: 'gpt-5.5',
    addDirs: ['/tmp/agent-studio-extra'],
    resumeFrom: { sessionId: 'thread-123', vendor: 'codex' },
    codexReasoningEffort: 'high',
    codexServiceTier: 'priority'
  },
  'hello codex'
)

assert.deepEqual(args, [
  'exec',
  '--model',
  'gpt-5.5',
  '--add-dir',
  '/tmp/agent-studio-extra',
  '-c',
  'model_reasoning_effort="high"',
  '-c',
  'service_tier="priority"',
  '--json',
  '--resume',
  'thread-123',
  '--dangerously-bypass-approvals-and-sandbox',
  '--skip-git-repo-check',
  'hello codex'
])

const defaultArgs = buildCodexExecArgs({}, 'plain')
assert.equal(defaultArgs.includes('model_reasoning_effort="high"'), false)
assert.equal(defaultArgs.includes('service_tier="priority"'), false)
