import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { z } from 'zod'

import { createModelLogger } from '../src/main/model-logger.ts'
import { DefaultModelGateway } from '../src/model/model-gateway.ts'
import { ModelRepository } from '../src/model/model-repository.ts'
import { ProviderAdapterError } from '../src/model/provider-adapter.ts'

const connection = {
  id: 'connection-deepseek',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  hasSecret: true,
  secretHint: '••••test',
  secretRef: 'secret-ref',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z'
}

const profile = {
  id: 'profile-writer',
  connectionId: connection.id,
  label: 'DeepSeek V4 Flash',
  modelId: 'deepseek-v4-flash',
  temperature: 0.6,
  maxOutputTokens: 2_048,
  contextWindow: 128_000,
  capabilities: ['stream-text', 'structured-output', 'usage']
}

const successAdapter = () => ({
  kind: 'openai-compatible',
  async testConnection(input) {
    return {
      connectionId: connection.id,
      modelId: input.modelId,
      authenticated: true,
      modelAvailable: true,
      capabilities: ['stream-text', 'structured-output', 'usage'],
      latencyMs: 4,
      providerRequestId: 'request-test'
    }
  },
  async listModels() {
    return [{ id: profile.modelId, label: profile.label }]
  },
  async *streamText() {
    yield { type: 'text-delta', text: '你好' }
    yield { type: 'text-delta', text: '，星海' }
    yield {
      type: 'finish',
      usage: { inputTokens: 3, outputTokens: 4 },
      providerRequestId: 'request-stream'
    }
  },
  async generateObject(input) {
    const parsed = input.schema.safeParse({ title: '星海' })
    assert.equal(parsed.success, true)
    return {
      value: parsed.data,
      usage: { inputTokens: 5, outputTokens: 6 },
      providerRequestId: 'request-object'
    }
  }
})

const fixtureGateway = (options = {}) => {
  const records = []
  const createdAdapters = []
  const adapter = options.adapter ?? successAdapter()
  let tick = 1_000
  const gateway = new DefaultModelGateway({
    repository: options.repository ?? {
      getConnection: async (id) => id === connection.id ? connection : undefined,
      getProfile: async (id) => id === profile.id ? profile : undefined
    },
    secretStore: options.secretStore ?? {
      read: async (ref) => {
        assert.equal(ref, connection.secretRef)
        return 'sk-private-gateway'
      }
    },
    registry: options.registry ?? {
      create(storedConnection, secret) {
        createdAdapters.push({ storedConnection, secret })
        return adapter
      }
    },
    logger: options.logger ?? createModelLogger((record) => records.push(record)),
    createId: options.createId ?? (() => `log-${records.length + 1}`),
    now: options.now ?? (() => {
      tick += 10
      return tick
    }),
    nowIso: options.nowIso ?? (() => '2026-08-10T12:00:00.000Z'),
    sleep: options.sleep ?? (async () => undefined),
    random: options.random ?? (() => 0.5)
  })
  return { gateway, records, createdAdapters, adapter }
}

const hasCode = (code) => (error) => {
  assert.equal(error?.code, code)
  return true
}

test('gateway resolves profile, secret and adapter while returning only provider-neutral results', async () => {
  const { gateway, records, createdAdapters } = fixtureGateway()

  const connectionResult = await gateway.testConnection(
    connection.id,
    profile.modelId,
    AbortSignal.timeout(2_000)
  )
  assert.equal(connectionResult.authenticated, true)

  const stream = []
  for await (const event of gateway.streamText({
    profileId: profile.id,
    prompt: 'private prompt text',
    signal: AbortSignal.timeout(2_000)
  })) stream.push(event)
  assert.equal(stream.filter((event) => event.type === 'text-delta').map((event) => event.text).join(''), '你好，星海')

  const object = await gateway.generateObject({
    profileId: profile.id,
    prompt: 'private chapter body',
    schema: z.object({ title: z.string() }),
    signal: AbortSignal.timeout(2_000)
  })
  assert.deepEqual(object.value, { title: '星海' })
  assert.deepEqual(await gateway.estimateTokens({ profileId: profile.id, text: 'abcdefgh' }), {
    tokens: 2,
    method: 'heuristic'
  })

  assert.equal(createdAdapters.length, 3)
  assert.ok(createdAdapters.every((item) => item.secret === 'sk-private-gateway'))
  assert.deepEqual(records.map((record) => record.operation), [
    'test-connection', 'stream-text', 'generate-object'
  ])
  assert.deepEqual(records.map((record) => record.status), ['succeeded', 'succeeded', 'succeeded'])
  assert.equal(records[0].modelId, profile.modelId)
  assert.equal(records[1].inputTokens, 3)
  assert.equal(records[1].outputTokens, 4)
  assert.equal(records[2].providerRequestId, 'request-object')
  assert.doesNotMatch(
    JSON.stringify(records),
    /private prompt text|private chapter body|sk-private-gateway|reasoning|apiKey|secretRef/
  )
})

