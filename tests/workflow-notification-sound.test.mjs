import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sound = readFileSync(join(root, 'src/renderer/src/workflowNotificationSound.ts'), 'utf8')
const workspace = readFileSync(join(root, 'src/renderer/src/WorkflowWorkspace.tsx'), 'utf8')
const runView = readFileSync(join(root, 'src/renderer/src/workflowRunView.ts'), 'utf8')

test('workflow transitions trigger deduped notification sounds from every run', () => {
  assert.match(runView, /workflowNotificationForRun\(run/)
  assert.match(runView, /run\.status === 'awaiting-confirm'/)
  assert.match(runView, /interrupted/)
  assert.match(workspace, /for \(const run of workflows\.runs\)/)
  assert.match(workspace, /playedNotificationKeys\.current\.has\(notification\.key\)/)
  assert.match(workspace, /playWorkflowNotificationSound\(notification\.sound\)/)
  assert.match(workspace, /prepareWorkflowNotificationSound\(\)/)
})

test('workflow notification sound is generated with Web Audio', () => {
  assert.match(sound, /new AudioContextImpl\(\)/)
  assert.match(sound, /createOscillator\(\)/)
  assert.match(sound, /createGain\(\)/)
  assert.match(sound, /case 'confirm'/)
  assert.match(sound, /case 'finished'/)
})

test('workflow notification sound supports global on off preference', () => {
  assert.match(sound, /readWorkflowNotificationSoundEnabled/)
  assert.match(sound, /writeWorkflowNotificationSoundEnabled/)
  assert.match(sound, /localStorage/)
  assert.match(workspace, /soundEnabled/)
  assert.match(workspace, /playedNotificationKeys/)
})
