import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { app, ipcMain, dialog, type BrowserWindow } from 'electron'
import { generateText } from 'ai'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
  type SingleSession,
  type SingleSessionCreateInput,
  type SingleSessionDetail,
  type SingleSessionEventEnvelope,
  type SingleSessionSendInput,
  type SkillSummary,
  type CliCheckResult,
  type CliVersionResult,
  type AgentDefinition,
  type ModelCatalog,
  type CronPreview,
  type WorkflowEventEnvelope,
  type WorkflowRun,
  type WorkflowRunGitSafety,
  type WorkflowSchedule,
  type WorkflowStartInput,
  type WorkflowStartResult,
  type WorkflowTemplate,
  type AgentMemoryMeta,
  type MemoryEntry,
  type ReflectionEngineConfig,
  type AppSettings,
  type ApiProviderConfig,
  type ApiCallLogEntry,
  type ApiCallLogStatus,
  type Credential,
  type ExportOptions,
  type ImportOptions,
  type PastedImageInput,
  type AppUpdateState
} from '@shared/types'
import { RunManager } from './RunManager'
import { TranscriptStore } from './TranscriptStore'
import { AgentStore } from './AgentStore'
import { WorkflowStore } from './WorkflowStore'
import { WorkflowManager } from './WorkflowManager'
import { SingleSessionStore } from './SingleSessionStore'
import { SingleSessionManager } from './SingleSessionManager'
import { SkillStore } from './SkillStore'
import { ScheduleStore, type ScheduleSaveInput } from './ScheduleStore'
import { Scheduler } from './Scheduler'
import { describeCron, isValidCron, nextFireTime } from './cronParser'
import { checkClis, getCliVersions } from './cliCheck'
import { installClaudeCode, installCodexCli } from './cliInstall'
import { listCliModels } from './cliModels'
import { MemoryStore } from './memory/MemoryStore'
import { MemoryInjector } from './memory/MemoryInjector'
import { createExportZip, createTemplateExportZip, executeImport, previewImportZip } from './dataPortability'
import { ReflectionAgent } from './memory/ReflectionAgent'
import { SignalCollector } from './memory/SignalCollector'
import { AppSettingsStore } from './AppSettingsStore'
import { getRecommendation } from './routeRecommendation'
import { ProviderStore } from './ProviderStore'
import { CredentialStore } from './CredentialStore'
import { ApiCallLogStore } from './ApiCallLogStore'
import { respondToPermissionRequest } from './adapters/api-tools/PermissionGuard'
import { normalizeProviderBaseUrl, resolveModel, shouldUseAnthropicBearerAuth } from './adapters/apiAdapter'
import { formatModelEndpointFailures, formatProviderHttpError, modelListEndpointCandidates, type ModelEndpointFailure } from './apiModelFetch'
import { FeishuNotifier } from './FeishuNotifier'
import { checkForAppUpdates, installAppUpdate } from './appUpdater'

/** Minimal JSON fetch using Node.js http/https (no dependency on the global
 *  `fetch` which may behave differently across Electron versions). */
function fetchJson(url: string, headers: Record<string, string>): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? httpsRequest : httpRequest
    const parsed = new URL(url)
    const req = mod(
      {
        hostname: parsed.hostname,
        port: parsed.port || (url.startsWith('https:') ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(formatProviderHttpError(res.statusCode, body)))
            return
          }
          try {
            const json = JSON.parse(body) as Record<string, unknown>
            const data = (json as { data?: Array<{ id: string }> }).data
            if (Array.isArray(data) && data.length > 0) {
              return resolve(data.map((m) => m.id).filter(Boolean))
            }
            if (Array.isArray(json) && json.length > 0) {
              return resolve(json
                .filter((m): m is string | { id: string } => typeof m === 'string' || (typeof m === 'object' && m !== null && 'id' in m))
                .map((m) => (typeof m === 'string' ? m : (m as { id: string }).id)))
            }
            reject(new Error('无法解析模型列表'))
          } catch (err) { reject(err) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.end()
  })
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pastedImageExtension(mediaType: string): string {
  const normalized = mediaType.toLowerCase().split(';', 1)[0].trim()
  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/bmp':
      return 'bmp'
    case 'image/svg+xml':
      return 'svg'
    case 'image/png':
    default:
      return 'png'
  }
}

export interface AppManagers {
  abortAll(): void
}

