import type { AgentError, AgentErrorCode } from '../shared/agent.ts'

const agentErrorCodes: string[] = [
  'INVALID_PROMPT',
  'INVALID_STATE',
  'INVALID_RUN',
  'EXECUTION_FAILED',
  'UNEXPECTED_ERROR'
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isAgentError = (value: unknown): value is AgentError =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  agentErrorCodes.includes(value.code) &&
  typeof value.message === 'string'

export const toAgentError = (
  error: unknown,
  fallbackCode: AgentErrorCode = 'UNEXPECTED_ERROR'
): AgentError => {
  if (isAgentError(error)) {
    return error
  }

  if (error instanceof Error && error.message) {
    return { code: fallbackCode, message: error.message }
  }

  return { code: fallbackCode, message: 'Unexpected agent error' }
}
