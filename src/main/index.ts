import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
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
import { registerChapterIpcHandlers } from './chapter-ipc.ts'
import { createChapterRuntime, type ChapterDialogs } from './chapter-runtime.ts'
import type { ExportFormat } from '../shared/chapter.ts'
import { registerModelIpcHandlers } from './model-ipc.ts'
import { startModelRuntime } from './model-runtime.ts'
import { registerBibleIpcHandlers } from './bible-ipc.ts'
import { createBibleRuntime } from './bible-runtime.ts'
import {
  createRendererFlushCoordinator,
  destroyWindowsForForcedExit,
  RendererFlushError
} from './renderer-flush.ts'
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
      properties: purpose === 'restore-backup'
        ? ['openFile']
        : purpose === 'open'
        ? ['openDirectory']
        : ['openDirectory', 'createDirectory'],
      ...(purpose === 'restore-backup'
        ? { filters: [{ name: 'OpenNovel 项目备份', extensions: ['opennovel.zip'] }] }
        : {})
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

const exportExtensions: Record<ExportFormat, string> = {
  txt: 'txt',
  markdown: 'md',
  docx: 'docx'
}

const chapterDialogs: ChapterDialogs = {
  chooseImportFile: async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要导入的文本',
      properties: ['openFile'],
      filters: [{ name: '文本与 Markdown', extensions: ['txt', 'md', 'markdown'] }]
    })
    return result.canceled ? undefined : result.filePaths[0]
  },
  chooseExportFile: async (format, projectTitle) => {
    const extension = exportExtensions[format]
    const result = await dialog.showSaveDialog({
      title: `导出${format.toUpperCase()}`,
      defaultPath: `${projectTitle}.${extension}`,
      filters: [{ name: `${format.toUpperCase()} 文件`, extensions: [extension] }]
    })
    return result.canceled ? undefined : result.filePath
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
let disposeRendererFlushRuntime = (): void => undefined
let flushActiveRenderers = async (): Promise<boolean> => true
let shutdownModelRuntime = async (): Promise<void> => undefined
let shutdownBibleRuntime = async (): Promise<void> => undefined
let shutdownProjectRuntime = async (): Promise<void> => undefined
const shutdownApplicationResources = async (): Promise<void> => {
  disposeAgentRuntime()
  disposeRendererFlushRuntime()
  await shutdownBibleRuntime()
  await shutdownModelRuntime()
  await shutdownProjectRuntime()
}
const shutdownGate = createProjectShutdownGate({
  shutdown: async () => {
    if (!(await flushActiveRenderers())) throw new RendererFlushError()
    await shutdownApplicationResources()
  },
  onFailure: async (error) => {
    if (error instanceof RendererFlushError) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: '草稿尚未安全保存',
        message: '至少一个编辑窗口未能确认保存。可以返回继续保存，或明确放弃未保存内容后退出。',
        buttons: ['返回继续保存', '放弃未保存内容并退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (result.response === 0) return false
      await shutdownApplicationResources().catch(() => undefined)
      destroyWindowsForForcedExit(activeWindows)
      return true
    }
    console.error('Project shutdown failed')
    await dialog.showMessageBox({
      type: 'error',
      title: '项目关闭失败',
      message: '本地数据库未能正常关闭。应用将安全退出，请在下次启动后检查项目状态。',
      buttons: ['安全退出'],
      noLink: true
    })
    return true
  },
  requestQuit: () => app.quit()
})

app.whenReady().then(async () => {
  const policy = senderPolicy()
  const rendererFlush = createRendererFlushCoordinator({
    ipcMain,
    senderPolicy: policy
  })
  disposeRendererFlushRuntime = () => rendererFlush.dispose()
  flushActiveRenderers = () => rendererFlush.requestFlush(
    [...activeWindows].map((window) => window.webContents)
  )
  const runtime = createAgentRuntime({
    storageRoot: join(app.getPath('userData'), 'agent-runs'),
    senderPolicy: policy,
    executorDelay: delayMockChunk
  })
  const projectService = await ProjectService.start(
    join(app.getPath('userData'), 'control.sqlite3')
  )
  shutdownProjectRuntime = () => projectService.shutdown()
  const modelRuntime = await startModelRuntime({
    controlDatabasePath: join(app.getPath('userData'), 'control.sqlite3'),
    secretRoot: join(app.getPath('userData'), 'model-secrets'),
    cipher: safeStorage,
    projectBindings: projectService,
    senderPolicy: policy
  })
  shutdownModelRuntime = () => modelRuntime.shutdown()
  const chapterRuntime = createChapterRuntime({
    project: projectService,
    dialogs: chapterDialogs,
    senderPolicy: policy
  })
  const bibleRuntime = createBibleRuntime({
    project: projectService,
    coauthor: modelRuntime.structuredCoauthor,
    senderPolicy: policy
  })
  shutdownBibleRuntime = () => bibleRuntime.close()
  const projectRuntime = createProjectRuntime({
    service: projectService,
    dialogs: projectDialogs,
    senderPolicy: policy,
    beforeProjectClose: async () => {
      await bibleRuntime.close()
      await chapterRuntime.close()
    }
  })
  shutdownProjectRuntime = async () => {
    await chapterRuntime.close()
    await projectRuntime.shutdown()
  }
  disposeAgentRuntime = await initializeAgentRuntime({
    runtime,
    registerIpc: () => {
      const disposeAgentIpc = registerAgentIpcHandlers(ipcMain, runtime)
      const disposeProjectIpc = registerProjectIpcHandlers(ipcMain, projectRuntime)
      const disposeChapterIpc = registerChapterIpcHandlers(ipcMain, chapterRuntime)
      const disposeModelIpc = registerModelIpcHandlers(ipcMain, modelRuntime)
      const disposeBibleIpc = registerBibleIpcHandlers(ipcMain, bibleRuntime)
      return () => {
        disposeBibleIpc()
        disposeModelIpc()
        disposeChapterIpc()
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
  await shutdownApplicationResources().catch(() => undefined)
  await dialog.showMessageBox({
    type: 'error',
    title: '应用启动失败',
    message: '本地数据库或安全密钥服务无法启动。应用将安全退出，项目目录不会被删除。',
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
