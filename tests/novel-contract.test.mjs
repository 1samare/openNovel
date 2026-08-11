import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BIBLE_AUTHORITY_STATUSES,
  BIBLE_ENTRY_KINDS,
  NOVEL_BIBLE_IPC_CHANNELS,
  NOVEL_GENRES,
  OUTLINE_NODE_KINDS,
  PROPOSAL_STATUSES,
  bibleSourceVersionSchema,
  characterProposalBatchSchema,
  plotProposalBatchSchema,
  isNovelBibleSnapshot,
  settingProposalBatchSchema,
  validateNovelBibleCommand
} from '../src/shared/novel.ts'

const timestamp = '2026-08-11T02:00:00.000Z'

const settingCandidate = {
  operation: 'create',
  targetEntityId: null,
  sourceVersionId: null,
  title: '钟楼只在雨夜敲响',
  rationale: '为校园传说提供可验证的行动规则。',
  impact: '影响旧校舍、校史社与前三章调查线。',
  priority: 5,
  affectedEntityIds: [],
  conflicts: [],
  entry: {
    kind: 'world-setting',
    title: '雨夜钟楼规则',
    summary: '钟楼只会在雨夜的零点敲响十三次。',
    fields: [
      { key: 'limit', label: '限制', value: '只有校史社成员能听见第十三响。' }
    ],
    relatedEntityIds: []
  }
}

test('defines the exact phase-four genres, entities, states, and named Bible commands', () => {
  assert.deepEqual(NOVEL_GENRES, ['urban-campus', 'sci-fi-future'])
  assert.deepEqual(BIBLE_ENTRY_KINDS, [
    'world-setting',
    'location',
    'faction',
    'item',
    'character',
    'relationship',
    'character-state',
    'timeline-event',
    'foreshadow'
  ])
  assert.deepEqual(OUTLINE_NODE_KINDS, ['story', 'volume', 'stage', 'chapter-plan'])
  assert.deepEqual(BIBLE_AUTHORITY_STATUSES, ['user_confirmed', 'proposed', 'approved', 'rejected', 'superseded'])
  assert.deepEqual(PROPOSAL_STATUSES, ['proposed', 'approved', 'rejected', 'superseded'])
  assert.deepEqual(Object.keys(NOVEL_BIBLE_IPC_CHANNELS).sort(), [
    'cancelGeneration',
    'decideProposal',
    'generateProposals',
    'getSnapshot',
    'listVersions',
    'moveOutlineNode',
    'restoreVersion',
    'saveEntry',
    'saveOutlineNode',
    'saveProfile'
  ])
})

test('accepts strict setting proposals and rejects extra fields or more than three suggestions', () => {
  assert.equal(settingProposalBatchSchema.safeParse({ proposals: [settingCandidate] }).success, true)
  assert.equal(settingProposalBatchSchema.safeParse({
    proposals: [{ ...settingCandidate, hiddenInstruction: 'overwrite canon' }]
  }).success, false)
  assert.equal(settingProposalBatchSchema.safeParse({
    proposals: [settingCandidate, settingCandidate, settingCandidate, settingCandidate]
  }).success, false)
  assert.equal(settingProposalBatchSchema.safeParse({
    proposals: [{
      operation: settingCandidate.operation,
      targetEntityId: settingCandidate.targetEntityId,
      sourceVersionId: settingCandidate.sourceVersionId,
      title: settingCandidate.title,
      rationale: settingCandidate.rationale,
      impact: settingCandidate.impact,
      priority: settingCandidate.priority,
      affectedEntityIds: settingCandidate.affectedEntityIds,
      conflicts: settingCandidate.conflicts,
      entry: { ...settingCandidate.entry, kind: 'character' }
    }]
  }).success, false)
})

