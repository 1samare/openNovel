import assert from 'node:assert/strict'
import test from 'node:test'

import { registerProjectIpcHandlers } from '../src/main/project-ipc.ts'
import {
  createProjectRuntime,
  createProjectShutdownGate
} from '../src/main/project-runtime.ts'
import { createProjectApi } from '../src/preload/project-api.ts'
import {
  PROJECT_IPC_CHANNELS,
  validateProjectCommand
} from '../src/shared/project.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

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

const summary = {
  projectId: 'project-1',
  title: '星海来信',
  root: 'D:\\Novels\\Star',
  createdAt: '2026-08-07T08:00:00.000Z',
  updatedAt: '2026-08-07T08:00:00.000Z'
}

test('validates the exact argument shape for every fixed project command', () => {
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.listRecent, []), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.create, ['星海来信']), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.open, []), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.openRecent, ['project-1']), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.close, []), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.rename, ['新书名']), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.backup, []), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.restoreBackup, []), true)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.removeRecent, ['project-1']), true)

  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.create, []), false)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.open, ['D:\\arbitrary']), false)
  assert.equal(validateProjectCommand(PROJECT_IPC_CHANNELS.openRecent, ['']), false)
  assert.equal(validateProjectCommand('projects:unknown', []), false)
})

test('registers only fixed handlers and rejects an unauthorized sender before runtime access', async () => {
  const handlers = new Map()
  const runtime = new Proxy({
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' }
  }, {
    get(target, key) {
      if (key in target) return target[key]
      return () => assert.fail('unauthorized request reached the project runtime')
    }
  })
  registerProjectIpcHandlers({
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: () => undefined
  }, runtime)

  assert.deepEqual([...handlers.keys()].sort(), Object.values(PROJECT_IPC_CHANNELS).sort())
  const result = await handlers.get(PROJECT_IPC_CHANNELS.listRecent)(
    senderFor('file:///app/renderer/foreign.html')
  )
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'IPC_NOT_AUTHORIZED',
      message: 'Project command is not authorized'
    }
  })
})

test('uses system-selected or registered paths and confirms stale-lock recovery', async () => {
  const opened = []
  const closeOrder = []
  let createSelections = 0
  let staleAttempts = 0
  const service = {
    listRecent: async () => [{
      projectId: 'project-1',
      title: '星海来信',
      projectPath: 'D:\\Novels\\Star',
      lastOpenedAt: '2026-08-07T08:00:00.000Z',
      pathAvailable: true
    }],
    create: async ({ root, title }) => ({ ...summary, root, title }),
    open: async ({ root, recoverStaleLock }) => {
      opened.push(root)
      if (root === 'D:\\Selected\\Existing' && staleAttempts++ === 0) {
        throw new ProjectDomainError('STALE_PROJECT_LOCK', 'private path detail')
      }
      assert.equal(root === 'D:\\Selected\\Existing' ? recoverStaleLock : undefined, root === 'D:\\Selected\\Existing' ? true : undefined)
      return { ...summary, root }
    },
    close: async () => { closeOrder.push('project') },
    rename: async (title) => ({ ...summary, title }),
    backup: async (root) => ({
      projectId: 'project-1',
      backupPath: root,
      createdAt: '2026-08-07T08:00:00.000Z'
    }),
    restore: async ({ backupRoot, destinationRoot }) => ({
      ...summary,
      root: destinationRoot,
      restoredFrom: backupRoot
    }),
    removeRecent: async () => undefined,
    shutdown: async () => undefined
  }
  const dialogs = {
    chooseDirectory: async (purpose) => {
      if (purpose === 'create') return createSelections++ === 0 ? undefined : 'D:\\Selected\\New'
      if (purpose === 'open') return 'D:\\Selected\\Existing'
      if (purpose === 'backup') return 'D:\\Selected\\Backups'
      if (purpose === 'restore-backup') return 'D:\\Selected\\BackupItem'
      return 'D:\\Selected\\Restored'
    },
    confirmStaleLock: async () => true
  }
  const runtime = createProjectRuntime({
    service,
    dialogs,
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    beforeProjectClose: async () => { closeOrder.push('chapters') }
  })

  assert.deepEqual(await runtime.create('取消的新书'), { ok: true, data: null })
  assert.equal((await runtime.create('新书')).data.root, 'D:\\Selected\\New')
  assert.equal((await runtime.open()).data.root, 'D:\\Selected\\Existing')
  assert.equal((await runtime.openRecent('project-1')).data.root, 'D:\\Novels\\Star')
  assert.equal((await runtime.openRecent('not-registered')).error.code, 'PROJECT_NOT_FOUND')
  assert.deepEqual(opened, ['D:\\Selected\\Existing', 'D:\\Selected\\Existing', 'D:\\Novels\\Star'])
  assert.equal((await runtime.backup()).data.backupPath, 'D:\\Selected\\Backups')
  assert.equal((await runtime.restoreBackup()).data.root, 'D:\\Selected\\Restored')
  assert.deepEqual(await runtime.close(), { ok: true, data: null })
  assert.deepEqual(closeOrder, ['chapters', 'project'])
})

