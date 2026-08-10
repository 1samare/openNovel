import { ModelDomainError } from '../shared/model.ts'
import type { StoredProviderConnection } from './model-repository.ts'
import { createAnthropicAdapter } from './anthropic-adapter.ts'
import { createGeminiAdapter } from './gemini-adapter.ts'
import { createOpenAICompatibleAdapter } from './openai-compatible-adapter.ts'
import type { ProviderAdapter } from './provider-adapter.ts'

export class ProviderRegistry {
  readonly #fetchImplementation: typeof fetch
  readonly #now?: () => number

  constructor(options: {
    fetchImplementation?: typeof fetch
    now?(): number
  } = {}) {
    this.#fetchImplementation = options.fetchImplementation ?? fetch
    this.#now = options.now
  }

  create(connection: StoredProviderConnection, apiKey: string): ProviderAdapter {
    if (!connection.enabled) {
      throw new ModelDomainError('MODEL_NOT_CONFIGURED', 'Provider connection is disabled')
    }
    if (apiKey.trim() === '') {
      throw new ModelDomainError('MODEL_SECRET_MISSING', 'Provider API key is missing')
    }
    const common = {
      connectionId: connection.id,
      apiKey,
      fetchImplementation: this.#fetchImplementation,
      now: this.#now
    }
    switch (connection.kind) {
      case 'openai-compatible':
        if (connection.baseUrl === undefined) {
          throw new ModelDomainError(
            'MODEL_INVALID_BASE_URL',
            'OpenAI-compatible Base URL is required'
          )
        }
        return createOpenAICompatibleAdapter({ ...common, baseUrl: connection.baseUrl })
      case 'anthropic':
        return createAnthropicAdapter({ ...common, baseUrl: connection.baseUrl })
      case 'gemini':
        return createGeminiAdapter({ ...common, baseUrl: connection.baseUrl })
    }
  }
}
