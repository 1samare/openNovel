import { contextBridge, ipcRenderer } from 'electron'
import { createAgentApi } from './agent-api.ts'
import { createProjectApi } from './project-api.ts'

if (!process.contextIsolated) {
  console.error('Preload isolation is disabled')
} else {
  contextBridge.exposeInMainWorld('openNovel', {
    agent: createAgentApi(ipcRenderer),
    projects: createProjectApi(ipcRenderer)
  })
}