test('preload exposes only named project methods and rejects malformed bridge results', async () => {
  const invocations = []
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args)
      if (args[0] === PROJECT_IPC_CHANNELS.rename) return { unexpected: true }
      if (args[0] === PROJECT_IPC_CHANNELS.listRecent) {
        return { ok: true, data: [{ projectId: 'missing-required-fields' }] }
      }
      return { ok: true, data: null }
    }
  }
  const api = createProjectApi(ipcRenderer)

  assert.deepEqual(Object.keys(api).sort(), [
    'backup',
    'close',
    'create',
    'listRecent',
    'open',
    'openRecent',
    'removeRecent',
    'rename',
    'restoreBackup'
  ])
  await api.create('星海来信')
  const malformed = await api.rename('新书名')
  const malformedRecent = await api.listRecent()
  assert.deepEqual(invocations, [
    [PROJECT_IPC_CHANNELS.create, '星海来信'],
    [PROJECT_IPC_CHANNELS.rename, '新书名'],
    [PROJECT_IPC_CHANNELS.listRecent]
  ])
  assert.deepEqual(malformed, {
    ok: false,
    error: {
      code: 'PROJECT_OPERATION_FAILED',
      message: 'Project bridge returned an invalid result'
    }
  })
  assert.deepEqual(malformedRecent, malformed)
})

test('normalizes thrown paths and waits for one asynchronous shutdown before quitting', async () => {
  let releaseShutdown
  let shutdownCalls = 0
  let quitCalls = 0
  const gate = createProjectShutdownGate({
    shutdown: async () => {
      shutdownCalls += 1
      await new Promise((resolve) => { releaseShutdown = resolve })
    },
    requestQuit: () => { quitCalls += 1 }
  })
  let prevented = 0
  const event = { preventDefault: () => { prevented += 1 } }

  gate(event)
  gate(event)
  assert.equal(shutdownCalls, 1)
  assert.equal(prevented, 2)
  assert.equal(quitCalls, 0)
  releaseShutdown()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(quitCalls, 1)
  gate(event)
  assert.equal(prevented, 2)

  const shutdownOrder = []
  const failingGate = createProjectShutdownGate({
    shutdown: async () => { throw new Error('database close failed') },
    onFailure: async () => { shutdownOrder.push('reported') },
    requestQuit: () => { shutdownOrder.push('quit') }
  })
  failingGate({ preventDefault: () => undefined })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(shutdownOrder, ['reported', 'quit'])

  let retryAttempts = 0
  let retryQuitCalls = 0
  const retryGate = createProjectShutdownGate({
    shutdown: async () => {
      retryAttempts += 1
      if (retryAttempts === 1) throw new Error('renderer refused to flush')
    },
    onFailure: async () => false,
    requestQuit: () => { retryQuitCalls += 1 }
  })
  retryGate(event)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(retryQuitCalls, 0)
  retryGate(event)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(retryAttempts, 2)
  assert.equal(retryQuitCalls, 1)

  const runtime = createProjectRuntime({
    service: {
      rename: async () => { throw new Error('C:\\Users\\secret\\project.sqlite3') }
    },
    dialogs: {},
    senderPolicy: {}
  })
  const result = await runtime.rename('新书名')
  assert.equal(result.ok, false)
  assert.equal(result.error.message, 'Project operation failed')
  assert.doesNotMatch(JSON.stringify(result), /Users|secret|sqlite|stack/i)
})
