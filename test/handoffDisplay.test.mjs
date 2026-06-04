import test from 'node:test'
import assert from 'node:assert/strict'

import { formatHandoffDisplay } from '../src/renderer/src/handoffDisplay.ts'

test('formats summary, artifact rows, and next-step guidance from parsed handoff JSON', () => {
  const display = formatHandoffDisplay({
    summary: 'Requirements are ready for design.',
    artifacts: [
      {
        path: 'docs/ui-spec.md',
        description: 'Workflow handoff UI requirements',
        type: 'design'
      },
      {
        path: 'TEST_PLAN.md',
        description: 'Regression checks for parsed display'
      }
    ],
    nextStepGuidance: 'Design the structured handoff panel next.'
  })

  assert.equal(display.summary.label, 'Summary')
  assert.equal(display.summary.text, 'Requirements are ready for design.')
  assert.deepEqual(display.artifacts.headers, ['Type', 'Path', 'Description'])
  assert.deepEqual(display.artifacts.rows, [
    {
      type: 'design',
      path: 'docs/ui-spec.md',
      description: 'Workflow handoff UI requirements'
    },
    {
      type: 'other',
      path: 'TEST_PLAN.md',
      description: 'Regression checks for parsed display'
    }
  ])
  assert.deepEqual(display.guidance, {
    label: 'Next Step Guidance',
    text: 'Design the structured handoff panel next.'
  })
})

test('formats an empty artifact list without guidance', () => {
  const display = formatHandoffDisplay({
    summary: 'No files were created.',
    artifacts: []
  })

  assert.deepEqual(display.artifacts.rows, [])
  assert.equal(display.artifacts.emptyText, 'No artifacts reported.')
  assert.equal(display.guidance, null)
})
