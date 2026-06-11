import { readFileSync, existsSync } from 'node:fs'
import { ipcMain, dialog, type BrowserWindow } from 'electron'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
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
  type ExportOptions,
  type ImportOptions
} from '@shared/types'
import { RunManager } from './RunManager'
import { TranscriptStore } from './TranscriptStore'
import { AgentStore } from './AgentStore'
import { WorkflowStore } from './WorkflowStore'
import { WorkflowManager } from './WorkflowManager'
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
  const scheduleStore = new ScheduleStore()
  const appSettingsStore = new AppSettingsStore()
  const runManager = new RunManager(transcriptStore)
  const memoryStore = new MemoryStore()
  const reflectionAgent = new ReflectionAgent(runManager, memoryStore)
  const signalCollector = new SignalCollector(reflectionAgent, memoryStore, agentStore)
  const memoryInjector = new MemoryInjector(memoryStore)

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
  }

  const workflowManager = new WorkflowManager(
    agentStore,
    workflowStore,
    runManager,
    transcriptStore,
    emitWorkflow,
    signalCollector,
    memoryInjector
  )
  const scheduler = new Scheduler(
    scheduleStore,
    workflowManager,
    workflowStore,
    emitWorkflow,
    {
      onScheduleRunResult: notificationHooks.notifyScheduleResult,
      onScheduleRunError: notificationHooks.notifyScheduleError
    }
  )
  workflowManager.setRunSettledHandler((run) => scheduler.handleWorkflowRunUpdated(run))
  scheduler.start()
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

  ipcMain.handle(IPC.checkClis, (): Promise<CliCheckResult> => checkClis())

  ipcMain.handle(IPC.cliVersions, (): Promise<CliVersionResult> => getCliVersions())

  ipcMain.handle(IPC.cliInstall, async (event, cli: 'claude' | 'codex') => {
    const win = getWindow()
    const onProgress = (msg: string) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.cliInstallProgress, cli, msg)
    }
    return cli === 'claude' ? installClaudeCode(onProgress) : installCodexCli(onProgress)
  })

  ipcMain.handle(IPC.listModels, (): Promise<ModelCatalog> => listCliModels())

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

  // ── File utilities ────────────────────────────────────────────────────

  ipcMain.handle(IPC.fileRead, (_e, absPath: string) => {
    if (!existsSync(absPath)) throw new Error(`File not found: ${absPath}`)
    return readFileSync(absPath, 'utf8')
  })

  // ── Data Import / Export ───────────────────────────────────────────────

  ipcMain.handle(IPC.dataExport, async (_e, options: ExportOptions) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: `agent-studio-export-${new Date().toISOString().slice(0, 10)}.zip`,
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

  // ── Agent CRUD ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.agentsList, (): AgentDefinition[] => agentStore.list())

  ipcMain.handle(IPC.agentsSave, (_e, input): AgentDefinition => agentStore.save(input))

  ipcMain.handle(IPC.agentsDelete, (_e, id: string): void => {
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

  ipcMain.handle(IPC.appSettingsSave, (_e, settings: AppSettings): void =>
    appSettingsStore.save(settings)
  )

  return {
    abortAll() {
      scheduler.stopAll()
      workflowManager.abortAll()
      runManager.abortAll()
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
