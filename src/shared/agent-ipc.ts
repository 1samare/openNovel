import type { AgentEvent, AgentResult, AgentRun, RunListResult } from './agent.ts'

export const AGENT_IPC_CHANNELS = {
  createRun: 'agent:create-run',
  getRun: 'agent:get-run',
  listRuns: 'agent:list-runs',
  getEvents: 'agent:get-events',
  approveRun: 'agent:approve-run',
  cancelRun: 'agent:cancel-run',
  resumeRun: 'agent:resume-run',
  event: 'agent:event'
} as const

export type AgentCommandChannel = Exclude<
  (typeof AGENT_IPC_CHANNELS)[keyof typeof AGENT_IPC_CHANNELS],
  typeof AGENT_IPC_CHANNELS.event
>

export type AgentCommand =
  | { channel: typeof AGENT_IPC_CHANNELS.createRun; prompt: string }
  | { channel: typeof AGENT_IPC_CHANNELS.getRun; runId: string }
  | { channel: typeof AGENT_IPC_CHANNELS.listRuns }
  | { channel: typeof AGENT_IPC_CHANNELS.getEvents; runId: string; afterSequence: number }
  | { channel: typeof AGENT_IPC_CHANNELS.approveRun; runId: string }
  | { channel: typeof AGENT_IPC_CHANNELS.cancelRun; runId: string }
  | { channel: typeof AGENT_IPC_CHANNELS.resumeRun; runId: string }

export type AgentApi = {
  createRun(prompt: string): Promise<AgentResult<AgentRun>>
  getRun(runId: string): Promise<AgentResult<AgentRun>>
  listRuns(): Promise<AgentResult<RunListResult>>
  getEvents(runId: string, afterSequence?: number): Promise<AgentResult<AgentEvent[]>>
  approveRun(runId: string): Promise<AgentResult<AgentRun>>
  cancelRun(runId: string): Promise<AgentResult<AgentRun>>
  resumeRun(runId: string): Promise<AgentResult<AgentRun>>
  subscribeEvents(listener: (event: AgentEvent) => void): () => void
}

const commandChannels: readonly AgentCommandChannel[] = [
  AGENT_IPC_CHANNELS.createRun,
  AGENT_IPC_CHANNELS.getRun,
  AGENT_IPC_CHANNELS.listRuns,
  AGENT_IPC_CHANNELS.getEvents,
  AGENT_IPC_CHANNELS.approveRun,
  AGENT_IPC_CHANNELS.cancelRun,
  AGENT_IPC_CHANNELS.resumeRun
]

const invalidArguments = (): AgentResult<never> => ({
  ok: false,
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid agent command arguments',
    retryable: false
  }
})

const forbiddenChannel = (): AgentResult<never> => ({
  ok: false,
  error: {
    code: 'IPC_FORBIDDEN',
    message: 'IPC channel is not allowed',
    retryable: false
  }
})

const isRunId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

const isAfterSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const isAgentCommandChannel = (value: unknown): value is AgentCommandChannel =>
  typeof value === 'string' && commandChannels.includes(value as AgentCommandChannel)

export const validateAgentCommand = (
  channel: unknown,
  args: readonly unknown[]
): AgentResult<AgentCommand> => {
  if (!isAgentCommandChannel(channel)) {
    return forbiddenChannel()
  }

  if (channel === AGENT_IPC_CHANNELS.createRun) {
    return args.length === 1 && typeof args[0] === 'string' && args[0].trim() !== ''
      ? { ok: true, data: { channel, prompt: args[0] } }
      : invalidArguments()
  }

  if (channel === AGENT_IPC_CHANNELS.listRuns) {
    return args.length === 0 ? { ok: true, data: { channel } } : invalidArguments()
  }

  if (channel === AGENT_IPC_CHANNELS.getEvents) {
    const afterSequence = args.length === 2 ? args[1] : 0
    if (!isRunId(args[0]) || !isAfterSequence(afterSequence) || args.length > 2) {
      return invalidArguments()
    }
    return { ok: true, data: { channel, runId: args[0], afterSequence } }
  }

  return args.length === 1 && isRunId(args[0])
    ? { ok: true, data: { channel, runId: args[0] } }
    : invalidArguments()
}
