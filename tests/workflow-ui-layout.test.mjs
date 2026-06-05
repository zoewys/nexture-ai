import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const css = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8')
const workspace = readFileSync(join(root, 'src/renderer/src/WorkflowWorkspace.tsx'), 'utf8')
const runsList = readFileSync(join(root, 'src/renderer/src/WorkflowRunsList.tsx'), 'utf8')
const detail = readFileSync(join(root, 'src/renderer/src/WorkflowRunDetail.tsx'), 'utf8')
const steps = readFileSync(join(root, 'src/renderer/src/WorkflowStepsPanel.tsx'), 'utf8')
const handoff = readFileSync(join(root, 'src/renderer/src/HandoffPanel.tsx'), 'utf8')
const drawer = readFileSync(join(root, 'src/renderer/src/NewWorkflowRunDrawer.tsx'), 'utf8')
const templatesView = readFileSync(join(root, 'src/renderer/src/TemplatesView.tsx'), 'utf8')
const app = readFileSync(join(root, 'src/renderer/src/App.tsx'), 'utf8')

test('workflow workspace uses runs-detail-steps layout', () => {
  assert.match(css, /\.workflow-workspace\s*\{/)
  assert.match(css, /grid-template-columns:\s*400px minmax\(0,\s*1fr\) 250px;/)
  assert.match(workspace, /WorkflowRunsList/)
  assert.match(workspace, /WorkflowRunDetail/)
  assert.match(workspace, /WorkflowStepsPanel/)
})

test('runs list contains realtime tail but no confirm button', () => {
  assert.match(runsList, /workflowRunTailLines/)
  assert.match(runsList, /onSelectRun/)
  assert.doesNotMatch(runsList, /确认详情|Confirm/)
})

test('steps panel lives on the right and supports long workflows', () => {
  assert.match(steps, /workflow-steps-panel/)
  assert.match(steps, /placeholder="搜索步骤 \/ agent"/)
  assert.match(steps, /overflow-y/)
})

test('run detail owns transcript, handoff, and composer', () => {
  assert.match(detail, /TranscriptViewer/)
  assert.match(detail, /HandoffPanel/)
  assert.match(detail, /workflow-cli-composer/)
  assert.match(handoff, /formatHandoffDisplay/)
})

test('new workflow run starts from a drawer with git safety confirmation', () => {
  assert.match(drawer, /New Workflow Run/)
  assert.match(drawer, /Template/)
  assert.match(drawer, /Run Name/)
  assert.match(drawer, /Project Directory/)
  assert.match(drawer, /onInspectGitSafety/)
  assert.match(drawer, /allowUnsafeSameGitRoot/)
  assert.match(drawer, /runningRunCount/)
  assert.match(drawer, /allowHighConcurrency/)
  assert.match(drawer, /5/)
  assert.match(drawer, /仍然启动/)
})

test('main navigation is consolidated to workflow templates agents single', () => {
  assert.match(app, /type WorkspaceMode = 'workflow' \| 'templates' \| 'single' \| 'agents'/)
  assert.match(app, /TemplatesView/)
  assert.match(templatesView, /Workflow Templates/)
  assert.doesNotMatch(app, /New Workflow Run['"]\s*\)/)
})
