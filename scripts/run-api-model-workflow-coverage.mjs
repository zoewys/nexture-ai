import { app } from 'electron'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve, dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_RUNTIME = resolve(ROOT_DIR, 'out', 'main', 'index-runtime.mjs')
const OUT_INDEX = resolve(ROOT_DIR, 'out', 'main', 'index.js')

const REQUIRED_MODELS = [
  'glm5.2',
  'deepseek',
  'glm-5.1',
  'kimi-k2.6',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'minimax-m3'
]

const REPO_ROOT = ROOT_DIR
const USER_DATA_DIR = join(app.getPath('appData'), 'agent-studio')
const LOG_DIR = join(USER_DATA_DIR, 'api-call-logs')
const RUN_TIMEOUT_MS = 4 * 60 * 1000

function summarizeRun(run) {
  return run.steps
    .map((step, idx) => {
      const execution = step.executions.at(-1)
      const status = execution?.status ?? step.status
      const err = execution?.error ? ` | ${String(execution.error).slice(0, 120)}` : ''
      const summary = execution?.handoff?.summary
        ? ` | ${execution.handoff.summary.slice(0, 60)}`
        : ''
      return `${idx + 1}. ${step.displayName || step.role} => ${status}${summary}${err}`
    })
    .join('\n')
}

function resolveConfig(model, providers) {
  if (model === 'glm5.2') {
    const volc = providers.find((item) => item.models.includes('glm-5.1'))
    return { provider: volc, model: 'glm-5.1' }
  }

  if (model === 'deepseek') {
    const deepseekProvider = providers.find(
      (item) => item.name.includes('deepseek') && item.models.includes('deepseek-v4-pro')
    )
    return { provider: deepseekProvider ?? providers[0], model: 'deepseek-v4-pro' }
  }

  const exact = providers.find((item) => item.models.includes(model))
  if (exact) return { provider: exact, model }

  const fallback = providers.find((item) => item.models.includes('kimi-k2.6'))
    || providers.find((item) => item.models.includes('deepseek-v4-pro'))
    || providers[0]
  return { provider: fallback, model }
}

function ensureRuntimeExports() {
  if (!existsSync(OUT_INDEX)) {
    throw new Error(`Build output missing: ${OUT_INDEX}. Run npm run build first.`)
  }

  if (!existsSync(OUT_RUNTIME)) {
    copyFileSync(OUT_INDEX, OUT_RUNTIME)
  }

  const source = readFileSync(OUT_RUNTIME, 'utf8')
  if (!source.includes('export { RunManager, TranscriptStore, AgentStore, WorkflowStore, WorkflowManager, ProviderStore, ApiCallLogStore, registerIpc }')) {
    writeFileSync(OUT_RUNTIME, `${source}\nexport { RunManager, TranscriptStore, AgentStore, WorkflowStore, WorkflowManager, ProviderStore, ApiCallLogStore, registerIpc };\n`, 'utf8')
  }
}

async function collectLogsAfter(beforeIds) {
  if (!existsSync(LOG_DIR)) return []
  const files = readdirSync(LOG_DIR).filter((name) => name.endsWith('.jsonl')).sort()
  const out = []

  for (const file of files) {
    const content = readFileSync(join(LOG_DIR, file), 'utf8').trim()
    if (!content) continue
    for (const line of content.split('\n')) {
      try {
        const item = JSON.parse(line)
        if (!beforeIds.has(item.id)) out.push(item)
      } catch {
        // ignore malformed lines
      }
    }
  }

  return out
}

async function waitRunDone(manager, runId, timeoutMs = RUN_TIMEOUT_MS) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const run = manager.listRuns().find((item) => item.id === runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if ([ 'completed', 'error', 'interrupted', 'aborted' ].includes(run.status)) {
      return run
    }
    await sleep(500)
  }
  throw new Error(`Workflow run timed out: ${runId}`)
}

