import { contextBridge, ipcRenderer } from 'electron'
import { createAgentApi } from './agent-api.ts'
import { createProjectApi } from './project-api.ts'
import { createChapterApi } from './chapter-api.ts'
import { createRendererFlushApi } from './renderer-flush-api.ts'

if (!process.contextIsolated) {
  console.error('Preload isolation is disabled')
} else {
  contextBridge.exposeInMainWorld('openNovel', {
    agent: createAgentApi(ipcRenderer),
    projects: createProjectApi(ipcRenderer),
    chapters: createChapterApi(ipcRenderer),
    lifecycle: createRendererFlushApi(ipcRenderer)
  })
}
