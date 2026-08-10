import type { ProjectRuntime } from './project-runtime.ts'
import {
  PROJECT_IPC_CHANNELS,
  validateProjectCommand,
  type ProjectResult
} from '../shared/project.ts'
import {
  isAllowedAgentIpcSender,
  type AgentIpcSenderEvent
} from './agent-ipc-security.ts'

export type ProjectIpcMain = {
  handle(
    channel: string,
    handler: (event: AgentIpcSenderEvent, ...args: unknown[]) => Promise<unknown>
  ): void
  removeHandler(channel: string): void
}

const unauthorized = (): ProjectResult<never> => ({
  ok: false,
  error: {
    code: 'IPC_NOT_AUTHORIZED',
    message: 'Project command is not authorized'
  }
})

const invalidCommand = (): ProjectResult<never> => ({
  ok: false,
  error: {
    code: 'INVALID_PROJECT_COMMAND',
    message: 'Project command arguments are invalid'
  }
})

export const registerProjectIpcHandlers = (
  ipcMain: ProjectIpcMain,
  runtime: ProjectRuntime
): (() => void) => {
  for (const channel of Object.values(PROJECT_IPC_CHANNELS)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAllowedAgentIpcSender(event, runtime.senderPolicy)) return unauthorized()
      if (!validateProjectCommand(channel, args)) return invalidCommand()
      switch (channel) {
        case PROJECT_IPC_CHANNELS.listRecent: return runtime.listRecent()
        case PROJECT_IPC_CHANNELS.create: return runtime.create(args[0] as string)
        case PROJECT_IPC_CHANNELS.open: return runtime.open()
        case PROJECT_IPC_CHANNELS.openRecent: return runtime.openRecent(args[0] as string)
        case PROJECT_IPC_CHANNELS.close: return runtime.close()
        case PROJECT_IPC_CHANNELS.rename: return runtime.rename(args[0] as string)
        case PROJECT_IPC_CHANNELS.backup: return runtime.backup()
        case PROJECT_IPC_CHANNELS.restoreBackup: return runtime.restoreBackup()
        case PROJECT_IPC_CHANNELS.removeRecent: return runtime.removeRecent(args[0] as string)
      }
    })
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const channel of Object.values(PROJECT_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}
