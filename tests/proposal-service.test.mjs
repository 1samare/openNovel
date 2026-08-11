import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BibleRepository } from '../src/novel/bible-repository.ts'
import { ProposalService } from '../src/novel/proposal-service.ts'
import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'

const projectId = 'project-phase-four'

const initializeProject = async (databasePath) => {
  const database = await DatabaseWorkerClient.open(databasePath)
  await database.transaction([
    {
      sql: `INSERT INTO projects (id, title, created_at, updated_at)
            VALUES (?, '阶段四提案测试', '2026-08-11T04:00:00.000Z', '2026-08-11T04:00:00.000Z')`,
      params: [projectId]
    }
  ])
  await database.close()
}

const deterministicDependencies = () => {
  let id = 0
  let time = 0
  return {
    createId: () => `proposal-id-${String(++id).padStart(3, '0')}`,
    now: () => new Date(Date.UTC(2026, 7, 11, 4, 0, time++)).toISOString()
  }
}

const hasCode = (code) => (error) => error?.code === code

const entryDraft = (title, summary = title) => ({
  kind: 'world-setting',
  title,
  summary,
  fields: [{ key: 'rule', label: '规则', value: summary }],
  relatedEntityIds: []
})

const settingCandidate = ({
  title,
  priority,
  operation = 'create',
  targetEntityId = null,
  sourceVersionId = null,
  summary = `${title}的候选内容`,
  conflicts = []
}) => ({
  operation,
  targetEntityId,
  sourceVersionId,
  title,
  rationale: `${title}能强化故事约束`,
  impact: `${title}将影响后续人物与剧情`,
  priority,
  affectedEntityIds: targetEntityId === null ? [] : [targetEntityId],
  conflicts,
  entry: entryDraft(title, summary)
})

const storyDraft = (title) => ({
  kind: 'story',
  parentId: null,
  title,
  summary: `${title}摘要`,
  goal: `${title}目标`,
  conflict: `${title}冲突`,
  turningPoint: `${title}转折`,
  hook: `${title}钩子`,
  targetWords: 10000,
  participantCharacterIds: [],
  position: 0
})

const withService = async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-proposal-service-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  await initializeProject(databasePath)
  const dependencies = deterministicDependencies()
  const repository = await BibleRepository.open(databasePath, projectId, dependencies)
  const service = new ProposalService(repository, dependencies)
  t.after(async () => {
    await repository.close().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })
  return { databasePath, repository, service }
}

test('curates proposals deterministically and keeps rejected candidates outside authoritative context', async (t) => {
  const { repository, service } = await withService(t)
  const proposals = await service.recordCandidates({
    sourceRunId: 'run-setting-curation',
    domain: 'setting',
    sourceVersionIds: [],
    candidates: [
      settingCandidate({ title: '低优先级', priority: 2 }),
      settingCandidate({ title: '最高优先级', priority: 5 }),
      settingCandidate({ title: '次高优先级', priority: 4 }),
      settingCandidate({ title: '第三优先级', priority: 3 })
    ]
  })

  assert.deepEqual(proposals.map((proposal) => proposal.candidate.title), [
    '最高优先级', '次高优先级', '第三优先级'
  ])
  assert.ok(proposals.every((proposal) => proposal.status === 'proposed'))
  await service.decideProposal({
    proposalId: proposals[0].id,
    decision: 'reject',
    confirmReplacement: false
  })

  const snapshot = await repository.snapshot()
  assert.equal(snapshot.proposals.find((proposal) => proposal.id === proposals[0].id)?.status, 'rejected')
  assert.deepEqual((await repository.authoritativeContext()).entries, [])
  await assert.rejects(service.decideProposal({
    proposalId: proposals[0].id,
    decision: 'approve',
    confirmReplacement: false
  }), hasCode('BIBLE_PROPOSAL_STATE'))
})

test('requires explicit replacement on the recorded baseline and rejects approval after a target changes', async (t) => {
  const { repository, service } = await withService(t)
  const original = await repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: entryDraft('星港校规', '夜间不得进入废弃天文台')
  })
  const [proposal] = await service.recordCandidates({
    sourceRunId: 'run-setting-replacement',
    domain: 'setting',
    sourceVersionIds: [original.currentVersionId],
    candidates: [settingCandidate({
      title: original.title,
      priority: 5,
      operation: 'update',
      targetEntityId: original.id,
      sourceVersionId: original.currentVersionId,
      summary: '天文台只在月蚀时开放',
      conflicts: [{
        field: 'summary',
        oldValue: original.summary,
        newValue: '天文台只在月蚀时开放',
        sourceVersionId: original.currentVersionId,
        affectedEntityIds: [original.id]
      }]
    })]
  })

  await assert.rejects(service.decideProposal({
    proposalId: proposal.id,
    decision: 'approve',
    confirmReplacement: false
  }), hasCode('BIBLE_CONFLICT'))
  assert.equal((await repository.listVersions({
    entityType: 'world-setting', entityId: original.id
  })).length, 1)

  const intervening = await repository.saveEntry({
    entryId: original.id,
    expectedVersionId: original.currentVersionId,
    draft: entryDraft(original.title, '学生会临时批准后可以进入')
  })
  await assert.rejects(service.decideProposal({
    proposalId: proposal.id,
    decision: 'approve',
    confirmReplacement: true
  }), hasCode('BIBLE_CONFLICT'))
  const unchanged = await repository.snapshot()
  const current = unchanged.entries.find((entry) => entry.id === original.id)
  assert.equal(current?.summary, intervening.summary)
  assert.equal(current?.currentVersionId, intervening.currentVersionId)

  const versions = await repository.listVersions({ entityType: 'world-setting', entityId: original.id })
  assert.equal(versions.length, 2)
  assert.equal(versions[0].sourceKind, 'user')
  assert.equal(unchanged.proposals.find((item) => item.id === proposal.id)?.status, 'proposed')
})