test('gateway blocks missing or capability-unknown profiles before reading secrets or creating adapters', async () => {
  let secretReads = 0
  let adapterCreates = 0
  const repository = {
    getConnection: async () => connection,
    getProfile: async (id) => id === 'unknown-capabilities'
      ? { ...profile, id, capabilities: [] }
      : undefined
  }
  const { gateway } = fixtureGateway({
    repository,
    secretStore: { read: async () => { secretReads += 1; return 'should-not-read' } },
    registry: { create: () => { adapterCreates += 1; return successAdapter() } }
  })

  await assert.rejects(gateway.generateObject({
    profileId: 'missing-profile',
    prompt: 'x',
    schema: z.object({ title: z.string() }),
    signal: AbortSignal.timeout(2_000)
  }), hasCode('MODEL_NOT_CONFIGURED'))
  await assert.rejects(async () => {
    for await (const _event of gateway.streamText({
      profileId: 'unknown-capabilities',
      prompt: 'x',
      signal: AbortSignal.timeout(2_000)
    })) {
      // consume
    }
  }, hasCode('MODEL_CAPABILITY_REQUIRED'))
  assert.equal(secretReads, 0)
  assert.equal(adapterCreates, 0)
})

test('gateway maps stable errors and retries only bounded transient failures', async (t) => {
  const cases = [
    { error: { kind: 'http', status: 401 }, code: 'MODEL_AUTH_FAILED', attempts: 1 },
    { error: { kind: 'http', status: 400, providerCode: 'insufficient_balance' }, code: 'MODEL_BALANCE_EXHAUSTED', attempts: 1 },
    { error: { kind: 'http', status: 404 }, code: 'MODEL_NOT_FOUND', attempts: 1 },
    { error: { kind: 'content-blocked' }, code: 'MODEL_CONTENT_BLOCKED', attempts: 1 },
    { error: { kind: 'invalid-response' }, code: 'MODEL_INVALID_STRUCTURE', attempts: 1 },
    { error: { kind: 'cancelled' }, code: 'MODEL_CANCELLED', attempts: 1 },
    { error: { kind: 'http', status: 408 }, code: 'MODEL_TIMEOUT', attempts: 3 },
    { error: { kind: 'http', status: 409 }, code: 'MODEL_PROVIDER_FAILED', attempts: 3 },
    { error: { kind: 'http', status: 429 }, code: 'MODEL_RATE_LIMITED', attempts: 3 },
    { error: { kind: 'http', status: 503 }, code: 'MODEL_PROVIDER_FAILED', attempts: 3 },
    { error: { kind: 'network', networkCode: 'ENOTFOUND' }, code: 'MODEL_DNS_FAILED', attempts: 3 },
    { error: { kind: 'network', networkCode: 'ECONNREFUSED' }, code: 'MODEL_OFFLINE', attempts: 3 },
    { error: { kind: 'network', networkCode: 'ETIMEDOUT' }, code: 'MODEL_TIMEOUT', attempts: 3 }
  ]

  for (const scenario of cases) {
    await t.test(`${scenario.code}:${scenario.error.status ?? scenario.error.networkCode ?? scenario.error.kind}`, async () => {
      let attempts = 0
      const delays = []
      const adapter = {
        ...successAdapter(),
        async generateObject() {
          attempts += 1
          throw new ProviderAdapterError(scenario.error)
        }
      }
      const { gateway, records } = fixtureGateway({
        adapter,
        sleep: async (milliseconds) => { delays.push(milliseconds) },
        random: () => 0.5
      })
      await assert.rejects(gateway.generateObject({
        profileId: profile.id,
        prompt: 'never log this input',
        schema: z.object({ title: z.string() }),
        signal: new AbortController().signal
      }), hasCode(scenario.code))
      assert.equal(attempts, scenario.attempts)
      assert.deepEqual(delays, scenario.attempts === 3 ? [100, 200] : [])
      assert.equal(records.length, 1)
      assert.equal(records[0].retryCount, scenario.attempts - 1)
      assert.equal(records[0].errorCode, scenario.code)
      assert.equal(records[0].status, scenario.code === 'MODEL_CANCELLED' ? 'cancelled' : 'failed')
    })
  }
})

