import {
  ModelDomainError,
  type ConnectionTestResult,
  type ModelCapability,
  type ModelGateway,
  type ModelProfile,
  type ModelStreamEvent,
  type ModelUsage,
  type ProviderModelOption,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
  type TextGenerationRequest,
  type TokenEstimate,
  type TokenEstimateRequest
} from '../shared/model.ts'
import type { ModelLogger } from '../main/model-logger.ts'
import type {
  ModelCallOperation,
  ModelRepository,
  StoredModelCallLog,
  StoredProviderConnection
} from './model-repository.ts'
import {
  ProviderAdapterError,
  type AdapterObjectResult,
  type ProviderAdapter
} from './provider-adapter.ts'
import type { ProviderRegistry } from './provider-registry.ts'
import type { EncryptedSecretStore } from './secret-store.ts'

type GatewayRepository = Pick<ModelRepository, 'getConnection' | 'getProfile'>
type GatewaySecretStore = Pick<EncryptedSecretStore, 'read'>
type GatewayRegistry = Pick<ProviderRegistry, 'create'>
type GatewayLogger = Pick<ModelLogger, 'record'>

type ResolvedConnection = {
  connection: StoredProviderConnection
  adapter: ProviderAdapter
  secret: string
}

type ResolvedProfile = ResolvedConnection & {
  profile: ModelProfile
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429])
const MAX_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 100
const MAX_RETRY_DELAY_MS = 2_000

const safeCode = (value: string | undefined): string => value?.toLowerCase() ?? ''

const safeProviderRequestId = (
  value: string | undefined,
  secret: string
): string | undefined => {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(value)) return undefined
  return secret.length > 0 && value.includes(secret) ? undefined : value
}

const defaultSleep = (milliseconds: number, signal: AbortSignal): Promise<void> => (
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
)

const mappedProviderError = (error: ProviderAdapterError): ModelDomainError => {
  const providerCode = safeCode(error.providerCode)
  const details = {
    status: error.status,
    providerRequestId: error.providerRequestId
  }
  if (error.kind === 'cancelled') {
    return new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled')
  }
  if (error.kind === 'content-blocked' || /content|safety|policy|blocked/.test(providerCode)) {
    return new ModelDomainError('MODEL_CONTENT_BLOCKED', 'Provider blocked the generated content')
  }
  if (error.kind === 'invalid-response') {
    return new ModelDomainError('MODEL_INVALID_STRUCTURE', 'Provider returned an invalid response')
  }
  if (error.kind === 'network') {
    switch (error.networkCode) {
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return new ModelDomainError('MODEL_DNS_FAILED', 'Provider host could not be resolved', {
          retryable: true
        })
      case 'ETIMEDOUT':
      case 'UND_ERR_CONNECT_TIMEOUT':
      case 'UND_ERR_HEADERS_TIMEOUT':
      case 'UND_ERR_BODY_TIMEOUT':
        return new ModelDomainError('MODEL_TIMEOUT', 'Provider request timed out', {
          retryable: true
        })
      default:
        return new ModelDomainError('MODEL_OFFLINE', 'Provider is unreachable', {
          retryable: true
        })
    }
  }
  if (error.kind === 'http') {
    if (error.status === 401 || error.status === 403) {
      return new ModelDomainError('MODEL_AUTH_FAILED', 'Provider authentication failed', details)
    }
    if (
      error.status === 402 ||
      /balance|billing|credit|hard_limit/.test(providerCode)
    ) {
      return new ModelDomainError('MODEL_BALANCE_EXHAUSTED', 'Provider balance is unavailable', details)
    }
    if (error.status === 404) {
      return new ModelDomainError('MODEL_NOT_FOUND', 'Provider model was not found', details)
    }
    if (error.status === 408) {
      return new ModelDomainError('MODEL_TIMEOUT', 'Provider request timed out', {
        ...details,
        retryable: true
      })
    }
    if (error.status === 429) {
      return new ModelDomainError('MODEL_RATE_LIMITED', 'Provider rate limit was reached', {
        ...details,
        retryable: true
      })
    }
    return new ModelDomainError('MODEL_PROVIDER_FAILED', 'Provider request failed', {
      ...details,
      retryable: error.status !== undefined && (
        RETRYABLE_HTTP_STATUSES.has(error.status) || error.status >= 500
      )
    })
  }
  return new ModelDomainError('MODEL_PROVIDER_FAILED', 'Provider request failed', {
    status: error.status
  })
}

