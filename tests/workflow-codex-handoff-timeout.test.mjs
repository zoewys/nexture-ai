import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import ts from 'typescript'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function importWorkflowManager() {
  const absPath = join(root, 'src/main/WorkflowManager.ts')
  const outBase = join(root, '.tmp', 'workflow-manager-tests')
  mkdirSync(outBase, { recursive: true })
  const outDir = mkdtempSync(join(outBase, 'ts-'))
  const outPath = join(outDir, `WorkflowManager-${Date.now()}-${Math.random()}.mjs`)
  const handoffParserUrl = pathToFileURL(join(root, 'src/main/handoffParser.ts')).href
  const transpiled = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    },
    fileName: absPath
  })
  const output = transpiled.outputText
    .replace(
      /import\s+\{\s*isParallelGroup\s*\}\s+from\s+['"]@shared\/types['"];?/,
      "const isParallelGroup = (node) => Boolean(node && Array.isArray(node.parallel));"
    )
    .replace(
      /import\s+\{\s*inspectWorkflowGitSafety\s*\}\s+from\s+['"]\.\/gitSafety['"];?/,
      "const inspectWorkflowGitSafety = () => ({ level: 'safe' });"
    )
    .replace(
      /import\s+\{\s*summarizeTranscript\s*\}\s+from\s+['"]\.\/memory\/transcriptSummarizer['"];?/,
      "const summarizeTranscript = () => '';"
    )
    .replace(
      /import\s+\{\s*parseHandoff\s*\}\s+from\s+['"]\.\/handoffParser['"];?/,
      `import { parseHandoff } from ${JSON.stringify(handoffParserUrl)};`
    )
    .replace(
      /import\s+\{\s*createWorktree,\s*removeWorktree,\s*cleanupOrphanedWorktrees,\s*isGitRepo\s*\}\s+from\s+['"]\.\/worktreeManager['"];?/,
      [
        'const createWorktree = () => ({ path: "" });',
        'const removeWorktree = () => {};',
        'const cleanupOrphanedWorktrees = () => {};',
        'const isGitRepo = () => false;'
      ].join('\n')
    )
  writeFileSync(outPath, output, 'utf8')
  return import(`${pathToFileURL(outPath).href}?cache=${Date.now()}-${Math.random()}`)
}

function agent(id, role) {
  return {
    id,
    name: role,
    role,
    vendor: 'codex',
    model: 'gpt-5.3-codex-spark',
    systemPrompt: ''
  }
}

async function createWorkflowHarness() {
  const { WorkflowManager } = await importWorkflowManager()
  const agents = [agent('product', 'product'), agent('dev', 'dev'), agent('preview', 'preview')]
  const template = {
    id: 'web',
    name: '网页开发',
    steps: [
      { agentId: 'product' },
      { agentId: 'dev', interactive: true },
      { agentId: 'preview' }
    ]
  }
  const savedRuns = []
  const started = []

  const manager = new WorkflowManager(
    { list: () => agents },
    {
      listTemplates: () => [template],
      listRuns: () => [],
      saveRun: (run) => savedRuns.push(structuredClone(run)),
      deleteRun: () => {}
    },
    {
      start(config, onEvent) {
        const id = `child-${started.length + 1}`
        started.push({ id, config, onEvent })
        return id
      },
      abort: () => {},
      closeInput: () => {},
      hasLiveRun: () => false
    },
    {
      recordUserInput: () => {},
      getTranscriptPath: () => ''
    },
    () => {}
  )

  const result = manager.start({
    templateId: 'web',
    projectPath: '/tmp/agent-studio-web',
    initialPrompt: '开发一个国风的你好网页',
    autoConfirm: true
  })

  return { manager, result, savedRuns, started }
}

function completeProductStep(started) {
  started[0].onEvent(started[0].id, {
    kind: 'message',
    role: 'assistant',
    text: '{"summary":"requirements ready","artifacts":[]}'
  })
  started[0].onEvent(started[0].id, {
    kind: 'turn-done',
    sessionId: 'codex-product',
    reason: 'complete'
  })
  assert.equal(started.length, 2)
}

function assertPreviewStarted(savedRuns, started) {
  const latestRun = savedRuns.at(-1)
  assert.equal(started.length, 3)
  assert.equal(latestRun.status, 'running')
  assert.equal(latestRun.currentStepIndex, 2)
  assert.equal(latestRun.steps[1].status, 'done')
  assert.equal(latestRun.steps[1].executions.at(-1).handoff.summary, '页面已完成')
  assert.equal(started[2].config.vendor, 'codex')
}

test('workflow advances when Codex emits a valid handoff before a terminal timeout error', async () => {
  const { savedRuns, started } = await createWorkflowHarness()
  completeProductStep(started)

  started[1].onEvent(started[1].id, {
    kind: 'message',
    role: 'assistant',
    text: '{"summary":"页面已完成","artifacts":[{"path":"index.html","description":"国风你好页面","type":"code"}],"nextStepGuidance":"本地打开预览"}'
  })
  started[1].onEvent(started[1].id, {
    kind: 'error',
    recoverable: false,
    message: 'Reconnecting... 5/5 (request timed out)'
  })

  assertPreviewStarted(savedRuns, started)
})

test('workflow advances when Codex emits a valid handoff before an error turn result', async () => {
  const { savedRuns, started } = await createWorkflowHarness()
  completeProductStep(started)

  started[1].onEvent(started[1].id, {
    kind: 'message',
    role: 'assistant',
    text: '{"summary":"页面已完成","artifacts":[{"path":"index.html","description":"国风你好页面","type":"code"}]}'
  })
  started[1].onEvent(started[1].id, {
    kind: 'turn-done',
    sessionId: 'codex-dev',
    reason: 'error'
  })

  assertPreviewStarted(savedRuns, started)
})

test('workflow synthesizes a step result when a non-interactive step completes without structured JSON', async () => {
  const { savedRuns, started } = await createWorkflowHarness()

  started[0].onEvent(started[0].id, {
    kind: 'file-changed',
    path: '/tmp/agent-studio-web/docs/requirements.md',
    op: 'create'
  })
  started[0].onEvent(started[0].id, {
    kind: 'message',
    role: 'assistant',
    text: '需求分析已经完成，已写入需求文档。'
  })
  started[0].onEvent(started[0].id, {
    kind: 'turn-done',
    sessionId: 'codex-product',
    reason: 'complete'
  })

  const latestRun = savedRuns.at(-1)
  assert.equal(started.length, 2)
  assert.equal(latestRun.status, 'running')
  assert.equal(latestRun.currentStepIndex, 1)
  assert.equal(latestRun.steps[0].status, 'done')
  assert.equal(latestRun.steps[0].executions.at(-1).handoff.summary, '需求分析已经完成，已写入需求文档。')
  assert.deepEqual(latestRun.steps[0].executions.at(-1).handoff.artifacts, [
    {
      path: 'docs/requirements.md',
      description: 'Created during this workflow step.',
      type: 'requirement'
    }
  ])
})

test('workflow does not advance when the latest todo list is unfinished', async () => {
  const { savedRuns, started } = await createWorkflowHarness()

  started[0].onEvent(started[0].id, {
    kind: 'tool-call',
    id: 'todo-1',
    name: 'todo_write',
    input: {
      todos: [
        { content: 'Analyze CSV data structure', status: 'completed' },
        { content: 'Write analysis script', status: 'in_progress' },
        { content: 'Generate analysis Excel output file', status: 'pending' }
      ]
    }
  })
  started[0].onEvent(started[0].id, {
    kind: 'message',
    role: 'assistant',
    text: '{"summary":"analysis complete","artifacts":[{"path":"summary.json","description":"partial summary","type":"other"}]}'
  })
  started[0].onEvent(started[0].id, {
    kind: 'turn-done',
    sessionId: 'codex-product',
    reason: 'complete'
  })

  const latestRun = savedRuns.at(-1)
  assert.equal(started.length, 1)
  assert.equal(latestRun.status, 'error')
  assert.equal(latestRun.steps[0].status, 'error')
  assert.match(latestRun.steps[0].executions.at(-1).error, /unfinished todo items/)
  assert.match(latestRun.steps[0].executions.at(-1).error, /Write analysis script/)
  assert.match(latestRun.steps[0].executions.at(-1).error, /Generate analysis Excel output file/)
})