test('approves an explicitly confirmed replacement only while its source version is current', async (t) => {
  const { repository, service } = await withService(t)
  const original = await repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: entryDraft('夜航钟声', '每周五响一次')
  })
  const [proposal] = await service.recordCandidates({
    sourceRunId: 'run-current-replacement',
    domain: 'setting',
    sourceVersionIds: [original.currentVersionId],
    candidates: [settingCandidate({
      title: original.title,
      priority: 5,
      operation: 'update',
      targetEntityId: original.id,
      sourceVersionId: original.currentVersionId,
      summary: '仅在月蚀夜响一次'
    })]
  })

  const approved = await service.decideProposal({
    proposalId: proposal.id,
    decision: 'approve',
    confirmReplacement: true
  })
  const current = approved.entries.find((entry) => entry.id === original.id)
  assert.equal(current?.summary, '仅在月蚀夜响一次')
  assert.equal(current?.authorityStatus, 'approved')
  const versions = await repository.listVersions({ entityType: 'world-setting', entityId: original.id })
  assert.equal(versions[0].supersedesVersionId, original.currentVersionId)
  assert.equal(versions[0].proposalId, proposal.id)
})

test('derives trustworthy replacement evidence and rejects an unrelated source version', async (t) => {
  const { repository, service } = await withService(t)
  const original = await repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: entryDraft('潮汐校历', '每月最后一天停课')
  })
  const [proposal] = await service.recordCandidates({
    sourceRunId: 'run-derived-conflict',
    domain: 'setting',
    sourceVersionIds: [original.currentVersionId],
    candidates: [settingCandidate({
      title: original.title,
      priority: 5,
      operation: 'update',
      targetEntityId: original.id,
      sourceVersionId: original.currentVersionId,
      summary: '每月最后一天进行潮汐演习',
      conflicts: []
    })]
  })
  const summaryConflict = proposal.candidate.conflicts.find((conflict) => conflict.field === 'summary')
  assert.deepEqual(summaryConflict, {
    field: 'summary',
    oldValue: '每月最后一天停课',
    newValue: '每月最后一天进行潮汐演习',
    sourceVersionId: original.currentVersionId,
    affectedEntityIds: [original.id]
  })

  const unrelated = await repository.saveEntry({
    entryId: null,
    expectedVersionId: null,
    draft: entryDraft('无关校规', '仅用于来源校验')
  })
  await assert.rejects(service.recordCandidates({
    sourceRunId: 'run-forged-source',
    domain: 'setting',
    sourceVersionIds: [unrelated.currentVersionId],
    candidates: [settingCandidate({
      title: original.title,
      priority: 5,
      operation: 'update',
      targetEntityId: original.id,
      sourceVersionId: unrelated.currentVersionId,
      summary: '伪造来源不得入库',
      conflicts: []
    })]
  }), hasCode('BIBLE_INVALID_COMMAND'))
})

test('rolls back the proposal decision when an approved outline candidate violates storage constraints', async (t) => {
  const { repository, service } = await withService(t)
  await repository.saveOutlineNode({
    nodeId: null,
    expectedVersionId: null,
    draft: storyDraft('既有总纲')
  })
  const [proposal] = await service.recordCandidates({
    sourceRunId: 'run-plot-rollback',
    domain: 'plot',
    sourceVersionIds: (await repository.authoritativeContext()).sourceVersionIds,
    candidates: [{
      operation: 'create',
      targetEntityId: null,
      sourceVersionId: null,
      title: '冲突总纲',
      rationale: '验证事务边界',
      impact: '与既有总纲位置冲突',
      priority: 5,
      affectedEntityIds: [],
      conflicts: [],
      outline: storyDraft('冲突总纲')
    }]
  })

  await assert.rejects(service.decideProposal({
    proposalId: proposal.id,
    decision: 'approve',
    confirmReplacement: false
  }), hasCode('BIBLE_INVALID_COMMAND'))
  const snapshot = await repository.snapshot()
  assert.equal(snapshot.outline.length, 1)
  assert.equal(snapshot.proposals.find((item) => item.id === proposal.id)?.status, 'proposed')
  assert.equal((await repository.listVersions({ entityType: 'story', entityId: snapshot.outline[0].id })).length, 1)
})