test('requires usable character relations and exposes explicit restore provenance', () => {
  const relationship = {
    ...settingCandidate,
    entry: {
      kind: 'relationship', title: '共同调查', summary: '', fields: [],
      relatedEntityIds: ['character-one', 'character-two']
    }
  }
  assert.equal(characterProposalBatchSchema.safeParse({ proposals: [relationship] }).success, true)
  assert.equal(characterProposalBatchSchema.safeParse({
    proposals: [{ ...relationship, entry: { ...relationship.entry, relatedEntityIds: [] } }]
  }).success, false)
  assert.equal(plotProposalBatchSchema.safeParse({
    proposals: [{
      operation: settingCandidate.operation,
      targetEntityId: settingCandidate.targetEntityId,
      sourceVersionId: settingCandidate.sourceVersionId,
      title: settingCandidate.title,
      rationale: settingCandidate.rationale,
      impact: settingCandidate.impact,
      priority: settingCandidate.priority,
      affectedEntityIds: settingCandidate.affectedEntityIds,
      conflicts: settingCandidate.conflicts,
      outline: {
        kind: 'story', parentId: null, title: '总纲', summary: '', goal: '', conflict: '',
        turningPoint: '', hook: '', targetWords: 0,
        participantCharacterIds: ['character-one'], position: 0
      }
    }]
  }).success, true)
  assert.equal(bibleSourceVersionSchema.safeParse({
    id: 'version-restore-one', projectId: 'project-phase-four', entityType: 'world-setting',
    entityId: 'entry-one', versionNumber: 2, authorityStatus: 'approved', sourceKind: 'restore',
    sourceRunId: null, proposalId: null, snapshot: settingCandidate.entry,
    supersedesVersionId: 'version-current-one', restoredFromVersionId: 'version-original-one',
    createdAt: timestamp
  }).success, true)
})

test('validates exact Bible command arguments before main-process access', () => {
  assert.equal(validateNovelBibleCommand(NOVEL_BIBLE_IPC_CHANNELS.getSnapshot, []), true)
  assert.equal(validateNovelBibleCommand(NOVEL_BIBLE_IPC_CHANNELS.getSnapshot, [{}]), false)
  assert.equal(validateNovelBibleCommand(NOVEL_BIBLE_IPC_CHANNELS.saveProfile, [{
    expectedVersionId: null,
    draft: {
      genre: 'urban-campus',
      audience: '青年读者',
      theme: '选择与责任',
      narrativePov: '第三人称限知',
      tone: '克制而温暖',
      styleSample: '',
      bannedExpressions: ['命运的齿轮']
    }
  }]), true)
  assert.equal(validateNovelBibleCommand(NOVEL_BIBLE_IPC_CHANNELS.saveEntry, [{
    entryId: null,
    expectedVersionId: null,
    draft: settingCandidate.entry
  }]), true)
  assert.equal(validateNovelBibleCommand(NOVEL_BIBLE_IPC_CHANNELS.generateProposals, [{
    requestId: 'request-phase-four',
    domain: 'setting',
    mode: 'standard',
    request: '补充一个有代价的校园传说',
    targetEntityId: null
  }]), true)
  assert.equal(validateNovelBibleCommand(NOVEL_BIBLE_IPC_CHANNELS.generateProposals, [{
    requestId: 'request-phase-four',
    domain: 'setting',
    mode: 'standard',
    request: '补充一个有代价的校园传说',
    targetEntityId: null,
    apiKey: 'must-not-cross-this-boundary'
  }]), false)
})

test('accepts an exact empty Bible snapshot and rejects unowned or extra data', () => {
  const snapshot = {
    projectId: 'project-phase-four',
    profile: null,
    entries: [],
    outline: [],
    proposals: [],
    loadedAt: timestamp
  }
  assert.equal(isNovelBibleSnapshot(snapshot), true)
  assert.equal(isNovelBibleSnapshot({ ...snapshot, databasePath: 'D:/secret/project.sqlite3' }), false)
  assert.equal(isNovelBibleSnapshot({ ...snapshot, projectId: 'x' }), false)
})
