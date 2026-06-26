import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { IPC, type AppUpdateState } from '@shared/types'
import { selectMirror, installMirrorRedirector } from './githubMirror'

type GetWindow = () => BrowserWindow | null

const { autoUpdater } = electronUpdater

let configured = false
let getWindow: GetWindow = () => null

let currentState: AppUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  canInstall: false
}

// Resolves once mirror selection has run. Probe is best-effort — it resolves
// null (direct connection) if no mirror answers, so it never blocks updates.
let mirrorReady: Promise<string | null> | null = null

function ensureMirrorReady(): Promise<string | null> {
  if (!mirrorReady) {
    mirrorReady = (async () => {
      const mirror = await selectMirror()
      installMirrorRedirector()
      return mirror
    })()
  }
  return mirrorReady
}

export function configureAppUpdater(nextGetWindow: GetWindow): void {
  getWindow = nextGetWindow
  if (configured) return
  configured = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: '正在检查新版本',
      error: undefined,
      canInstall: false
    })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setUpdateState({
      status: 'available',
      availableVersion: info.version,
      message: `发现新版本 ${info.version}，正在下载`,
      error: undefined,
      canInstall: false
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    setUpdateState({
      status: 'not-available',
      availableVersion: info.version,
      percent: undefined,
      message: '当前已是最新版本',
      error: undefined,
      canInstall: false
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setUpdateState({
      status: 'downloading',
      percent: progress.percent,
      message: `正在下载更新 ${Math.round(progress.percent)}%`,
      error: undefined,
      canInstall: false
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setUpdateState({
      status: 'downloaded',
      availableVersion: info.version,
      percent: 100,
      message: `新版本 ${info.version} 已下载，重启后安装`,
      error: undefined,
      canInstall: true
    })
  })

  autoUpdater.on('error', (error: Error) => {
    setUpdateState({
      status: 'error',
      message: '检查更新失败',
      error: error.message,
      canInstall: false
    })
  })
}

export function getAppUpdateState(): AppUpdateState {
  return currentState
}

export async function checkForAppUpdates(options: { silent?: boolean } = {}): Promise<AppUpdateState> {
  if (!app.isPackaged) {
    return setUpdateState({
      status: 'not-available',
      message: '更新检查仅在打包版本中启用',
      error: undefined,
      canInstall: false
    }, !options.silent)
  }

  try {
    const mirror = await ensureMirrorReady()
    setUpdateState({
      status: 'checking',
      message: mirror ? '正在检查新版本（镜像加速）' : '正在检查新版本',
      error: undefined,
      canInstall: false
    }, !options.silent)
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setUpdateState({
      status: 'error',
      message: '检查更新失败',
      error: error instanceof Error ? error.message : String(error),
      canInstall: false
    }, !options.silent)
  }

  return currentState
}

export function installAppUpdate(): AppUpdateState {
  if (!currentState.canInstall) return currentState
  autoUpdater.quitAndInstall(false, true)
  return currentState
}

function setUpdateState(patch: Partial<AppUpdateState>, emit = true): AppUpdateState {
  currentState = {
    ...currentState,
    ...patch,
    currentVersion: app.getVersion()
  }
  if (emit) emitUpdateState()
  return currentState
}

function emitUpdateState(): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.appUpdateEvent, currentState)
}
