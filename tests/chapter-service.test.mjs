import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { ChapterService } from '../src/novel/chapter-service.ts'
import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

const hasCode = (code) => (error) => {
  assert.equal(error instanceof ProjectDomainError, true)
  assert.equal(error.code, code)
  return true
}

const openService = async (t, prefix = 'open-novel-chapters-') => {
  const sandbox = await mkdtemp(join(tmpdir(), prefix))
  const databasePath = join(sandbox, 'project.sqlite3')
  const database = await DatabaseWorkerClient.open(databasePath)
  await database.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['project-1', '星海来信', '2026-08-10T03:00:00.000Z', '2026-08-10T03:00:00.000Z']
  )
  await database.close()
  let nextId = 0
  let nextSecond = 0
  const service = await ChapterService.open(databasePath, 'project-1', {
    createId: () => `generated-${++nextId}`,
    now: () => `2026-08-10T03:00:${String(nextSecond++).padStart(2, '0')}.000Z`
  })
  t.after(async () => {
    await service.close()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })
  return service
}

test('creates a valid volume/chapter tree and keeps stable sibling positions', async (t) => {
  const service = await openService(t)
  const volume = await service.create({ kind: 'volume', title: '  第一卷  ' })
  const first = await service.create({ kind: 'chapter', parentId: volume.chapter.id, title: '第一章' })
  const second = await service.create({ kind: 'chapter', parentId: volume.chapter.id, title: '第二章' })
  const standalone = await service.create({ kind: 'chapter', title: '序章' })

  assert.equal(volume.chapter.title, '第一卷')
  assert.deepEqual((await service.listTree()).map(({ title, parentId, position }) => ({
    title,
    parentId,
    position
  })), [
    { title: '第一卷', parentId: null, position: 0 },
    { title: '第一章', parentId: volume.chapter.id, position: 0 },
    { title: '第二章', parentId: volume.chapter.id, position: 1 },
    { title: '序章', parentId: null, position: 1 }
  ])

  await service.move(second.chapter.id, volume.chapter.id, 0)
  assert.deepEqual((await service.listTree()).filter((item) => item.parentId === volume.chapter.id)
    .map(({ id, position }) => ({ id, position })), [
    { id: second.chapter.id, position: 0 },
    { id: first.chapter.id, position: 1 }
  ])
  assert.equal((await service.rename(standalone.chapter.id, '  楔子  ')).title, '楔子')

  await assert.rejects(
    service.create({ kind: 'volume', parentId: volume.chapter.id, title: '嵌套卷' }),
    hasCode('INVALID_CHAPTER_HIERARCHY')
  )
  await assert.rejects(service.remove(volume.chapter.id), hasCode('CHAPTER_HAS_CHILDREN'))
})

test('saves drafts with optimistic revisions and preserves the winning content', async (t) => {
  const service = await openService(t, 'open-novel-drafts-')
  const created = await service.create({ kind: 'chapter', title: '第一章' })

  assert.deepEqual(await service.load(created.chapter.id), created)
  const saved = await service.saveDraft({
    chapterId: created.chapter.id,
    content: '雨落在旧站台。',
    expectedRevision: 0
  })
  assert.equal(saved.draftRevision, 1)
  assert.equal(saved.characterCount, 6)

  await assert.rejects(service.saveDraft({
    chapterId: created.chapter.id,
    content: '这份过期稿不能覆盖。',
    expectedRevision: 0
  }), hasCode('CHAPTER_SAVE_CONFLICT'))
  assert.equal((await service.load(created.chapter.id)).content, '雨落在旧站台。')
})

test('allows exactly one concurrent draft compare-and-swap winner', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-draft-cas-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  const database = await DatabaseWorkerClient.open(databasePath)
  await database.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['project-1', '星海来信', '2026-08-10T03:00:00.000Z', '2026-08-10T03:00:00.000Z']
  )
  await database.close()
  let id = 0
  const dependencies = {
    createId: () => `cas-generated-${++id}`,
    now: () => '2026-08-10T03:00:00.000Z'
  }
  const firstService = await ChapterService.open(databasePath, 'project-1', dependencies)
  const secondService = await ChapterService.open(databasePath, 'project-1', dependencies)
  t.after(async () => {
    await Promise.all([firstService.close(), secondService.close()])
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })
  const chapter = await firstService.create({ kind: 'chapter', title: '第一章' })
  const blocker = new DatabaseSync(databasePath)
  blocker.exec('BEGIN IMMEDIATE')
  const saves = [
    firstService.saveDraft({ chapterId: chapter.chapter.id, content: '甲稿', expectedRevision: 0 }),
    secondService.saveDraft({ chapterId: chapter.chapter.id, content: '乙稿', expectedRevision: 0 })
  ]
  await new Promise((resolve) => setTimeout(resolve, 80))
  blocker.exec('COMMIT')
  blocker.close()

  const results = await Promise.allSettled(saves)
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  const loser = results.find(({ status }) => status === 'rejected')
  assert.equal(loser?.status, 'rejected')
  assert.equal(loser.reason instanceof ProjectDomainError, true)
  assert.equal(loser.reason.code, 'CHAPTER_SAVE_CONFLICT')
  const winningContent = results.find(({ status }) => status === 'fulfilled').value.content
  assert.equal((await firstService.load(chapter.chapter.id)).content, winningContent)
})

test('confirms immutable versions and restores history into a new draft revision', async (t) => {
  const service = await openService(t, 'open-novel-versions-')
  const created = await service.create({ kind: 'chapter', title: '第一章' })
  await service.saveDraft({ chapterId: created.chapter.id, content: '第一版。', expectedRevision: 0 })
  const first = await service.confirm(created.chapter.id)
  await service.saveDraft({ chapterId: created.chapter.id, content: '第二版。', expectedRevision: 1 })
  const second = await service.confirm(created.chapter.id)

  const versions = await service.listVersions(created.chapter.id)
  assert.deepEqual(versions.map(({ id, status, content }) => ({ id, status, content })), [
    { id: second.id, status: 'confirmed', content: '第二版。' },
    { id: first.id, status: 'superseded', content: '第一版。' }
  ])

  const restored = await service.restoreVersion(created.chapter.id, first.id)
  assert.equal(restored.content, '第一版。')
  assert.equal(restored.draftRevision, 3)
  assert.equal((await service.listVersions(created.chapter.id)).length, 2)
})

test('lists a 300 chapter project in deterministic tree order', async (t) => {
  const service = await openService(t, 'open-novel-300-chapters-')
  const volume = await service.create({ kind: 'volume', title: '长篇' })
  for (let index = 1; index <= 300; index += 1) {
    await service.create({
      kind: 'chapter',
      parentId: volume.chapter.id,
      title: `第${index}章`
    })
  }

  const tree = await service.listTree()
  assert.equal(tree.length, 301)
  assert.equal(tree[1].title, '第1章')
  assert.equal(tree[300].title, '第300章')
  assert.equal(tree[300].position, 299)
})
