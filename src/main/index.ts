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

const activeWindows = new Set<BrowserWindow>()
const MOCK_CHUNK_DELAY_MS = 500

const delayMockChunk = (signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) {
    resolve()
    return
  }

  let timer: ReturnType<typeof setTimeout>
  const finish = (): void => {
    clearTimeout(timer)
    signal.removeEventListener('abort', finish)
    resolve()
  }
  timer = setTimeout(finish, MOCK_CHUNK_DELAY_MS)
  signal.addEventListener('abort', finish, { once: true })
})

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
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  activeWindows.add(mainWindow)
  mainWindow.once('closed', () => activeWindows.delete(mainWindow))
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
    senderPolicy: senderPolicy(),
    executorDelay: delayMockChunk
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
