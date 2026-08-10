import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import type { ProviderModelOption } from '../shared/model.ts'
import { createSecureRedirectFetch, validateProviderBaseUrl } from './model-validation.ts'
import {
  AiSdkProviderAdapter,
  providerHttpError,
  type ProviderAdapter
} from './provider-adapter.ts'

type OpenAICompatibleAdapterOptions = {
  connectionId: string
  baseUrl: string
  apiKey: string
  fetchImplementation?: typeof fetch
  now?(): number
}

const responseHeaders = (response: Response): Record<string, string> => (
  Object.fromEntries(response.headers.entries())
)

export const createOpenAICompatibleAdapter = (
  options: OpenAICompatibleAdapterOptions
): ProviderAdapter => {
  const baseUrl = validateProviderBaseUrl(options.baseUrl).href.replace(/\/$/, '')
  const secureFetch = createSecureRedirectFetch(options.fetchImplementation ?? fetch)
  const provider = createOpenAICompatible({
    name: 'open-novel-openai-compatible',
    baseURL: baseUrl,
    apiKey: options.apiKey,
    includeUsage: true,
    supportsStructuredOutputs: true,
    fetch: secureFetch
  })

  const listModels = async (signal: AbortSignal): Promise<ProviderModelOption[]> => {
    const response = await secureFetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${options.apiKey}` },
      signal
    })
    let data: unknown
    try {
      data = await response.json()
    } catch {
      if (!response.ok) throw providerHttpError(response.status, undefined, responseHeaders(response))
      throw new SyntaxError('Invalid provider model list')
    }
    if (!response.ok) throw providerHttpError(response.status, data, responseHeaders(response))
    if (typeof data !== 'object' || data === null || !('data' in data) || !Array.isArray(data.data)) {
      throw new SyntaxError('Invalid provider model list')
    }
    const models = data.data.flatMap((entry): ProviderModelOption[] => {
      if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'string') {
        return []
      }
      const label = 'name' in entry && typeof entry.name === 'string' && entry.name.trim() !== ''
        ? entry.name
        : entry.id
      return [{ id: entry.id, label }]
    })
    return models.sort((left, right) => left.id.localeCompare(right.id))
  }

  return new AiSdkProviderAdapter({
    kind: 'openai-compatible',
    connectionId: options.connectionId,
    model: (modelId) => provider.languageModel(modelId),
    listModels,
    now: options.now
  })
}
