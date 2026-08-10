import {
  MODEL_CAPABILITIES,
  ModelDomainError,
  requiredCapabilitiesForRole,
  type AgentRole,
  type ModelBindingConfiguration,
  type ModelCapability,
  type ModelProfile,
  type ModelRoute,
  type ProviderConnectionSummary,
  type SaveModelBindingsInput,
  type SaveModelProfileInput,
  type SaveProviderConnectionInput
} from '../shared/model.ts'
import type { EncryptedSecretStore } from './secret-store.ts'
import { ModelRepository, type StoredProviderConnection } from './model-repository.ts'
import { validateProviderBaseUrl } from './model-validation.ts'

export type ProjectModelBindings = {
  listModelBindings(): Promise<ModelBindingConfiguration>
  saveModelBindings(configuration: ModelBindingConfiguration): Promise<ModelBindingConfiguration>
}

const nonBlank = (value: string, label: string, maximum: number): string => {
  if (typeof value !== 'string') {
    throw new ModelDomainError('MODEL_INVALID_COMMAND', `${label} is required`)
  }
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new ModelDomainError('MODEL_INVALID_COMMAND', `${label} is invalid`)
  }
  return normalized
}

const publicConnection = (connection: StoredProviderConnection): ProviderConnectionSummary => ({
  id: connection.id,
  name: connection.name,
  kind: connection.kind,
  ...(connection.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl }),
  enabled: connection.enabled,
  hasSecret: connection.hasSecret,
  ...(connection.secretHint === undefined ? {} : { secretHint: connection.secretHint }),
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt
})

const secretHint = (secret: string): string => secret.length <= 4
  ? '••••'
  : `••••${secret.slice(-4)}`

const uniqueCapabilities = (values: readonly ModelCapability[]): ModelCapability[] => {
  if (!Array.isArray(values) || !values.every((value) => MODEL_CAPABILITIES.includes(value))) {
    throw new ModelDomainError('MODEL_INVALID_COMMAND', 'Model capabilities are invalid')
  }
  return [...new Set(values)]
}

const cloneBindings = (value: ModelBindingConfiguration): ModelBindingConfiguration => ({
  modeDefaults: value.modeDefaults.map((route) => ({
    ...route,
    fallbackProfileIds: [...route.fallbackProfileIds]
  })),
  roleBindings: value.roleBindings.map((route) => ({
    ...route,
    fallbackProfileIds: [...route.fallbackProfileIds]
  }))
})

export class ModelService {
  readonly #repository: ModelRepository
  readonly #secretStore: Pick<EncryptedSecretStore, 'save' | 'read' | 'remove'>
  readonly #projectBindings: ProjectModelBindings
  readonly #createId: () => string
  readonly #now: () => string
  #tail: Promise<void> = Promise.resolve()
  #shutdown = false
  #shutdownPromise?: Promise<void>

  constructor(options: {
    repository: ModelRepository
    secretStore: Pick<EncryptedSecretStore, 'save' | 'read' | 'remove'>
    projectBindings: ProjectModelBindings
    createId(): string
    now(): string
  }) {
    this.#repository = options.repository
    this.#secretStore = options.secretStore
    this.#projectBindings = options.projectBindings
    this.#createId = options.createId
    this.#now = options.now
  }

