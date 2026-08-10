import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { registerModelIpcHandlers } from '../src/main/model-ipc.ts'
import { createModelRuntime } from '../src/main/model-runtime.ts'
import { createModelApi } from '../src/preload/model-api.ts'
import {
  MODEL_IPC_CHANNELS,
  ModelDomainError,
  validateModelCommand
} from '../src/shared/model.ts'

const senderFor = (url, { topLevel = true } = {}) => {
  const mainFrame = { url, isDestroyed: () => false }
  const senderFrame = topLevel ? mainFrame : { url, isDestroyed: () => false }
  return {
    sender: {
      getURL: () => url,
      isDestroyed: () => false,
      mainFrame
    },
    senderFrame
  }
}

const connection = {
  id: 'connection-deepseek',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  hasSecret: true,
  secretHint: '••••vate',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z'
}

const profile = {
  id: 'profile-deepseek',
  connectionId: connection.id,
  label: 'DeepSeek V4 Flash',
  modelId: 'deepseek-v4-flash',
  temperature: 0.6,
  maxOutputTokens: 2_048,
  contextWindow: 128_000,
  capabilities: ['stream-text', 'structured-output', 'usage']
}

const bindings = {
  modeDefaults: [{
    mode: 'standard',
    primaryProfileId: profile.id,
    fallbackProfileIds: [],
    allowCrossProviderFallback: false
  }],
  roleBindings: [{
    role: 'writer',
    mode: 'standard',
    primaryProfileId: profile.id,
    fallbackProfileIds: [],
    allowCrossProviderFallback: false
  }]
}

const saveConnectionInput = {
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  enabled: true
}

const saveProfileInput = {
  connectionId: connection.id,
  label: profile.label,
  modelId: profile.modelId,
  temperature: 0.6,
  maxOutputTokens: 2_048,
  contextWindow: 128_000,
  capabilities: ['stream-text', 'structured-output', 'usage']
}

const saveBindingsInput = {
  ...bindings,
  confirmCrossProviderRouting: false
}

test('validates exact arguments for all fixed model commands', () => {
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.listConnections, []), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveConnection, [saveConnectionInput]), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.testConnection, [{
    requestId: 'request-1', connectionId: connection.id, modelId: profile.modelId
  }]), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.cancelConnectionTest, ['request-1']), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.listModels, [connection.id]), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.listProfiles, []), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveProfile, [saveProfileInput]), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.getBindings, []), true)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveBindings, [saveBindingsInput]), true)

  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.listConnections, ['extra']), false)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveConnection, [{ ...saveConnectionInput, extra: true }]), false)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.testConnection, [{
    requestId: 'request-1', connectionId: connection.id, modelId: profile.modelId, apiKey: 'leak'
  }]), false)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveProfile, [{ ...saveProfileInput, capabilities: ['unknown'] }]), false)
  assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveBindings, [{
    ...saveBindingsInput,
    roleBindings: [{ ...bindings.roleBindings[0], fallbackProfileIds: [profile.id, profile.id] }]
  }]), false)
  assert.equal(validateModelCommand('models:unknown', []), false)
})

test('registers only fixed handlers and rejects wrong origin or non-top-level frames before runtime access', async () => {
  const handlers = new Map()
  const runtime = new Proxy({
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' }
  }, {
    get(target, key) {
      if (key in target) return target[key]
      return () => assert.fail('unauthorized request reached model runtime')
    }
  })
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel)
  }
  const dispose = registerModelIpcHandlers(ipcMain, runtime)
  assert.equal(registerModelIpcHandlers(ipcMain, runtime), dispose)
  assert.deepEqual([...handlers.keys()].sort(), Object.values(MODEL_IPC_CHANNELS).sort())

  for (const event of [
    senderFor('file:///app/renderer/foreign.html'),
    senderFor('file:///app/renderer/index.html', { topLevel: false })
  ]) {
    const result = await handlers.get(MODEL_IPC_CHANNELS.listConnections)(event)
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'MODEL_IPC_NOT_AUTHORIZED',
        message: 'Model command is not authorized',
        retryable: false
      }
    })
  }
  dispose()
  dispose()
  assert.equal(handlers.size, 0)
})

