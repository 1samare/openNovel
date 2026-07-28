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

const isPlainDataObject = (value: unknown): value is Record<string, unknown> => {
  try {
    if (!isRecord(value) || Array.isArray(value)) {
      return false
    }

    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

const agentErrorKeys = ['code', 'message', 'retryable']

type OwnDescriptorSnapshot = {
  ownKeys: PropertyKey[]
  descriptors: Record<string, PropertyDescriptor>
}

const getOwnDescriptorSnapshot = (value: unknown): OwnDescriptorSnapshot | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  try {
    return {
      ownKeys: Reflect.ownKeys(value),
      descriptors: Object.getOwnPropertyDescriptors(value)
    }
  } catch {
    return undefined
  }
}

const isEnumerableDataProperty = (descriptor: PropertyDescriptor | undefined): boolean =>
  descriptor !== undefined &&
  descriptor.enumerable === true &&
  Object.hasOwn(descriptor, 'value') &&
  !Object.hasOwn(descriptor, 'get') &&
  !Object.hasOwn(descriptor, 'set')

const isAgentErrorCode = (value: unknown): value is AgentErrorCode =>
  typeof value === 'string' && agentErrorCodes.includes(value)

const retryableFor = (code: AgentErrorCode): boolean =>
  code === 'PERSISTENCE_FAILED' || code === 'EXECUTION_FAILED'

const toPublicAgentError = (
  value: unknown,
  snapshot: OwnDescriptorSnapshot | undefined = getOwnDescriptorSnapshot(value)
): AgentError | undefined => {
  if (
    !isPlainDataObject(value) ||
    snapshot === undefined ||
    snapshot.ownKeys.length !== agentErrorKeys.length ||
    !snapshot.ownKeys.every((key) => typeof key === 'string' && agentErrorKeys.includes(key))
  ) {
    return undefined
  }

  const { code, message, retryable } = snapshot.descriptors
  if (
    !isEnumerableDataProperty(code) ||
    !isEnumerableDataProperty(message) ||
    !isEnumerableDataProperty(retryable) ||
    !isAgentErrorCode(code.value) ||
    typeof message.value !== 'string' ||
    typeof retryable.value !== 'boolean'
  ) {
    return undefined
  }

  return { code: code.value, message: message.value, retryable: retryable.value }
}

const readDescriptorValue = (
  value: Record<string, unknown>,
  descriptor: PropertyDescriptor | undefined
): unknown => {
  if (descriptor === undefined) {
    return undefined
  }

  if (Object.hasOwn(descriptor, 'value')) {
    return descriptor.value
  }

  return descriptor.get?.call(value)
}

export const isAgentError = (value: unknown): value is AgentError =>
  toPublicAgentError(value) !== undefined

export const toAgentError = (
  error: unknown,
  fallbackCode: AgentErrorCode = 'EXECUTION_FAILED'
): AgentError => {
  const fallback = (): AgentError => ({
    code: fallbackCode,
    message: 'Unexpected agent error',
    retryable: retryableFor(fallbackCode)
  })

  try {
    const snapshot = getOwnDescriptorSnapshot(error)
    const publicError = toPublicAgentError(error, snapshot)
    if (publicError !== undefined) {
      return publicError
    }

    const codeValue = snapshot === undefined
      ? undefined
      : readDescriptorValue(error as Record<string, unknown>, snapshot.descriptors.code)
    const messageValue = snapshot === undefined
      ? undefined
      : readDescriptorValue(error as Record<string, unknown>, snapshot.descriptors.message)
    const retryableValue = snapshot === undefined
      ? undefined
      : readDescriptorValue(error as Record<string, unknown>, snapshot.descriptors.retryable)
    const code = isAgentErrorCode(codeValue) ? codeValue : fallbackCode
    const message = typeof messageValue === 'string' ? messageValue : 'Unexpected agent error'
    const retryable = typeof retryableValue === 'boolean'
      ? retryableValue
      : retryableFor(code)

    return { code, message, retryable }
  } catch {
    return fallback()
  }
}
