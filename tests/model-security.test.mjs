import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { unzipSync } from 'fflate'
import { z } from 'zod'

import { renderMarkdown } from '../src/export/export-service.ts'
import { createModelLogger } from '../src/main/model-logger.ts'
import { DefaultModelGateway } from '../src/model/model-gateway.ts'
import { ModelRepository } from '../src/model/model-repository.ts'
import { ModelService } from '../src/model/model-service.ts'
import { EncryptedSecretStore } from '../src/model/secret-store.ts'
import { ChapterService } from '../src/novel/chapter-service.ts'
import { ProjectService } from '../src/novel/project-service.ts'
import { createModelApi } from '../src/preload/model-api.ts'
import { MODEL_IPC_CHANNELS } from '../src/shared/model.ts'

const SENTINEL = 'sk-stage3-sentinel'
const sentinelBytes = Buffer.from(SENTINEL)
const now = () => '2026-08-10T16:00:00.000Z'

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`cipher:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
  decryptString: (value) => Buffer.from(
    value.toString('utf8').slice('cipher:'.length),
    'base64'
  ).toString('utf8')
}

const readMatchingFiles = async (root, predicate) => {
  const names = await readdir(root)
  const buffers = []
  for (const name of names.filter(predicate)) buffers.push(await readFile(join(root, name)))
  return Buffer.concat(buffers)
}

test('keeps the BYOK secret out of databases, backups, exports, logs, and public IPC results', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-model-security-'))
  const controlDatabasePath = join(sandbox, 'control.sqlite3')
  const projectRoot = join(sandbox, 'novel')
  const secretRoot = join(sandbox, 'model-secrets')
  const exportPath = join(sandbox, 'novel-export.md')
  const backupRoot = join(sandbox, 'backups')
  let project
  let models
  let chapters
  let closed = false

  t.after(async () => {
    if (!closed) {
      await chapters?.close().catch(() => undefined)
      await models?.shutdown().catch(() => undefined)
      await project?.shutdown().catch(() => undefined)
    }
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  project = await ProjectService.start(controlDatabasePath, { createId: randomUUID, now })
  const projectSummary = await project.create({ root: projectRoot, title: '星海来信' })
  const repository = await ModelRepository.open(controlDatabasePath)
  const secretStore = new EncryptedSecretStore({ root: secretRoot, cipher })
  models = new ModelService({
    repository,
    secretStore,
    projectBindings: project,
    createId: randomUUID,
    now
  })

  const connection = await models.saveConnection({
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKey: SENTINEL,
    enabled: true
  })
  const profile = await models.saveProfile({
    connectionId: connection.id,
    label: 'DeepSeek V4 Flash',
    modelId: 'deepseek-v4-flash',
    temperature: 0.6,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    capabilities: ['stream-text', 'structured-output', 'usage']
  })
  const bindings = await models.saveBindings({
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

  const adapter = {
    kind: 'openai-compatible',
    async testConnection(input) {
      return {
        connectionId: connection.id,
        modelId: input.modelId,
        authenticated: true,
        modelAvailable: true,
        capabilities: ['stream-text', 'structured-output', 'usage'],
        latencyMs: 7,
        providerRequestId: SENTINEL
      }
    },
    async listModels() {
      return [{ id: profile.modelId, label: profile.label }]
    },
    async *streamText() {
      yield { type: 'text-delta', text: '星海' }
      yield {
        type: 'finish',
        usage: { inputTokens: 2, outputTokens: 2 },
        providerRequestId: SENTINEL
      }
    },
    async generateObject(input) {
      const parsed = input.schema.safeParse({ title: '星海' })
      assert.equal(parsed.success, true)
      return {
        value: parsed.data,
        usage: { inputTokens: 3, outputTokens: 2 },
        providerRequestId: SENTINEL
      }
    }
  }
  let tick = 1_000
  const gateway = new DefaultModelGateway({
    repository,
    secretStore,
    registry: {
      create(_storedConnection, secret) {
        assert.equal(secret, SENTINEL)
        return adapter
      }
    },
    logger: createModelLogger((record) => repository.saveCallLog(record)),
    createId: randomUUID,
    now: () => tick += 10,
    nowIso: now
  })

  const connectionTest = await gateway.testConnection(
    connection.id,
    profile.modelId,
    AbortSignal.timeout(2_000)
  )
  for await (const _event of gateway.streamText({
    profileId: profile.id,
    prompt: '续写一段不含密钥的正文。',
    signal: AbortSignal.timeout(2_000)
  })) {
    // Consume the complete stream so its metadata-only log is persisted.
  }
  await gateway.generateObject({
    profileId: profile.id,
    prompt: '生成不含密钥的标题。',
    schema: z.object({ title: z.string() }),
    signal: AbortSignal.timeout(2_000)
  })

  chapters = await ChapterService.open(
    join(projectRoot, 'project.sqlite3'),
    projectSummary.projectId,
    { createId: randomUUID, now }
  )
  const chapter = await chapters.create({ kind: 'chapter', title: '第一章 雨夜' })
  await chapters.saveDraft({
    chapterId: chapter.chapter.id,
    content: '雨落在站台上。',
    expectedRevision: 0
  })
  const exportBytes = Buffer.from(renderMarkdown(await chapters.exportSnapshot()))
  await writeFile(exportPath, exportBytes)
  await chapters.recordExport(
    'markdown',
    exportPath,
    createHash('sha256').update(exportBytes).digest('hex')
  )
  await chapters.close()
  chapters = undefined

  const backup = await project.backup(backupRoot)
  const logs = await repository.listCallLogs(20)

  const publicByChannel = new Map([
    [MODEL_IPC_CHANNELS.listConnections, { ok: true, data: await models.listConnections() }],
    [MODEL_IPC_CHANNELS.listProfiles, { ok: true, data: await models.listProfiles() }],
    [MODEL_IPC_CHANNELS.getBindings, { ok: true, data: await models.getBindings() }],
    [MODEL_IPC_CHANNELS.testConnection, { ok: true, data: connectionTest }]
  ])
  const modelApi = createModelApi({
    async invoke(channel) {
      return publicByChannel.get(channel)
    }
  })
  const ipcResults = [
    await modelApi.listConnections(),
    await modelApi.listProfiles(),
    await modelApi.getBindings(),
    await modelApi.testConnection({
      requestId: 'security-public-result',
      connectionId: connection.id,
      modelId: profile.modelId
    })
  ]

  assert.doesNotMatch(JSON.stringify(connection), /apiKey|secretRef/)
  assert.equal(bindings.roleBindings[0].primaryProfileId, profile.id)
  assert.equal(logs.length, 3)

  await models.shutdown()
  await project.shutdown()
  closed = true

  const rawBackup = await readFile(backup.backupPath)
  const archive = unzipSync(rawBackup)
  const unpackedBackup = Buffer.concat(Object.values(archive).map((bytes) => Buffer.from(bytes)))
  const artifacts = {
    controlDbBytes: await readMatchingFiles(sandbox, (name) => name.startsWith('control.sqlite3')),
    projectDbBytes: await readMatchingFiles(projectRoot, (name) => name.startsWith('project.sqlite3')),
    backupBytes: Buffer.concat([rawBackup, unpackedBackup]),
    exportBytes: await readFile(exportPath),
    logBytes: Buffer.from(JSON.stringify(logs)),
    ipcBytes: Buffer.from(JSON.stringify(ipcResults)),
    encryptedSecretBytes: await readMatchingFiles(secretRoot, () => true)
  }

  for (const [name, artifact] of Object.entries(artifacts)) {
    assert.equal(artifact.includes(sentinelBytes), false, `${name} must not contain the BYOK sentinel`)
  }
  assert.equal(artifacts.encryptedSecretBytes.length > 0, true)
})