const normalizeGatewayError = (error: unknown, signal: AbortSignal): ModelDomainError => {
  if (signal.aborted) {
    return new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled')
  }
  if (error instanceof ModelDomainError) return error
  if (error instanceof ProviderAdapterError) return mappedProviderError(error)
  return new ModelDomainError('MODEL_PROVIDER_FAILED', 'Provider request failed')
}

const requiredCapability = (
  profile: ModelProfile,
  capability: ModelCapability
): void => {
  if (!profile.capabilities.includes(capability)) {
    throw new ModelDomainError(
      'MODEL_CAPABILITY_REQUIRED',
      `Model profile requires ${capability}`
    )
  }
}

const heuristicTokens = (text: string): number => {
  let ascii = 0
  let nonAscii = 0
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return Math.max(1, Math.ceil(ascii / 4) + nonAscii)
}

export class DefaultModelGateway implements ModelGateway {
  readonly #repository: GatewayRepository
  readonly #secretStore: GatewaySecretStore
  readonly #registry: GatewayRegistry
  readonly #logger: GatewayLogger
  readonly #createId: () => string
  readonly #now: () => number
  readonly #nowIso: () => string
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly #random: () => number

  constructor(options: {
    repository: GatewayRepository
    secretStore: GatewaySecretStore
    registry: GatewayRegistry
    logger: GatewayLogger
    createId(): string
    now?(): number
    nowIso(): string
    sleep?(milliseconds: number, signal: AbortSignal): Promise<void>
    random?(): number
  }) {
    this.#repository = options.repository
    this.#secretStore = options.secretStore
    this.#registry = options.registry
    this.#logger = options.logger
    this.#createId = options.createId
    this.#now = options.now ?? Date.now
    this.#nowIso = options.nowIso
    this.#sleep = options.sleep ?? defaultSleep
    this.#random = options.random ?? Math.random
  }

