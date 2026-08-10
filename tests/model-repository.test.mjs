import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ProjectService } from '../src/novel/project-service.ts'

const hasCode = (code) => (error) => error?.code === code

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
  decryptString: (value) => [...value.toString('utf8')].reverse().join('')
}

const now = () => '2026-08-10T12:00:00.000Z'

const startFixture = async (sandbox, openExisting = false) => {
  const { EncryptedSecretStore } = await import('../src/model/secret-store.ts')
  const { ModelRepository } = await import('../src/model/model-repository.ts')
  const { ModelService } = await import('../src/model/model-service.ts')
  const controlDatabasePath = join(sandbox, 'control.sqlite3')
  const projectRoot = join(sandbox, 'novel')
  const project = await ProjectService.start(controlDatabasePath, { createId: randomUUID, now })
  if (openExisting) {
    await project.open({ root: projectRoot })
  } else {
    await project.create({ root: projectRoot, title: '星海来信' })
  }
  const repository = await ModelRepository.open(controlDatabasePath)
  const models = new ModelService({
    repository,
    secretStore: new EncryptedSecretStore({ root: join(sandbox, 'model-secrets'), cipher }),
    projectBindings: project,
    createId: randomUUID,
    now
  })
  return { models, project, projectRoot }
}

test('persists redacted connections, profiles, mode defaults, and role overrides across restart', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-model-repository-'))
  let fixture = await startFixture(sandbox)
  t.after(async () => {
    await fixture.models.shutdown().catch(() => undefined)
    await fixture.project.shutdown().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const connection = await fixture.models.saveConnection({
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-stage3-private',
    enabled: true
  })
  assert.deepEqual(Object.keys(connection).sort(), [
    'baseUrl', 'createdAt', 'enabled', 'hasSecret', 'id', 'kind', 'name', 'secretHint', 'updatedAt'
  ])
  assert.equal(connection.hasSecret, true)
  assert.equal(connection.secretHint, '••••vate')
  assert.doesNotMatch(JSON.stringify(connection), /sk-stage3-private|apiKey|secretRef/)

  const unchanged = await fixture.models.saveConnection({
    id: connection.id,
    name: 'DeepSeek 官方',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    enabled: true
  })
  assert.equal(unchanged.secretHint, '••••vate')
  assert.equal((await readdir(join(sandbox, 'model-secrets'))).length, 1)

  const profile = await fixture.models.saveProfile({
    connectionId: connection.id,
    label: 'DeepSeek V4 Pro',
    modelId: 'deepseek-v4-pro',
    temperature: 0.7,
    maxOutputTokens: 8_192,
    contextWindow: 1_000_000,
    capabilities: ['stream-text', 'structured-output', 'tools', 'usage']
  })
  const bindings = await fixture.models.saveBindings({
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
    }],
    confirmCrossProviderRouting: false
  })
  assert.equal(bindings.modeDefaults[0].primaryProfileId, profile.id)
  assert.equal(bindings.roleBindings[0].role, 'writer')

  await fixture.models.shutdown()
  await fixture.project.shutdown()
  fixture = await startFixture(sandbox, true)

  assert.deepEqual(await fixture.models.listConnections(), [{ ...unchanged }])
  assert.deepEqual(await fixture.models.listProfiles(), [profile])
  assert.deepEqual(await fixture.models.getBindings(), bindings)
})

test('rejects capability-incompatible bindings and requires explicit cross-provider consent', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-model-binding-'))
  const fixture = await startFixture(sandbox)
  t.after(async () => {
    await fixture.models.shutdown().catch(() => undefined)
    await fixture.project.shutdown().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const deepSeek = await fixture.models.saveConnection({
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-deepseek',
    enabled: true
  })
  const anthropic = await fixture.models.saveConnection({
    name: 'Anthropic',
    kind: 'anthropic',
    apiKey: 'sk-anthropic',
    enabled: true
  })
  const textOnly = await fixture.models.saveProfile({
    connectionId: deepSeek.id,
    label: '仅文本',
    modelId: 'deepseek-v4-flash',
    temperature: 0.5,
    maxOutputTokens: 4_096,
    contextWindow: 1_000_000,
    capabilities: ['stream-text']
  })
  const crossProviderWriter = await fixture.models.saveProfile({
    connectionId: anthropic.id,
    label: '跨平台正文',
    modelId: 'claude-writer-test',
    temperature: 0.7,
    maxOutputTokens: 8_192,
    contextWindow: 200_000,
    capabilities: ['stream-text', 'structured-output']
  })

  await assert.rejects(fixture.models.saveBindings({
    modeDefaults: [],
    roleBindings: [{
      role: 'plot',
      mode: 'standard',
      primaryProfileId: textOnly.id,
      fallbackProfileIds: [],
      allowCrossProviderFallback: false
    }],
    confirmCrossProviderRouting: false
  }), hasCode('MODEL_CAPABILITY_REQUIRED'))

  const crossProvider = {
    modeDefaults: [],
    roleBindings: [{
      role: 'writer',
      mode: 'standard',
      primaryProfileId: textOnly.id,
      fallbackProfileIds: [crossProviderWriter.id],
      allowCrossProviderFallback: true
    }]
  }
  await assert.rejects(
    fixture.models.saveBindings({
      modeDefaults: [],
      roleBindings: [{
        ...crossProvider.roleBindings[0],
        allowCrossProviderFallback: false
      }],
      confirmCrossProviderRouting: true
    }),
    hasCode('MODEL_INVALID_COMMAND')
  )
  await assert.rejects(
    fixture.models.saveBindings({ ...crossProvider, confirmCrossProviderRouting: false }),
    hasCode('MODEL_INVALID_COMMAND')
  )

  const accepted = await fixture.models.saveBindings({
    modeDefaults: [],
    roleBindings: crossProvider.roleBindings,
    confirmCrossProviderRouting: true
  })
  assert.equal(accepted.roleBindings[0].allowCrossProviderFallback, true)
})

test('never reveals a complete short API key through the public secret hint', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-model-short-secret-'))
  const fixture = await startFixture(sandbox)
  t.after(async () => {
    await fixture.models.shutdown().catch(() => undefined)
    await fixture.project.shutdown().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  for (const apiKey of ['a', 'ab', 'abc', 'abcd']) {
    const connection = await fixture.models.saveConnection({
      name: `短密钥 ${apiKey.length}`,
      kind: 'openai-compatible',
      baseUrl: 'https://provider.example',
      apiKey,
      enabled: true
    })
    assert.equal(connection.secretHint, '••••')
    assert.equal(connection.secretHint.includes(apiKey), false)
  }
})
