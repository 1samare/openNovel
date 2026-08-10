import { createGoogleGenerativeAI } from '@ai-sdk/google'

import { createSecureRedirectFetch, validateProviderBaseUrl } from './model-validation.ts'
import { AiSdkProviderAdapter, type ProviderAdapter } from './provider-adapter.ts'

type GeminiAdapterOptions = {
  connectionId: string
  apiKey: string
  baseUrl?: string
  fetchImplementation?: typeof fetch
  now?(): number
}

export const createGeminiAdapter = (
  options: GeminiAdapterOptions
): ProviderAdapter => {
  const baseUrl = options.baseUrl === undefined
    ? 'https://generativelanguage.googleapis.com/v1beta'
    : validateProviderBaseUrl(options.baseUrl).href.replace(/\/$/, '')
  const provider = createGoogleGenerativeAI({
    baseURL: baseUrl,
    apiKey: options.apiKey,
    fetch: createSecureRedirectFetch(options.fetchImplementation ?? fetch)
  })
  return new AiSdkProviderAdapter({
    kind: 'gemini',
    connectionId: options.connectionId,
    model: (modelId) => provider.languageModel(
      modelId as Parameters<typeof provider.languageModel>[0]
    ),
    now: options.now
  })
}
