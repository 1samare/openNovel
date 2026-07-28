import { isAgentError } from './errors.ts'
import type { AgentEvent, AgentResult, AgentRun, RunStatus } from '../shared/agent.ts'

const runStatuses: string[] = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'cancelled',
  'failed',
  'interrupted'
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isRunStatus = (value: unknown): value is RunStatus =>
  typeof value === 'string' && runStatuses.includes(value)

export const isAgentEvent = (value: unknown): value is AgentEvent => {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.at !== 'string' ||
    typeof value.type !== 'string'
  ) {
    return false
  }

  if (value.type === 'status_changed') {
    return isRunStatus(value.status)
  }

  if (value.type === 'chunk') {
    return (
      (value.phase === 'analysis' || value.phase === 'final') &&
      typeof value.text === 'string'
    )
  }

  if (value.type === 'approval_requested') {
    return true
  }

  return value.type === 'failed' && isAgentError(value.error)
}

export const isAgentRun = (value: unknown): value is AgentRun => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.prompt !== 'string' ||
    value.prompt.trim() === '' ||
    !isRunStatus(value.status) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.events) ||
    !value.events.every(isAgentEvent)
  ) {
    return false
  }

  if (value.events.some((event, index) => event.sequence !== index + 1)) {
    return false
  }

  return (
    (value.result === undefined || typeof value.result === 'string') &&
    (value.error === undefined || isAgentError(value.error))
  )
}

export const validatePrompt = (value: unknown): AgentResult<string> => {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'INVALID_PROMPT',
        message: 'Prompt must be a non-blank string'
      }
    }
  }

  return { ok: true, value }
}
