import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BibleRepository } from '../src/novel/bible-repository.ts'
import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'

const projectId = 'project-phase-four'
const createdAt = '2026-08-11T03:00:00.000Z'

const initializeProject = async (databasePath) => {
  const database = await DatabaseWorkerClient.open(databasePath)
  await database.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [projectId, '雨夜第十三响', createdAt, createdAt]
  )
  await database.close()
}

const deterministicDependencies = () => {
  let id = 0
  let minute = 0
  return {
    createId: () => `phase-four-${++id}`,
    now: () => `2026-08-11T03:${String(minute++).padStart(2, '0')}:00.000Z`
  }
}

const hasCode = (code) => (error) => {
  assert.equal(error?.code, code)
  return true
}

const profileDraft = {
  genre: 'urban-campus',
  audience: '青年读者',
  theme: '选择与责任',
  narrativePov: '第三人称限知',
  tone: '克制而温暖',
  styleSample: '',
  bannedExpressions: ['命运的齿轮']
}

const worldDraft = {
  kind: 'world-setting',
  title: '雨夜钟楼规则',
  summary: '钟楼只会在雨夜零点敲响十三次。',
  fields: [{ key: 'limit', label: '限制', value: '只有校史社成员能听见第十三响。' }],
  relatedEntityIds: []
}

const outlineDraft = (kind, parentId, title, position) => ({
  kind,
  parentId,
  title,
  summary: `${title}摘要`,
  goal: `${title}目标`,
  conflict: `${title}冲突`,
  turningPoint: `${title}转折`,
  hook: `${title}钩子`,
  targetWords: kind === 'chapter-plan' ? 2200 : 0,
  participantCharacterIds: [],
  position
})

test('persists user-confirmed Bible entries as append-only versions and restores history after restart', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-bible-repository-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  await initializeProject(databasePath)
  const dependencies = deterministicDependencies()
  const repository = await BibleRepository.open(databasePath, projectId, dependencies)
  t.after(async () => {
    await repository.close().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const profile = await repository.saveProfile({ expectedVersionId: null, draft: profileDraft })
  assert.equal(profile.genre, 'urban-campus')
  assert.equal(profile.authorityStatus, 'user_confirmed')
  await assert.rejects(repository.saveProfile({
    expectedVersionId: profile.currentVersionId,
    draft: { ...profileDraft, genre: 'sci-fi-future' }
  }), hasCode('BIBLE_CONFLICT'))
  await assert.rejects(repository.saveProfile({
    expectedVersionId: null,
    draft: { ...profileDraft, tone: '陈旧窗口覆盖' }
  }), hasCode('BIBLE_CONFLICT'))

  const created = await repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: worldDraft
  })
  assert.equal(created.authorityStatus, 'user_confirmed')

  const updated = await repository.saveEntry({
    entryId: created.id,
    expectedVersionId: created.currentVersionId,
    draft: { ...worldDraft, summary: '钟楼会在雨夜零点敲响十三次，并唤醒旧档案室的灯。' }
  })
  assert.equal(updated.id, created.id)
  assert.notEqual(updated.currentVersionId, created.currentVersionId)
  await assert.rejects(repository.saveEntry({
    entryId: created.id,
    expectedVersionId: created.currentVersionId,
    draft: { ...worldDraft, summary: '陈旧写入不应覆盖。' }
  }), hasCode('BIBLE_CONFLICT'))

  const versions = await repository.listVersions({ entityType: 'world-setting', entityId: created.id })
  assert.deepEqual(versions.map((version) => ({
    number: version.versionNumber,
    summary: version.snapshot.summary,
    source: version.sourceKind
  })), [
    { number: 2, summary: updated.summary, source: 'user' },
    { number: 1, summary: created.summary, source: 'user' }
  ])

  const restored = await repository.restoreVersion({
    entityType: 'world-setting',
    entityId: created.id,
    versionId: versions[1].id
  })
  assert.equal(restored.entries.find((entry) => entry.id === created.id)?.summary, created.summary)
  assert.deepEqual(
    (await repository.listVersions({ entityType: 'world-setting', entityId: created.id }))
      .map((version) => [version.sourceKind, version.restoredFromVersionId, version.authorityStatus]),
    [
      ['restore', versions[1].id, versions[1].authorityStatus],
      ['user', null, 'user_confirmed'],
      ['user', null, 'user_confirmed']
    ]
  )

  const context = await repository.authoritativeContext()
  assert.deepEqual(context.sourceVersionIds, [
    profile.currentVersionId,
    restored.entries.find((entry) => entry.id === created.id).currentVersionId
  ])
  assert.equal(JSON.stringify(context).includes('陈旧写入不应覆盖'), false)

  await repository.close()
  const reopened = await BibleRepository.open(databasePath, projectId, dependencies)
  const snapshot = await reopened.snapshot()
  assert.equal(snapshot.profile?.genre, 'urban-campus')
  assert.equal(snapshot.entries.length, 1)
  assert.equal(snapshot.entries[0].summary, created.summary)
  await reopened.close()

  const inspector = await DatabaseWorkerClient.open(databasePath, [])
  const audit = await inspector.all(
    `SELECT event_type FROM audit_events
     WHERE project_id = ? AND event_type LIKE 'bible.%' ORDER BY created_at`,
    [projectId]
  )
  assert.deepEqual(audit.map((event) => event.event_type), [
    'bible.profile.saved',
    'bible.entry.saved',
    'bible.entry.saved',
    'bible.version.restored'
  ])
  await inspector.close()
})

