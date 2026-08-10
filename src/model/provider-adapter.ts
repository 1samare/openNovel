import { APICallError } from '@ai-sdk/provider'
import {
  generateText,
  NoObjectGeneratedError,
  Output,
  streamText,
  type LanguageModel,
  type LanguageModelResponseMetadata,
  type LanguageModelUsage
} from 'ai'

import type {
  ConnectionTestResult,
  ModelStreamEvent,
  ModelUsage,
  ProviderKind,
  ProviderModelOption,
  RuntimeSchema,
  StructuredGenerationResult
} from '../shared/model.ts'

export type AdapterConnectionTest = {
  modelId: string
  signal: AbortSignal
}

export type AdapterTextRequest = {
  modelId: string
  prompt: string
  system?: string
  temperature: number
  maxOutputTokens: number
  signal: AbortSignal
}

export type AdapterObjectRequest<T> = AdapterTextRequest & {
  schema: RuntimeSchema<T>
}

export type AdapterObjectResult<T> = StructuredGenerationResult<T>
export type AdapterStreamEvent = ModelStreamEvent

export interface ProviderAdapter {
  readonly kind: ProviderKind
  testConnection(input: AdapterConnectionTest): Promise<ConnectionTestResult>
  listModels(signal: AbortSignal): Promise<ProviderModelOption[] | undefined>
  streamText(input: AdapterTextRequest): AsyncIterable<AdapterStreamEvent>
  generateObject<T>(input: AdapterObjectRequest<T>): Promise<AdapterObjectResult<T>>
}

export type ProviderAdapterErrorKind =
  | 'cancelled'
  | 'http'
  | 'network'
  | 'invalid-response'
  | 'content-blocked'
  | 'unknown'

export class ProviderAdapterError extends Error {
  readonly kind: ProviderAdapterErrorKind
  readonly status?: number
  readonly providerCode?: string
  readonly providerRequestId?: string
  readonly networkCode?: string

  constructor(options: {
    kind: ProviderAdapterErrorKind
    status?: number
    providerCode?: string
    providerRequestId?: string
    networkCode?: string
  }) {
    super(`Provider adapter failed (${options.kind})`)
    this.name = 'ProviderAdapterError'
    this.kind = options.kind
    if (options.status !== undefined) this.status = options.status
    if (options.providerCode !== undefined) this.providerCode = options.providerCode
    if (options.providerRequestId !== undefined) {
      this.providerRequestId = options.providerRequestId
    }
    if (options.networkCode !== undefined) this.networkCode = options.networkCode
  }
}

type AdapterCoreOptions = {
  kind: ProviderKind
  connectionId: string
  model(modelId: string): LanguageModel
  listModels?(signal: AbortSignal): Promise<ProviderModelOption[] | undefined>
  now?(): number
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
)

const optionalCode = (value: unknown): string | undefined => (
  typeof value === 'string' && value.length > 0 && value.length <= 120
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined
)

const providerCodeFrom = (data: unknown): string | undefined => {
  const outer = asRecord(data)
  if (outer === undefined) return undefined
  const nested = asRecord(outer.error)
  return optionalCode(nested?.code) ??
    optionalCode(nested?.type) ??
    optionalCode(nested?.status) ??
    optionalCode(outer.code) ??
    optionalCode(outer.type) ??
    optionalCode(outer.status)
}

const networkCodeFrom = (error: unknown): string | undefined => {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    const record = asRecord(current)
    if (record === undefined) return undefined
    if (typeof record.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(record.code)) {
      return record.code
    }
    current = record.cause
  }
  return undefined
}

const requestIdFromHeaders = (
  headers: Record<string, string> | undefined
): string | undefined => headers?.['x-request-id'] ??
  headers?.['request-id'] ??
  headers?.['x-goog-request-id']

const requestIdFromResponse = (
  response: LanguageModelResponseMetadata
): string | undefined => requestIdFromHeaders(response.headers) ?? response.id

export const normalizeProviderAdapterError = (
  error: unknown,
  signal?: AbortSignal
): ProviderAdapterError => {
  if (error instanceof ProviderAdapterError) return error
  const named = asRecord(error)
  if (signal?.aborted === true || named?.name === 'AbortError') {
    return new ProviderAdapterError({ kind: 'cancelled' })
  }
  if (APICallError.isInstance(error)) {
    const providerRequestId = requestIdFromHeaders(error.responseHeaders)
    if (error.statusCode !== undefined && error.statusCode >= 400) {
      return new ProviderAdapterError({
        kind: 'http',
        status: error.statusCode,
        providerCode: providerCodeFrom(error.data),
        providerRequestId
      })
    }
    return new ProviderAdapterError({
      kind: error.statusCode === undefined && error.cause instanceof TypeError
        ? 'network'
        : 'invalid-response',
      providerCode: providerCodeFrom(error.data),
      providerRequestId,
      networkCode: networkCodeFrom(error)
    })
  }
  if (NoObjectGeneratedError.isInstance(error) || error instanceof SyntaxError) {
    return new ProviderAdapterError({ kind: 'invalid-response' })
  }
  if (error instanceof TypeError) {
    return new ProviderAdapterError({
      kind: 'network',
      networkCode: networkCodeFrom(error)
    })
  }
  return new ProviderAdapterError({ kind: 'unknown' })
}

