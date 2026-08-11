import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ModelDomainError } from '../src/shared/model.ts'
import { NOVEL_BIBLE_IPC_CHANNELS } from '../src/shared/novel.ts'
import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { registerBibleIpcHandlers } from '../src/main/bible-ipc.ts'
import { createBibleRuntime } from '../src/main/bible-runtime.ts'
import { createBibleApi } from '../src/preload/bible-api.ts'

const senderFor = (url, { topLevel = true } = {}) => {
  const mainFrame = { url, isDestroyed: () => false }
  return {
    sender: { getURL: () => url, isDestroyed: () => false, mainFrame },
    senderFrame: topLevel ? mainFrame : { url, isDestroyed: () => false }
  }
}

const profileDraft = {
  genre: 'urban-campus',
  audience: '青年读者',
  theme: '选择与责任',
  narrativePov: '第三人称限知',
  tone: '克制悬疑',
  styleSample: '',
  bannedExpressions: []
}

const initializeProject = async (root, projectId) => {
  await mkdir(root, { recursive: true })
  const database = await DatabaseWorkerClient.open(join(root, 'project.sqlite3'))
  await database.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [projectId, projectId, '2026-08-11T06:00:00.000Z', '2026-08-11T06:00:00.000Z']
  )
  await database.close()
}

test('registers ten fixed Bible handlers and rejects unauthorized, extra-argument, and malformed runtime results', async () => {
  const handlers = new Map()
  let runtimeCalls = 0
  const runtime = new Proxy({
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' }
  }, {
    get(target, key) {
      if (key in target) return target[key]
      return async () => {
        runtimeCalls += 1
        return key === 'getSnapshot'
          ? { ok: true, data: { projectId: 'leak', databasePath: 'C:\\private\\project.sqlite3' } }
          : { ok: true, data: null }
      }
    }
  })
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel)
  }
  const dispose = registerBibleIpcHandlers(ipcMain, runtime)
  assert.equal(registerBibleIpcHandlers(ipcMain, runtime), dispose)
  assert.deepEqual([...handlers.keys()].sort(), Object.values(NOVEL_BIBLE_IPC_CHANNELS).sort())

  const unauthorized = await handlers.get(NOVEL_BIBLE_IPC_CHANNELS.getSnapshot)(
    senderFor('file:///app/renderer/foreign.html')
  )
  assert.equal(unauthorized.error.code, 'BIBLE_IPC_NOT_AUTHORIZED')
  assert.equal(runtimeCalls, 0)
  const invalid = await handlers.get(NOVEL_BIBLE_IPC_CHANNELS.saveProfile)(
      senderFor('file:///app/renderer/index.html'), {
        expectedVersionId: null, draft: { ...profileDraft, apiKey: 'sk-leak' }
      }
  )
  assert.equal(invalid.error.code, 'BIBLE_INVALID_COMMAND')
  assert.equal(runtimeCalls, 0)
  const malformed = await handlers.get(NOVEL_BIBLE_IPC_CHANNELS.getSnapshot)(
    senderFor('file:///app/renderer/index.html')
  )
  assert.equal(malformed.error.code, 'BIBLE_OPERATION_FAILED')
  assert.doesNotMatch(JSON.stringify(malformed), /private|sqlite|databasePath/i)
  dispose()
  dispose()
  assert.equal(handlers.size, 0)
})

