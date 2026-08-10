export const PROVIDER_KINDS = ['openai-compatible', 'anthropic', 'gemini'] as const
export const AGENT_ROLES = ['editor', 'setting', 'character', 'plot', 'writer', 'reviewer'] as const
export const GENERATION_MODES = ['quick', 'standard', 'deep'] as const
export const MODEL_CAPABILITIES = ['stream-text', 'structured-output', 'tools', 'usage'] as const

export type ProviderKind = typeof PROVIDER_KINDS[number]
export type AgentRole = typeof AGENT_ROLES[number]
export type GenerationMode = typeof GENERATION_MODES[number]
export type ModelCapability = typeof MODEL_CAPABILITIES[number]

export type ModelErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'MODEL_ENCRYPTION_UNAVAILABLE'
  | 'MODEL_SECRET_MISSING'
  | 'MODEL_INVALID_BASE_URL'
  | 'MODEL_CAPABILITY_REQUIRED'
  | 'MODEL_OFFLINE'
  | 'MODEL_DNS_FAILED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_AUTH_FAILED'
  | 'MODEL_BALANCE_EXHAUSTED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_CONTENT_BLOCKED'
  | 'MODEL_INVALID_STRUCTURE'
  | 'MODEL_CANCELLED'
  | 'MODEL_PROVIDER_FAILED'
  | 'MODEL_DATABASE_FAILED'
  | 'MODEL_IPC_NOT_AUTHORIZED'
  | 'MODEL_INVALID_COMMAND'
  | 'MODEL_OPERATION_FAILED'

export class ModelDomainError extends Error {
  readonly code: ModelErrorCode
  readonly retryable: boolean
  readonly status?: number

  constructor(
    code: ModelErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ModelDomainError'
    this.code = code
    this.retryable = options.retryable === true
    if (options.status !== undefined) this.status = options.status
  }
}

export type SaveProviderConnectionInput = {
  id?: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  apiKey?: string
  enabled: boolean
}

export type ProviderConnectionSummary = {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  enabled: boolean
  hasSecret: boolean
  secretHint?: string
  createdAt: string
  updatedAt: string
}

export type ModelProfile = {
  id: string
  connectionId: string
  label: string
  modelId: string
  temperature: number
  maxOutputTokens: number
  contextWindow: number
  capabilities: ModelCapability[]
}

export type SaveModelProfileInput = Omit<ModelProfile, 'id'> & { id?: string }

export type ModelRoute = {
  primaryProfileId: string
  fallbackProfileIds: string[]
  allowCrossProviderFallback: boolean
}

export type GenerationModeDefault = ModelRoute & {
  mode: GenerationMode
}

export type AgentRoleBinding = ModelRoute & {
  role: AgentRole
  mode: GenerationMode
}

export type ModelBindingConfiguration = {
  modeDefaults: GenerationModeDefault[]
  roleBindings: AgentRoleBinding[]
}

export type SaveModelBindingsInput = ModelBindingConfiguration & {
  confirmCrossProviderRouting: boolean
}

export type ProviderModelOption = {
  id: string
  label: string
}

export type ConnectionTestResult = {
  connectionId: string
  modelId: string
  authenticated: boolean
  modelAvailable: boolean
  capabilities: ModelCapability[]
  latencyMs: number
  providerRequestId?: string
}

export type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  estimatedCostMicros?: number
}

export type ModelStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; usage?: ModelUsage; providerRequestId?: string }

export type TextGenerationRequest = {
  profileId: string
  prompt: string
  system?: string
  signal: AbortSignal
}

export type RuntimeSchema<T> = ZodType<T>

export type StructuredGenerationRequest<T> = {
  profileId: string
  prompt: string
  system?: string
  schema: RuntimeSchema<T>
  signal: AbortSignal
}

export type StructuredGenerationResult<T> = {
  value: T
  usage?: ModelUsage
  providerRequestId?: string
}

export type TokenEstimateRequest = {
  profileId: string
  text: string
}

export type TokenEstimate = {
  tokens: number
  method: 'provider' | 'heuristic'
}

export interface ModelGateway {
  testConnection(
    connectionId: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<ConnectionTestResult>
  streamText(request: TextGenerationRequest): AsyncIterable<ModelStreamEvent>
  generateObject<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGenerationResult<T>>
  estimateTokens(request: TokenEstimateRequest): Promise<TokenEstimate>
}

export type ModelPublicError = {
  code: ModelErrorCode
  message: string
  retryable: boolean
}

export type ModelResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ModelPublicError }

