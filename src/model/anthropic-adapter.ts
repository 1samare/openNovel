import { createAnthropic } from '@ai-sdk/anthropic'

import { createSecureRedirectFetch, validateProviderBaseUrl } from './model-validation.ts'
import { AiSdkProviderAdapter, type ProviderAdapter } from './provider-adapter.ts'

type AnthropicAdapterOptions = {
  connectionId: string
  apiKey: string
  baseUrl?: string
  fetchImplementation?: typeof fetch
  now?(): number
}

export const createAnthropicAdapter = (
  options: AnthropicAdapterOptions
): ProviderAdapter => {
  const baseUrl = options.baseUrl === undefined
    ? 'https://api.anthropic.com/v1'
    : validateProviderBaseUrl(options.baseUrl).href.replace(/\/$/, '')
  const provider = createAnthropic({
    baseURL: baseUrl,
    apiKey: options.apiKey,
    fetch: createSecureRedirectFetch(options.fetchImplementation ?? fetch)
  })
  return new AiSdkProviderAdapter({
    kind: 'anthropic',
    connectionId: options.connectionId,
    model: (modelId) => provider.languageModel(
      modelId as Parameters<typeof provider.languageModel>[0]
    ),
    now: options.now
  })
}