test('switches project storage, locks generation request ids, cancels work, and waits during close', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-bible-runtime-'))
  const firstRoot = join(sandbox, 'first')
  const secondRoot = join(sandbox, 'second')
  await initializeProject(firstRoot, 'project-first')
  await initializeProject(secondRoot, 'project-second')
  let current = {
    projectId: 'project-first', title: '第一本', root: firstRoot,
    createdAt: '2026-08-11T06:00:00.000Z', updatedAt: '2026-08-11T06:00:00.000Z'
  }
  const projectListeners = new Set()
  const projectAccessor = {
    current: () => current,
    subscribe(listener) {
      projectListeners.add(listener)
      return () => projectListeners.delete(listener)
    }
  }
  const switchProject = (summary) => {
    current = summary
    for (const listener of projectListeners) listener(summary)
  }
  const order = []
  let confirmClosingStarted
  const closingStarted = new Promise((resolve) => { confirmClosingStarted = resolve })
  const runtime = createBibleRuntime({
    project: projectAccessor,
    coauthor: {
      async generate(input) {
        if (input.signal.aborted) {
          throw new ModelDomainError('MODEL_CANCELLED', 'private cancelled')
        }
        if (input.prompt.includes('泄露')) {
          throw new Error('C:\\private\\project.sqlite3 SELECT apiKey=sk-secret')
        }
        if (!input.prompt.includes('等待')) return { proposals: [] }
        order.push('generation.started')
        if (input.prompt.includes('等待关闭')) confirmClosingStarted()
        await new Promise((resolve, reject) => {
          input.signal.addEventListener('abort', () => {
            order.push('generation.aborted')
            reject(new ModelDomainError('MODEL_CANCELLED', 'private cancelled'))
          }, { once: true })
        })
      }
    },
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' }
  })
  t.after(async () => {
    await runtime.close().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  assert.equal((await runtime.getSnapshot()).data.projectId, 'project-first')
  assert.equal((await runtime.saveProfile({ expectedVersionId: null, draft: profileDraft })).ok, true)
  const pending = runtime.generateProposals({
    requestId: 'request-hold-one', domain: 'setting', mode: 'standard',
    request: '等待取消', targetEntityId: null
  })
  await new Promise((resolve) => setImmediate(resolve))
  const duplicate = await runtime.generateProposals({
    requestId: 'request-hold-one', domain: 'setting', mode: 'standard',
    request: '等待取消', targetEntityId: null
  })
  assert.equal(duplicate.error.code, 'BIBLE_INVALID_COMMAND')
  assert.deepEqual(await runtime.cancelGeneration('request-hold-one'), { ok: true, data: null })
  assert.equal((await pending).error.code, 'BIBLE_GENERATION_CANCELLED')

  const switchingGeneration = runtime.generateProposals({
    requestId: 'request-switch-one', domain: 'setting', mode: 'standard',
    request: '等待项目切换', targetEntityId: null
  })
  await new Promise((resolve) => setImmediate(resolve))
  switchProject({
    projectId: 'project-second', title: '第二本', root: secondRoot,
    createdAt: '2026-08-11T06:00:00.000Z', updatedAt: '2026-08-11T06:00:00.000Z'
  })
  assert.equal((await switchingGeneration).error.code, 'BIBLE_GENERATION_CANCELLED')
  const switched = await runtime.getSnapshot()
  assert.equal(switched.data.projectId, 'project-second')
  assert.equal(switched.data.profile, null)
  await runtime.saveProfile({ expectedVersionId: null, draft: profileDraft })
  const leaked = await runtime.generateProposals({
    requestId: 'request-private-one', domain: 'setting', mode: 'standard',
    request: '泄露错误', targetEntityId: null
  })
  assert.equal(leaked.error.code, 'BIBLE_OPERATION_FAILED')
  assert.doesNotMatch(JSON.stringify(leaked), /private|sqlite|SELECT|apiKey|sk-secret/i)

  const closingGeneration = runtime.generateProposals({
    requestId: 'request-hold-two', domain: 'setting', mode: 'standard',
    request: '等待关闭', targetEntityId: null
  })
  await closingStarted
  const closing = runtime.close().then(() => order.push('runtime.closed'))
  const duringClose = await runtime.getSnapshot()
  assert.equal(duringClose.error.code, 'BIBLE_NOT_AVAILABLE')
  await closingGeneration
  await closing
  assert.deepEqual(order.slice(-3), [
    'generation.started', 'generation.aborted', 'runtime.closed'
  ])
  assert.equal((await runtime.getSnapshot()).error.code, 'BIBLE_NOT_AVAILABLE')
  switchProject({
    projectId: 'project-first', title: '第一本', root: firstRoot,
    createdAt: '2026-08-11T06:00:00.000Z', updatedAt: '2026-08-11T06:00:00.000Z'
  })
  assert.equal((await runtime.getSnapshot()).data.projectId, 'project-first')
})

test('preload exposes ten named Bible methods and rejects malformed success payloads', async () => {
  const invocations = []
  const ipcRenderer = {
    async invoke(channel, ...args) {
      invocations.push([channel, ...args])
      if (channel === NOVEL_BIBLE_IPC_CHANNELS.getSnapshot) {
        return { ok: true, data: { projectId: 'x', sql: 'SELECT secret' } }
      }
      if (channel === NOVEL_BIBLE_IPC_CHANNELS.listVersions ||
        channel === NOVEL_BIBLE_IPC_CHANNELS.generateProposals) {
        return { ok: true, data: [] }
      }
      if (channel === NOVEL_BIBLE_IPC_CHANNELS.cancelGeneration) {
        return { ok: true, data: null }
      }
      return { ok: false, error: { code: 'BIBLE_CONFLICT', message: '安全错误', retryable: false } }
    }
  }
  const api = createBibleApi(ipcRenderer)
  assert.deepEqual(Object.keys(api).sort(), [
    'cancelGeneration', 'decideProposal', 'generateProposals', 'getSnapshot',
    'listVersions', 'moveOutlineNode', 'restoreVersion', 'saveEntry',
    'saveOutlineNode', 'saveProfile'
  ])
  assert.equal((await api.getSnapshot()).error.code, 'BIBLE_OPERATION_FAILED')
  assert.deepEqual(await api.listVersions({ entityType: 'novel-profile', entityId: 'profile-one' }), {
    ok: true, data: []
  })
  assert.deepEqual(await api.generateProposals({
    requestId: 'request-one', domain: 'setting', mode: 'standard', request: '完善设定', targetEntityId: null
  }), { ok: true, data: [] })
  assert.deepEqual(await api.cancelGeneration('request-one'), { ok: true, data: null })
  assert.equal(invocations.length, 4)
})
