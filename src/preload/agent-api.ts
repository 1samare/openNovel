import { isAgentEvent, isAgentResult } from '../agent/validation.ts'
import type { AgentEvent, AgentResult } from '../shared/agent.ts'
import { AGENT_IPC_CHANNELS, type AgentApi } from '../shared/agent-ipc.ts'

export type IpcRendererBridge = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

const unavailable = (): AgentResult<never> => ({
  ok: false,
  error: {
    code: 'EXECUTION_FAILED',
    message: 'Agent bridge returned an invalid result',
    retryable: false
  }
})

const invoke = async <T>(
  ipcRenderer: IpcRendererBridge,
  channel: string,
  args: readonly unknown[] = []
): Promise<AgentResult<T>> => {
  try {
    const result = await ipcRenderer.invoke(channel, ...args)
    return isAgentResult(result) ? structuredClone(result) as AgentResult<T> : unavailable()
  } catch {
    return unavailable()
  }
}

export const createAgentApi = (ipcRenderer: IpcRendererBridge): AgentApi => ({
  createRun: (prompt) => invoke(ipcRenderer, AGENT_IPC_CHANNELS.createRun, [prompt]),
  getRun: (runId) => invoke(ipcRenderer, AGENT_IPC_CHANNELS.getRun, [runId]),
  listRuns: () => invoke(ipcRenderer, AGENT_IPC_CHANNELS.listRuns),
  getEvents: (runId, afterSequence) => invoke(
    ipcRenderer,
    AGENT_IPC_CHANNELS.getEvents,
    afterSequence === undefined ? [runId] : [runId, afterSequence]
  ),
  approveRun: (runId) => invoke(ipcRenderer, AGENT_IPC_CHANNELS.approveRun, [runId]),
  cancelRun: (runId) => invoke(ipcRenderer, AGENT_IPC_CHANNELS.cancelRun, [runId]),
  resumeRun: (runId) => invoke(ipcRenderer, AGENT_IPC_CHANNELS.resumeRun, [runId]),
  subscribeEvents: (listener) => {
    const receive = (_event: unknown, value: unknown): void => {
      if (!isAgentEvent(value)) return
      try {
        listener(structuredClone(value) as AgentEvent)
      } catch {
        // Renderer callback failures must not escape the preload boundary.
      }
    }
    ipcRenderer.on(AGENT_IPC_CHANNELS.event, receive)
    return () => ipcRenderer.removeListener(AGENT_IPC_CHANNELS.event, receive)
  }
})