  listConnections(): Promise<ProviderConnectionSummary[]> {
    return this.#serialize(async () => (
      await this.#repository.listConnections()
    ).map(publicConnection))
  }

  saveConnection(input: SaveProviderConnectionInput): Promise<ProviderConnectionSummary> {
    return this.#serialize(() => this.#saveConnection(input))
  }

  async #saveConnection(input: SaveProviderConnectionInput): Promise<ProviderConnectionSummary> {
    const existing = input.id === undefined
      ? undefined
      : await this.#repository.getConnection(input.id)
    if (input.id !== undefined && existing === undefined) {
      throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Provider connection does not exist')
    }
    const name = nonBlank(input.name, 'Connection name', 120)
    const baseUrl = input.baseUrl === undefined
      ? undefined
      : validateProviderBaseUrl(nonBlank(input.baseUrl, 'Base URL', 2048)).href.replace(/\/$/, '')
    if (input.kind === 'openai-compatible' && baseUrl === undefined) {
      throw new ModelDomainError('MODEL_INVALID_BASE_URL', 'OpenAI-compatible Base URL is required')
    }
    const providedSecret = input.apiKey?.trim()
    if (existing === undefined && (providedSecret === undefined || providedSecret.length === 0)) {
      throw new ModelDomainError('MODEL_SECRET_MISSING', 'API key is required')
    }
    const timestamp = this.#now()
    const ref = existing?.secretRef ?? this.#createId()
    let previousSecret: string | undefined
    if (providedSecret !== undefined && providedSecret.length > 0 && existing !== undefined) {
      previousSecret = await this.#secretStore.read(ref)
    }
    if (providedSecret !== undefined && providedSecret.length > 0) {
      await this.#secretStore.save(ref, providedSecret)
    }
    const connection: StoredProviderConnection = {
      id: existing?.id ?? this.#createId(),
      name,
      kind: input.kind,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      enabled: input.enabled,
      hasSecret: true,
      secretHint: providedSecret === undefined || providedSecret.length === 0
        ? existing?.secretHint
        : secretHint(providedSecret),
      secretRef: ref,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    try {
      await this.#repository.saveConnection(connection)
    } catch (error) {
      if (providedSecret !== undefined && providedSecret.length > 0) {
        if (previousSecret === undefined) {
          await this.#secretStore.remove(ref).catch(() => undefined)
        } else {
          await this.#secretStore.save(ref, previousSecret).catch(() => undefined)
        }
      }
      throw error
    }
    return publicConnection(connection)
  }

  listProfiles(): Promise<ModelProfile[]> {
    return this.#serialize(() => this.#repository.listProfiles())
  }

  saveProfile(input: SaveModelProfileInput): Promise<ModelProfile> {
    return this.#serialize(async () => {
      const connection = await this.#repository.getConnection(input.connectionId)
      if (connection === undefined) {
        throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Provider connection does not exist')
      }
      const profile: ModelProfile = {
        id: input.id ?? this.#createId(),
        connectionId: connection.id,
        label: nonBlank(input.label, 'Profile label', 120),
        modelId: nonBlank(input.modelId, 'Model ID', 256),
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        contextWindow: input.contextWindow,
        capabilities: uniqueCapabilities(input.capabilities)
      }
      if (!Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2 ||
        !Number.isSafeInteger(profile.maxOutputTokens) || profile.maxOutputTokens <= 0 ||
        !Number.isSafeInteger(profile.contextWindow) || profile.contextWindow <= 0) {
        throw new ModelDomainError('MODEL_INVALID_COMMAND', 'Model profile limits are invalid')
      }
      await this.#repository.saveProfile(profile, this.#now())
      return { ...profile, capabilities: [...profile.capabilities] }
    })
  }

  getBindings(): Promise<ModelBindingConfiguration> {
    return this.#serialize(async () => cloneBindings(
      await this.#projectBindings.listModelBindings()
    ))
  }

  saveBindings(input: SaveModelBindingsInput): Promise<ModelBindingConfiguration> {
    return this.#serialize(async () => {
      const configuration: ModelBindingConfiguration = {
        modeDefaults: input.modeDefaults,
        roleBindings: input.roleBindings
      }
      const profiles = new Map((await this.#repository.listProfiles()).map((item) => [item.id, item]))
      const connections = new Map((await this.#repository.listConnections()).map((item) => [item.id, item]))

      const validateRoute = async (
        route: ModelRoute,
        required: readonly ModelCapability[]
      ): Promise<void> => {
        const selected = [route.primaryProfileId, ...route.fallbackProfileIds].map((id) => {
          const profile = profiles.get(id)
          if (profile === undefined) {
            throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Bound model profile does not exist')
          }
          for (const capability of required) {
            if (!profile.capabilities.includes(capability)) {
              throw new ModelDomainError(
                'MODEL_CAPABILITY_REQUIRED',
                'Bound model profile lacks a required capability'
              )
            }
          }
          return profile
        })
        const kinds = new Set(selected.map((profile) => {
          const connection = connections.get(profile.connectionId)
          if (connection === undefined || !connection.enabled) {
            throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Bound provider is unavailable')
          }
          return connection.kind
        }))
        if (
          kinds.size > 1 &&
          (!route.allowCrossProviderFallback || !input.confirmCrossProviderRouting)
        ) {
          throw new ModelDomainError(
            'MODEL_INVALID_COMMAND',
            'Cross-provider routing requires explicit confirmation'
          )
        }
      }

      for (const route of configuration.modeDefaults) {
        await validateRoute(route, ['stream-text', 'structured-output'])
      }
      for (const route of configuration.roleBindings) {
        await validateRoute(route, requiredCapabilitiesForRole(route.role as AgentRole))
      }
      return cloneBindings(await this.#projectBindings.saveModelBindings(
        cloneBindings(configuration)
      ))
    })
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise !== undefined) return this.#shutdownPromise
    this.#shutdown = true
    this.#shutdownPromise = this.#tail.then(() => this.#repository.close())
    return this.#shutdownPromise
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#shutdown) {
      return Promise.reject(new ModelDomainError('MODEL_OPERATION_FAILED', 'Model service is shut down'))
    }
    const result = this.#tail.then(operation)
    this.#tail = result.then(() => undefined, () => undefined)
    return result
  }
}
