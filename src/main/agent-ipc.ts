import type { AgentEvent, AgentResult, AgentRun, RunListResult } from '../shared/agent.ts'
import {
  AGENT_IPC_CHANNELS,
  type AgentCommand,
  type AgentCommandChannel,
  validateAgentCommand
} from '../shared/agent-ipc.ts'
import type { AgentRuntime } from './agent-runtime.ts'
import { isAllowedAgentIpcSender, type AgentIpcSenderEvent } from './agent-ipc-security.ts'

export type AgentIpcMain = {
  handle(
    channel: AgentCommandChannel,
    listener: (event: AgentIpcSenderEvent, ...args: unknown[]) => Promise<AgentResult<unknown>>
  ): void
}

type AgentCommandResult = AgentResult<AgentRun | RunListResult | AgentEvent[]>

const failure = (code: 'VALIDATION_ERROR' | 'IPC_FORBIDDEN' | 'EXECUTION_FAILED'): AgentResult<never> => ({
  ok: false,
  error: {
    code,
    message: code === 'VALIDATION_ERROR'
      ? 'Invalid agent command arguments'
      : code === 'IPC_FORBIDDEN'
        ? 'IPC sender is not allowed'
        : 'Agent IPC command failed',
    retryable: false
  }
})

const serializedError = (error: unknown): AgentResult<never> => {
  if (typeof error !== 'object' || error === null || !Object.hasOwn(error, 'code')) {
    return failure('EXECUTION_FAILED')
  }
  const code = (error as { code?: unknown }).code
  if (code === 'VALIDATION_ERROR') return failure('VALIDATION_ERROR')
  if (code === 'IPC_FORBIDDEN') return failure('IPC_FORBIDDEN')
  if (code === 'RUN_NOT_FOUND') {
    return { ok: false, error: { code, message: 'Run was not found', retryable: false } }
  }
  if (code === 'INVALID_STATE') {
    return { ok: false, error: { code, message: 'Agent command is not allowed in the current state', retryable: false } }
  }
  if (code === 'PERSISTENCE_FAILED') {
    return { ok: false, error: { code, message: 'Agent data could not be saved', retryable: true } }
  }
  return failure('EXECUTION_FAILED')
}

const dispatch = (runtime: AgentRuntime, command: AgentCommand): Promise<AgentCommandResult> => {
  switch (command.channel) {
    case AGENT_IPC_CHANNELS.createRun:
      return runtime.orchestrator.createRun(command.prompt)
    case AGENT_IPC_CHANNELS.getRun:
      return runtime.orchestrator.getRun(command.runId)
    case AGENT_IPC_CHANNELS.listRuns:
      return runtime.orchestrator.listRuns()
    case AGENT_IPC_CHANNELS.getEvents:
      return runtime.orchestrator.getEvents(command.runId, command.afterSequence)
    case AGENT_IPC_CHANNELS.approveRun:
      return runtime.orchestrator.approveRun(command.runId)
    case AGENT_IPC_CHANNELS.cancelRun:
      return runtime.orchestrator.cancelRun(command.runId)
    case AGENT_IPC_CHANNELS.resumeRun:
      return runtime.orchestrator.resumeRun(command.runId)
  }
}

export const registerAgentIpcHandlers = (ipcMain: AgentIpcMain, runtime: AgentRuntime): void => {
  const channels: AgentCommandChannel[] = [
    AGENT_IPC_CHANNELS.createRun,
    AGENT_IPC_CHANNELS.getRun,
    AGENT_IPC_CHANNELS.listRuns,
    AGENT_IPC_CHANNELS.getEvents,
    AGENT_IPC_CHANNELS.approveRun,
    AGENT_IPC_CHANNELS.cancelRun,
    AGENT_IPC_CHANNELS.resumeRun
  ]

  for (const channel of channels) {
    ipcMain.handle(channel, async (event, ...args): Promise<AgentResult<unknown>> => {
      if (!isAllowedAgentIpcSender(event, runtime.senderPolicy)) return failure('IPC_FORBIDDEN')
      const command = validateAgentCommand(channel, args)
      if (!command.ok) return command
      try {
        const result = await dispatch(runtime, command.data)
        return result.ok ? structuredClone(result) : serializedError(result.error)
      } catch {
        return failure('EXECUTION_FAILED')
      }
    })
  }
}
