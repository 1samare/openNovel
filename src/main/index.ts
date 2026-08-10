import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { APP_NAME } from '@shared/app'
import { ProjectService } from '../novel/project-service.ts'
import { registerAgentIpcHandlers } from './agent-ipc.ts'
import {
  bindAgentWindowForwarding,
  createAgentRuntime,
  initializeAgentRuntime,
  type AgentRuntime
} from './agent-runtime.ts'
import type { AgentSenderPolicy } from './agent-ipc-security.ts'
import { registerProjectIpcHandlers } from './project-ipc.ts'
import {
  createProjectRuntime,
  createProjectShutdownGate,
  type ProjectDialogs,
  type ProjectDirectoryPurpose
} from './project-runtime.ts'

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

const directoryTitles: Record<ProjectDirectoryPurpose, string> = {
  create: '选择空目录创建小说项目',
  open: '选择要打开的小说项目',
  backup: '选择项目备份保存目录',
  'restore-backup': '选择要恢复的项目备份',
  'restore-destination': '选择空目录恢复小说项目'
}

const projectDialogs: ProjectDialogs = {
  chooseDirectory: async (purpose) => {
    const result = await dialog.showOpenDialog({
      title: directoryTitles[purpose],
      properties: purpose === 'open' || purpose === 'restore-backup'
        ? ['openDirectory']
        : ['openDirectory', 'createDirectory']
    })
    return result.canceled ? undefined : result.filePaths[0]
  },
  confirmStaleLock: async () => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '检测到陈旧项目锁',
      message: '上一次运行可能未正常关闭。确认没有其他 OpenNovel 实例正在编辑后再恢复。',
      buttons: ['取消', '恢复并打开'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    return result.response === 1
  }
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
let shutdownProjectRuntime = async (): Promise<void> => undefined
const shutdownGate = createProjectShutdownGate({
  shutdown: async () => {
    disposeAgentRuntime()
    await shutdownProjectRuntime()
  },
  onFailure: async () => {
    console.error('Project shutdown failed')
    await dialog.showMessageBox({
      type: 'error',
      title: '项目关闭失败',
      message: '本地数据库未能正常关闭。应用将安全退出，请在下次启动后检查项目状态。',
      buttons: ['安全退出'],
      noLink: true
    })
  },
  requestQuit: () => app.quit()
})

app.whenReady().then(async () => {
  const policy = senderPolicy()
  const runtime = createAgentRuntime({
    storageRoot: join(app.getPath('userData'), 'agent-runs'),
    senderPolicy: policy,
    executorDelay: delayMockChunk
  })
  const projectService = await ProjectService.start(
    join(app.getPath('userData'), 'control.sqlite3')
  )
  const projectRuntime = createProjectRuntime({
    service: projectService,
    dialogs: projectDialogs,
    senderPolicy: policy
  })
  shutdownProjectRuntime = () => projectRuntime.shutdown()
  disposeAgentRuntime = await initializeAgentRuntime({
    runtime,
    registerIpc: () => {
      const disposeAgentIpc = registerAgentIpcHandlers(ipcMain, runtime)
      const disposeProjectIpc = registerProjectIpcHandlers(ipcMain, projectRuntime)
      return () => {
        disposeProjectIpc()
        disposeAgentIpc()
      }
    },
    createWindow: () => { createMainWindow(runtime) },
    onRecoveryFailure: () => console.error('Agent recovery failed')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(runtime)
    }
  })
}).catch(async () => {
  console.error('应用启动失败')
  disposeAgentRuntime()
  await shutdownProjectRuntime().catch(() => undefined)
  await dialog.showMessageBox({
    type: 'error',
    title: '应用启动失败',
    message: '本地项目数据库无法启动。应用将安全退出，项目目录不会被删除。',
    buttons: ['安全退出'],
    noLink: true
  }).catch(() => undefined)
  app.quit()
})

app.on('before-quit', (event) => shutdownGate(event))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