test('gateway never retries a stream after a text delta has been exposed', async () => {
  let attempts = 0
  const adapter = {
    ...successAdapter(),
    async *streamText() {
      attempts += 1
      yield { type: 'text-delta', text: '不可重复' }
      throw new ProviderAdapterError({ kind: 'http', status: 429 })
    }
  }
  const { gateway, records } = fixtureGateway({ adapter })
  let visible = ''
  await assert.rejects(async () => {
    for await (const event of gateway.streamText({
      profileId: profile.id,
      prompt: 'private',
      signal: new AbortController().signal
    })) {
      if (event.type === 'text-delta') visible += event.text
    }
  }, hasCode('MODEL_RATE_LIMITED'))
  assert.equal(visible, '不可重复')
  assert.equal(attempts, 1)
  assert.equal(records[0].retryCount, 0)
})

test('gateway logs cancellation during retry backoff and clamps jitter before later success', async (t) => {
  await t.test('cancellation during backoff', async () => {
    const controller = new AbortController()
    let attempts = 0
    const adapter = {
      ...successAdapter(),
      async generateObject() {
        attempts += 1
        throw new ProviderAdapterError({ kind: 'http', status: 429 })
      }
    }
    const { gateway, records } = fixtureGateway({
      adapter,
      sleep: async () => { controller.abort() }
    })
    await assert.rejects(gateway.generateObject({
      profileId: profile.id,
      prompt: 'private',
      schema: z.object({ title: z.string() }),
      signal: controller.signal
    }), hasCode('MODEL_CANCELLED'))
    assert.equal(attempts, 1)
    assert.equal(records.length, 1)
    assert.equal(records[0].status, 'cancelled')
    assert.equal(records[0].retryCount, 0)
  })

  await t.test('bounded jitter and later success', async () => {
    let attempts = 0
    const delays = []
    const adapter = {
      ...successAdapter(),
      async generateObject(input) {
        attempts += 1
        if (attempts < 3) throw new ProviderAdapterError({ kind: 'http', status: 503 })
        return successAdapter().generateObject(input)
      }
    }
    const { gateway, records } = fixtureGateway({
      adapter,
      sleep: async (milliseconds) => { delays.push(milliseconds) },
      random: () => 2
    })
    const result = await gateway.generateObject({
      profileId: profile.id,
      prompt: 'private',
      schema: z.object({ title: z.string() }),
      signal: new AbortController().signal
    })
    assert.deepEqual(result.value, { title: '星海' })
    assert.equal(attempts, 3)
    assert.deepEqual(delays, [125, 250])
    assert.equal(records.length, 1)
    assert.equal(records[0].status, 'succeeded')
    assert.equal(records[0].retryCount, 2)
  })
})

test('safe model logs persist through the repository without accepting content or secrets', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-model-log-'))
  let repository = await ModelRepository.open(join(sandbox, 'control.sqlite3'))
  t.after(async () => {
    await repository.close().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })
  const logger = createModelLogger((record) => repository.saveCallLog(record))
  await logger.record({
    id: randomUUID(),
    connectionId: connection.id,
    profileId: profile.id,
    providerKind: connection.kind,
    modelId: profile.modelId,
    operation: 'generate-object',
    status: 'failed',
    latencyMs: 120,
    retryCount: 2,
    errorCode: 'MODEL_RATE_LIMITED',
    providerRequestId: 'request-safe',
    createdAt: '2026-08-10T12:00:00.000Z',
    prompt: 'must not persist',
    secret: 'sk-must-not-persist',
    reasoning: 'must not persist'
  })

  await repository.close()
  repository = await ModelRepository.open(join(sandbox, 'control.sqlite3'))
  const saved = await repository.listCallLogs(10)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].errorCode, 'MODEL_RATE_LIMITED')
  assert.deepEqual(Object.keys(saved[0]).sort(), [
    'connectionId', 'createdAt', 'errorCode', 'id', 'latencyMs', 'modelId',
    'operation', 'profileId', 'providerKind', 'providerRequestId', 'retryCount', 'status'
  ])
  assert.doesNotMatch(JSON.stringify(saved), /must not persist|sk-must-not-persist|prompt|secret|reasoning/)
})
