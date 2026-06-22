import { app, shell, BrowserWindow, nativeImage, Tray, Menu, Notification } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import type { AppManagers } from './ipc'
import { AppSettingsStore } from './AppSettingsStore'
import type { WorkflowRun, WorkflowSchedule } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let appManagers: AppManagers | null = null
let tray: Tray | null = null
let quitting = false
let scheduleBadgeActive = false

const APP_NAME = 'Nexture AI'
const LEGACY_USER_DATA_DIR = join(app.getPath('appData'), 'agent-studio')
const appIconPath = join(__dirname, '../../resources/icon.png')
const trayIconPath = join(__dirname, '../../resources/tray-icon.png')

app.setName(APP_NAME)
app.setPath('userData', LEGACY_USER_DATA_DIR)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: appIconPath,
    frame: false,
    show: true,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('show', () => setScheduleBadge(false))
  mainWindow.on('focus', () => setScheduleBadge(false))
  mainWindow.on('close', (event) => {
    if (quitting) return
    const settings = new AppSettingsStore().get()
    if (settings.minimizeToTray) {
      event.preventDefault()
      if (mainWindow) mainWindow.hide()
    }
  })

  // Open external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the file in prod.
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const traySource = nativeImage.createFromPath(trayIconPath)
  const fallbackSource = nativeImage.createFromPath(appIconPath)
  const icon = (traySource.isEmpty() ? fallbackSource : traySource).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  updateTrayMenu()
}

function updateTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    {
      label: scheduleBadgeActive ? `打开 ${APP_NAME}（有定时任务失败）` : `打开 ${APP_NAME}`,
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
        setScheduleBadge(false)
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ]))
}

function setScheduleBadge(active: boolean): void {
  scheduleBadgeActive = active
  if (process.platform === 'darwin') {
    if (active) app.dock.setBadge('!')
    else app.dock.setBadge('')
  }
  tray?.setToolTip(active ? `${APP_NAME} - 有定时任务失败` : APP_NAME)
  updateTrayMenu()
}

function stepDisplayName(run: WorkflowRun): string {
  const step = run.steps[run.currentStepIndex]
  return step?.displayName ?? step?.role ?? `步骤 ${run.currentStepIndex + 1}`
}

function lastExecutionError(run: WorkflowRun): string | undefined {
  const step = run.steps[run.currentStepIndex]
  if (!step) return undefined
  for (let i = step.executions.length - 1; i >= 0; i--) {
    const exec = step.executions[i]
    if (exec.status === 'error' && exec.error) return exec.error
  }
  return undefined
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function notifyScheduleResult(schedule: WorkflowSchedule, run: WorkflowRun): void {
  if (run.status === 'error') {
    setScheduleBadge(true)
    const reason = lastExecutionError(run) ?? '执行过程中断，请打开应用查看详情'
    showNotification(
      `定时任务失败：${schedule.name}`,
      `步骤「${stepDisplayName(run)}」执行失败：${truncate(reason)}`
    )
    return
  }

  if (run.status === 'completed') {
    showNotification(
      `定时任务完成：${schedule.name}`,
      `共 ${run.steps.length} 步，已全部执行完成`
    )
  }
}

function notifyScheduleError(schedule: WorkflowSchedule, error: unknown): void {
  setScheduleBadge(true)
  const reason = error instanceof Error ? error.message : String(error)
  showNotification(
    `定时任务失败：${schedule.name}`,
    `无法启动任务：${truncate(reason)}`
  )
}

function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body, icon: appIconPath }).show()
}

app.commandLine.appendSwitch('remote-debugging-port', '9223')

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(appIconPath)
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }

  createTray()
  appManagers = registerIpc(() => mainWindow, {
    notifyScheduleResult,
    notifyScheduleError
  })
  createWindow()

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      setScheduleBadge(false)
      return
    }
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Kill every live CLI child process before exiting to avoid orphans.
app.on('before-quit', () => {
  quitting = true
  appManagers?.abortAll()
})
