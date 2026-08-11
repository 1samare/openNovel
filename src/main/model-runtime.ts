import { randomUUID } from 'node:crypto'

import type { AgentSenderPolicy } from './agent-ipc-security.ts'
import { createModelLogger } from './model-logger.ts'
import {
  ModelDomainError,
  type ConnectionTestResult,
  type ModelBindingConfiguration,
  type ModelProfile,
  type ModelResult,
  type ProviderConnectionSummary,
  type ProviderModelOption,
  type SaveModelBindingsInput,
  type SaveModelProfileInput,
  type SaveProviderConnectionInput,
  type StructuredGenerationRequest,
  type StructuredGenerationResult
} from '../shared/model.ts'
import type { StructuredCoauthorPort } from '../novel/proposal-service.ts'
import { DefaultModelGateway } from '../model/model-gateway.ts'
import { ModelRepository } from '../model/model-repository.ts'
import {
  ModelService,
  type ProjectModelBindings
} from '../model/model-service.ts'
import { ProviderRegistry } from '../model/provider-registry.ts'
import {
  EncryptedSecretStore,
  type SecretCipher
} from '../model/secret-store.ts'

export type ModelServicePort = {
  listConnections(): Promise<ProviderConnectionSummary[]>
  saveConnection(input: SaveProviderConnectionInput): Promise<ProviderConnectionSummary>
  listProfiles(): Promise<ModelProfile[]>
  saveProfile(input: SaveModelProfileInput): Promise<ModelProfile>
  getBindings(): Promise<ModelBindingConfiguration>
  saveBindings(input: SaveModelBindingsInput): Promise<ModelBindingConfiguration>
  shutdown(): Promise<void>
}

export type ModelGatewayPort = {
  testConnection(
    connectionId: string,
    modelId: string,
    signal: AbortSignal
  ): Promise<ConnectionTestResult>
  listModels(connectionId: string, signal: AbortSignal): Promise<ProviderModelOption[]>
  generateObject<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>>
}

export type ModelRuntime = {
  senderPolicy: AgentSenderPolicy
  structuredCoauthor: StructuredCoauthorPort
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
  shutdown(): Promise<void>
}

const safeFailure = (error: unknown): ModelResult<never> => {
  const domain = error instanceof ModelDomainError
    ? error
    : new ModelDomainError('MODEL_OPERATION_FAILED', 'Model operation failed')
  return {
    ok: false,
    error: {
      code: domain.code,
      message: domain.code === 'MODEL_CANCELLED'
        ? 'Model operation was cancelled'
        : 'Model operation failed',
      retryable: domain.retryable
    }
  }
}

