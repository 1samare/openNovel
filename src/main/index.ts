import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { APP_NAME } from '@shared/app'
import { registerAgentIpcHandlers } from './agent-ipc.ts'
import {
  bindAgentWindowForwarding,
  createAgentRuntime,
  initializeAgentRuntime,
  type AgentRuntime
} from './agent-runtime.ts'
import type { AgentSenderPolicy } from './agent-ipc-security.ts'

const senderPolicy = (): AgentSenderPolicy => {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl !== undefined) {
    try {
      return { devServerOrigin: devServerUrl }
    } catch {
      return {}
    }
  }
  return { appPageUrl: pathToFileURL(join(__dirname, '../renderer/index.html')).href }
}

const createMainWindow = (runtime: AgentRuntime): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  bindAgentWindowForwarding(mainWindow, runtime)
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Renderer load failed', { errorCode, errorDescription, validatedURL })
    }
  )

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

let disposeAgentRuntime = (): void => undefined

app.whenReady().then(async () => {
  const runtime = createAgentRuntime({
    storageRoot: join(app.getPath('userData'), 'agent-runs'),
    senderPolicy: senderPolicy()
  })
  disposeAgentRuntime = await initializeAgentRuntime({
    runtime,
    registerIpc: () => registerAgentIpcHandlers(ipcMain, runtime),
    createWindow: () => { createMainWindow(runtime) },
    onRecoveryFailure: () => console.error('Agent recovery failed')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(runtime)
    }
  })
})

app.once('before-quit', () => {
  disposeAgentRuntime()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
