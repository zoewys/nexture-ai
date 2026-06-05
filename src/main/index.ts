import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import type { AppManagers } from './ipc'

let mainWindow: BrowserWindow | null = null
let appManagers: AppManagers | null = null

const appIconPath = join(__dirname, '../../resources/icon.png')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: appIconPath,
    frame: false,
    show: true,
    title: 'Agent Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(appIconPath)
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }

  appManagers = registerIpc(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Kill every live CLI child process before exiting to avoid orphans.
app.on('before-quit', () => {
  appManagers?.abortAll()
})