export const MODEL_IPC_CHANNELS = {
  listConnections: 'models:list-connections',
  saveConnection: 'models:save-connection',
  testConnection: 'models:test-connection',
  cancelConnectionTest: 'models:cancel-connection-test',
  listModels: 'models:list-models',
  listProfiles: 'models:list-profiles',
  saveProfile: 'models:save-profile',
  getBindings: 'models:get-bindings',
  saveBindings: 'models:save-bindings'
} as const

export type ModelIpcChannel = typeof MODEL_IPC_CHANNELS[keyof typeof MODEL_IPC_CHANNELS]

export type ModelApi = {
  listConnections(): Promise<ModelResult<ProviderConnectionSummary[]>>
  saveConnection(input: SaveProviderConnectionInput): Promise<ModelResult<ProviderConnectionSummary>>
  testConnection(input: {
    requestId: string
    connectionId: string
    modelId: string
  }): Promise<ModelResult<ConnectionTestResult>>
  cancelConnectionTest(requestId: string): Promise<ModelResult<null>>
  listModels(connectionId: string): Promise<ModelResult<ProviderModelOption[]>>
  listProfiles(): Promise<ModelResult<ModelProfile[]>>
  saveProfile(input: SaveModelProfileInput): Promise<ModelResult<ModelProfile>>
  getBindings(): Promise<ModelResult<ModelBindingConfiguration>>
  saveBindings(input: SaveModelBindingsInput): Promise<ModelResult<ModelBindingConfiguration>>
}

