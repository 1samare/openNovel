import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RENDERER_FLUSH_IPC_CHANNELS,
  isRendererFlushRequestId
} from '../src/shared/renderer-flush.ts'
import { createRendererFlushApi } from '../src/preload/renderer-flush-api.ts'
import {
  createRendererFlushCoordinator,
  destroyWindowsForForcedExit
} from '../src/main/renderer-flush.ts'

const requestId = '123e4567-e89b-42d3-a456-426614174000'

const createIpcMain = () => {
  const listeners = new Map()
  return {
    on(channel, listener) { listeners.set(channel, listener) },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
    emit(channel, ...args) { listeners.get(channel)?.(...args) },
    listeners
  }
}

const createTarget = (sent) => ({
  getURL: () => 'file:///app/index.html#/chapters',
  isDestroyed: () => false,
  send: (channel, ...args) => sent.push([channel, ...args])
})

const senderEvent = (sender) => {
  const frame = { url: sender.getURL(), isDestroyed: () => false }
  sender.mainFrame = frame
  return { sender, senderFrame: frame }
}

test('renderer flush request ids and preload bridge accept only the fixed lifecycle contract', async () => {
  assert.equal(isRendererFlushRequestId(requestId), true)
  assert.equal(isRendererFlushRequestId('../project.sqlite3'), false)
  const listeners = new Map()
  const sent = []
  const ipcRenderer = {
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
    send: (channel, ...args) => sent.push([channel, ...args])
  }
  const api = createRendererFlushApi(ipcRenderer)
  const received = []
  const dispose = api.onFlushRequest((id) => received.push(id))

  listeners.get(RENDERER_FLUSH_IPC_CHANNELS.request)?.({}, '../secret')
  listeners.get(RENDERER_FLUSH_IPC_CHANNELS.request)?.({}, requestId)
  api.completeFlush(requestId, true)
  assert.deepEqual(received, [requestId])
  assert.deepEqual(sent, [[RENDERER_FLUSH_IPC_CHANNELS.result, requestId, true]])

  dispose()
  assert.equal(listeners.has(RENDERER_FLUSH_IPC_CHANNELS.request), false)
})

test('main coordinator resolves only an authorized matching renderer response', async () => {
  const ipcMain = createIpcMain()
  const sent = []
  const target = createTarget(sent)
  const coordinator = createRendererFlushCoordinator({
    ipcMain,
    senderPolicy: { appPageUrl: 'file:///app/index.html' },
    createRequestId: () => requestId,
    timeoutMs: 50
  })

  const pending = coordinator.requestFlush([target])
  assert.deepEqual(sent, [[RENDERER_FLUSH_IPC_CHANNELS.request, requestId]])
  const impostor = createTarget([])
  ipcMain.emit(RENDERER_FLUSH_IPC_CHANNELS.result, senderEvent(impostor), requestId, true)
  ipcMain.emit(RENDERER_FLUSH_IPC_CHANNELS.result, senderEvent(target), requestId, 'yes')
  ipcMain.emit(RENDERER_FLUSH_IPC_CHANNELS.result, senderEvent(target), requestId, true)
  assert.equal(await pending, true)

  coordinator.dispose()
  assert.equal(ipcMain.listeners.size, 0)
})

test('main coordinator reports renderer refusal and timeout without hanging shutdown', async () => {
  const ipcMain = createIpcMain()
  const firstTarget = createTarget([])
  const secondTarget = createTarget([])
  let sequence = 0
  const coordinator = createRendererFlushCoordinator({
    ipcMain,
    senderPolicy: { appPageUrl: 'file:///app/index.html' },
    createRequestId: () => sequence++ === 0
      ? requestId
      : '123e4567-e89b-42d3-a456-426614174001',
    timeoutMs: 20
  })

  const refused = coordinator.requestFlush([firstTarget])
  ipcMain.emit(RENDERER_FLUSH_IPC_CHANNELS.result, senderEvent(firstTarget), requestId, false)
  assert.equal(await refused, false)
  assert.equal(await coordinator.requestFlush([secondTarget]), false)
  coordinator.dispose()
})

test('explicit discard destroys windows without invoking a blockable close path', () => {
  const calls = []
  const window = {
    isDestroyed: () => false,
    close: () => calls.push('beforeunload-close'),
    destroy: () => calls.push('destroy')
  }

  destroyWindowsForForcedExit([window])
  assert.deepEqual(calls, ['destroy'])
})
