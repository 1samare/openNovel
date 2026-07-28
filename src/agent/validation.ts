import { isAgentError } from './errors.ts'
import type {
  AgentEvent,
  AgentEventType,
  AgentResult,
  AgentRun,
  JsonValue,
  RunStatus
} from '../shared/agent.ts'

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

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key))

const agentEventTypes: string[] = [
  'run.created',
  'run.started',
  'run.interrupted',
  'run.resumed',
  'run.completed',
  'run.cancelled',
  'run.failed',
  'step.started',
  'step.delta',
  'step.completed',
  'approval.requested',
  'approval.resolved'
]

const isAgentEventType = (value: unknown): value is AgentEventType =>
  typeof value === 'string' && agentEventTypes.includes(value)

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  return isRecord(value) && Object.values(value).every(isJsonValue)
}

const isEventPayload = (value: unknown): value is Record<string, JsonValue> =>
  isRecord(value) && Object.values(value).every(isJsonValue)

export const isRunStatus = (value: unknown): value is RunStatus =>
  typeof value === 'string' && runStatuses.includes(value)

export const isAgentEvent = (value: unknown): value is AgentEvent => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['runId', 'sequence', 'type', 'timestamp', 'payload']) ||
    typeof value.runId !== 'string' ||
    typeof value.sequence !== 'number' ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 1 ||
    !isAgentEventType(value.type) ||
    typeof value.timestamp !== 'string' ||
    !isEventPayload(value.payload)
  ) {
    return false
  }

  return true
}

export const isAgentRun = (value: unknown): value is AgentRun => {
  const runKeys = [
    'id',
    'prompt',
    'status',
    'createdAt',
    'updatedAt',
    'events',
    'output',
    'checkpoint'
  ]

  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, Object.hasOwn(value, 'error') ? [...runKeys, 'error'] : runKeys) ||
    typeof value.id !== 'string' ||
    typeof value.prompt !== 'string' ||
    value.prompt.trim() === '' ||
    !isRunStatus(value.status) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.events) ||
    !value.events.every(isAgentEvent) ||
    !isRecord(value.output) ||
    !hasOnlyKeys(value.output, ['analysis', 'final']) ||
    typeof value.output.analysis !== 'string' ||
    typeof value.output.final !== 'string' ||
    !isRecord(value.checkpoint) ||
    !hasOnlyKeys(value.checkpoint, ['phase', 'nextChunkIndex']) ||
    (value.checkpoint.phase !== 'analysis' && value.checkpoint.phase !== 'final') ||
    typeof value.checkpoint.nextChunkIndex !== 'number' ||
    !Number.isInteger(value.checkpoint.nextChunkIndex) ||
    value.checkpoint.nextChunkIndex < 0 ||
    (value.error !== undefined && !isAgentError(value.error))
  ) {
    return false
  }

  if (
    value.events.some(
      (event, index) => event.sequence !== index + 1 || event.runId !== value.id
    )
  ) {
    return false
  }

  return true
}

export const isAgentResult = (value: unknown): value is AgentResult<unknown> => {
  if (!isRecord(value)) {
    return false
  }

  if (value.ok === true) {
    return hasOnlyKeys(value, ['ok', 'data'])
  }

  return value.ok === false && hasOnlyKeys(value, ['ok', 'error']) && isAgentError(value.error)
}

export const validatePrompt = (value: unknown): AgentResult<string> => {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Prompt must be a non-blank string',
        retryable: false
      }
    }
  }

  return { ok: true, data: value }
}