const MODEL_ERROR_CODES: ReadonlySet<string> = new Set<ModelErrorCode>([
  'MODEL_NOT_CONFIGURED',
  'MODEL_ENCRYPTION_UNAVAILABLE',
  'MODEL_SECRET_MISSING',
  'MODEL_INVALID_BASE_URL',
  'MODEL_CAPABILITY_REQUIRED',
  'MODEL_OFFLINE',
  'MODEL_DNS_FAILED',
  'MODEL_TIMEOUT',
  'MODEL_RATE_LIMITED',
  'MODEL_AUTH_FAILED',
  'MODEL_BALANCE_EXHAUSTED',
  'MODEL_NOT_FOUND',
  'MODEL_CONTENT_BLOCKED',
  'MODEL_INVALID_STRUCTURE',
  'MODEL_CANCELLED',
  'MODEL_PROVIDER_FAILED',
  'MODEL_DATABASE_FAILED',
  'MODEL_IPC_NOT_AUTHORIZED',
  'MODEL_INVALID_COMMAND',
  'MODEL_OPERATION_FAILED'
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|')

const isNonBlankString = (value: unknown, maximum = 200): value is string =>
  typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum

const isOptionalId = (value: unknown): value is string | undefined =>
  value === undefined || isNonBlankString(value, 128)

const isProviderKind = (value: unknown): value is ProviderKind =>
  typeof value === 'string' && PROVIDER_KINDS.includes(value as ProviderKind)

const isModelCapability = (value: unknown): value is ModelCapability =>
  typeof value === 'string' && MODEL_CAPABILITIES.includes(value as ModelCapability)

const isGenerationMode = (value: unknown): value is GenerationMode =>
  typeof value === 'string' && GENERATION_MODES.includes(value as GenerationMode)

const isAgentRole = (value: unknown): value is AgentRole =>
  typeof value === 'string' && AGENT_ROLES.includes(value as AgentRole)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const isUniqueIds = (value: unknown, disallowed?: string): value is string[] => {
  if (!Array.isArray(value) || !value.every((item) => isNonBlankString(item, 128))) {
    return false
  }
  const ids = value as string[]
  return new Set(ids).size === ids.length && !ids.includes(disallowed ?? '')
}

const isCapabilityList = (value: unknown): value is ModelCapability[] => (
  Array.isArray(value) &&
  value.every(isModelCapability) &&
  new Set(value).size === value.length
)

const hasPublicDataOnly = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.every(hasPublicDataOnly)
  if (!isRecord(value)) return true
  for (const [key, child] of Object.entries(value)) {
    if (key === 'apiKey' || key === 'secretRef' || key === 'secret') return false
    if (!hasPublicDataOnly(child)) return false
  }
  return true
}

export const isProviderConnectionSummary = (
  value: unknown
): value is ProviderConnectionSummary => {
  if (!isRecord(value)) return false
  const keys = [
    'id', 'name', 'kind', 'enabled', 'hasSecret', 'createdAt', 'updatedAt',
    ...(value.baseUrl === undefined ? [] : ['baseUrl']),
    ...(value.secretHint === undefined ? [] : ['secretHint'])
  ]
  return hasExactKeys(value, keys) &&
    isNonBlankString(value.id, 128) &&
    isNonBlankString(value.name, 120) &&
    isProviderKind(value.kind) &&
    (value.baseUrl === undefined || isNonBlankString(value.baseUrl, 2048)) &&
    typeof value.enabled === 'boolean' &&
    typeof value.hasSecret === 'boolean' &&
    (value.secretHint === undefined || isNonBlankString(value.secretHint, 16)) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
}

export const isModelProfile = (value: unknown): value is ModelProfile => (
  isRecord(value) &&
  hasExactKeys(value, [
    'id', 'connectionId', 'label', 'modelId', 'temperature',
    'maxOutputTokens', 'contextWindow', 'capabilities'
  ]) &&
  isNonBlankString(value.id, 128) &&
  isNonBlankString(value.connectionId, 128) &&
  isNonBlankString(value.label, 120) &&
  isNonBlankString(value.modelId, 256) &&
  isFiniteNumber(value.temperature) && value.temperature >= 0 && value.temperature <= 2 &&
  isPositiveInteger(value.maxOutputTokens) &&
  isPositiveInteger(value.contextWindow) &&
  isCapabilityList(value.capabilities)
)

export const isConnectionTestResult = (value: unknown): value is ConnectionTestResult => {
  if (!isRecord(value)) return false
  const keys = [
    'connectionId', 'modelId', 'authenticated', 'modelAvailable',
    'capabilities', 'latencyMs',
    ...(value.providerRequestId === undefined ? [] : ['providerRequestId'])
  ]
  return hasExactKeys(value, keys) &&
    isNonBlankString(value.connectionId, 128) &&
    isNonBlankString(value.modelId, 256) &&
    typeof value.authenticated === 'boolean' &&
    typeof value.modelAvailable === 'boolean' &&
    isCapabilityList(value.capabilities) &&
    isFiniteNumber(value.latencyMs) && value.latencyMs >= 0 &&
    (value.providerRequestId === undefined || isNonBlankString(value.providerRequestId, 256))
}

const isProviderModelOption = (value: unknown): value is ProviderModelOption => (
  isRecord(value) &&
  hasExactKeys(value, ['id', 'label']) &&
  isNonBlankString(value.id, 256) &&
  isNonBlankString(value.label, 256)
)

const isModelRoute = (value: unknown): value is ModelRoute => (
  isRecord(value) &&
  hasExactKeys(value, [
    'primaryProfileId', 'fallbackProfileIds', 'allowCrossProviderFallback'
  ]) &&
  isNonBlankString(value.primaryProfileId, 128) &&
  isUniqueIds(value.fallbackProfileIds, value.primaryProfileId) &&
  typeof value.allowCrossProviderFallback === 'boolean'
)

const isModeDefault = (value: unknown): value is GenerationModeDefault => (
  isRecord(value) &&
  hasExactKeys(value, [
    'mode', 'primaryProfileId', 'fallbackProfileIds', 'allowCrossProviderFallback'
  ]) &&
  isGenerationMode(value.mode) &&
  isModelRoute({
    primaryProfileId: value.primaryProfileId,
    fallbackProfileIds: value.fallbackProfileIds,
    allowCrossProviderFallback: value.allowCrossProviderFallback
  })
)

const isRoleBinding = (value: unknown): value is AgentRoleBinding => (
  isRecord(value) &&
  hasExactKeys(value, [
    'role', 'mode', 'primaryProfileId', 'fallbackProfileIds', 'allowCrossProviderFallback'
  ]) &&
  isAgentRole(value.role) &&
  isGenerationMode(value.mode) &&
  isModelRoute({
    primaryProfileId: value.primaryProfileId,
    fallbackProfileIds: value.fallbackProfileIds,
    allowCrossProviderFallback: value.allowCrossProviderFallback
  })
)

export const isProviderConnectionList = (
  value: unknown
): value is ProviderConnectionSummary[] => (
  Array.isArray(value) && value.every(isProviderConnectionSummary)
)

export const isModelProfileList = (value: unknown): value is ModelProfile[] => (
  Array.isArray(value) && value.every(isModelProfile)
)

export const isProviderModelOptionList = (
  value: unknown
): value is ProviderModelOption[] => (
  Array.isArray(value) && value.every(isProviderModelOption)
)

export const isModelBindingConfiguration = (
  value: unknown
): value is ModelBindingConfiguration => {
  if (!isRecord(value) || !hasExactKeys(value, ['modeDefaults', 'roleBindings'])) return false
  if (!Array.isArray(value.modeDefaults) || !value.modeDefaults.every(isModeDefault)) return false
  if (!Array.isArray(value.roleBindings) || !value.roleBindings.every(isRoleBinding)) return false
  const modeKeys = value.modeDefaults.map((item) => item.mode)
  const roleKeys = value.roleBindings.map((item) => `${item.role}:${item.mode}`)
  return new Set(modeKeys).size === modeKeys.length && new Set(roleKeys).size === roleKeys.length
}

export function isModelResult(value: unknown): value is ModelResult<unknown>
export function isModelResult<T>(
  value: unknown,
  validateData: (data: unknown) => data is T
): value is ModelResult<T>
export function isModelResult<T>(
  value: unknown,
  validateData: (data: unknown) => data is T = (_data): _data is T => true
): value is ModelResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) {
    return hasExactKeys(value, ['ok', 'data']) &&
      hasPublicDataOnly(value.data) &&
      validateData(value.data)
  }
  if (!hasExactKeys(value, ['ok', 'error']) || !isRecord(value.error)) return false
  return hasExactKeys(value.error, ['code', 'message', 'retryable']) &&
    typeof value.error.code === 'string' &&
    MODEL_ERROR_CODES.has(value.error.code) &&
    typeof value.error.message === 'string' &&
    typeof value.error.retryable === 'boolean'
}