export interface AppNotificationHooks {
  notifyScheduleResult?: (schedule: WorkflowSchedule, run: WorkflowRun) => void
  notifyScheduleError?: (schedule: WorkflowSchedule, error: unknown) => void
}

/**
 * Registers all IPC handlers and returns the RunManager so the app can kill
 * live runs on shutdown. Events flow main → renderer via webContents.send.
 */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  notificationHooks: AppNotificationHooks = {}
): AppManagers {
  const transcriptStore = new TranscriptStore()
  const agentStore = new AgentStore()
  const workflowStore = new WorkflowStore()
  const singleSessionStore = new SingleSessionStore()
  const skillStore = new SkillStore()
  const scheduleStore = new ScheduleStore()
  const appSettingsStore = new AppSettingsStore()
  const providerStore = new ProviderStore()
  const credentialStore = new CredentialStore()
  const apiCallLogStore = new ApiCallLogStore()
  const recordProviderApiLog = (input: {
    source: 'provider-test' | 'model-fetch'
    provider?: Partial<ApiProviderConfig>
    providerId?: string
    model?: string
    startedAt: number
    status: ApiCallLogStatus
    error?: unknown
    messagesSummary?: string
  }): void => {
    try {
      apiCallLogStore.record({
        source: input.source,
        providerId: input.providerId ?? input.provider?.id,
        providerName: input.provider?.name,
        format: input.provider?.format,
        baseUrl: input.provider?.baseUrl,
        model: input.model,
        messagesSummary: input.messagesSummary,
        durationMs: Date.now() - input.startedAt,
        status: input.status,
        usage: { inputTokens: 0, outputTokens: 0 },
        error: input.error === undefined ? undefined : toErrorMessage(input.error),
        structuredOutput: 'none'
      })
    } catch {
      /* logging must not break provider setup actions */
    }
  }
  const runManager = new RunManager(transcriptStore, providerStore, apiCallLogStore)
  const memoryStore = new MemoryStore()
  const reflectionAgent = new ReflectionAgent(runManager, memoryStore)
  const signalCollector = new SignalCollector(reflectionAgent, memoryStore, agentStore)
  const memoryInjector = new MemoryInjector(memoryStore)
  const feishuNotifier = new FeishuNotifier()

  // ── message-delta batching ───────────────────────────────────────────
  // Token streaming produces 50-100 message-delta events per second. Sending
  // each one via webContents.send() would serialise/deserialise and
  // round-trip through the renderer for every token. Instead we accumulate
  // deltas in a per-run buffer and flush every ~16 ms (one frame), reducing
  // IPC overhead by 10-20×. All other event kinds pass through immediately.
  //
  // Inspired by CodeIsland's JSONLTailer which accumulates file appends
  // before emitting a single delta per batch of lines.

  const deltaBufs = new Map<string, { runId: string; text: string; timer: ReturnType<typeof setTimeout> | null }>()

  const flushDelta = (buf: { runId: string; text: string; timer: ReturnType<typeof setTimeout> | null }): void => {
    if (buf.timer !== null) {
      clearTimeout(buf.timer)
      buf.timer = null
    }
    if (!buf.text) return
    const runId = buf.runId
    transcriptStore.record(runId, { kind: 'message-delta', text: buf.text })
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.runEvent, { runId, event: { kind: 'message-delta', text: buf.text } } satisfies RunEventEnvelope)
    }
    buf.text = ''
    deltaBufs.delete(runId)
  }

  const emit = (runId: string, event: RunEventEnvelope['event']): void => {
    if (event.kind === 'message-delta') {
      // Batch deltas: accumulate into the per-run buffer; flush after ~16ms.
      let buf = deltaBufs.get(runId)
      if (!buf) {
        buf = { runId, text: '', timer: null }
        deltaBufs.set(runId, buf)
      }
      buf.text += event.text
      // If buffer hits a coherency threshold, flush immediately so the
      // renderer doesn't lag too far behind.
      if (buf.text.length >= 256) {
        flushDelta(buf)
      } else if (buf.timer === null) {
        buf.timer = setTimeout(() => flushDelta(buf!), 16)
      }
      return
    }

    // Non-delta events: flush any pending delta for this runId first so
    // the renderer sees deltas before the tool-call / turn-done etc.
    const pending = deltaBufs.get(runId)
    if (pending) flushDelta(pending)

    // Persist every event before forwarding (captures the full stream on disk).
    transcriptStore.record(runId, event)
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.runEvent, { runId, event } satisfies RunEventEnvelope)
    }
  }

  const emitWorkflow = (envelope: WorkflowEventEnvelope): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.workflowEvent, envelope)
    }
    if (envelope.event.kind === 'run-updated') {
      void feishuNotifier.handleRunUpdate(envelope.event.run)
    }
  }

  const emitSingleSession = (envelope: SingleSessionEventEnvelope): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.singleSessionEvent, envelope)
    }
  }

  const workflowManager = new WorkflowManager(
    agentStore,
    workflowStore,
    runManager,
    transcriptStore,
    emitWorkflow,
    signalCollector,
    memoryInjector,
    credentialStore
  )
  const singleSessionManager = new SingleSessionManager(
    singleSessionStore,
    runManager,
    transcriptStore,
    skillStore,
    memoryInjector,
    emitSingleSession
  )
  const scheduler = new Scheduler(
    scheduleStore,
    workflowManager,
    workflowStore,
    agentStore,
    emitWorkflow,
    {
      onScheduleRunResult: notificationHooks.notifyScheduleResult,
      onScheduleRunError: notificationHooks.notifyScheduleError
    }
  )
  workflowManager.setRunSettledHandler((run) => scheduler.handleWorkflowRunUpdated(run))
  scheduler.start()
  const initFeishu = (): void => {
    const settings = appSettingsStore.get()
    void feishuNotifier.configure(
      settings.feishu,
      (status) => {
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.feishuStatusChanged, status)
        }
      },
      (runId, action, stepIndex) => {
        try {
          if (action === 'approve') workflowManager.confirmStep(runId, stepIndex)
          else if (action === 'reject') workflowManager.abort(runId)
          else if (action === 'rerun') workflowManager.rerunStep(runId, stepIndex)
        } catch (err) {
          console.error('[Feishu] card action failed:', err)
          throw err
        }
      }
    )
  }
  initFeishu()
  void signalCollector.drainRawSignals()

  ipcMain.handle(IPC.runStart, (_e, config: RunConfig): RunStartResult => {
    const { launchConfig, injectedMemoryIds } = withSingleRunMemoryContext(config, memoryInjector)
    // The renderer can't know the on-disk transcript path; fill it here so the
    // resume-fallback in RunManager can find prior context if --resume fails.
    if (launchConfig.resumeFrom && !launchConfig.resumeFrom.transcriptPath) {
      launchConfig.resumeFrom.transcriptPath = transcriptStore.getTranscriptPath(
        launchConfig.resumeFrom.sessionId
      )
    }
    const runId = runManager.start(launchConfig, emit)
    // The first user turn never appears in the event stream — record it.
    transcriptStore.recordUserInput(runId, launchConfig.prompt)
    return { runId, injectedMemoryIds }
  })

  ipcMain.handle(IPC.runPush, async (_e, runId: string, text: string): Promise<void> => {
    transcriptStore.recordUserInput(runId, text)
    await runManager.push(runId, text)
  })

  ipcMain.handle(IPC.runAbort, (_e, runId: string): void => {
    runManager.abort(runId)
  })

  ipcMain.handle(IPC.singleSessionsList, (): SingleSession[] =>
    singleSessionManager.listSessions()
  )

  ipcMain.handle(IPC.singleSessionCreate, (_e, input: SingleSessionCreateInput): SingleSession =>
    singleSessionManager.createSession(input)
  )

  ipcMain.handle(IPC.singleSessionGet, (_e, id: string): SingleSessionDetail =>
    singleSessionManager.getSessionDetail(id)
  )

  ipcMain.handle(IPC.singleSessionSend, (_e, input: SingleSessionSendInput): SingleSessionDetail =>
    singleSessionManager.sendMessage(input)
  )

  ipcMain.handle(IPC.singleSessionAbort, (_e, id: string): SingleSessionDetail =>
    singleSessionManager.abortSessionRun(id)
  )

  ipcMain.handle(IPC.singleSessionDelete, (_e, id: string): void => {
    singleSessionManager.deleteSession(id)
  })

  ipcMain.handle(IPC.skillsList, (): SkillSummary[] => skillStore.list())

  ipcMain.handle(IPC.checkClis, (): Promise<CliCheckResult> => checkClis())

  ipcMain.handle(IPC.cliVersions, (): Promise<CliVersionResult> => getCliVersions())

  ipcMain.handle(IPC.cliInstall, async (event, cli: 'claude' | 'codex') => {
    const win = getWindow()
    const onProgress = (msg: string) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.cliInstallProgress, cli, msg)
    }
    return cli === 'claude' ? installClaudeCode(onProgress) : installCodexCli(onProgress)
  })

  ipcMain.handle(IPC.listModels, (): Promise<ModelCatalog> => listCliModels(providerStore))

  ipcMain.handle(IPC.providersList, (): ApiProviderConfig[] => providerStore.list())

  ipcMain.handle(IPC.providersSave, (_e, input): ApiProviderConfig => providerStore.save(input))

  ipcMain.handle(IPC.providersGetDecrypted, (_e, id: string): ApiProviderConfig => providerStore.getDecrypted(id))

  ipcMain.handle(IPC.providersDelete, (_e, id: string): void => providerStore.remove(id))

  ipcMain.handle(IPC.credentialsList, (): Credential[] => credentialStore.list())

  ipcMain.handle(IPC.credentialsSave, (_e, input): Credential => credentialStore.save(input))

  ipcMain.handle(IPC.credentialsGetDecrypted, (_e, id: string): Credential => credentialStore.getDecrypted(id))

  ipcMain.handle(IPC.credentialsDelete, (_e, id: string): void => {
    const referencing = workflowStore
      .listTemplates()
      .filter((template) => (template.credentialIds ?? []).includes(id))
    if (referencing.length > 0) {
      throw new Error(`该凭据正在被 ${referencing.length} 个 Workflow 使用，请先在对应 Workflow 中取消勾选`)
    }
    credentialStore.remove(id)
  })

  ipcMain.handle(IPC.providersTest, async (_e, id: string): Promise<{ ok: boolean; message: string }> => {
    const startedAt = Date.now()
    let providerForLog: Partial<ApiProviderConfig> | undefined
    let modelId: string | undefined
    try {
      const provider = providerStore.getDecrypted(id)
      providerForLog = provider
      const rawBase = (provider.baseUrl ?? '').replace(/\/+$/, '')
      modelId = provider.defaultModel ?? provider.models[0]
      if (!rawBase) {
        const message = '未配置 Base URL，请先在编辑表单中填写'
        recordProviderApiLog({ source: 'provider-test', provider, providerId: id, model: modelId, startedAt, status: 'error', error: message, messagesSummary: 'Provider connection test' })
        return { ok: false, message }
      }
      if (!modelId) {
        const message = '未配置模型，请先添加模型或使用「自动获取」'
        recordProviderApiLog({ source: 'provider-test', provider, providerId: id, startedAt, status: 'error', error: message, messagesSummary: 'Provider connection test' })
        return { ok: false, message }
      }
      const base = normalizeProviderBaseUrl(provider)

      // Step 1 — verify API reachability via the models endpoint.
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (provider.format === 'anthropic') {
        if (shouldUseAnthropicBearerAuth(provider)) headers['Authorization'] = `Bearer ${provider.apiKey}`
        else headers['x-api-key'] = provider.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${provider.apiKey}`
      }
      const modelCandidates = modelListEndpointCandidates(provider, base)
      let modelsReachable = false
      const modelFetchFailures: ModelEndpointFailure[] = []
      for (const url of [...new Set(modelCandidates)]) {
        try { await fetchJson(url, headers); modelsReachable = true; break }
        catch (err) { modelFetchFailures.push({ url, error: toErrorMessage(err) }) }
      }
      if (!modelsReachable) {
        const message = `无法连接 API 模型列表：${formatModelEndpointFailures(modelFetchFailures)}。请检查 Base URL 和 API Key 是否正确`
        recordProviderApiLog({ source: 'provider-test', provider, providerId: id, model: modelId, startedAt, status: 'error', error: message, messagesSummary: 'Provider connection test' })
        return { ok: false, message }
      }

      // Step 2 — test chat completion with the configured model.
      await generateText({
        model: resolveModel(provider, modelId) as any,
        prompt: 'Reply with OK.',
        maxOutputTokens: 8,
        temperature: 1,
        topP: 0.95
      })
      recordProviderApiLog({ source: 'provider-test', provider, providerId: id, model: modelId, startedAt, status: 'success', messagesSummary: 'Provider connection test' })
      return { ok: true, message: `连接成功 (模型: ${modelId})` }
    } catch (err) {
      const msg = toErrorMessage(err)
      recordProviderApiLog({ source: 'provider-test', provider: providerForLog, providerId: id, model: modelId, startedAt, status: 'error', error: msg, messagesSummary: 'Provider connection test' })
      // Translate common AI SDK errors into actionable Chinese hints.
      if (msg.includes('Not Found') || msg.includes('404')) {
        return { ok: false, message: `模型不存在 (${msg})。请在模型列表中确认「默认模型」名称正确，或使用「自动获取」更新模型列表` }
      }
      if (msg.includes('Unauthorized') || msg.includes('401') || msg.includes('403')) {
        return { ok: false, message: `API Key 无效或无权限 (${msg})。请检查 Key 是否正确` }
      }
      if (msg.includes('InsufficientBalance') || msg.includes('insufficient') || msg.includes('402')) {
        return { ok: false, message: `账户余额不足 (${msg})` }
      }
      return { ok: false, message: msg }
    }
  })

  ipcMain.handle(IPC.providersFetchModels, async (_e, provider: ApiProviderConfig, providerId?: string): Promise<{ models: string[]; error?: string }> => {
    const startedAt = Date.now()
    try {
      // If no key was provided but we have a stored provider, use its key.
      let apiKey = provider.apiKey
      if (!apiKey && providerId) {
        try { apiKey = providerStore.getDecrypted(providerId).apiKey } catch { /* not found */ }
      }
      const rawBase = (provider.baseUrl ?? '').replace(/\/+$/, '')
      if (!apiKey) {
        const error = '请先填写 API Key'
        recordProviderApiLog({ source: 'model-fetch', provider, providerId, startedAt, status: 'error', error, messagesSummary: 'Fetch provider model list' })
        return { models: [], error }
      }
      if (!rawBase) {
        const error = '请先填写 Base URL'
        recordProviderApiLog({ source: 'model-fetch', provider, providerId, startedAt, status: 'error', error, messagesSummary: 'Fetch provider model list' })
        return { models: [], error }
      }
      const base = normalizeProviderBaseUrl(provider)

      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (provider.format === 'anthropic') {
        if (shouldUseAnthropicBearerAuth(provider)) headers['Authorization'] = `Bearer ${apiKey}`
        else headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const candidates = modelListEndpointCandidates(provider, base)
      const failures: ModelEndpointFailure[] = []

      for (const url of [...new Set(candidates)]) {
        try {
          const models = await fetchJson(url, headers)
          if (models.length > 0) {
            recordProviderApiLog({ source: 'model-fetch', provider, providerId, startedAt, status: 'success', messagesSummary: `Fetched ${models.length} provider models` })
            return { models }
          }
        } catch (err) {
          failures.push({ url, error: toErrorMessage(err) })
        }
      }
      const error = `无法获取模型列表：${formatModelEndpointFailures(failures)}`
      recordProviderApiLog({ source: 'model-fetch', provider, providerId, startedAt, status: 'error', error, messagesSummary: 'Fetch provider model list' })
      return { models: [], error }
    } catch (err) {
      const error = toErrorMessage(err)
      recordProviderApiLog({ source: 'model-fetch', provider, providerId, startedAt, status: 'error', error, messagesSummary: 'Fetch provider model list' })
      return { models: [], error }
    }
  })

  ipcMain.handle(IPC.permissionRespond, (_e, requestId: string, allowed: boolean): void => {
    respondToPermissionRequest(requestId, allowed)
  })

  ipcMain.handle(IPC.apiLogsList, (_e, limit?: number): ApiCallLogEntry[] =>
    apiCallLogStore.list({ limit })
  )

  ipcMain.handle(IPC.apiLogsGet, (_e, id: string): ApiCallLogEntry | null =>
    apiCallLogStore.get(id)
  )

  ipcMain.handle(IPC.apiLogsClear, (): void => {
    apiCallLogStore.clear()
  })

  ipcMain.handle(IPC.apiLogsOpenDir, (): Promise<string> =>
    apiCallLogStore.openDir()
  )

  ipcMain.handle(IPC.windowMinimize, (): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, (): boolean => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle(IPC.windowClose, (): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.close()
  })

  ipcMain.handle(IPC.windowIsMaximized, (): boolean => {
    const win = getWindow()
    return win && !win.isDestroyed() ? win.isMaximized() : false
  })

  ipcMain.handle(IPC.pickDir, async (): Promise<string | null> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.pickFiles, async (): Promise<string[] | null> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'] },
        { name: 'Documents', extensions: ['md', 'txt', 'pdf', 'doc', 'docx'] },
        { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'py', 'rb', 'go', 'rs'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle(IPC.savePastedImage, (_e, input: PastedImageInput): string => {
    const mediaType = input.mediaType || 'image/png'
    if (!mediaType.toLowerCase().startsWith('image/')) {
      throw new Error(`Unsupported pasted image type: ${mediaType}`)
    }
    const buffer = Buffer.from(input.data)
    if (buffer.length === 0) {
      throw new Error('Pasted image is empty')
    }
    const attachmentsDir = join(app.getPath('userData'), 'pasted-attachments')
    mkdirSync(attachmentsDir, { recursive: true })
    const ext = pastedImageExtension(mediaType)
    const filePath = join(
      attachmentsDir,
      `pasted-image-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
    )
    writeFileSync(filePath, buffer)
    return filePath
  })

  // ── File utilities ────────────────────────────────────────────────────

  ipcMain.handle(IPC.fileRead, (_e, absPath: string) => {
    if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`)
    return readFileSync(absPath, 'utf8')
  })

  // ── Data Import / Export ───────────────────────────────────────────────

  ipcMain.handle(IPC.dataExport, async (_e, options: ExportOptions) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: `nexture-ai-export-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP files', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    return createExportZip(result.filePath, options)
  })

  ipcMain.handle(IPC.dataExportTemplate, async (_e, templateId: string) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: `template-export-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP files', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    return createTemplateExportZip(result.filePath, templateId)
  })

  ipcMain.handle(IPC.dataImportPreview, async (_e, filePath: string) =>
    previewImportZip(filePath)
  )

  ipcMain.handle(IPC.dataImport, async (_e, filePath: string, options: ImportOptions) => {
    const result = await executeImport(filePath, options)
    if (result.ok) {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.cliInstallProgress, 'system' as any, 'import-complete')
      }
      setTimeout(() => { app.relaunch(); app.exit(0) }, 500)
    }
    return result
  })

  ipcMain.handle(IPC.appVersionGet, (): string => app.getVersion())

  ipcMain.handle(IPC.appUpdateCheck, async (): Promise<AppUpdateState> =>
    checkForAppUpdates()
  )

  ipcMain.handle(IPC.appUpdateInstall, (): AppUpdateState =>
    installAppUpdate()
  )

  // ── Agent CRUD ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.agentsList, (): AgentDefinition[] => agentStore.list())

  ipcMain.handle(IPC.agentsSave, (_e, input): AgentDefinition => agentStore.save(input))

  ipcMain.handle(IPC.agentsDelete, (_e, id: string): void => {
    // 内置 agent（如使用助手）受保护，禁止删除
    const existing = agentStore.list().find((a) => a.id === id)
    if (existing?.builtin) return
    agentStore.remove(id)
    memoryStore.removeByAgent(id)
  })

  // ── Workflow orchestration ─────────────────────────────────────────────

  ipcMain.handle(IPC.workflowsList, (): WorkflowTemplate[] => workflowStore.listTemplates())

  ipcMain.handle(IPC.workflowsSave, (_e, input): WorkflowTemplate =>
    workflowStore.saveTemplate(input)
  )

  ipcMain.handle(IPC.workflowsDelete, (_e, id: string): void =>
    workflowStore.deleteTemplate(id)
  )

  ipcMain.handle(IPC.workflowStart, (_e, input: WorkflowStartInput): WorkflowStartResult =>
    workflowManager.start(input)
  )

  ipcMain.handle(IPC.workflowRunsList, (): WorkflowRun[] => workflowManager.listRuns())

  ipcMain.handle(IPC.workflowDeleteRun, (_e, runId: string): void => {
    workflowManager.deleteRun(runId)
  })

  ipcMain.handle(IPC.workflowGitSafety, (_e, projectPath: string): WorkflowRunGitSafety =>
    workflowManager.inspectGitSafety(projectPath)
  )

  ipcMain.handle(IPC.workflowConfirmStep, (_e, runId: string, stepIndex?: number) =>
    workflowManager.confirmStep(runId, stepIndex)
  )

  ipcMain.handle(IPC.workflowFinishInteractive, (_e, runId: string, stepIndex: number) =>
    workflowManager.finishInteractiveStep(runId, stepIndex)
  )

  ipcMain.handle(IPC.workflowRerunStep, (_e, runId: string, stepIndex: number) =>
    workflowManager.rerunStep(runId, stepIndex)
  )

  ipcMain.handle(IPC.workflowAbort, (_e, runId: string) => workflowManager.abort(runId))

  ipcMain.handle(IPC.workflowPush, (_e, runId: string, stepIndex: number, text: string) =>
    workflowManager.pushInput(runId, stepIndex, text)
  )

  ipcMain.handle(IPC.workflowUpdatePrompt, (_e, runId: string, newPrompt: string): WorkflowRun =>
    workflowManager.updatePrompt(runId, newPrompt)
  )

  ipcMain.handle(IPC.workflowSkipStep, (_e, runId: string) =>
    workflowManager.skipStep(runId)
  )

  ipcMain.handle(IPC.workflowGotoStep, (_e, runId: string, targetIndex: number) =>
    workflowManager.gotoStep(runId, targetIndex)
  )

  ipcMain.handle(IPC.routeRecommend, (_e, role: string) =>
    getRecommendation(role)
  )

  // ── Workflow schedules ───────────────────────────────────────────────

  ipcMain.handle(IPC.schedulesList, (): WorkflowSchedule[] => scheduleStore.list())

  ipcMain.handle(IPC.schedulesSave, (_e, input: ScheduleSaveInput): WorkflowSchedule => {
    const saved = scheduleStore.save(input)
    scheduler.register(saved)
    return saved
  })

  ipcMain.handle(IPC.schedulesDelete, (_e, id: string): void => {
    scheduler.unregister(id)
    scheduleStore.remove(id)
  })

  ipcMain.handle(IPC.schedulesToggle, (_e, id: string, enabled: boolean): WorkflowSchedule => {
    const saved = scheduleStore.toggle(id, enabled)
    if (saved.enabled) scheduler.register(saved)
    else scheduler.unregister(saved.id)
    return saved
  })

  ipcMain.handle(IPC.cronValidate, (_e, expression: string): boolean =>
    isValidCron(expression)
  )

  ipcMain.handle(IPC.cronDescribe, (_e, expression: string): CronPreview =>
    cronPreview(expression)
  )

  // ── Agent memory ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.memoryList, (_e, agentId: string, projectPath?: string): MemoryEntry[] =>
    memoryStore.list(agentId, projectPath)
  )

  ipcMain.handle(IPC.memoryDelete, (_e, memoryId: string): void =>
    memoryStore.remove(memoryId)
  )

  ipcMain.handle(IPC.memoryMeta, (_e, agentId: string): AgentMemoryMeta =>
    memoryStore.getMeta(agentId)
  )

  ipcMain.handle(IPC.reflectionConfigGet, (): ReflectionEngineConfig =>
    memoryStore.getReflectionConfig()
  )

  ipcMain.handle(IPC.reflectionConfigSave, (_e, config: ReflectionEngineConfig): void =>
    memoryStore.saveReflectionConfig(config)
  )

  ipcMain.handle(IPC.appSettingsGet, (): AppSettings =>
    appSettingsStore.get()
  )

  ipcMain.handle(IPC.appSettingsSave, (_e, settings: AppSettings): void => {
    appSettingsStore.save(settings)
    initFeishu()
  })

  ipcMain.handle(IPC.feishuTest, () => feishuNotifier.sendTestNotification())

  ipcMain.handle(IPC.feishuStatus, () => feishuNotifier.getStatus())

  return {
    abortAll() {
      scheduler.stopAll()
      workflowManager.abortAll()
      runManager.abortAll()
      feishuNotifier.destroy()
    }
  }
}

function cronPreview(expression: string): CronPreview {
  try {
    return {
      valid: true,
      description: describeCron(expression),
      nextFireAt: nextFireTime(expression).getTime()
    }
  } catch (err) {
    return {
      valid: false,
      description: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function withSingleRunMemoryContext(
  config: RunConfig,
  memoryInjector: MemoryInjector
): { launchConfig: RunConfig; injectedMemoryIds: string[] } {
  if (!config.agentId) return { launchConfig: config, injectedMemoryIds: [] }

  const { text, injectedMemoryIds } = memoryInjector.build(config.agentId, config.cwd)
  if (!text) return { launchConfig: config, injectedMemoryIds }

  return {
    launchConfig: {
      ...config,
      prompt: `${text}\n${config.prompt}`
    },
    injectedMemoryIds
  }
}
