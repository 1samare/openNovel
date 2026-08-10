import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'

import { z } from 'zod'

import {
  ProviderAdapterError,
  collectAdapterText
} from '../src/model/provider-adapter.ts'
import { ProviderRegistry } from '../src/model/provider-registry.ts'

const providerCases = [
  {
    kind: 'openai-compatible',
    connectionId: 'connection-openai',
    modelId: 'deepseek-v4-flash',
    basePath: '/v1',
    authHeader: 'authorization',
    authValue: 'Bearer sk-private-openai'
  },
  {
    kind: 'anthropic',
    connectionId: 'connection-anthropic',
    modelId: 'claude-sonnet-4-5-test',
    basePath: '/v1',
    authHeader: 'x-api-key',
    authValue: 'sk-private-anthropic'
  },
  {
    kind: 'gemini',
    connectionId: 'connection-gemini',
    modelId: 'gemini-2.5-flash',
    basePath: '/v1beta',
    authHeader: 'x-goog-api-key',
    authValue: 'sk-private-gemini'
  }
]

const json = (response, status, value, headers = {}) => {
  response.writeHead(status, {
    'content-type': 'application/json',
    ...headers
  })
  response.end(JSON.stringify(value))
}

const sse = (response, chunks, requestId) => {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-request-id': requestId
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end()
}

const openAiResponse = (text, finishReason = 'stop') => ({
  id: 'request-openai',
  object: 'chat.completion',
  created: 1,
  model: 'deepseek-v4-flash',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: text },
    finish_reason: finishReason
  }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
})

const anthropicResponse = (text, finishReason = 'end_turn') => ({
  type: 'message',
  id: 'request-anthropic',
  model: 'claude-sonnet-4-5-test',
  role: 'assistant',
  content: [{ type: 'text', text }],
  stop_reason: finishReason,
  stop_sequence: null,
  usage: { input_tokens: 3, output_tokens: 4 }
})

const geminiResponse = (text, finishReason = 'STOP') => ({
  responseId: 'request-gemini',
  candidates: [{
    content: { role: 'model', parts: [{ text }] },
    finishReason
  }],
  usageMetadata: {
    promptTokenCount: 3,
    candidatesTokenCount: 4,
    totalTokenCount: 7
  }
})

