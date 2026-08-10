import {
  PROJECT_IPC_CHANNELS,
  isProjectBackupSummary,
  isProjectResult,
  isProjectSummary,
  isRecentProjectSummary,
  type ProjectApi,
  type ProjectResult
} from '../shared/project.ts'

export type ProjectIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

const unavailable = (): ProjectResult<never> => ({
  ok: false,
  error: {
    code: 'PROJECT_OPERATION_FAILED',
    message: 'Project bridge returned an invalid result'
  }
})

const invoke = async <T>(
  ipcRenderer: ProjectIpcRenderer,
  channel: string,
  args: readonly unknown[],
  validateData: (data: unknown) => data is T
): Promise<ProjectResult<T>> => {
  try {
    const result = await ipcRenderer.invoke(channel, ...args)
    return isProjectResult(result, validateData)
      ? structuredClone(result) as ProjectResult<T>
      : unavailable()
  } catch {
    return unavailable()
  }
}

const isNull = (value: unknown): value is null => value === null
const isNullableProjectSummary = (value: unknown): value is import('../shared/project.ts').ProjectSummary | null =>
  value === null || isProjectSummary(value)
const isNullableProjectBackupSummary = (value: unknown): value is import('../shared/project.ts').ProjectBackupSummary | null =>
  value === null || isProjectBackupSummary(value)
const isRecentProjectList = (value: unknown): value is import('../shared/project.ts').RecentProjectSummary[] =>
  Array.isArray(value) && value.every(isRecentProjectSummary)

export const createProjectApi = (ipcRenderer: ProjectIpcRenderer): ProjectApi => ({
  listRecent: () => invoke(ipcRenderer, PROJECT_IPC_CHANNELS.listRecent, [], isRecentProjectList),
  create: (title) => invoke(
    ipcRenderer,
    PROJECT_IPC_CHANNELS.create,
    [title],
    isNullableProjectSummary
  ),
  open: () => invoke(ipcRenderer, PROJECT_IPC_CHANNELS.open, [], isNullableProjectSummary),
  openRecent: (projectId) => invoke(
    ipcRenderer,
    PROJECT_IPC_CHANNELS.openRecent,
    [projectId],
    isProjectSummary
  ),
  close: () => invoke(ipcRenderer, PROJECT_IPC_CHANNELS.close, [], isNull),
  rename: (title) => invoke(
    ipcRenderer,
    PROJECT_IPC_CHANNELS.rename,
    [title],
    isProjectSummary
  ),
  backup: () => invoke(
    ipcRenderer,
    PROJECT_IPC_CHANNELS.backup,
    [],
    isNullableProjectBackupSummary
  ),
  restoreBackup: () => invoke(
    ipcRenderer,
    PROJECT_IPC_CHANNELS.restoreBackup,
    [],
    isNullableProjectSummary
  ),
  removeRecent: (projectId) => invoke(
    ipcRenderer,
    PROJECT_IPC_CHANNELS.removeRecent,
    [projectId],
    isNull
  )
})
