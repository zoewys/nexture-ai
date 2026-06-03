import { ipcMain, dialog, type BrowserWindow } from 'electron'
import {
  IPC,
  type RunConfig,
  type RunStartResult,
  type RunEventEnvelope,
  type CliCheckResult
} from '@shared/types'
import { RunManager } from './RunManager'
import { checkClis } from './cliCheck'

/**
 * Registers all IPC handlers and returns the RunManager so the app can kill
 * live runs on shutdown. Events flow main → renderer via webContents.send.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): RunManager {
  const runManager = new RunManager()

  const emit = (runId: string, event: RunEventEnvelope['event']): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.runEvent, { runId, event } satisfies RunEventEnvelope)
    }
  }

  ipcMain.handle(IPC.runStart, (_e, config: RunConfig): RunStartResult => {
    const runId = runManager.start(config, emit)
    return { runId }
  })

  ipcMain.handle(IPC.runPush, async (_e, runId: string, text: string): Promise<void> => {
    await runManager.push(runId, text)
  })

  ipcMain.handle(IPC.runAbort, (_e, runId: string): void => {
    runManager.abort(runId)
  })

  ipcMain.handle(IPC.checkClis, (): Promise<CliCheckResult> => checkClis())

  ipcMain.handle(IPC.pickDir, async (): Promise<string | null> => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  return runManager
}