export const providerHttpError = (
  status: number,
  data: unknown,
  headers?: Record<string, string>
): ProviderAdapterError => new ProviderAdapterError({
  kind: 'http',
  status,
  providerCode: providerCodeFrom(data),
  providerRequestId: requestIdFromHeaders(headers)
})

const usageFrom = (usage: LanguageModelUsage): ModelUsage | undefined => {
  const result: ModelUsage = {}
  if (usage.inputTokens !== undefined) result.inputTokens = usage.inputTokens
  if (usage.outputTokens !== undefined) result.outputTokens = usage.outputTokens
  return Object.keys(result).length === 0 ? undefined : result
}

const contentBlocked = (finishReason: string): void => {
  if (finishReason === 'content-filter') {
    throw new ProviderAdapterError({ kind: 'content-blocked' })
  }
}

const commonGenerationOptions = (input: AdapterTextRequest) => ({
  prompt: input.prompt,
  ...(input.system === undefined ? {} : { system: input.system }),
  temperature: input.temperature,
  maxOutputTokens: input.maxOutputTokens,
  abortSignal: input.signal,
  maxRetries: 0
})

export class AiSdkProviderAdapter implements ProviderAdapter {
  readonly kind: ProviderKind
  readonly #connectionId: string
  readonly #model: (modelId: string) => LanguageModel
  readonly #listModels?: (signal: AbortSignal) => Promise<ProviderModelOption[] | undefined>
  readonly #now: () => number

  constructor(options: AdapterCoreOptions) {
    this.kind = options.kind
    this.#connectionId = options.connectionId
    this.#model = options.model
    this.#listModels = options.listModels
    this.#now = options.now ?? Date.now
  }

  async testConnection(input: AdapterConnectionTest): Promise<ConnectionTestResult> {
    const startedAt = this.#now()
    try {
      const result = await generateText({
        model: this.#model(input.modelId),
        prompt: 'Reply with OK.',
        maxOutputTokens: 1,
        abortSignal: input.signal,
        maxRetries: 0
      })
      contentBlocked(result.finishReason)
      const usage = usageFrom(result.usage)
      return {
        connectionId: this.#connectionId,
        modelId: input.modelId,
        authenticated: true,
        modelAvailable: true,
        capabilities: usage === undefined ? [] : ['usage'],
        latencyMs: Math.max(0, this.#now() - startedAt),
        providerRequestId: requestIdFromResponse(result.response)
      }
    } catch (error) {
      throw normalizeProviderAdapterError(error, input.signal)
    }
  }

  async listModels(signal: AbortSignal): Promise<ProviderModelOption[] | undefined> {
    if (this.#listModels === undefined) return undefined
    try {
      return await this.#listModels(signal)
    } catch (error) {
      throw normalizeProviderAdapterError(error, signal)
    }
  }

  async *streamText(input: AdapterTextRequest): AsyncIterable<AdapterStreamEvent> {
    try {
      const result = streamText({
        model: this.#model(input.modelId),
        ...commonGenerationOptions(input)
      })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield { type: 'text-delta', text: part.text }
        } else if (part.type === 'error') {
          throw part.error
        } else if (part.type === 'abort') {
          throw new ProviderAdapterError({ kind: 'cancelled' })
        }
      }
      const [usage, finishReason, response] = await Promise.all([
        result.usage,
        result.finishReason,
        result.response
      ])
      contentBlocked(finishReason)
      yield {
        type: 'finish',
        usage: usageFrom(usage),
        providerRequestId: requestIdFromResponse(response)
      }
    } catch (error) {
      throw normalizeProviderAdapterError(error, input.signal)
    }
  }

  async generateObject<T>(input: AdapterObjectRequest<T>): Promise<AdapterObjectResult<T>> {
    try {
      const result = await generateText({
        model: this.#model(input.modelId),
        ...commonGenerationOptions(input),
        output: Output.object({ schema: input.schema })
      })
      contentBlocked(result.finishReason)
      const validation = input.schema.safeParse(result.output)
      if (!validation.success) {
        throw new ProviderAdapterError({ kind: 'invalid-response' })
      }
      return {
        value: validation.data,
        usage: usageFrom(result.usage),
        providerRequestId: requestIdFromResponse(result.response)
      }
    } catch (error) {
      throw normalizeProviderAdapterError(error, input.signal)
    }
  }
}

export const collectAdapterText = (events: Iterable<AdapterStreamEvent>): string => {
  let text = ''
  for (const event of events) {
    if (event.type === 'text-delta') text += event.text
  }
  return text
}