async function runWorkflow() {
  ensureRuntimeExports()

  const {
    AgentStore,
    WorkflowStore,
    RunManager,
    TranscriptStore,
    ProviderStore,
    ApiCallLogStore,
    WorkflowManager
  } = await import(`file://${OUT_RUNTIME}`)

  const transcriptStore = new TranscriptStore()
  const providerStore = new ProviderStore()
  const apiCallLogStore = new ApiCallLogStore()
  const runManager = new RunManager(transcriptStore, providerStore, apiCallLogStore)
  const agentStore = new AgentStore()
  const workflowStore = new WorkflowStore()

  const beforeLogIds = new Set((await collectLogsAfter(new Set())).map((item) => item.id))

  const providers = providerStore.list()
  if (!providers.length) {
    console.log('provider 列表为空')
    app.exit(1)
    return
  }

  const agents = []
  for (const model of REQUIRED_MODELS) {
    const conf = resolveConfig(model, providers)
    if (!conf.provider) throw new Error(`No provider for model ${model}`)

    if (!conf.provider.models.includes(conf.model)) {
      providerStore.save({ ...conf.provider, models: [...conf.provider.models, conf.model] })
      console.log(`补齐 model 到 provider: ${conf.provider.name} <- ${conf.model}`)
    }

    const existing = agentStore.list().find((item) => item.name === `api-check-${model}`)
    const agent = agentStore.save({
      id: existing?.id,
      name: `api-check-${model}`,
      role: model,
      vendor: 'api',
      model: conf.model,
      apiProviderId: conf.provider.id,
      permissionMode: 'bypassPermissions',
      systemPrompt: '你是 JSON 回执代理，请只输出单个 JSON 对象，不要 markdown。字段: summary, artifacts, nextStepGuidance, routeSuggestion。'
    })
    agents.push(agent)

    if (model === 'deepseek' || model === 'glm5.2') {
      console.log(`agent准备: ${agent.name} -> ${conf.provider.name} | ${conf.model}`)
    }
  }

  const templateName = 'api-model-coverage-workflow'
  const existingTemplate = workflowStore.listTemplates().find((t) => t.name === templateName)
  const template = workflowStore.saveTemplate({
    id: existingTemplate?.id,
    name: templateName,
    description: '覆盖用户指定 API 模型（顺序）',
    steps: agents.map((agent) => ({
      agentId: agent.id,
      role: agent.role,
      failureStrategy: { type: 'retry-then-notify', maxRetries: 1 }
    })),
    budgetUsd: 20
  })

  const workflowManager = new WorkflowManager(
    agentStore,
    workflowStore,
    runManager,
    transcriptStore,
    (envelope) => {
      if (envelope.event.kind === 'agent-event' && envelope.event.event.kind === 'error') {
        console.log(`[agent-error] step=${envelope.event.stepIndex + 1} ${envelope.event.event.message}`)
      }
    }
  )

  const run = workflowManager.start({
    templateId: template.id,
    projectPath: REPO_ROOT,
    initialPrompt: '请按系统提示输出 handoff JSON，不要创建或修改文件。',
    autoConfirm: true
  })

  const finalRun = await waitRunDone(workflowManager, run.run.id)

  console.log('\n=== Workflow 结果 ===')
  console.log(`runId=${finalRun.id}`)
  console.log(`status=${finalRun.status}`)
  console.log(summarizeRun(finalRun))

  const runLogs = (await collectLogsAfter(beforeLogIds)).filter((item) => item.source === 'workflow')
  console.log(`\n本次 workflow 日志 ${runLogs.length} 条`)
  for (const item of runLogs) {
    console.log(`[${item.status}] model=${item.model} provider=${item.providerName || ''} duration=${item.durationMs}ms${item.error ? ` error=${item.error}` : ''}`)
  }

  app.exit(finalRun.status === 'completed' ? 0 : 1)
}

app.whenReady().then(runWorkflow).catch((error) => {
  console.error(error)
  app.exit(1)
})
