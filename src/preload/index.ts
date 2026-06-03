import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
  type CliCheckResult
} from '@shared/types'

/**
 * The only surface the renderer can touch. No Node, no ipcRenderer directly —
 * just these typed methods. Mirrors the IPC channel contract in shared/types.
 */
const api = {
  startRun: (config: RunConfig): Promise<RunStartResult> =>
    ipcRenderer.invoke(IPC.runStart, config),

  pushInput: (runId: string, text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.runPush, runId, text),

  abortRun: (runId: string): Promise<void> => ipcRenderer.invoke(IPC.runAbort, runId),

  checkClis: (): Promise<CliCheckResult> => ipcRenderer.invoke(IPC.checkClis),

  pickDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickDir),

  /** Subscribe to run events. Returns an unsubscribe function. */
  onRunEvent: (cb: (envelope: RunEventEnvelope) => void): (() => void) => {
    const listener = (_e: unknown, envelope: RunEventEnvelope): void => cb(envelope)
    ipcRenderer.on(IPC.runEvent, listener)
    return () => ipcRenderer.removeListener(IPC.runEvent, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AgentStudioApi = typeof api
