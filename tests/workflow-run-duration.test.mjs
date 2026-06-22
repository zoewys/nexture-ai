import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importDurationModule() {
  const absPath = join(root, 'src/renderer/src/workflowRunDuration.ts')
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}#${Date.now()}-${Math.random()}`
  return import(dataUrl)
}

function runWithExecutions(executions) {
  return {
    steps: [
      {
        executions
      }
    ]
  }
}

test('workflow run duration sums execution spans instead of wall-clock run age', async () => {
  const { formatWorkflowRunActualDuration, workflowRunActualDurationMs } = await importDurationModule()
  const fourDays = 4 * 24 * 60 * 60 * 1000
  const run = runWithExecutions([
    { status: 'done', startedAt: 0, finishedAt: 111_597 },
    { status: 'error', startedAt: fourDays, finishedAt: fourDays + 1_153 },
    { status: 'done', startedAt: fourDays + 21_852, finishedAt: fourDays + 219_327 },
    { status: 'done', startedAt: fourDays + 478_315, finishedAt: fourDays + 603_524 },
    { status: 'done', startedAt: fourDays + 860_000, finishedAt: fourDays + 1_080_181 }
  ])

  assert.equal(workflowRunActualDurationMs(run), 655_615)
  assert.equal(formatWorkflowRunActualDuration(run), '10m 56s')
})

test('workflow run duration includes only active running spans when unfinished', async () => {
  const { formatWorkflowRunActualDuration } = await importDurationModule()
  const run = runWithExecutions([
    { status: 'done', startedAt: 0, finishedAt: 30_000 },
    { status: 'running', startedAt: 60_000 },
    { status: 'awaiting-input', startedAt: 1_000 }
  ])

  assert.equal(formatWorkflowRunActualDuration(run, 150_000), '2m 0s')
})

test('workflow run duration is used by list and schedule history views', () => {
  const runsList = readFileSync(join(root, 'src/renderer/src/WorkflowRunsList.tsx'), 'utf8')
  const scheduleDetail = readFileSync(join(root, 'src/renderer/src/ScheduleDetail.tsx'), 'utf8')
  const manager = readFileSync(join(root, 'src/main/WorkflowManager.ts'), 'utf8')

  assert.match(runsList, /formatWorkflowRunActualDuration\(run\)/)
  assert.doesNotMatch(runsList, /run\.finishedAt \?\? Date\.now\(\)/)
  assert.match(scheduleDetail, /formatWorkflowRunActualDuration\(run\)/)
  assert.match(manager, /private enterAwaitingInput[\s\S]*execution\.finishedAt = execution\.finishedAt \?\? Date\.now\(\)/)
  assert.match(manager, /finishInteractiveStep[\s\S]*execution\.finishedAt = execution\.finishedAt \?\? Date\.now\(\)/)
})
