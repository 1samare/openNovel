import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { CONTROL_MIGRATIONS, PROJECT_MIGRATIONS } from '../src/novel/schema.ts'

test('model contract exposes only fixed commands and rejects secret-bearing list inputs', async () => {
  const model = await import('../src/shared/model.ts')

  assert.equal(model.validateModelCommand(model.MODEL_IPC_CHANNELS.listConnections, []), true)
  assert.equal(model.validateModelCommand(model.MODEL_IPC_CHANNELS.listProfiles, []), true)
  assert.equal(model.validateModelCommand(model.MODEL_IPC_CHANNELS.getBindings, []), true)
  assert.equal(model.validateModelCommand(model.MODEL_IPC_CHANNELS.listConnections, [{ apiKey: 'sk-leak' }]), false)
  assert.equal(model.validateModelCommand('models:unknown', []), false)

  assert.equal(model.validateModelCommand(model.MODEL_IPC_CHANNELS.saveConnection, [{
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-local-only',
    enabled: true
  }]), true)
  assert.equal(model.validateModelCommand(model.MODEL_IPC_CHANNELS.saveConnection, [{
    name: 'DeepSeek',
    kind: 'unsupported-provider',
    baseUrl: 'https://api.deepseek.com',
    enabled: true
  }]), false)
})

test('role capability requirements prevent structured roles from using text-only profiles', async () => {
  const { requiredCapabilitiesForRole } = await import('../src/shared/model.ts')

  assert.deepEqual(requiredCapabilitiesForRole('writer'), ['stream-text'])
  assert.deepEqual(requiredCapabilitiesForRole('editor'), ['structured-output'])
  assert.deepEqual(requiredCapabilitiesForRole('setting'), ['structured-output'])
  assert.deepEqual(requiredCapabilitiesForRole('character'), ['structured-output'])
  assert.deepEqual(requiredCapabilitiesForRole('plot'), ['structured-output'])
  assert.deepEqual(requiredCapabilitiesForRole('reviewer'), ['structured-output'])
})

test('model result validation rejects secret fields anywhere in public connection data', async () => {
  const { isModelResult } = await import('../src/shared/model.ts')
  const publicConnection = {
    id: 'connection-1',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    enabled: true,
    hasSecret: true,
    secretHint: '••••abcd',
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-10T10:00:00.000Z'
  }

  assert.equal(isModelResult({ ok: true, data: [publicConnection] }), true)
  assert.equal(isModelResult({
    ok: true,
    data: [{ ...publicConnection, apiKey: 'sk-leak' }]
  }), false)
  assert.equal(isModelResult({
    ok: true,
    data: [{ ...publicConnection, secretRef: 'secret-file-id' }]
  }), false)
})

test('phase three migrations create model metadata and project binding tables', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-model-contract-'))
  const project = await DatabaseWorkerClient.open(join(sandbox, 'project.sqlite3'), PROJECT_MIGRATIONS)
  const control = await DatabaseWorkerClient.open(join(sandbox, 'control.sqlite3'), CONTROL_MIGRATIONS)
  t.after(async () => {
    await Promise.all([project.close(), control.close()])
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  assert.equal((await project.health()).userVersion, 4)
  assert.equal((await control.health()).userVersion, 2)
  assert.deepEqual(await project.all(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('generation_mode_defaults', 'agent_role_bindings')
    ORDER BY name
  `), [
    { name: 'agent_role_bindings' },
    { name: 'generation_mode_defaults' }
  ])
  assert.deepEqual(await control.all(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('provider_connections', 'model_profiles', 'model_call_logs')
    ORDER BY name
  `), [
    { name: 'model_call_logs' },
    { name: 'model_profiles' },
    { name: 'provider_connections' }
  ])
})