const streamResponse = (kind, text, contentBlocked = false) => {
  if (kind === 'openai-compatible') {
    return [
      {
        id: 'request-openai',
        choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
      },
      {
        id: 'request-openai',
        choices: [{ index: 0, delta: {}, finish_reason: contentBlocked ? 'content_filter' : 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      }
    ]
  }
  if (kind === 'anthropic') {
    return [
      {
        type: 'message_start',
        message: {
          id: 'request-anthropic',
          model: 'claude-sonnet-4-5-test',
          role: 'assistant',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 3, output_tokens: 0 }
        }
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: {
          stop_reason: contentBlocked ? 'refusal' : 'end_turn',
          stop_sequence: null
        },
        usage: { output_tokens: 4 }
      },
      { type: 'message_stop' }
    ]
  }
  return [geminiResponse(text, contentBlocked ? 'SAFETY' : 'STOP')]
}

const providerErrorBody = (kind, status) => {
  if (kind === 'anthropic') {
    return {
      type: 'error',
      error: {
        type: status === 401 ? 'authentication_error' : status === 404 ? 'not_found_error' : 'rate_limit_error',
        message: 'provider rejected request'
      }
    }
  }
  if (kind === 'gemini') {
    return {
      error: {
        code: status,
        status: status === 401 ? 'UNAUTHENTICATED' : status === 404 ? 'NOT_FOUND' : 'RESOURCE_EXHAUSTED',
        message: 'provider rejected request'
      }
    }
  }
  return {
    error: {
      type: 'invalid_request_error',
      code: status === 401 ? 'invalid_api_key' : status === 404 ? 'model_not_found' : 'rate_limit_exceeded',
      message: 'provider rejected request'
    }
  }
}

const readBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const startFakeProvider = async (kind) => {
  const requests = []
  const server = createServer(async (request, response) => {
    try {
      const body = request.method === 'POST' ? await readBody(request) : {}
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      })

      if (request.method === 'GET' && request.url === '/v1/models') {
        json(response, 200, {
          data: [
            { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
            { id: 'deepseek-v4-flash' }
          ]
        })
        return
      }

      const serialized = JSON.stringify(body)
      if (serialized.includes('ERROR:cancel')) {
        request.once('close', () => response.destroy())
        return
      }
      const status = serialized.includes('ERROR:auth')
        ? 401
        : serialized.includes('ERROR:missing')
          ? 404
          : serialized.includes('ERROR:rate')
            ? 429
            : undefined
      if (status !== undefined) {
        json(response, status, providerErrorBody(kind, status), {
          'x-request-id': `error-${kind}`
        })
        return
      }

      if (serialized.includes('ERROR:malformed')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{invalid json')
        return
      }

      const isStream = body.stream === true || request.url?.includes(':streamGenerateContent')
      const isObject = serialized.includes('OBJECT')
      const isBlocked = serialized.includes('ERROR:content')
      const text = isObject ? JSON.stringify({ title: '星海' }) : '你好，星海'

      if (isStream) {
        sse(response, streamResponse(kind, isBlocked ? '' : text, isBlocked), `request-${kind}`)
        return
      }

      const value = kind === 'openai-compatible'
        ? openAiResponse(text, isBlocked ? 'content_filter' : 'stop')
        : kind === 'anthropic'
          ? anthropicResponse(text, isBlocked ? 'refusal' : 'end_turn')
          : geminiResponse(text, isBlocked ? 'SAFETY' : 'STOP')
      json(response, 200, value, { 'x-request-id': `request-${kind}` })
    } catch (error) {
      response.destroy(error)
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.equal(typeof address, 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    }
  }
}

const connectionFor = (fixture, baseUrl) => ({
  id: fixture.connectionId,
  name: `${fixture.kind} fixture`,
  kind: fixture.kind,
  baseUrl: `${baseUrl}${fixture.basePath}`,
  enabled: true,
  hasSecret: true,
  secretHint: '••••test',
  secretRef: `secret-${fixture.kind}`,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z'
})

const adapterFor = (fixture, fake) => new ProviderRegistry().create(
  connectionFor(fixture, fake.baseUrl),
  fixture.authValue.replace(/^Bearer /, '')
)

const errorWith = (kind, status) => (error) => {
  assert.ok(error instanceof ProviderAdapterError)
  assert.equal(error.kind, kind)
  if (status !== undefined) assert.equal(error.status, status)
  assert.doesNotMatch(JSON.stringify(error), /sk-private|provider rejected request/)
  return true
}

test('all provider adapters use native AI SDK contracts for test, stream, object, usage, and request ids', async (t) => {
  for (const fixture of providerCases) {
    await t.test(fixture.kind, async (t) => {
      const fake = await startFakeProvider(fixture.kind)
      t.after(() => fake.close())
      const adapter = adapterFor(fixture, fake)

      const connection = await adapter.testConnection({
        modelId: fixture.modelId,
        signal: AbortSignal.timeout(2_000)
      })
      assert.equal(connection.connectionId, fixture.connectionId)
      assert.equal(connection.authenticated, true)
      assert.equal(connection.modelAvailable, true)
      assert.deepEqual(connection.capabilities, ['usage'])
      assert.ok(connection.latencyMs >= 0)
      assert.equal(connection.providerRequestId, `request-${fixture.kind}`)

      const streamEvents = []
      for await (const event of adapter.streamText({
        modelId: fixture.modelId,
        prompt: 'STREAM',
        temperature: 0.4,
        maxOutputTokens: 128,
        signal: AbortSignal.timeout(2_000)
      })) streamEvents.push(event)
      assert.equal(collectAdapterText(streamEvents), '你好，星海')
      assert.deepEqual(streamEvents.at(-1), {
        type: 'finish',
        usage: { inputTokens: 3, outputTokens: 4 },
        providerRequestId: `request-${fixture.kind}`
      })

      const objectResult = await adapter.generateObject({
        modelId: fixture.modelId,
        prompt: 'OBJECT',
        temperature: 0.2,
        maxOutputTokens: 128,
        schema: z.object({ title: z.string() }),
        signal: AbortSignal.timeout(2_000)
      })
      assert.deepEqual(objectResult, {
        value: { title: '星海' },
        usage: { inputTokens: 3, outputTokens: 4 },
        providerRequestId: `request-${fixture.kind}`
      })

      const authenticatedRequests = fake.requests.filter((item) => item.method === 'POST')
      assert.ok(authenticatedRequests.length >= 3)
      assert.ok(authenticatedRequests.every((item) => (
        item.headers[fixture.authHeader] === fixture.authValue
      )))
      const objectRequest = authenticatedRequests.find((item) => JSON.stringify(item.body).includes('OBJECT'))
      assert.ok(objectRequest)
      if (fixture.kind === 'openai-compatible') {
        assert.equal(objectRequest.body.response_format.type, 'json_schema')
      } else if (fixture.kind === 'anthropic') {
        assert.equal(objectRequest.body.output_config.format.type, 'json_schema')
      } else {
        assert.equal(objectRequest.body.generationConfig.responseMimeType, 'application/json')
        assert.ok(objectRequest.body.generationConfig.responseSchema)
      }
    })
  }
})

test('OpenAI-compatible exposes an optional model list while native adapters preserve manual ids', async (t) => {
  for (const fixture of providerCases) {
    const fake = await startFakeProvider(fixture.kind)
    t.after(() => fake.close())
    const models = await adapterFor(fixture, fake).listModels(AbortSignal.timeout(2_000))
    if (fixture.kind === 'openai-compatible') {
      assert.deepEqual(models, [
        { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
      ])
    } else {
      assert.equal(models, undefined)
    }
  }
})

test('provider adapters reduce HTTP, malformed, policy, and cancellation failures to a safe boundary', async (t) => {
  for (const fixture of providerCases) {
    await t.test(fixture.kind, async (t) => {
      const fake = await startFakeProvider(fixture.kind)
      t.after(() => fake.close())
      const adapter = adapterFor(fixture, fake)
      const schema = z.object({ title: z.string() })

      for (const [marker, status] of [
        ['ERROR:auth', 401],
        ['ERROR:missing', 404],
        ['ERROR:rate', 429]
      ]) {
        await assert.rejects(adapter.generateObject({
          modelId: fixture.modelId,
          prompt: marker,
          maxOutputTokens: 32,
          temperature: 0,
          schema,
          signal: AbortSignal.timeout(2_000)
        }), errorWith('http', status))
      }

      await assert.rejects(adapter.generateObject({
        modelId: fixture.modelId,
        prompt: 'ERROR:malformed',
        maxOutputTokens: 32,
        temperature: 0,
        schema,
        signal: AbortSignal.timeout(2_000)
      }), errorWith('invalid-response'))

      await assert.rejects(async () => {
        for await (const _event of adapter.streamText({
          modelId: fixture.modelId,
          prompt: 'ERROR:content',
          maxOutputTokens: 32,
          temperature: 0,
          signal: AbortSignal.timeout(2_000)
        })) {
          // consume the complete stream to observe its terminal policy reason
        }
      }, errorWith('content-blocked'))

      const controller = new AbortController()
      const pending = adapter.generateObject({
        modelId: fixture.modelId,
        prompt: 'ERROR:cancel',
        maxOutputTokens: 32,
        temperature: 0,
        schema,
        signal: controller.signal
      })
      controller.abort()
      await assert.rejects(pending, errorWith('cancelled'))
    })
  }
})
