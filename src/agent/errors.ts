import type { AgentError, AgentErrorCode } from '../shared/agent.ts'

const agentErrorCodes: string[] = [
  'VALIDATION_ERROR',
  'RUN_NOT_FOUND',
  'INVALID_STATE',
  'PERSISTENCE_FAILED',
  'EXECUTION_FAILED',
  'IPC_FORBIDDEN'
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isAgentErrorCode = (value: unknown): value is AgentErrorCode =>
  typeof value === 'string' && agentErrorCodes.includes(value)

const retryableFor = (code: AgentErrorCode): boolean =>
  code === 'PERSISTENCE_FAILED' || code === 'EXECUTION_FAILED'

export const isAgentError = (value: unknown): value is AgentError =>
  isRecord(value) &&
  Object.keys(value).length === 3 &&
  Object.hasOwn(value, 'code') &&
  Object.hasOwn(value, 'message') &&
  Object.hasOwn(value, 'retryable') &&
  isAgentErrorCode(value.code) &&
  typeof value.message === 'string' &&
  typeof value.retryable === 'boolean'

export const toAgentError = (
  error: unknown,
  fallbackCode: AgentErrorCode = 'EXECUTION_FAILED'
): AgentError => {
  if (isAgentError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }

  const code = isRecord(error) && isAgentErrorCode(error.code) ? error.code : fallbackCode
  const message = error instanceof Error && error.message
    ? error.message
    : isRecord(error) && typeof error.message === 'string'
      ? error.message
      : 'Unexpected agent error'
  const retryable = isRecord(error) && typeof error.retryable === 'boolean'
    ? error.retryable
    : retryableFor(code)

  return { code, message, retryable }
}
