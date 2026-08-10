import assert from 'node:assert/strict'
import test from 'node:test'

import { registerChapterIpcHandlers } from '../src/main/chapter-ipc.ts'
import { createChapterApi } from '../src/preload/chapter-api.ts'
import {
  CHAPTER_IPC_CHANNELS,
  validateChapterCommand
} from '../src/shared/chapter.ts'

const senderFor = (url) => {
  const mainFrame = { url, isDestroyed: () => false }
  return {
    sender: { getURL: () => url, isDestroyed: () => false, mainFrame },
    senderFrame: mainFrame
  }
}

test('validates exact arguments for every fixed chapter command', () => {
  const create = { kind: 'chapter', parentId: null, title: '第一章' }
  const preview = {
    sourceName: '第一章.txt',
    format: 'txt',
    mode: 'single-chapter',
    referenceContent: null,
    chapters: [{ title: '第一章', content: '正文。', characterCount: 2 }]
  }
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.list, []), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.create, [create]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.rename, [{ chapterId: 'chapter-1', title: '新标题' }]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.move, [{ chapterId: 'chapter-1', parentId: null, position: 0 }]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.remove, ['chapter-1']), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.load, ['chapter-1']), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.saveDraft, [{ chapterId: 'chapter-1', content: '正文', expectedRevision: 0 }]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.confirmVersion, ['chapter-1']), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.listVersions, ['chapter-1']), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.restoreVersion, [{ chapterId: 'chapter-1', versionId: 'version-1' }]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.previewImport, [{ mode: 'split-chapters', text: null, sourceName: null }]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.confirmImport, [preview]), true)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.exportBook, ['docx']), true)

  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.create, [{ ...create, root: 'D:\\secret' }]), false)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.saveDraft, [{ chapterId: 'chapter-1', content: '正文', expectedRevision: -1 }]), false)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.previewImport, [{ mode: 'reference', text: null, sourceName: null, path: 'D:\\secret' }]), false)
  assert.equal(validateChapterCommand(CHAPTER_IPC_CHANNELS.exportBook, ['epub']), false)
  assert.equal(validateChapterCommand('chapters:unknown', []), false)
})

test('registers only fixed handlers and rejects unauthorized senders', async () => {
  const handlers = new Map()
  const runtime = new Proxy({ senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' } }, {
    get(target, key) {
      if (key in target) return target[key]
      return () => assert.fail('unauthorized request reached runtime')
    }
  })
  registerChapterIpcHandlers({
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: () => undefined
  }, runtime)

  assert.deepEqual([...handlers.keys()].sort(), Object.values(CHAPTER_IPC_CHANNELS).sort())
  const result = await handlers.get(CHAPTER_IPC_CHANNELS.list)(senderFor('file:///foreign.html'))
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'IPC_NOT_AUTHORIZED', message: 'Chapter command is not authorized' }
  })
})

test('preload exposes only named chapter methods and rejects malformed results', async () => {
  const invocations = []
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args)
      return args[0] === CHAPTER_IPC_CHANNELS.list
        ? { ok: true, data: [{ id: 'missing-fields' }] }
        : { ok: true, data: null }
    }
  }
  const api = createChapterApi(ipcRenderer)
  assert.deepEqual(Object.keys(api).sort(), [
    'confirmImport',
    'confirmVersion',
    'create',
    'exportBook',
    'list',
    'listVersions',
    'load',
    'move',
    'previewImport',
    'remove',
    'rename',
    'restoreVersion',
    'saveDraft'
  ])
  const malformed = await api.list()
  assert.equal(malformed.ok, false)
  assert.equal(malformed.error.code, 'CHAPTER_OPERATION_FAILED')
  assert.deepEqual(invocations, [[CHAPTER_IPC_CHANNELS.list]])
})
