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
const mainIndex = readFileSync(join(root, 'src/main/index.ts'), 'utf8')

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
  assert.match(runsList, /workflow-runs-title/)
  assert.match(runsList, /workflowRunProgressSegments/)
  assert.match(runsList, /workflow-run-card-progress/)
  assert.match(css, /\.workflow-run-card-progress\s*\{/)
  assert.doesNotMatch(runsList, /Sound On|Sound Off/)
  assert.doesNotMatch(runsList, /section-title">Workflow Runs/)
  assert.doesNotMatch(runsList, /确认详情|Confirm/)
})

test('steps panel lives on the right and supports long workflows', () => {
  assert.match(steps, /workflow-steps-panel/)
  assert.match(steps, /placeholder="搜索步骤 \/ agent"/)
  assert.match(steps, /workflow-step-card-row/)
  assert.match(steps, /workflow-step-status-dot/)
  assert.match(steps, /workflow-step-status/)
  assert.match(steps, /overflow-y/)
})

test('run detail owns transcript, handoff, and composer', () => {
  assert.match(detail, /TranscriptViewer/)
  assert.match(detail, /HandoffPanel/)
  assert.match(detail, /workflow-cli-composer/)
  assert.match(detail, /workflow-run-step-summary/)
  assert.match(detail, /Rerun Step/)
  assert.match(detail, /Stop/)
  assert.match(handoff, /formatHandoffDisplay/)
})

test('new workflow run starts from a drawer with git safety confirmation', () => {
  assert.match(drawer, /New Workflow Run/)
  assert.match(drawer, /Template/)
  assert.match(drawer, /Run Name/)
  assert.match(drawer, /Project Directory/)
  assert.match(drawer, /Git Root/)
  assert.match(drawer, /Worktree/)
  assert.match(drawer, /workflow-new-run-split/)
  assert.match(drawer, /onInspectGitSafety/)
  assert.match(drawer, /allowUnsafeSameGitRoot/)
  assert.match(drawer, /runningRunCount/)
  assert.match(drawer, /allowHighConcurrency/)
  assert.match(drawer, /5/)
  assert.match(drawer, /仍然启动/)
  assert.match(drawer, /Template Preview/)
  assert.match(drawer, /workflow-template-preview-pills/)
  assert.match(drawer, /Save Draft/)
  assert.match(css, /grid-template-rows:\s*auto minmax\(0,\s*1fr\) 58px;/)
})

test('main navigation is consolidated to workflow templates agents single', () => {
  const nav = app.match(/<nav className="mode-rail"[\s\S]*?<\/nav>/)?.[0] ?? ''
  assert.match(app, /type WorkspaceMode = 'workflow' \| 'templates' \| 'agents' \| 'single'/)
  assert.match(app, /TemplatesView/)
  assert.match(app, /case 'templates':\s*return 'Templates'/)
  assert.match(templatesView, /templates-title">Templates/)
  assert.match(nav, /<span>Workflow<\/span>[\s\S]*<span>Templates<\/span>[\s\S]*<span>Agents<\/span>[\s\S]*<span>Single<\/span>/)
  assert.doesNotMatch(nav, /Single Run/)
  assert.doesNotMatch(app, /New Workflow Run['"]\s*\)/)
})

test('templates screen matches two-column list and canvas design', () => {
  assert.doesNotMatch(templatesView, /WorkflowPanel/)
  assert.match(templatesView, /templates-view-list/)
  assert.match(templatesView, /templates-template-card/)
  assert.match(templatesView, /templates-view-main/)
  assert.match(templatesView, /Dev Flow Template/)
  assert.match(templatesView, /Future Node Canvas Preview/)
  assert.match(templatesView, /canvas-preview/)
  assert.match(templatesView, /node a/)
  assert.match(templatesView, /node b/)
  assert.match(templatesView, /node c/)
  assert.match(templatesView, /node d/)
  assert.match(templatesView, /Duplicate/)
  assert.match(templatesView, /Save/)
  assert.match(css, /\.templates-page\s*\{[\s\S]*background:\s*#191c23;/)
  assert.match(css, /\.templates-view\s*\{[\s\S]*grid-template-columns:\s*360px minmax\(0,\s*1fr\);/)
  assert.match(css, /\.canvas-preview\s*\{[\s\S]*height:\s*190px;/)
})

test('electron main window is visible for local UI review', () => {
  assert.match(mainIndex, /frame:\s*false/)
  assert.match(mainIndex, /show:\s*true/)
})
