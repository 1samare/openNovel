import type { AgentSenderPolicy } from './agent-ipc-security.ts'
import {
  ProjectDomainError,
  type ProjectBackupSummary,
  type ProjectResult,
  type ProjectSummary,
  type RecentProjectSummary
} from '../shared/project.ts'

export type ProjectServicePort = {
  listRecent(): Promise<RecentProjectSummary[]>
  create(input: { root: string; title: string }): Promise<ProjectSummary>
  open(input: { root: string; recoverStaleLock?: boolean }): Promise<ProjectSummary>
  close(): Promise<void>
  rename(title: string): Promise<ProjectSummary>
  backup(destinationRoot?: string): Promise<ProjectBackupSummary>
  restore(input: { backupRoot: string; destinationRoot: string }): Promise<ProjectSummary>
  removeRecent(projectId: string): Promise<void>
  shutdown(): Promise<void>
}

export type ProjectDirectoryPurpose =
  | 'create'
  | 'open'
  | 'backup'
  | 'restore-backup'
  | 'restore-destination'

export type ProjectDialogs = {
  chooseDirectory(purpose: ProjectDirectoryPurpose): Promise<string | undefined>
  confirmStaleLock(): Promise<boolean>
}

export type ProjectRuntime = {
  senderPolicy: AgentSenderPolicy
  listRecent(): Promise<ProjectResult<RecentProjectSummary[]>>
  create(title: string): Promise<ProjectResult<ProjectSummary | null>>
  open(): Promise<ProjectResult<ProjectSummary | null>>
  openRecent(projectId: string): Promise<ProjectResult<ProjectSummary>>
  close(): Promise<ProjectResult<null>>
  rename(title: string): Promise<ProjectResult<ProjectSummary>>
  backup(): Promise<ProjectResult<ProjectBackupSummary | null>>
  restoreBackup(): Promise<ProjectResult<ProjectSummary | null>>
  removeRecent(projectId: string): Promise<ProjectResult<null>>
  shutdown(): Promise<void>
}

const safeFailure = (error: unknown): ProjectResult<never> => {
  if (error instanceof ProjectDomainError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.code === 'STALE_PROJECT_LOCK'
          ? 'Project has a stale lock'
          : 'Project operation failed'
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'PROJECT_OPERATION_FAILED',
      message: 'Project operation failed'
    }
  }
}

export const createProjectRuntime = (options: {
  service: ProjectServicePort
  dialogs: Partial<ProjectDialogs>
  senderPolicy: AgentSenderPolicy
  beforeProjectClose?(): Promise<void>
}): ProjectRuntime => {
  const run = async <T>(operation: () => Promise<T>): Promise<ProjectResult<T>> => {
    try {
      return { ok: true, data: await operation() }
    } catch (error) {
      return safeFailure(error)
    }
  }

  const choose = async (purpose: ProjectDirectoryPurpose): Promise<string | undefined> => {
    if (options.dialogs.chooseDirectory === undefined) return undefined
    return options.dialogs.chooseDirectory(purpose)
  }

  const openPath = async (root: string): Promise<ProjectSummary> => {
    try {
      return await options.service.open({ root })
    } catch (error) {
      if (
        !(error instanceof ProjectDomainError) ||
        error.code !== 'STALE_PROJECT_LOCK' ||
        options.dialogs.confirmStaleLock === undefined ||
        !(await options.dialogs.confirmStaleLock())
      ) throw error
      return options.service.open({ root, recoverStaleLock: true })
    }
  }

  return {
    senderPolicy: options.senderPolicy,
    listRecent: () => run(() => options.service.listRecent()),
    create: (title) => run(async () => {
      const root = await choose('create')
      return root === undefined ? null : options.service.create({ root, title })
    }),
    open: () => run(async () => {
      const root = await choose('open')
      return root === undefined ? null : openPath(root)
    }),
    openRecent: (projectId) => run(async () => {
      const recent = (await options.service.listRecent()).find(
        (project) => project.projectId === projectId
      )
      if (recent === undefined) {
        throw new ProjectDomainError('PROJECT_NOT_FOUND', 'Recent project does not exist')
      }
      return openPath(recent.projectPath)
    }),
    close: () => run(async () => {
      await options.beforeProjectClose?.()
      await options.service.close()
      return null
    }),
    rename: (title) => run(() => options.service.rename(title)),
    backup: () => run(async () => {
      const root = await choose('backup')
      return root === undefined ? null : options.service.backup(root)
    }),
    restoreBackup: () => run(async () => {
      const backupRoot = await choose('restore-backup')
      if (backupRoot === undefined) return null
      const destinationRoot = await choose('restore-destination')
      return destinationRoot === undefined
        ? null
        : options.service.restore({ backupRoot, destinationRoot })
    }),
    removeRecent: (projectId) => run(async () => {
      await options.service.removeRecent(projectId)
      return null
    }),
    shutdown: () => options.service.shutdown()
  }
}

export const createProjectShutdownGate = (options: {
  shutdown(): Promise<void>
  requestQuit(): void
  onFailure?(error: unknown): boolean | void | Promise<boolean | void>
}): ((event: { preventDefault(): void }) => void) => {
  let completed = false
  let running = false
  return (event) => {
    if (completed) return
    event.preventDefault()
    if (running) return
    running = true
    void options.shutdown()
      .then(() => {
        completed = true
        options.requestQuit()
      })
      .catch(async (error) => {
        let shouldQuit = true
        try {
          shouldQuit = (await options.onFailure?.(error)) !== false
        } catch {
          shouldQuit = true
        }
        if (!shouldQuit) {
          running = false
          return
        }
        completed = true
        options.requestQuit()
      })
  }
}