test('enforces story-volume-stage-chapter hierarchy and versions deterministic sibling moves', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-outline-repository-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  await initializeProject(databasePath)
  const repository = await BibleRepository.open(databasePath, projectId, deterministicDependencies())
  t.after(async () => {
    await repository.close().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await assert.rejects(repository.saveOutlineNode({
    nodeId: null,
    expectedVersionId: null,
    draft: outlineDraft('volume', null, '无父级分卷', 0)
  }), hasCode('BIBLE_INVALID_COMMAND'))

  const story = await repository.saveOutlineNode({
    nodeId: null,
    expectedVersionId: null,
    draft: outlineDraft('story', null, '故事总纲', 0)
  })
  const volume = await repository.saveOutlineNode({
    nodeId: null,
    expectedVersionId: null,
    draft: outlineDraft('volume', story.id, '第一卷', 0)
  })
  const stage = await repository.saveOutlineNode({
    nodeId: null,
    expectedVersionId: null,
    draft: outlineDraft('stage', volume.id, '调查钟楼', 0)
  })
  const chapters = []
  for (let index = 0; index < 3; index += 1) {
    chapters.push(await repository.saveOutlineNode({
      nodeId: null,
      expectedVersionId: null,
      draft: outlineDraft('chapter-plan', stage.id, `第${index + 1}章`, index)
    }))
  }

  const moved = await repository.moveOutlineNode({ nodeId: chapters[2].id, direction: 'up' })
  assert.deepEqual(
    moved.filter((node) => node.kind === 'chapter-plan').map((node) => [node.title, node.position]),
    [['第1章', 0], ['第3章', 1], ['第2章', 2]]
  )
  assert.equal((await repository.listVersions({
    entityType: 'chapter-plan',
    entityId: chapters[2].id
  })).length, 2)
  assert.equal((await repository.listVersions({
    entityType: 'chapter-plan',
    entityId: chapters[1].id
  })).length, 2)

  const movedVersions = await repository.listVersions({
    entityType: 'chapter-plan',
    entityId: chapters[2].id
  })
  const restored = await repository.restoreVersion({
    entityType: 'chapter-plan',
    entityId: chapters[2].id,
    versionId: movedVersions[1].id
  })
  assert.deepEqual(
    restored.outline.filter((node) => node.kind === 'chapter-plan').map((node) => [node.title, node.position]),
    [['第1章', 0], ['第2章', 1], ['第3章', 2]]
  )
  const latest = (await repository.listVersions({
    entityType: 'chapter-plan', entityId: chapters[2].id
  }))[0]
  assert.equal(latest.sourceKind, 'restore')
  assert.equal(latest.restoredFromVersionId, movedVersions[1].id)

  await repository.moveOutlineNode({ nodeId: chapters[2].id, direction: 'up' })
  await repository.moveOutlineNode({ nodeId: chapters[2].id, direction: 'up' })
  const beforeFailedRestore = await repository.snapshot()
  const beforeFailedVersions = await repository.listVersions({
    entityType: 'chapter-plan', entityId: chapters[2].id
  })
  const faultInstaller = await DatabaseWorkerClient.open(databasePath, [])
  const beforeFailedAudits = await faultInstaller.get(
    `SELECT COUNT(*) AS count FROM audit_events
     WHERE project_id = ? AND event_type = 'bible.version.restored'`,
    [projectId]
  )
  await faultInstaller.run(`
    CREATE TRIGGER fail_outline_restore
    BEFORE UPDATE OF position ON chapter_plans
    WHEN OLD.id = '${chapters[2].id}' AND NEW.position = 2
    BEGIN
      SELECT RAISE(ABORT, 'injected restore failure');
    END
  `)
  await faultInstaller.close()

  await assert.rejects(repository.restoreVersion({
    entityType: 'chapter-plan',
    entityId: chapters[2].id,
    versionId: movedVersions[1].id
  }), hasCode('BIBLE_INVALID_COMMAND'))
  const afterFailedRestore = await repository.snapshot()
  assert.deepEqual(
    afterFailedRestore.outline
      .filter((node) => node.kind === 'chapter-plan')
      .map((node) => [node.id, node.position, node.currentVersionId]),
    beforeFailedRestore.outline
      .filter((node) => node.kind === 'chapter-plan')
      .map((node) => [node.id, node.position, node.currentVersionId])
  )
  assert.equal((await repository.listVersions({
    entityType: 'chapter-plan', entityId: chapters[2].id
  })).length, beforeFailedVersions.length)
  const faultInspector = await DatabaseWorkerClient.open(databasePath, [])
  assert.deepEqual(await faultInspector.get(
    `SELECT COUNT(*) AS count FROM audit_events
     WHERE project_id = ? AND event_type = 'bible.version.restored'`,
    [projectId]
  ), beforeFailedAudits)
  await faultInspector.close()
})

test('validates relationship, character-state, and outline participant references', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-bible-relations-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  await initializeProject(databasePath)
  const repository = await BibleRepository.open(databasePath, projectId, deterministicDependencies())
  t.after(async () => {
    await repository.close().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const character = async (title) => repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: { kind: 'character', title, summary: '', fields: [], relatedEntityIds: [] }
  })
  const first = await character('林澈')
  const second = await character('许遥')
  await assert.rejects(repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: {
      kind: 'relationship', title: '无效关系', summary: '', fields: [],
      relatedEntityIds: [first.id, 'missing-character']
    }
  }), hasCode('BIBLE_INVALID_COMMAND'))
  const relationship = await repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: {
      kind: 'relationship', title: '共同调查', summary: '', fields: [],
      relatedEntityIds: [first.id, second.id]
    }
  })
  assert.deepEqual(relationship.relatedEntityIds, [first.id, second.id])
  await assert.rejects(repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: {
      kind: 'character-state', title: '无效状态', summary: '', fields: [],
      relatedEntityIds: [relationship.id]
    }
  }), hasCode('BIBLE_INVALID_COMMAND'))

  const story = await repository.saveOutlineNode({
    nodeId: null,
    expectedVersionId: null,
    draft: { ...outlineDraft('story', null, '人物总纲', 0), participantCharacterIds: [first.id] }
  })
  assert.deepEqual(story.participantCharacterIds, [first.id])
  await assert.rejects(repository.saveOutlineNode({
    nodeId: story.id,
    expectedVersionId: story.currentVersionId,
    draft: { ...outlineDraft('story', null, '人物总纲', 0), participantCharacterIds: [relationship.id] }
  }), hasCode('BIBLE_INVALID_COMMAND'))
})
