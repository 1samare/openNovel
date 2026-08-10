import {
  MODEL_IPC_CHANNELS,
  isConnectionTestResult,
  isModelBindingConfiguration,
  isModelProfile,
  isModelProfileList,
  isModelResult,
  isProviderConnectionList,
  isProviderConnectionSummary,
  isProviderModelOptionList,
  type ModelApi,
  type ModelResult
} from '../shared/model.ts'

export type ModelIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

const unavailable = (): ModelResult<never> => ({
  ok: false,
  error: {
    code: 'MODEL_OPERATION_FAILED',
    message: 'Model bridge returned an invalid result',
    retryable: false
  }
})

const invoke = async <T>(
  ipcRenderer: ModelIpcRenderer,
  channel: string,
  args: readonly unknown[],
  validateData: (value: unknown) => value is T
): Promise<ModelResult<T>> => {
  try {
    const result = await ipcRenderer.invoke(channel, ...args)
    return isModelResult(result, validateData)
      ? structuredClone(result) as ModelResult<T>
      : unavailable()
  } catch {
    return unavailable()
  }
}

const isNull = (value: unknown): value is null => value === null

export const createModelApi = (ipcRenderer: ModelIpcRenderer): ModelApi => ({
  listConnections: () => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.listConnections,
    [],
    isProviderConnectionList
  ),
  saveConnection: (input) => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.saveConnection,
    [input],
    isProviderConnectionSummary
  ),
  testConnection: (input) => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.testConnection,
    [input],
    isConnectionTestResult
  ),
  cancelConnectionTest: (requestId) => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.cancelConnectionTest,
    [requestId],
    isNull
  ),
  listModels: (connectionId) => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.listModels,
    [connectionId],
    isProviderModelOptionList
  ),
  listProfiles: () => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.listProfiles,
    [],
    isModelProfileList
  ),
  saveProfile: (input) => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.saveProfile,
    [input],
    isModelProfile
  ),
  getBindings: () => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.getBindings,
    [],
    isModelBindingConfiguration
  ),
  saveBindings: (input) => invoke(
    ipcRenderer,
    MODEL_IPC_CHANNELS.saveBindings,
    [input],
    isModelBindingConfiguration
  )
})