export const createModelRuntime = (options: {
  service: ModelServicePort
  gateway: ModelGatewayPort
  senderPolicy: AgentSenderPolicy
}): ModelRuntime => {
  const active = new Set<Promise<unknown>>()
  const networkControllers = new Set<AbortController>()
  const connectionTests = new Map<string, AbortController>()
  let shuttingDown = false
  let shutdownPromise: Promise<void> | undefined

  const unavailable = (): ModelResult<never> => safeFailure(
    new ModelDomainError('MODEL_OPERATION_FAILED', 'Model runtime is shut down')
  )

  const track = <T>(operation: () => Promise<T>): Promise<ModelResult<T>> => {
    if (shuttingDown) return Promise.resolve(unavailable())
    const pending = operation()
      .then((data): ModelResult<T> => ({ ok: true, data }))
      .catch(safeFailure)
    active.add(pending)
    void pending.then(
      () => active.delete(pending),
      () => active.delete(pending)
    )
    return pending
  }

  const trackInternal = <T>(operation: () => Promise<T>): Promise<T> => {
    if (shuttingDown) {
      return Promise.reject(new ModelDomainError('MODEL_CANCELLED', 'Model runtime is shut down'))
    }
    const pending = operation()
    active.add(pending)
    void pending.then(
      () => active.delete(pending),
      () => active.delete(pending)
    )
    return pending
  }

  const structuredCoauthor: StructuredCoauthorPort = {
    generate: (input) => {
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      input.signal.addEventListener('abort', onAbort, { once: true })
      if (input.signal.aborted) controller.abort()
      networkControllers.add(controller)
      return trackInternal(async () => {
        const mode = input.mode ?? 'standard'
        const bindings = await options.service.getBindings()
        const route = bindings.roleBindings.find((item) => (
          item.role === input.role && item.mode === mode
        )) ?? bindings.modeDefaults.find((item) => item.mode === mode)
        if (route === undefined) {
          throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'No model route is configured')
        }
        const profileIds = [route.primaryProfileId, ...route.fallbackProfileIds]
        let lastError: ModelDomainError | undefined
        for (const profileId of profileIds) {
          if (controller.signal.aborted) {
            throw new ModelDomainError('MODEL_CANCELLED', 'Model operation was cancelled')
          }
          try {
            const result = await options.gateway.generateObject<unknown>({
              profileId,
              prompt: input.prompt,
              system: input.system,
              schema: input.schema,
              signal: controller.signal
            })
            return result.value
          } catch (error) {
            const domain = error instanceof ModelDomainError
              ? error
              : new ModelDomainError('MODEL_OPERATION_FAILED', 'Model operation failed')
            if (domain.code === 'MODEL_CANCELLED' || domain.code === 'MODEL_CONTENT_BLOCKED' ||
              domain.code === 'MODEL_INVALID_STRUCTURE') {
              throw domain
            }
            lastError = domain
          }
        }
        throw lastError ?? new ModelDomainError('MODEL_NOT_CONFIGURED', 'No model route is configured')
      }).finally(() => {
        input.signal.removeEventListener('abort', onAbort)
        networkControllers.delete(controller)
      })
    }
  }

  const runtime: ModelRuntime = {
    senderPolicy: options.senderPolicy,
    structuredCoauthor,
    listConnections: () => track(() => options.service.listConnections()),
    saveConnection: (input) => track(() => options.service.saveConnection(input)),
    testConnection: (input) => {
      if (shuttingDown) return Promise.resolve(unavailable())
      if (connectionTests.has(input.requestId)) {
        return Promise.resolve(safeFailure(new ModelDomainError(
          'MODEL_INVALID_COMMAND',
          'Connection test request is already active'
        )))
      }
      const controller = new AbortController()
      connectionTests.set(input.requestId, controller)
      networkControllers.add(controller)
      return track(() => options.gateway.testConnection(
        input.connectionId,
        input.modelId,
        controller.signal
      )).finally(() => {
        if (connectionTests.get(input.requestId) === controller) {
          connectionTests.delete(input.requestId)
        }
        networkControllers.delete(controller)
      })
    },
    cancelConnectionTest: async (requestId) => {
      connectionTests.get(requestId)?.abort()
      return { ok: true, data: null }
    },
    listModels: (connectionId) => {
      const controller = new AbortController()
      networkControllers.add(controller)
      return track(() => options.gateway.listModels(connectionId, controller.signal))
        .finally(() => networkControllers.delete(controller))
    },
    listProfiles: () => track(() => options.service.listProfiles()),
    saveProfile: (input) => track(() => options.service.saveProfile(input)),
    getBindings: () => track(() => options.service.getBindings()),
    saveBindings: (input) => track(() => options.service.saveBindings(input)),
    shutdown: () => {
      if (shutdownPromise !== undefined) return shutdownPromise
      shuttingDown = true
      for (const controller of networkControllers) controller.abort()
      shutdownPromise = (async () => {
        await Promise.allSettled([...active])
        await options.service.shutdown()
      })()
      return shutdownPromise
    }
  }
  return runtime
}

export const startModelRuntime = async (options: {
  controlDatabasePath: string
  secretRoot: string
  cipher: SecretCipher
  projectBindings: ProjectModelBindings
  senderPolicy: AgentSenderPolicy
  createId?(): string
  now?(): string
  nowMilliseconds?(): number
}): Promise<ModelRuntime> => {
  const repository = await ModelRepository.open(options.controlDatabasePath)
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  try {
    const secretStore = new EncryptedSecretStore({
      root: options.secretRoot,
      cipher: options.cipher
    })
    const service = new ModelService({
      repository,
      secretStore,
      projectBindings: options.projectBindings,
      createId,
      now
    })
    const gateway = new DefaultModelGateway({
      repository,
      secretStore,
      registry: new ProviderRegistry(),
      logger: createModelLogger((record) => repository.saveCallLog(record)),
      createId,
      now: options.nowMilliseconds,
      nowIso: now
    })
    return createModelRuntime({ service, gateway, senderPolicy: options.senderPolicy })
  } catch (error) {
    await repository.close().catch(() => undefined)
    throw error
  }
}