const isSaveConnectionInput = (value: unknown): value is SaveProviderConnectionInput => {
  if (!isRecord(value)) return false
  const keys = [
    'name', 'kind', 'enabled',
    ...(value.id === undefined ? [] : ['id']),
    ...(value.baseUrl === undefined ? [] : ['baseUrl']),
    ...(value.apiKey === undefined ? [] : ['apiKey'])
  ]
  return hasExactKeys(value, keys) &&
    isOptionalId(value.id) &&
    isNonBlankString(value.name, 120) &&
    isProviderKind(value.kind) &&
    (value.baseUrl === undefined || isNonBlankString(value.baseUrl, 2048)) &&
    (value.apiKey === undefined || isNonBlankString(value.apiKey, 4096)) &&
    typeof value.enabled === 'boolean'
}

const isSaveProfileInput = (value: unknown): value is SaveModelProfileInput => {
  if (!isRecord(value)) return false
  const keys = [
    'connectionId', 'label', 'modelId', 'temperature', 'maxOutputTokens',
    'contextWindow', 'capabilities',
    ...(value.id === undefined ? [] : ['id'])
  ]
  return hasExactKeys(value, keys) &&
    isOptionalId(value.id) &&
    isNonBlankString(value.connectionId, 128) &&
    isNonBlankString(value.label, 120) &&
    isNonBlankString(value.modelId, 256) &&
    isFiniteNumber(value.temperature) && value.temperature >= 0 && value.temperature <= 2 &&
    isPositiveInteger(value.maxOutputTokens) &&
    isPositiveInteger(value.contextWindow) &&
    isCapabilityList(value.capabilities)
}

const isSaveBindingsInput = (value: unknown): value is SaveModelBindingsInput => (
  isRecord(value) &&
  hasExactKeys(value, ['modeDefaults', 'roleBindings', 'confirmCrossProviderRouting']) &&
  typeof value.confirmCrossProviderRouting === 'boolean' &&
  isModelBindingConfiguration({
    modeDefaults: value.modeDefaults,
    roleBindings: value.roleBindings
  })
)

const isRequestId = (value: unknown): value is string => isNonBlankString(value, 128)

export const validateModelCommand = (channel: string, args: readonly unknown[]): boolean => {
  switch (channel) {
    case MODEL_IPC_CHANNELS.listConnections:
    case MODEL_IPC_CHANNELS.listProfiles:
    case MODEL_IPC_CHANNELS.getBindings:
      return args.length === 0
    case MODEL_IPC_CHANNELS.saveConnection:
      return args.length === 1 && isSaveConnectionInput(args[0])
    case MODEL_IPC_CHANNELS.testConnection:
      return args.length === 1 && isRecord(args[0]) &&
        hasExactKeys(args[0], ['requestId', 'connectionId', 'modelId']) &&
        isRequestId(args[0].requestId) &&
        isNonBlankString(args[0].connectionId, 128) &&
        isNonBlankString(args[0].modelId, 256)
    case MODEL_IPC_CHANNELS.cancelConnectionTest:
    case MODEL_IPC_CHANNELS.listModels:
      return args.length === 1 && isRequestId(args[0])
    case MODEL_IPC_CHANNELS.saveProfile:
      return args.length === 1 && isSaveProfileInput(args[0])
    case MODEL_IPC_CHANNELS.saveBindings:
      return args.length === 1 && isSaveBindingsInput(args[0])
    default:
      return false
  }
}

export const requiredCapabilitiesForRole = (role: AgentRole): ModelCapability[] =>
  role === 'writer' ? ['stream-text'] : ['structured-output']
import type { ZodType } from 'zod'
