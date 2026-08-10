import {
  MODEL_IPC_CHANNELS,
  isModelResult,
  validateModelCommand,
  type ModelResult
} from '../shared/model.ts'
import {
  isAllowedAgentIpcSender,
  type AgentIpcSenderEvent
} from './agent-ipc-security.ts'
import type { ModelRuntime } from './model-runtime.ts'

export type ModelIpcMain = {
  handle(
    channel: string,
    handler: (event: AgentIpcSenderEvent, ...args: unknown[]) => Promise<unknown>
  ): void
  removeHandler(channel: string): void
}

const failure = (
  code: 'MODEL_IPC_NOT_AUTHORIZED' | 'MODEL_INVALID_COMMAND' | 'MODEL_OPERATION_FAILED'
): ModelResult<never> => ({
  ok: false,
  error: {
    code,
    message: code === 'MODEL_IPC_NOT_AUTHORIZED'
      ? 'Model command is not authorized'
      : code === 'MODEL_INVALID_COMMAND'
        ? 'Model command arguments are invalid'
        : 'Model operation failed',
    retryable: false
  }
})

const dispatch = (
  runtime: ModelRuntime,
  channel: string,
  args: readonly unknown[]
): Promise<ModelResult<unknown>> => {
  switch (channel) {
    case MODEL_IPC_CHANNELS.listConnections: return runtime.listConnections()
    case MODEL_IPC_CHANNELS.saveConnection:
      return runtime.saveConnection(args[0] as Parameters<ModelRuntime['saveConnection']>[0])
    case MODEL_IPC_CHANNELS.testConnection:
      return runtime.testConnection(args[0] as Parameters<ModelRuntime['testConnection']>[0])
    case MODEL_IPC_CHANNELS.cancelConnectionTest:
      return runtime.cancelConnectionTest(args[0] as string)
    case MODEL_IPC_CHANNELS.listModels: return runtime.listModels(args[0] as string)
    case MODEL_IPC_CHANNELS.listProfiles: return runtime.listProfiles()
    case MODEL_IPC_CHANNELS.saveProfile:
      return runtime.saveProfile(args[0] as Parameters<ModelRuntime['saveProfile']>[0])
    case MODEL_IPC_CHANNELS.getBindings: return runtime.getBindings()
    case MODEL_IPC_CHANNELS.saveBindings:
      return runtime.saveBindings(args[0] as Parameters<ModelRuntime['saveBindings']>[0])
    default: return Promise.resolve(failure('MODEL_INVALID_COMMAND'))
  }
}

const registrations = new WeakMap<ModelIpcMain, () => void>()

export const registerModelIpcHandlers = (
  ipcMain: ModelIpcMain,
  runtime: ModelRuntime
): (() => void) => {
  const existing = registrations.get(ipcMain)
  if (existing !== undefined) return existing
  const channels = Object.values(MODEL_IPC_CHANNELS)
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAllowedAgentIpcSender(event, runtime.senderPolicy)) {
        return failure('MODEL_IPC_NOT_AUTHORIZED')
      }
      if (!validateModelCommand(channel, args)) return failure('MODEL_INVALID_COMMAND')
      try {
        const result = await dispatch(runtime, channel, args)
        return isModelResult(result)
          ? structuredClone(result)
          : failure('MODEL_OPERATION_FAILED')
      } catch {
        return failure('MODEL_OPERATION_FAILED')
      }
    })
  }
  const dispose = (): void => {
    if (registrations.get(ipcMain) !== dispose) return
    for (const channel of channels) ipcMain.removeHandler(channel)
    registrations.delete(ipcMain)
  }
  registrations.set(ipcMain, dispose)
  return dispose
}