test('dispatches authorized commands and rejects invalid arguments without reaching runtime', async () => {
  const calls = []
  const handlers = new Map()
  const runtime = {
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    listConnections: async () => { calls.push('listConnections'); return { ok: true, data: [connection] } },
    saveConnection: async (input) => { calls.push(['saveConnection', input]); return { ok: true, data: connection } },
    testConnection: async (input) => { calls.push(['testConnection', input]); return { ok: true, data: {
      connectionId: connection.id,
      modelId: profile.modelId,
      authenticated: true,
      modelAvailable: true,
      capabilities: profile.capabilities,
      latencyMs: 12
    } } },
    cancelConnectionTest: async (id) => { calls.push(['cancel', id]); return { ok: true, data: null } },
    listModels: async (id) => { calls.push(['models', id]); return { ok: true, data: [{ id: profile.modelId, label: profile.label }] } },
    listProfiles: async () => { calls.push('profiles'); return { ok: true, data: [profile] } },
    saveProfile: async (input) => { calls.push(['saveProfile', input]); return { ok: true, data: profile } },
    getBindings: async () => { calls.push('bindings'); return { ok: true, data: bindings } },
    saveBindings: async (input) => { calls.push(['saveBindings', input]); return { ok: true, data: bindings } }
  }
  registerModelIpcHandlers({
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: () => undefined
  }, runtime)
  const event = senderFor('file:///app/renderer/index.html')

  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.listConnections)(event)).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.saveConnection)(event, saveConnectionInput)).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.testConnection)(event, {
    requestId: 'request-1', connectionId: connection.id, modelId: profile.modelId
  })).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.cancelConnectionTest)(event, 'request-1')).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.listModels)(event, connection.id)).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.listProfiles)(event)).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.saveProfile)(event, saveProfileInput)).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.getBindings)(event)).ok, true)
  assert.equal((await handlers.get(MODEL_IPC_CHANNELS.saveBindings)(event, saveBindingsInput)).ok, true)
  assert.equal(calls.length, 9)

  const invalid = await handlers.get(MODEL_IPC_CHANNELS.saveProfile)(event, { ...saveProfileInput, extra: true })
  assert.equal(invalid.error.code, 'MODEL_INVALID_COMMAND')
  assert.equal(calls.length, 9)
})

test('runtime locks request ids, cancels tests, and aborts then awaits active calls before service shutdown', async () => {
  const order = []
  let testCalls = 0
  const service = {
    listConnections: async () => [connection],
    saveConnection: async () => connection,
    listProfiles: async () => [profile],
    saveProfile: async () => profile,
    getBindings: async () => bindings,
    saveBindings: async () => bindings,
    shutdown: async () => { order.push('service.shutdown') }
  }
  const gateway = {
    testConnection: async (_connectionId, _modelId, signal) => {
      testCalls += 1
      order.push('test.started')
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          order.push('test.aborted')
          reject(new ModelDomainError('MODEL_CANCELLED', 'private cancellation detail'))
        }, { once: true })
      })
    },
    listModels: async (_connectionId, signal) => {
      order.push('models.started')
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('model list was not aborted')), 100)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          order.push('models.aborted')
          reject(new ModelDomainError('MODEL_CANCELLED', 'private cancellation detail'))
        }, { once: true })
      })
    },
    streamText: () => { throw new Error('not used') },
    generateObject: async () => { throw new Error('not used') },
    estimateTokens: async () => ({ tokens: 1, method: 'heuristic' })
  }
  const runtime = createModelRuntime({ service, gateway, senderPolicy: {} })
  const first = runtime.testConnection({
    requestId: 'same-request',
    connectionId: connection.id,
    modelId: profile.modelId
  })
  await new Promise((resolve) => setImmediate(resolve))
  const duplicate = await runtime.testConnection({
    requestId: 'same-request',
    connectionId: connection.id,
    modelId: profile.modelId
  })
  assert.equal(duplicate.error.code, 'MODEL_INVALID_COMMAND')
  assert.equal(testCalls, 1)

  const models = runtime.listModels(connection.id)
  await new Promise((resolve) => setImmediate(resolve))
  const shutdown = runtime.shutdown()
  assert.deepEqual(order, [
    'test.started', 'models.started', 'test.aborted', 'models.aborted'
  ])
  assert.equal((await first).error.code, 'MODEL_CANCELLED')
  assert.equal((await models).error.code, 'MODEL_CANCELLED')
  await shutdown
  assert.deepEqual(order, [
    'test.started', 'models.started', 'test.aborted', 'models.aborted', 'service.shutdown'
  ])
  assert.equal((await runtime.listConnections()).error.code, 'MODEL_OPERATION_FAILED')
})

