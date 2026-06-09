import { ipcMain, dialog, type BrowserWindow } from 'electron'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
  type CliCheckResult,
  type AgentDefinition,
  type ModelCatalog,
  type WorkflowEventEnvelope,
  type WorkflowRun,
  type WorkflowRunGitSafety,
  type WorkflowStartInput,
  type WorkflowStartResult,
  type WorkflowTemplate
} from '@shared/types'
import { RunManager } from './RunManager'
import { TranscriptStore } from './TranscriptStore'
import { AgentStore } from './AgentStore'
import { WorkflowStore } from './WorkflowStore'
import { WorkflowManager } from './WorkflowManager'
import { checkClis } from './cliCheck'
import { installClaudeCode, installCodexCli } from './cliInstall'
import { listCliModels } from './cliModels'
import { MemoryStore } from './memory/MemoryStore'
import { ReflectionAgent } from './memory/ReflectionAgent'
import { SignalCollector } from './memory/SignalCollector'

export interface AppManagers {
  abortAll(): void
}

/**
 * Registers all IPC handlers and returns the RunManager so the app can kill
 * live runs on shutdown. Events flow main → renderer via webContents.send.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): AppManagers {
  const transcriptStore = new TranscriptStore()
  const agentStore = new AgentStore()
  const workflowStore = new WorkflowStore()
  const runManager = new RunManager(transcriptStore)
  const memoryStore = new MemoryStore()
  const reflectionAgent = new ReflectionAgent(runManager, memoryStore)
  const signalCollector = new SignalCollector(reflectionAgent, memoryStore, agentStore)

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
    signalCollector
  )
  void signalCollector.drainRawSignals()

  ipcMain.handle(IPC.runStart, (_e, config: RunConfig): RunStartResult => {
    // The renderer can't know the on-disk transcript path; fill it here so the
    // resume-fallback in RunManager can find prior context if --resume fails.
    if (config.resumeFrom && !config.resumeFrom.transcriptPath) {
      config.resumeFrom.transcriptPath = transcriptStore.getTranscriptPath(
        config.resumeFrom.sessionId
      )
    }
    const runId = runManager.start(config, emit)
    // The first user turn never appears in the event stream — record it.
    transcriptStore.recordUserInput(runId, config.prompt)
    return { runId }
  })

  ipcMain.handle(IPC.runPush, async (_e, runId: string, text: string): Promise<void> => {
    transcriptStore.recordUserInput(runId, text)
    await runManager.push(runId, text)
  })

  ipcMain.handle(IPC.runAbort, (_e, runId: string): void => {
    runManager.abort(runId)
  })

  ipcMain.handle(IPC.checkClis, (): Promise<CliCheckResult> => checkClis())

  ipcMain.handle(IPC.cliInstall, async (_e, cli: 'claude' | 'codex') => {
    return cli === 'claude' ? installClaudeCode() : installCodexCli()
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

  // ── Agent CRUD ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.agentsList, (): AgentDefinition[] => agentStore.list())

  ipcMain.handle(IPC.agentsSave, (_e, input): AgentDefinition => agentStore.save(input))

  ipcMain.handle(IPC.agentsDelete, (_e, id: string): void => agentStore.remove(id))

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

  ipcMain.handle(IPC.workflowConfirmStep, (_e, runId: string) =>
    workflowManager.confirmStep(runId)
  )

  ipcMain.handle(IPC.workflowRerunStep, (_e, runId: string, stepIndex: number) =>
    workflowManager.rerunStep(runId, stepIndex)
  )

  ipcMain.handle(IPC.workflowAbort, (_e, runId: string) => workflowManager.abort(runId))

  ipcMain.handle(IPC.workflowPush, (_e, runId: string, stepIndex: number, text: string) =>
    workflowManager.pushInput(runId, stepIndex, text)
  )

  return {
    abortAll() {
      workflowManager.abortAll()
      runManager.abortAll()
    }
  }
}