  async testConnection(
    connectionId: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<ConnectionTestResult> {
    const resolved = await this.#resolveConnection(connectionId)
    const result = await this.#execute({
      connection: resolved.connection,
      secret: resolved.secret,
      modelId,
      operation: 'test-connection',
      signal,
      call: () => resolved.adapter.testConnection({ modelId, signal }),
      metadata: (value) => ({
        providerRequestId: safeProviderRequestId(value.providerRequestId, resolved.secret)
      })
    })
    const providerRequestId = safeProviderRequestId(result.providerRequestId, resolved.secret)
    const { providerRequestId: _unsafeRequestId, ...publicResult } = result
    return providerRequestId === undefined
      ? publicResult
      : { ...publicResult, providerRequestId }
  }

  async listModels(connectionId: string, signal: AbortSignal): Promise<ProviderModelOption[]> {
    const resolved = await this.#resolveConnection(connectionId)
    return this.#execute({
      connection: resolved.connection,
      secret: resolved.secret,
      modelId: '(model-list)',
      operation: 'list-models',
      signal,
      call: async () => (await resolved.adapter.listModels(signal)) ?? []
    })
  }

  async *streamText(request: TextGenerationRequest): AsyncIterable<ModelStreamEvent> {
    const resolved = await this.#resolveProfile(request.profileId, 'stream-text')
    const startedAt = this.#now()
    let retryCount = 0
    let emitted = false
    for (;;) {
      let usage: ModelUsage | undefined
      let providerRequestId: string | undefined
      try {
        for await (const event of resolved.adapter.streamText({
          modelId: resolved.profile.modelId,
          prompt: request.prompt,
          ...(request.system === undefined ? {} : { system: request.system }),
          temperature: resolved.profile.temperature,
          maxOutputTokens: resolved.profile.maxOutputTokens,
          signal: request.signal
        })) {
          emitted = true
          if (event.type !== 'finish') {
            yield event
            continue
          }
          usage = event.usage
          providerRequestId = safeProviderRequestId(event.providerRequestId, resolved.secret)
          yield {
            type: 'finish',
            ...(event.usage === undefined ? {} : { usage: event.usage }),
            ...(providerRequestId === undefined ? {} : { providerRequestId })
          }
        }
        await this.#writeLog({
          connection: resolved.connection,
          profile: resolved.profile,
          modelId: resolved.profile.modelId,
          operation: 'stream-text',
          status: 'succeeded',
          startedAt,
          retryCount,
          usage,
          providerRequestId,
          secret: resolved.secret
        })
        return
      } catch (error) {
        const mapped = normalizeGatewayError(error, request.signal)
        if (!emitted && mapped.retryable && retryCount < MAX_ATTEMPTS - 1) {
          try {
            await this.#backoff(retryCount, request.signal)
          } catch (backoffError) {
            const cancelled = normalizeGatewayError(backoffError, request.signal)
            await this.#writeLog({
              connection: resolved.connection,
              profile: resolved.profile,
              modelId: resolved.profile.modelId,
              operation: 'stream-text',
              status: 'cancelled',
              startedAt,
              retryCount,
              errorCode: cancelled.code,
              secret: resolved.secret
            })
            throw cancelled
          }
          retryCount += 1
          continue
        }
        await this.#writeLog({
          connection: resolved.connection,
          profile: resolved.profile,
          modelId: resolved.profile.modelId,
          operation: 'stream-text',
          status: mapped.code === 'MODEL_CANCELLED' ? 'cancelled' : 'failed',
          startedAt,
          retryCount,
          errorCode: mapped.code,
          providerRequestId: error instanceof ProviderAdapterError
            ? safeProviderRequestId(error.providerRequestId, resolved.secret)
            : undefined,
          secret: resolved.secret
        })
        throw mapped
      }
    }
  }

  async generateObject<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGenerationResult<T>> {
    const resolved = await this.#resolveProfile(request.profileId, 'structured-output')
    const result = await this.#execute({
      connection: resolved.connection,
      secret: resolved.secret,
      profile: resolved.profile,
      modelId: resolved.profile.modelId,
      operation: 'generate-object',
      signal: request.signal,
      call: () => resolved.adapter.generateObject({
        modelId: resolved.profile.modelId,
        prompt: request.prompt,
        ...(request.system === undefined ? {} : { system: request.system }),
        temperature: resolved.profile.temperature,
        maxOutputTokens: resolved.profile.maxOutputTokens,
        schema: request.schema,
        signal: request.signal
      }),
      metadata: (result: AdapterObjectResult<T>) => ({
        usage: result.usage,
        providerRequestId: safeProviderRequestId(result.providerRequestId, resolved.secret)
      })
    })
    const providerRequestId = safeProviderRequestId(result.providerRequestId, resolved.secret)
    const { providerRequestId: _unsafeRequestId, ...publicResult } = result
    return providerRequestId === undefined
      ? publicResult
      : { ...publicResult, providerRequestId }
  }

  async estimateTokens(request: TokenEstimateRequest): Promise<TokenEstimate> {
    const profile = await this.#repository.getProfile(request.profileId)
    if (profile === undefined) {
      throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Model profile does not exist')
    }
    return { tokens: heuristicTokens(request.text), method: 'heuristic' }
  }

  async #resolveConnection(connectionId: string): Promise<ResolvedConnection> {
    const connection = await this.#repository.getConnection(connectionId)
    if (connection === undefined || !connection.enabled) {
      throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Provider connection is unavailable')
    }
    const secret = await this.#secretStore.read(connection.secretRef)
    return { connection, adapter: this.#registry.create(connection, secret), secret }
  }

  async #resolveProfile(
    profileId: string,
    capability: ModelCapability
  ): Promise<ResolvedProfile> {
    const profile = await this.#repository.getProfile(profileId)
    if (profile === undefined) {
      throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Model profile does not exist')
    }
    requiredCapability(profile, capability)
    return { ...await this.#resolveConnection(profile.connectionId), profile }
  }

  async #execute<T>(options: {
    connection: StoredProviderConnection
    secret: string
    profile?: ModelProfile
    modelId: string
    operation: ModelCallOperation
    signal: AbortSignal
    call(): Promise<T>
    metadata?(result: T): {
      usage?: ModelUsage
      providerRequestId?: string
    }
  }): Promise<T> {
    const startedAt = this.#now()
    let retryCount = 0
    for (;;) {
      let result: T
      try {
        result = await options.call()
      } catch (error) {
        const mapped = normalizeGatewayError(error, options.signal)
        if (mapped.retryable && retryCount < MAX_ATTEMPTS - 1) {
          try {
            await this.#backoff(retryCount, options.signal)
          } catch (backoffError) {
            const cancelled = normalizeGatewayError(backoffError, options.signal)
            await this.#writeLog({
              connection: options.connection,
              profile: options.profile,
              modelId: options.modelId,
              operation: options.operation,
              status: 'cancelled',
              startedAt,
              retryCount,
              errorCode: cancelled.code,
              secret: options.secret
            })
            throw cancelled
          }
          retryCount += 1
          continue
        }
        await this.#writeLog({
          connection: options.connection,
          profile: options.profile,
          modelId: options.modelId,
          operation: options.operation,
          status: mapped.code === 'MODEL_CANCELLED' ? 'cancelled' : 'failed',
          startedAt,
          retryCount,
          errorCode: mapped.code,
          providerRequestId: error instanceof ProviderAdapterError
            ? safeProviderRequestId(error.providerRequestId, options.secret)
            : undefined,
          secret: options.secret
        })
        throw mapped
      }
      const metadata = options.metadata?.(result)
      await this.#writeLog({
        connection: options.connection,
        profile: options.profile,
        modelId: options.modelId,
        operation: options.operation,
        status: 'succeeded',
        startedAt,
        retryCount,
        usage: metadata?.usage,
        providerRequestId: metadata?.providerRequestId,
        secret: options.secret
      })
      return result
    }
  }

  async #backoff(retryCount: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled')
    }
    const jitter = 0.75 + Math.min(1, Math.max(0, this.#random())) * 0.5
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      Math.round(BASE_RETRY_DELAY_MS * (2 ** retryCount) * jitter)
    )
    await this.#sleep(delay, signal)
    if (signal.aborted) {
      throw new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled')
    }
  }

  async #writeLog(options: {
    connection: StoredProviderConnection
    profile?: ModelProfile
    modelId: string
    operation: ModelCallOperation
    status: StoredModelCallLog['status']
    startedAt: number
    retryCount: number
    usage?: ModelUsage
    errorCode?: string
    providerRequestId?: string
    secret: string
  }): Promise<void> {
    await this.#logger.record({
      id: this.#createId(),
      connectionId: options.connection.id,
      ...(options.profile === undefined ? {} : { profileId: options.profile.id }),
      providerKind: options.connection.kind,
      modelId: options.modelId,
      operation: options.operation,
      status: options.status,
      latencyMs: Math.max(0, Math.round(this.#now() - options.startedAt)),
      ...(options.usage?.inputTokens === undefined
        ? {}
        : { inputTokens: options.usage.inputTokens }),
      ...(options.usage?.outputTokens === undefined
        ? {}
        : { outputTokens: options.usage.outputTokens }),
      retryCount: options.retryCount,
      ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
      ...(safeProviderRequestId(options.providerRequestId, options.secret) === undefined
        ? {}
        : { providerRequestId: safeProviderRequestId(options.providerRequestId, options.secret) }),
      createdAt: this.#nowIso()
    })
  }
}