test('runtime exposes idempotent connection-test cancellation and safe domain errors', async () => {
  let controllerSignal
  const service = {
    listConnections: async () => { throw new ModelDomainError('MODEL_DATABASE_FAILED', 'C:\\private\\control.sqlite3') },
    shutdown: async () => undefined
  }
  const gateway = {
    testConnection: async (_connectionId, _modelId, signal) => {
      controllerSignal = signal
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      throw new ModelDomainError('MODEL_CANCELLED', 'private cancellation detail')
    },
    listModels: async () => []
  }
  const runtime = createModelRuntime({ service, gateway, senderPolicy: {} })
  const database = await runtime.listConnections()
  assert.equal(database.error.code, 'MODEL_DATABASE_FAILED')
  assert.equal(database.error.message, 'Model operation failed')
  assert.doesNotMatch(JSON.stringify(database), /private|sqlite|stack/i)

  const pending = runtime.testConnection({
    requestId: 'cancel-me', connectionId: connection.id, modelId: profile.modelId
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(controllerSignal.aborted, false)
  assert.deepEqual(await runtime.cancelConnectionTest('cancel-me'), { ok: true, data: null })
  assert.equal(controllerSignal.aborted, true)
  assert.deepEqual(await runtime.cancelConnectionTest('cancel-me'), { ok: true, data: null })
  assert.equal((await pending).error.code, 'MODEL_CANCELLED')
  await runtime.shutdown()
})

test('preload exposes nine named methods and rejects malformed or secret-bearing results', async () => {
  const invocations = []
  const ipcRenderer = {
    async invoke(channel, ...args) {
      invocations.push([channel, ...args])
      if (channel === MODEL_IPC_CHANNELS.listConnections) {
        return { ok: true, data: [{ ...connection, apiKey: 'sk-leak' }] }
      }
      if (channel === MODEL_IPC_CHANNELS.saveProfile) {
        return { ok: true, data: { ...profile, capabilities: ['unknown'] } }
      }
      if (channel === MODEL_IPC_CHANNELS.getBindings) {
        return { ok: true, data: bindings }
      }
      return { ok: true, data: null }
    }
  }
  const api = createModelApi(ipcRenderer)
  assert.deepEqual(Object.keys(api).sort(), [
    'cancelConnectionTest', 'getBindings', 'listConnections', 'listModels',
    'listProfiles', 'saveBindings', 'saveConnection', 'saveProfile', 'testConnection'
  ])
  const leaked = await api.listConnections()
  const malformedProfile = await api.saveProfile(saveProfileInput)
  assert.equal(leaked.error.code, 'MODEL_OPERATION_FAILED')
  assert.equal(malformedProfile.error.code, 'MODEL_OPERATION_FAILED')
  assert.deepEqual(await api.getBindings(), { ok: true, data: bindings })
  assert.doesNotMatch(JSON.stringify([leaked, malformedProfile]), /sk-leak|apiKey|secretRef/)
  assert.deepEqual(invocations, [
    [MODEL_IPC_CHANNELS.listConnections],
    [MODEL_IPC_CHANNELS.saveProfile, saveProfileInput],
    [MODEL_IPC_CHANNELS.getBindings]
  ])
})

test('production composition injects safeStorage, exposes models, and shuts model runtime before projects', async () => {
  const [mainSource, preloadSource, envSource] = await Promise.all([
    readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/env.d.ts', import.meta.url), 'utf8')
  ])
  assert.match(mainSource, /safeStorage/)
  assert.match(mainSource, /model-secrets/)
  assert.match(mainSource, /startModelRuntime/)
  assert.match(mainSource, /await shutdownModelRuntime\(\)[\s\S]*await shutdownProjectRuntime\(\)/)
  assert.match(preloadSource, /models:\s*createModelApi\(ipcRenderer\)/)
  assert.match(envSource, /models:\s*ModelApi/)
})
