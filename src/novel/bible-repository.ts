import { randomUUID } from 'node:crypto'
import {
  BibleDomainError,
  bibleEntryDraftSchema,
  bibleProposalSchema,
  bibleSourceVersionSchema,
  characterProposalCandidateSchema,
  novelProfileDraftSchema,
  outlineNodeDraftSchema,
  plotProposalCandidateSchema,
  settingProposalCandidateSchema,
  type BibleAuthorityStatus,
  type BibleEntry,
  type BibleEntryDraft,
  type BibleEntryKind,
  type BibleProposal,
  type BibleSourceVersion,
  type MoveOutlineNodeInput,
  type NovelBibleSnapshot,
  type NovelProfile,
  type NovelProfileDraft,
  type OutlineNode,
  type OutlineNodeDraft,
  type OutlineNodeKind,
  type ProposalCandidate,
  type ProposalDomain,
  type RestoreBibleVersionInput,
  type SaveBibleEntryInput,
  type SaveNovelProfileInput,
  type SaveOutlineNodeInput,
  type VersionTarget,
  type VersionedEntityType
} from '../shared/novel.ts'
import { ProjectDomainError } from '../shared/project.ts'
import { DatabaseWorkerClient, type TransactionStatement } from './database-worker.ts'

export type BibleRepositoryDependencies = {
  createId(): string
  now(): string
}

export type AuthoritativeBibleContext = {
  profile: NovelProfile | null
  entries: BibleEntry[]
  outline: OutlineNode[]
  sourceVersionIds: string[]
}

type ProfileRow = {
  id: string
  project_id: string
  genre: NovelProfile['genre']
  audience: string
  theme: string
  narrative_pov: string
  tone: string
  style_sample: string
  banned_expressions_json: string
  authority_status: BibleAuthorityStatus
  current_version_id: string
  created_at: string
  updated_at: string
}

type EntryRow = {
  id: string
  project_id: string
  title: string
  summary: string
  fields_json: string
  related_entity_ids_json: string
  authority_status: BibleAuthorityStatus
  current_version_id: string
  created_at: string
  updated_at: string
}

type OutlineRow = {
  id: string
  project_id: string
  parent_id: string | null
  title: string
  summary: string
  goal: string
  conflict: string
  turning_point: string
  hook: string
  target_words: number
  participant_character_ids_json: string
  position: number
  authority_status: BibleAuthorityStatus
  current_version_id: string
  created_at: string
  updated_at: string
}

type VersionRow = {
  id: string
  project_id: string
  entity_type: VersionedEntityType
  entity_id: string
  version_number: number
  authority_status: 'user_confirmed' | 'approved'
  source_kind: 'user' | 'agent' | 'restore'
  source_run_id: string | null
  proposal_id: string | null
  snapshot_json: string
  supersedes_version_id: string | null
  restored_from_version_id: string | null
  created_at: string
}

type ProposalRow = {
  id: string
  project_id: string
  source_run_id: string
  schema_version: number
  domain: BibleProposal['domain']
  status: BibleProposal['status']
  target_entity_type: VersionedEntityType
  target_entity_id: string | null
  source_version_id: string | null
  source_version_ids_json: string
  candidate_json: string
  created_at: string
  decided_at: string | null
}

export type RecordBibleProposalsInput = {
  sourceRunId: string
  domain: ProposalDomain
  sourceVersionIds: string[]
  candidates: ProposalCandidate[]
}

export type DecideStoredProposalInput = {
  proposalId: string
  decision: 'approve' | 'reject'
  confirmReplacement: boolean
}

const ENTRY_TABLES: Readonly<Record<BibleEntryKind, string>> = {
  'world-setting': 'world_settings',
  location: 'locations',
  faction: 'factions',
  item: 'items',
  character: 'characters',
  relationship: 'character_relationships',
  'character-state': 'character_states',
  'timeline-event': 'timeline_events',
  foreshadow: 'foreshadows'
}

const OUTLINE_TABLES: Readonly<Record<OutlineNodeKind, {
  table: string
  parentColumn: string | null
  parentKind: OutlineNodeKind | null
}>> = {
  story: { table: 'story_outlines', parentColumn: null, parentKind: null },
  volume: { table: 'story_volumes', parentColumn: 'story_outline_id', parentKind: 'story' },
  stage: { table: 'story_stages', parentColumn: 'story_volume_id', parentKind: 'volume' },
  'chapter-plan': { table: 'chapter_plans', parentColumn: 'story_stage_id', parentKind: 'stage' }
}

const ENTRY_ORDER = Object.keys(ENTRY_TABLES) as BibleEntryKind[]
const OUTLINE_ORDER: OutlineNodeKind[] = ['story', 'volume', 'stage', 'chapter-plan']

const parseProposalCandidate = (domain: ProposalDomain, value: unknown): ProposalCandidate => {
  if (domain === 'setting') return settingProposalCandidateSchema.parse(value)
  if (domain === 'character') return characterProposalCandidateSchema.parse(value)
  return plotProposalCandidateSchema.parse(value)
}

const conflictValue = (value: unknown): string => (
  typeof value === 'string' ? value : JSON.stringify(value)
)

const derivedReplacementConflicts = (
  candidate: ProposalCandidate,
  baseline: BibleEntryDraft | OutlineNodeDraft
): ProposalCandidate['conflicts'] => {
  const proposed = 'entry' in candidate ? candidate.entry : candidate.outline
  const fields = 'entry' in candidate
    ? ['title', 'summary', 'fields', 'relatedEntityIds'] as const
    : [
        'parentId', 'title', 'summary', 'goal', 'conflict', 'turningPoint', 'hook',
        'targetWords', 'participantCharacterIds', 'position'
      ] as const
  const affectedEntityIds = candidate.affectedEntityIds.length > 0
    ? candidate.affectedEntityIds
    : [candidate.targetEntityId as string]
  return fields.flatMap((field) => {
    const oldValue = baseline[field as keyof typeof baseline]
    const newValue = proposed[field as keyof typeof proposed]
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return []
    return [{
      field,
      oldValue: conflictValue(oldValue),
      newValue: conflictValue(newValue),
      sourceVersionId: candidate.sourceVersionId as string,
      affectedEntityIds
    }]
  })
}

const defaults: BibleRepositoryDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString()
}

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new BibleDomainError('BIBLE_OPERATION_FAILED', 'Stored Bible data is invalid')
  }
}

const parseStringArray = (value: string): string[] => {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new BibleDomainError('BIBLE_OPERATION_FAILED', 'Stored Bible list is invalid')
  }
  return parsed
}

const mapDatabaseError = (error: unknown): never => {
  if (error instanceof BibleDomainError) throw error
  if (error instanceof ProjectDomainError) {
    if (error.code === 'DATABASE_EXPECTED_CHANGES_MISMATCH') {
      throw new BibleDomainError('BIBLE_CONFLICT', 'Bible data changed before it could be saved')
    }
    if (error.code === 'DATABASE_TRANSACTION_FAILED') {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Bible write violates project constraints')
    }
  }
  throw new BibleDomainError('BIBLE_OPERATION_FAILED', 'Bible operation failed')
}

const profileFromRow = (row: ProfileRow): NovelProfile => ({
  id: row.id,
  projectId: row.project_id,
  genre: row.genre,
  audience: row.audience,
  theme: row.theme,
  narrativePov: row.narrative_pov,
  tone: row.tone,
  styleSample: row.style_sample,
  bannedExpressions: parseStringArray(row.banned_expressions_json),
  authorityStatus: row.authority_status as 'user_confirmed' | 'approved',
  currentVersionId: row.current_version_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const entryFromRow = (kind: BibleEntryKind, row: EntryRow): BibleEntry => {
  const draft = bibleEntryDraftSchema.parse({
    kind,
    title: row.title,
    summary: row.summary,
    fields: parseJson(row.fields_json),
    relatedEntityIds: parseStringArray(row.related_entity_ids_json)
  })
  return {
    ...draft,
    id: row.id,
    projectId: row.project_id,
    authorityStatus: row.authority_status as 'user_confirmed' | 'approved',
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const outlineFromRow = (kind: OutlineNodeKind, row: OutlineRow): OutlineNode => {
  const draft = outlineNodeDraftSchema.parse({
    kind,
    parentId: row.parent_id,
    title: row.title,
    summary: row.summary,
    goal: row.goal,
    conflict: row.conflict,
    turningPoint: row.turning_point,
    hook: row.hook,
    targetWords: row.target_words,
    participantCharacterIds: parseStringArray(row.participant_character_ids_json),
    position: row.position
  })
  return {
    ...draft,
    id: row.id,
    projectId: row.project_id,
    authorityStatus: row.authority_status as 'user_confirmed' | 'approved',
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const outlineDraftFromRow = (
  kind: OutlineNodeKind,
  row: OutlineRow,
  position = row.position
): OutlineNodeDraft => outlineNodeDraftSchema.parse({
  kind,
  parentId: row.parent_id,
  title: row.title,
  summary: row.summary,
  goal: row.goal,
  conflict: row.conflict,
  turningPoint: row.turning_point,
  hook: row.hook,
  targetWords: row.target_words,
  participantCharacterIds: parseStringArray(row.participant_character_ids_json),
  position
})

export class BibleRepository {
  readonly #database: DatabaseWorkerClient
  readonly #projectId: string
  readonly #dependencies: BibleRepositoryDependencies

  private constructor(
    database: DatabaseWorkerClient,
    projectId: string,
    dependencies: BibleRepositoryDependencies
  ) {
    this.#database = database
    this.#projectId = projectId
    this.#dependencies = dependencies
  }

  static async open(
    databasePath: string,
    projectId: string,
    dependencies: BibleRepositoryDependencies = defaults
  ): Promise<BibleRepository> {
    const database = await DatabaseWorkerClient.open(databasePath)
    try {
      const project = await database.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', [projectId])
      if (project === undefined) {
        throw new BibleDomainError('BIBLE_NOT_AVAILABLE', 'The active project has no Bible storage')
      }
      return new BibleRepository(database, projectId, dependencies)
    } catch (error) {
      await database.close().catch(() => undefined)
      throw error
    }
  }

  async saveProfile(input: SaveNovelProfileInput): Promise<NovelProfile> {
    const parsed = novelProfileDraftSchema.parse(input.draft)
    const existing = await this.#profileRow()
    if (existing === undefined && input.expectedVersionId !== null) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'A new novel profile cannot have a source version')
    }
    if (existing !== undefined && input.expectedVersionId !== existing.current_version_id) {
      throw new BibleDomainError('BIBLE_CONFLICT', 'Novel profile changed before it could be saved')
    }
    if (existing !== undefined && existing.genre !== parsed.genre) {
      throw new BibleDomainError('BIBLE_CONFLICT', 'The primary novel genre cannot be replaced')
    }
    const entityId = existing?.id ?? this.#dependencies.createId()
    const versionId = this.#dependencies.createId()
    const auditId = this.#dependencies.createId()
    const timestamp = this.#dependencies.now()
    const versionNumber = await this.#nextVersionNumber('novel-profile', entityId)
    const statements: TransactionStatement[] = [this.#versionStatement({
      id: versionId,
      entityType: 'novel-profile',
      entityId,
      versionNumber,
      authorityStatus: 'user_confirmed',
      sourceKind: 'user',
      snapshot: parsed,
      supersedesVersionId: existing?.current_version_id ?? null,
      createdAt: timestamp
    })]
    if (existing === undefined) {
      statements.push({
        sql: `INSERT INTO novel_profiles (
                id, project_id, genre, audience, theme, narrative_pov, tone, style_sample,
                banned_expressions_json, authority_status, current_version_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user_confirmed', ?, ?, ?)`,
        params: [entityId, this.#projectId, parsed.genre, parsed.audience, parsed.theme,
          parsed.narrativePov, parsed.tone, parsed.styleSample, JSON.stringify(parsed.bannedExpressions),
          versionId, timestamp, timestamp]
      })
    } else {
      statements.push({
        sql: `UPDATE novel_profiles SET audience = ?, theme = ?, narrative_pov = ?, tone = ?,
                style_sample = ?, banned_expressions_json = ?, authority_status = 'user_confirmed',
                current_version_id = ?, updated_at = ?
              WHERE id = ? AND current_version_id = ?`,
        params: [parsed.audience, parsed.theme, parsed.narrativePov, parsed.tone, parsed.styleSample,
          JSON.stringify(parsed.bannedExpressions), versionId, timestamp, entityId, existing.current_version_id],
        expectedChanges: 1
      })
    }
    statements.push(this.#auditStatement(auditId, 'bible.profile.saved', entityId, timestamp))
    await this.#transaction(statements)
    return profileFromRow((await this.#profileRow()) as ProfileRow)
  }

  saveEntry(input: SaveBibleEntryInput): Promise<BibleEntry> {
    return this.#saveEntry(input, 'user', 'user_confirmed')
  }

  async #saveEntry(
    input: SaveBibleEntryInput,
    sourceKind: 'user' | 'agent' | 'restore',
    authorityStatus: 'user_confirmed' | 'approved',
    proposalId: string | null = null,
    sourceRunId: string | null = null,
    auditEventType = 'bible.entry.saved',
    restoredFromVersionId: string | null = null
  ): Promise<BibleEntry> {
    const draft = bibleEntryDraftSchema.parse(input.draft)
    await this.#validateEntryRelations(draft)
    const table = ENTRY_TABLES[draft.kind]
    const existing = input.entryId === null
      ? undefined
      : await this.#database.get<EntryRow>(`SELECT * FROM ${table} WHERE id = ? AND project_id = ?`, [input.entryId, this.#projectId])
    if (input.entryId !== null && existing === undefined) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Bible entry does not exist in this domain')
    }
    if (existing !== undefined && input.expectedVersionId !== existing.current_version_id) {
      throw new BibleDomainError('BIBLE_CONFLICT', 'Bible entry changed before it could be saved')
    }
    if (existing === undefined && input.expectedVersionId !== null) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'A new Bible entry cannot have a source version')
    }
    const entityId = existing?.id ?? this.#dependencies.createId()
    const versionId = this.#dependencies.createId()
    const auditId = this.#dependencies.createId()
    const timestamp = this.#dependencies.now()
    const versionNumber = await this.#nextVersionNumber(draft.kind, entityId)
    const statements: TransactionStatement[] = [this.#versionStatement({
      id: versionId,
      entityType: draft.kind,
      entityId,
      versionNumber,
      authorityStatus,
      sourceKind,
      sourceRunId,
      proposalId,
      snapshot: draft,
      supersedesVersionId: existing?.current_version_id ?? null,
      restoredFromVersionId,
      createdAt: timestamp
    })]
    if (existing === undefined) {
      statements.push({
        sql: `INSERT INTO ${table} (
                id, project_id, title, summary, fields_json, related_entity_ids_json,
                authority_status, current_version_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [entityId, this.#projectId, draft.title, draft.summary, JSON.stringify(draft.fields),
          JSON.stringify(draft.relatedEntityIds), authorityStatus, versionId, timestamp, timestamp]
      })
    } else {
      statements.push({
        sql: `UPDATE ${table} SET title = ?, summary = ?, fields_json = ?,
                related_entity_ids_json = ?, authority_status = ?, current_version_id = ?, updated_at = ?
              WHERE id = ? AND project_id = ? AND current_version_id = ?`,
        params: [draft.title, draft.summary, JSON.stringify(draft.fields),
          JSON.stringify(draft.relatedEntityIds), authorityStatus, versionId, timestamp,
          entityId, this.#projectId, existing.current_version_id],
        expectedChanges: 1
      })
    }
    statements.push(this.#auditStatement(auditId, auditEventType, entityId, timestamp))
    await this.#transaction(statements)
    const saved = await this.#database.get<EntryRow>(`SELECT * FROM ${table} WHERE id = ?`, [entityId])
    if (saved === undefined) throw new BibleDomainError('BIBLE_OPERATION_FAILED', 'Saved Bible entry is missing')
    return entryFromRow(draft.kind, saved)
  }

  async saveOutlineNode(input: SaveOutlineNodeInput): Promise<OutlineNode> {
    return this.#saveOutlineNode(input, 'user', 'user_confirmed')
  }

  async #saveOutlineNode(
    input: SaveOutlineNodeInput,
    sourceKind: 'user' | 'agent' | 'restore',
    authorityStatus: 'user_confirmed' | 'approved',
    proposalId: string | null = null,
    sourceRunId: string | null = null,
    auditEventType = 'bible.outline.saved',
    restoredFromVersionId: string | null = null
  ): Promise<OutlineNode> {
    const draft = outlineNodeDraftSchema.parse(input.draft)
    const config = OUTLINE_TABLES[draft.kind]
    await this.#validateOutlineParent(draft)
    await this.#validateOutlineParticipants(draft)
    const existing = input.nodeId === null
      ? undefined
      : await this.#outlineRow(draft.kind, input.nodeId)
    if (input.nodeId !== null && existing === undefined) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Outline node does not exist in this level')
    }
    if (existing !== undefined && input.expectedVersionId !== existing.current_version_id) {
      throw new BibleDomainError('BIBLE_CONFLICT', 'Outline node changed before it could be saved')
    }
    if (existing !== undefined && (existing.parent_id !== draft.parentId || existing.position !== draft.position)) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Use the outline move command to change hierarchy or order')
    }
    if (existing === undefined) {
      if (input.expectedVersionId !== null) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'A new outline node cannot have a source version')
      }
      const siblingCount = await this.#siblingCount(draft.kind, draft.parentId)
      if (draft.position !== siblingCount) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'New outline nodes must append to their siblings')
      }
    }
    const entityId = existing?.id ?? this.#dependencies.createId()
    const versionId = this.#dependencies.createId()
    const auditId = this.#dependencies.createId()
    const timestamp = this.#dependencies.now()
    const versionNumber = await this.#nextVersionNumber(draft.kind, entityId)
    const statements: TransactionStatement[] = [this.#versionStatement({
      id: versionId,
      entityType: draft.kind,
      entityId,
      versionNumber,
      authorityStatus,
      sourceKind,
      sourceRunId,
      proposalId,
      snapshot: draft,
      supersedesVersionId: existing?.current_version_id ?? null,
      restoredFromVersionId,
      createdAt: timestamp
    })]
    const values = [draft.title, draft.summary, draft.goal, draft.conflict, draft.turningPoint,
      draft.hook, draft.targetWords, JSON.stringify(draft.participantCharacterIds), draft.position]
    if (existing === undefined) {
      const parentColumns = config.parentColumn === null ? '' : `, ${config.parentColumn}`
      const parentPlaceholder = config.parentColumn === null ? '' : ', ?'
      statements.push({
        sql: `INSERT INTO ${config.table} (
                id, project_id${parentColumns}, title, summary, goal, conflict, turning_point, hook,
                target_words, participant_character_ids_json, position, authority_status,
                current_version_id, created_at, updated_at
              ) VALUES (?, ?${parentPlaceholder}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [entityId, this.#projectId, ...(config.parentColumn === null ? [] : [draft.parentId]),
          ...values, authorityStatus, versionId, timestamp, timestamp]
      })
    } else {
      statements.push({
        sql: `UPDATE ${config.table} SET title = ?, summary = ?, goal = ?, conflict = ?,
                turning_point = ?, hook = ?, target_words = ?, participant_character_ids_json = ?,
                position = ?, authority_status = ?, current_version_id = ?, updated_at = ?
              WHERE id = ? AND project_id = ? AND current_version_id = ?`,
        params: [...values, authorityStatus, versionId, timestamp, entityId, this.#projectId,
          existing.current_version_id],
        expectedChanges: 1
      })
    }
    statements.push(this.#auditStatement(auditId, auditEventType, entityId, timestamp))
    await this.#transaction(statements)
    const saved = await this.#outlineRow(draft.kind, entityId)
    if (saved === undefined) throw new BibleDomainError('BIBLE_OPERATION_FAILED', 'Saved outline node is missing')
    return outlineFromRow(draft.kind, saved)
  }

  async moveOutlineNode(input: MoveOutlineNodeInput): Promise<OutlineNode[]> {
    const located = await this.#findOutlineNode(input.nodeId)
    if (located === undefined) throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Outline node does not exist')
    const targetPosition = located.row.position + (input.direction === 'up' ? -1 : 1)
    if (targetPosition < 0) return (await this.snapshot()).outline
    const sibling = await this.#outlineSibling(located.kind, located.row.parent_id, targetPosition)
    if (sibling === undefined) return (await this.snapshot()).outline
    const timestamp = this.#dependencies.now()
    const firstVersionId = this.#dependencies.createId()
    const secondVersionId = this.#dependencies.createId()
    const auditId = this.#dependencies.createId()
    const firstDraft = { ...outlineFromRow(located.kind, located.row), position: targetPosition }
    const secondDraft = { ...outlineFromRow(located.kind, sibling), position: located.row.position }
    const { id: _firstId, projectId: _firstProject, authorityStatus: _firstStatus,
      currentVersionId: _firstVersion, createdAt: _firstCreated, updatedAt: _firstUpdated,
      ...firstSnapshot } = firstDraft
    const { id: _secondId, projectId: _secondProject, authorityStatus: _secondStatus,
      currentVersionId: _secondVersion, createdAt: _secondCreated, updatedAt: _secondUpdated,
      ...secondSnapshot } = secondDraft
    const firstNumber = await this.#nextVersionNumber(located.kind, located.row.id)
    const secondNumber = await this.#nextVersionNumber(located.kind, sibling.id)
    const table = OUTLINE_TABLES[located.kind].table
    await this.#transaction([
      this.#versionStatement({ id: firstVersionId, entityType: located.kind,
        entityId: located.row.id, versionNumber: firstNumber,
        authorityStatus: located.row.authority_status as 'user_confirmed' | 'approved', sourceKind: 'user',
        snapshot: firstSnapshot, supersedesVersionId: located.row.current_version_id, createdAt: timestamp }),
      this.#versionStatement({ id: secondVersionId, entityType: located.kind,
        entityId: sibling.id, versionNumber: secondNumber,
        authorityStatus: sibling.authority_status as 'user_confirmed' | 'approved', sourceKind: 'user',
        snapshot: secondSnapshot, supersedesVersionId: sibling.current_version_id, createdAt: timestamp }),
      { sql: `UPDATE ${table} SET position = 2147483647 WHERE id = ? AND current_version_id = ?`,
        params: [located.row.id, located.row.current_version_id], expectedChanges: 1 },
      { sql: `UPDATE ${table} SET position = ?, current_version_id = ?, updated_at = ?
              WHERE id = ? AND current_version_id = ?`,
        params: [located.row.position, secondVersionId, timestamp, sibling.id, sibling.current_version_id],
        expectedChanges: 1 },
      { sql: `UPDATE ${table} SET position = ?, current_version_id = ?, updated_at = ?
              WHERE id = ? AND position = 2147483647`,
        params: [targetPosition, firstVersionId, timestamp, located.row.id], expectedChanges: 1 },
      this.#auditStatement(auditId, 'bible.outline.moved', located.row.id, timestamp)
    ])
    return (await this.snapshot()).outline
  }

  async listVersions(target: VersionTarget): Promise<BibleSourceVersion[]> {
    const rows = await this.#database.all<VersionRow>(
      `SELECT id, project_id, entity_type, entity_id, version_number, authority_status,
              source_kind, source_run_id, proposal_id, snapshot_json, supersedes_version_id,
              restored_from_version_id, created_at
       FROM bible_source_versions
       WHERE project_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY version_number DESC`,
      [this.#projectId, target.entityType, target.entityId]
    )
    return rows.map((row) => bibleSourceVersionSchema.parse({
      id: row.id,
      projectId: row.project_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      versionNumber: row.version_number,
      authorityStatus: row.authority_status,
      sourceKind: row.source_kind,
      sourceRunId: row.source_run_id,
      proposalId: row.proposal_id,
      snapshot: parseJson(row.snapshot_json),
      supersedesVersionId: row.supersedes_version_id,
      restoredFromVersionId: row.restored_from_version_id,
      createdAt: row.created_at
    }))
  }

  async recordProposals(input: RecordBibleProposalsInput): Promise<BibleProposal[]> {
    const timestamp = this.#dependencies.now()
    const statements: TransactionStatement[] = []
    const proposals: BibleProposal[] = []
    for (const rawCandidate of input.candidates) {
      let candidate = parseProposalCandidate(input.domain, rawCandidate)
      const isCreate = candidate.operation === 'create'
      if (isCreate !== (candidate.targetEntityId === null && candidate.sourceVersionId === null)) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal operation and target do not match')
      }
      if (isCreate) {
        if (candidate.conflicts.some(
          (conflict) => !input.sourceVersionIds.includes(conflict.sourceVersionId)
        )) {
          throw new BibleDomainError(
            'BIBLE_INVALID_COMMAND',
            'Proposal conflict source is missing from its source context'
          )
        }
      } else {
        const sourceVersionId = candidate.sourceVersionId as string
        if (!input.sourceVersionIds.includes(sourceVersionId)) {
          throw new BibleDomainError(
            'BIBLE_INVALID_COMMAND',
            'Proposal target version is missing from its source context'
          )
        }
        const source = await this.#database.get<VersionRow>(
          `SELECT id, project_id, entity_type, entity_id, version_number, authority_status,
                  source_kind, source_run_id, proposal_id, snapshot_json,
                  supersedes_version_id, restored_from_version_id, created_at
           FROM bible_source_versions WHERE id = ? AND project_id = ?`,
          [sourceVersionId, this.#projectId]
        )
        const proposedKind = 'entry' in candidate ? candidate.entry.kind : candidate.outline.kind
        if (
          source === undefined ||
          source.entity_id !== candidate.targetEntityId ||
          source.entity_type !== proposedKind
        ) {
          throw new BibleDomainError(
            'BIBLE_INVALID_COMMAND',
            'Proposal source version does not belong to its target'
          )
        }
        const baseline = 'entry' in candidate
          ? bibleEntryDraftSchema.parse(parseJson(source.snapshot_json))
          : outlineNodeDraftSchema.parse(parseJson(source.snapshot_json))
        candidate = parseProposalCandidate(input.domain, {
          ...candidate,
          conflicts: derivedReplacementConflicts(candidate, baseline)
        })
      }
      const proposalId = this.#dependencies.createId()
      const targetEntityType = 'entry' in candidate ? candidate.entry.kind : candidate.outline.kind
      statements.push({
        sql: `INSERT INTO bible_proposals (
                id, project_id, source_run_id, schema_version, domain, status,
                target_entity_type, target_entity_id, source_version_id,
                source_version_ids_json, candidate_json, decided_at, superseded_by_id, created_at
              ) VALUES (?, ?, ?, 1, ?, 'proposed', ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        params: [proposalId, this.#projectId, input.sourceRunId, input.domain, targetEntityType,
          candidate.targetEntityId, candidate.sourceVersionId, JSON.stringify(input.sourceVersionIds),
          JSON.stringify(candidate), timestamp]
      })
      for (const conflict of candidate.conflicts) {
        statements.push({
          sql: `INSERT INTO bible_proposal_conflicts (
                  id, proposal_id, field, old_value, new_value, source_version_id,
                  affected_entity_ids_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params: [this.#dependencies.createId(), proposalId, conflict.field, conflict.oldValue,
            conflict.newValue, conflict.sourceVersionId, JSON.stringify(conflict.affectedEntityIds)]
        })
      }
      for (const entityId of new Set(candidate.affectedEntityIds)) {
        statements.push({
          sql: 'INSERT INTO bible_proposal_impacts (proposal_id, entity_id) VALUES (?, ?)',
          params: [proposalId, entityId]
        })
      }
      statements.push(this.#auditStatement(
        this.#dependencies.createId(), 'bible.proposal.created', proposalId, timestamp
      ))
      proposals.push(bibleProposalSchema.parse({
        id: proposalId,
        projectId: this.#projectId,
        sourceRunId: input.sourceRunId,
        schemaVersion: 1,
        domain: input.domain,
        status: 'proposed',
        sourceVersionIds: input.sourceVersionIds,
        candidate,
        createdAt: timestamp,
        decidedAt: null
      }))
    }
    if (statements.length > 0) await this.#transaction(statements)
    return proposals
  }

  async decideProposal(input: DecideStoredProposalInput): Promise<NovelBibleSnapshot> {
    const row = await this.#database.get<ProposalRow>(
      'SELECT * FROM bible_proposals WHERE id = ? AND project_id = ?',
      [input.proposalId, this.#projectId]
    )
    if (row === undefined) throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Bible proposal does not exist')
    if (row.status !== 'proposed') {
      throw new BibleDomainError('BIBLE_PROPOSAL_STATE', 'Bible proposal has already been decided')
    }
    const candidate = parseProposalCandidate(row.domain, parseJson(row.candidate_json))
    const timestamp = this.#dependencies.now()
    const auditId = this.#dependencies.createId()
    if (input.decision === 'reject') {
      await this.#transaction([
        {
          sql: `UPDATE bible_proposals SET status = 'rejected', decided_at = ?
                WHERE id = ? AND project_id = ? AND status = 'proposed'`,
          params: [timestamp, row.id, this.#projectId],
          expectedChanges: 1
        },
        this.#auditStatement(auditId, 'bible.proposal.rejected', row.id, timestamp)
      ])
      return this.snapshot()
    }

    const versionId = this.#dependencies.createId()
    const statements: TransactionStatement[] = []
    let entityId: string
    let versionNumber: number
    let supersedesVersionId: string | null
    if ('entry' in candidate) {
      const draft = bibleEntryDraftSchema.parse(candidate.entry)
      await this.#validateEntryRelations(draft)
      const table = ENTRY_TABLES[draft.kind]
      const current = candidate.targetEntityId === null
        ? undefined
        : await this.#database.get<EntryRow>(
          `SELECT * FROM ${table} WHERE id = ? AND project_id = ?`,
          [candidate.targetEntityId, this.#projectId]
        )
      if (candidate.operation === 'update' && current === undefined) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal target no longer exists')
      }
      if (candidate.operation === 'create' && current !== undefined) {
        throw new BibleDomainError('BIBLE_CONFLICT', 'Proposal target already exists')
      }
      if (current !== undefined) {
        const baselineChanged = current.current_version_id !== candidate.sourceVersionId
        if (baselineChanged) {
          throw new BibleDomainError('BIBLE_CONFLICT', 'Proposal source is stale; regenerate against current data')
        }
        if (candidate.conflicts.length > 0 && !input.confirmReplacement) {
          throw new BibleDomainError('BIBLE_CONFLICT', 'Proposal replaces confirmed Bible data')
        }
        entityId = current.id
        supersedesVersionId = current.current_version_id
        versionNumber = await this.#nextVersionNumber(draft.kind, entityId)
        statements.push({
          sql: `UPDATE ${table} SET title = ?, summary = ?, fields_json = ?,
                  related_entity_ids_json = ?, authority_status = 'approved',
                  current_version_id = ?, updated_at = ?
                WHERE id = ? AND project_id = ? AND current_version_id = ?`,
          params: [draft.title, draft.summary, JSON.stringify(draft.fields),
            JSON.stringify(draft.relatedEntityIds), versionId, timestamp,
            entityId, this.#projectId, current.current_version_id],
          expectedChanges: 1
        })
      } else {
        if (candidate.operation !== 'create') {
          throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal target is invalid')
        }
        entityId = this.#dependencies.createId()
        supersedesVersionId = null
        versionNumber = 1
        statements.push({
          sql: `INSERT INTO ${table} (
                  id, project_id, title, summary, fields_json, related_entity_ids_json,
                  authority_status, current_version_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
          params: [entityId, this.#projectId, draft.title, draft.summary, JSON.stringify(draft.fields),
            JSON.stringify(draft.relatedEntityIds), versionId, timestamp, timestamp]
        })
      }
      statements.unshift(this.#versionStatement({
        id: versionId,
        entityType: draft.kind,
        entityId,
        versionNumber,
        authorityStatus: 'approved',
        sourceKind: 'agent',
        sourceRunId: row.source_run_id,
        proposalId: row.id,
        snapshot: draft,
        supersedesVersionId,
        createdAt: timestamp
      }))
    } else {
      const draft = outlineNodeDraftSchema.parse(candidate.outline)
      const config = OUTLINE_TABLES[draft.kind]
      await this.#validateOutlineParent(draft)
      await this.#validateOutlineParticipants(draft)
      const current = candidate.targetEntityId === null
        ? undefined
        : await this.#outlineRow(draft.kind, candidate.targetEntityId)
      if (candidate.operation === 'update' && current === undefined) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal target no longer exists')
      }
      if (current !== undefined) {
        if (current.parent_id !== draft.parentId || current.position !== draft.position) {
          throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal cannot silently move an outline node')
        }
        const baselineChanged = current.current_version_id !== candidate.sourceVersionId
        if (baselineChanged) {
          throw new BibleDomainError('BIBLE_CONFLICT', 'Proposal source is stale; regenerate against current data')
        }
        if (candidate.conflicts.length > 0 && !input.confirmReplacement) {
          throw new BibleDomainError('BIBLE_CONFLICT', 'Proposal replaces confirmed outline data')
        }
        entityId = current.id
        supersedesVersionId = current.current_version_id
        versionNumber = await this.#nextVersionNumber(draft.kind, entityId)
        statements.push({
          sql: `UPDATE ${config.table} SET title = ?, summary = ?, goal = ?, conflict = ?,
                  turning_point = ?, hook = ?, target_words = ?, participant_character_ids_json = ?,
                  authority_status = 'approved', current_version_id = ?, updated_at = ?
                WHERE id = ? AND project_id = ? AND current_version_id = ?`,
          params: [draft.title, draft.summary, draft.goal, draft.conflict, draft.turningPoint,
            draft.hook, draft.targetWords, JSON.stringify(draft.participantCharacterIds), versionId,
            timestamp, entityId, this.#projectId, current.current_version_id],
          expectedChanges: 1
        })
      } else {
        if (candidate.operation !== 'create') {
          throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Proposal target is invalid')
        }
        const siblingCount = await this.#siblingCount(draft.kind, draft.parentId)
        if (draft.position !== siblingCount) {
          throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'New proposal outline nodes must append')
        }
        entityId = this.#dependencies.createId()
        supersedesVersionId = null
        versionNumber = 1
        const parentColumns = config.parentColumn === null ? '' : `, ${config.parentColumn}`
        const parentPlaceholder = config.parentColumn === null ? '' : ', ?'
        statements.push({
          sql: `INSERT INTO ${config.table} (
                  id, project_id${parentColumns}, title, summary, goal, conflict, turning_point, hook,
                  target_words, participant_character_ids_json, position, authority_status,
                  current_version_id, created_at, updated_at
                ) VALUES (?, ?${parentPlaceholder}, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
          params: [entityId, this.#projectId, ...(config.parentColumn === null ? [] : [draft.parentId]),
            draft.title, draft.summary, draft.goal, draft.conflict, draft.turningPoint, draft.hook,
            draft.targetWords, JSON.stringify(draft.participantCharacterIds), draft.position,
            versionId, timestamp, timestamp]
        })
      }
      statements.unshift(this.#versionStatement({
        id: versionId,
        entityType: draft.kind,
        entityId,
        versionNumber,
        authorityStatus: 'approved',
        sourceKind: 'agent',
        sourceRunId: row.source_run_id,
        proposalId: row.id,
        snapshot: draft,
        supersedesVersionId,
        createdAt: timestamp
      }))
    }

    if (candidate.operation === 'update') {
      statements.push({
        sql: `UPDATE bible_proposals SET status = 'superseded', superseded_by_id = ?
              WHERE project_id = ? AND status = 'approved' AND target_entity_type = ?
                AND target_entity_id = ?`,
        params: [row.id, this.#projectId, row.target_entity_type, entityId]
      })
    }
    statements.push({
      sql: `UPDATE bible_proposals SET status = 'approved', target_entity_id = ?, decided_at = ?
            WHERE id = ? AND project_id = ? AND status = 'proposed'`,
      params: [entityId, timestamp, row.id, this.#projectId],
      expectedChanges: 1
    })
    statements.push(this.#auditStatement(auditId, 'bible.proposal.approved', row.id, timestamp))
    await this.#transaction(statements)
    return this.snapshot()
  }

  async restoreVersion(input: RestoreBibleVersionInput): Promise<NovelBibleSnapshot> {
    const versions = await this.listVersions(input)
    const selected = versions.find((version) => version.id === input.versionId)
    if (selected === undefined) throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Bible version does not exist')
    if (input.entityType === 'novel-profile') {
      const current = await this.#profileRow()
      if (current === undefined) throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Novel profile does not exist')
      const draft = novelProfileDraftSchema.parse(selected.snapshot)
      if (draft.genre !== current.genre) {
        throw new BibleDomainError('BIBLE_CONFLICT', 'Restoring cannot change the primary genre')
      }
      await this.#restoreProfile(current, draft, selected.authorityStatus, selected.id)
    } else if (input.entityType in ENTRY_TABLES) {
      const kind = input.entityType as BibleEntryKind
      const table = ENTRY_TABLES[kind]
      const current = await this.#database.get<EntryRow>(`SELECT * FROM ${table} WHERE id = ?`, [input.entityId])
      if (current === undefined) throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Bible entry does not exist')
      await this.#saveEntry({ entryId: input.entityId, expectedVersionId: current.current_version_id,
        draft: bibleEntryDraftSchema.parse(selected.snapshot) }, 'restore',
        selected.authorityStatus, null, null,
        'bible.version.restored', selected.id)
    } else {
      const kind = input.entityType as OutlineNodeKind
      const current = await this.#outlineRow(kind, input.entityId)
      if (current === undefined) throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Outline node does not exist')
      const draft = outlineNodeDraftSchema.parse(selected.snapshot)
      if (current.parent_id !== draft.parentId) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Restoring cannot change outline hierarchy')
      }
      await this.#restoreOutlineNode(current, draft, selected.authorityStatus, selected.id)
    }
    return this.snapshot()
  }

  async snapshot(): Promise<NovelBibleSnapshot> {
    const profileRow = await this.#profileRow()
    const entries: BibleEntry[] = []
    for (const kind of ENTRY_ORDER) {
      const rows = await this.#database.all<EntryRow>(
        `SELECT * FROM ${ENTRY_TABLES[kind]} WHERE project_id = ? ORDER BY updated_at DESC, id`,
        [this.#projectId]
      )
      entries.push(...rows.map((row) => entryFromRow(kind, row)))
    }
    const outline: OutlineNode[] = []
    for (const kind of OUTLINE_ORDER) {
      const rows = await this.#outlineRows(kind)
      outline.push(...rows.map((row) => outlineFromRow(kind, row)))
    }
    const proposalRows = await this.#database.all<ProposalRow>(
      `SELECT id, project_id, source_run_id, schema_version, domain, status,
              source_version_ids_json, candidate_json, created_at, decided_at
       FROM bible_proposals WHERE project_id = ? ORDER BY created_at DESC, id`,
      [this.#projectId]
    )
    const proposals = proposalRows.map((row) => bibleProposalSchema.parse({
      id: row.id,
      projectId: row.project_id,
      sourceRunId: row.source_run_id,
      schemaVersion: row.schema_version,
      domain: row.domain,
      status: row.status,
      sourceVersionIds: parseStringArray(row.source_version_ids_json),
      candidate: parseJson(row.candidate_json),
      createdAt: row.created_at,
      decidedAt: row.decided_at
    }))
    return {
      projectId: this.#projectId,
      profile: profileRow === undefined ? null : profileFromRow(profileRow),
      entries,
      outline,
      proposals,
      loadedAt: this.#dependencies.now()
    }
  }

  async authoritativeContext(): Promise<AuthoritativeBibleContext> {
    const snapshot = await this.snapshot()
    return {
      profile: snapshot.profile,
      entries: snapshot.entries,
      outline: snapshot.outline,
      sourceVersionIds: [
        ...(snapshot.profile === null ? [] : [snapshot.profile.currentVersionId]),
        ...snapshot.entries.map((entry) => entry.currentVersionId),
        ...snapshot.outline.map((node) => node.currentVersionId)
      ]
    }
  }

  close(): Promise<void> {
    return this.#database.close()
  }

  #profileRow(): Promise<ProfileRow | undefined> {
    return this.#database.get<ProfileRow>('SELECT * FROM novel_profiles WHERE project_id = ?', [this.#projectId])
  }

  async #restoreProfile(
    current: ProfileRow,
    draft: NovelProfileDraft,
    authorityStatus: 'user_confirmed' | 'approved',
    restoredFromVersionId: string
  ): Promise<void> {
    const versionId = this.#dependencies.createId()
    const auditId = this.#dependencies.createId()
    const timestamp = this.#dependencies.now()
    const versionNumber = await this.#nextVersionNumber('novel-profile', current.id)
    await this.#transaction([
      this.#versionStatement({ id: versionId, entityType: 'novel-profile', entityId: current.id,
        versionNumber, authorityStatus,
        sourceKind: 'restore', snapshot: draft, supersedesVersionId: current.current_version_id,
        restoredFromVersionId,
        createdAt: timestamp }),
      { sql: `UPDATE novel_profiles SET audience = ?, theme = ?, narrative_pov = ?, tone = ?,
                style_sample = ?, banned_expressions_json = ?, authority_status = ?,
                current_version_id = ?, updated_at = ?
              WHERE id = ? AND current_version_id = ?`,
        params: [draft.audience, draft.theme, draft.narrativePov, draft.tone, draft.styleSample,
          JSON.stringify(draft.bannedExpressions), authorityStatus, versionId, timestamp,
          current.id, current.current_version_id],
        expectedChanges: 1 },
      this.#auditStatement(auditId, 'bible.version.restored', current.id, timestamp)
    ])
  }

  async #restoreOutlineNode(
    current: OutlineRow,
    draft: OutlineNodeDraft,
    authorityStatus: 'user_confirmed' | 'approved',
    restoredFromVersionId: string
  ): Promise<void> {
    await this.#validateOutlineParticipants(draft)
    const siblings = (await this.#outlineRows(draft.kind))
      .filter((row) => row.parent_id === current.parent_id)
    const latestCurrent = siblings.find((row) => row.id === current.id)
    if (
      latestCurrent === undefined ||
      latestCurrent.current_version_id !== current.current_version_id ||
      latestCurrent.position !== current.position ||
      draft.position >= siblings.length
    ) {
      throw new BibleDomainError('BIBLE_CONFLICT', 'Outline order changed before restore could start')
    }

    const lowerPosition = Math.min(current.position, draft.position)
    const upperPosition = Math.max(current.position, draft.position)
    const affectedSiblings = siblings.filter((row) => (
      row.id !== current.id && row.position >= lowerPosition && row.position <= upperPosition
    ))
    if (affectedSiblings.length !== Math.abs(current.position - draft.position)) {
      throw new BibleDomainError('BIBLE_CONFLICT', 'Outline sibling order is incomplete')
    }

    const timestamp = this.#dependencies.now()
    const auditId = this.#dependencies.createId()
    const targetVersionId = this.#dependencies.createId()
    const targetVersionNumber = await this.#nextVersionNumber(draft.kind, current.id)
    const siblingChanges = await Promise.all(affectedSiblings.map(async (row) => {
      const position = current.position > draft.position ? row.position + 1 : row.position - 1
      return {
        row,
        draft: outlineDraftFromRow(draft.kind, row, position),
        versionId: this.#dependencies.createId(),
        versionNumber: await this.#nextVersionNumber(draft.kind, row.id)
      }
    }))
    const table = OUTLINE_TABLES[draft.kind].table
    const changes = [{ row: current, versionId: targetVersionId }, ...siblingChanges]
    const maximumPosition = Math.max(...siblings.map((row) => row.position))
    const temporaryBase = maximumPosition + changes.length + 1
    const statements: TransactionStatement[] = []

    for (const [index, change] of changes.entries()) {
      statements.push({
        sql: `UPDATE ${table} SET position = ?
              WHERE id = ? AND project_id = ? AND current_version_id = ?`,
        params: [temporaryBase + index, change.row.id, this.#projectId, change.row.current_version_id],
        expectedChanges: 1
      })
    }
    statements.push(this.#versionStatement({
      id: targetVersionId,
      entityType: draft.kind,
      entityId: current.id,
      versionNumber: targetVersionNumber,
      authorityStatus,
      sourceKind: 'restore',
      snapshot: draft,
      supersedesVersionId: current.current_version_id,
      restoredFromVersionId,
      createdAt: timestamp
    }))
    for (const change of siblingChanges) {
      statements.push(this.#versionStatement({
        id: change.versionId,
        entityType: draft.kind,
        entityId: change.row.id,
        versionNumber: change.versionNumber,
        authorityStatus: change.row.authority_status as 'user_confirmed' | 'approved',
        sourceKind: 'restore',
        snapshot: change.draft,
        supersedesVersionId: change.row.current_version_id,
        createdAt: timestamp
      }))
    }
    statements.push({
      sql: `UPDATE ${table} SET title = ?, summary = ?, goal = ?, conflict = ?,
              turning_point = ?, hook = ?, target_words = ?, participant_character_ids_json = ?,
              position = ?, authority_status = ?, current_version_id = ?, updated_at = ?
            WHERE id = ? AND project_id = ? AND current_version_id = ? AND position = ?`,
      params: [draft.title, draft.summary, draft.goal, draft.conflict, draft.turningPoint,
        draft.hook, draft.targetWords, JSON.stringify(draft.participantCharacterIds), draft.position,
        authorityStatus, targetVersionId, timestamp, current.id, this.#projectId,
        current.current_version_id, temporaryBase],
      expectedChanges: 1
    })
    for (const [index, change] of siblingChanges.entries()) {
      statements.push({
        sql: `UPDATE ${table} SET position = ?, current_version_id = ?, updated_at = ?
              WHERE id = ? AND project_id = ? AND current_version_id = ? AND position = ?`,
        params: [change.draft.position, change.versionId, timestamp, change.row.id, this.#projectId,
          change.row.current_version_id, temporaryBase + index + 1],
        expectedChanges: 1
      })
    }
    statements.push(this.#auditStatement(auditId, 'bible.version.restored', current.id, timestamp))
    await this.#transaction(statements)
  }

  async #nextVersionNumber(entityType: VersionedEntityType, entityId: string): Promise<number> {
    const row = await this.#database.get<{ value: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS value
       FROM bible_source_versions WHERE entity_type = ? AND entity_id = ?`,
      [entityType, entityId]
    )
    return Number(row?.value ?? 1)
  }

  #versionStatement(input: {
    id: string
    entityType: VersionedEntityType
    entityId: string
    versionNumber: number
    authorityStatus: 'user_confirmed' | 'approved'
    sourceKind: 'user' | 'agent' | 'restore'
    sourceRunId?: string | null
    proposalId?: string | null
    snapshot: NovelProfileDraft | BibleEntryDraft | OutlineNodeDraft
    supersedesVersionId: string | null
    restoredFromVersionId?: string | null
    createdAt: string
  }): TransactionStatement {
    return {
      sql: `INSERT INTO bible_source_versions (
              id, project_id, entity_type, entity_id, version_number, authority_status,
              source_kind, source_run_id, proposal_id, snapshot_json, supersedes_version_id,
              restored_from_version_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [input.id, this.#projectId, input.entityType, input.entityId, input.versionNumber,
        input.authorityStatus, input.sourceKind, input.sourceRunId ?? null, input.proposalId ?? null,
        JSON.stringify(input.snapshot), input.supersedesVersionId, input.restoredFromVersionId ?? null,
        input.createdAt]
    }
  }

  #auditStatement(id: string, eventType: string, entityId: string, createdAt: string): TransactionStatement {
    return {
      sql: `INSERT INTO audit_events (id, project_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      params: [id, this.#projectId, eventType, JSON.stringify({ entityId }), createdAt]
    }
  }

  async #transaction(statements: TransactionStatement[]): Promise<void> {
    await this.#database.transaction(statements).catch(mapDatabaseError)
  }

  async #validateOutlineParent(draft: OutlineNodeDraft): Promise<void> {
    const config = OUTLINE_TABLES[draft.kind]
    if (config.parentKind === null) {
      if (draft.parentId !== null) {
        throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Story outlines cannot have a parent')
      }
      return
    }
    if (draft.parentId === null || await this.#outlineRow(config.parentKind, draft.parentId) === undefined) {
      throw new BibleDomainError('BIBLE_INVALID_COMMAND', 'Outline parent does not match the required level')
    }
  }

  async #validateEntryRelations(draft: BibleEntryDraft): Promise<void> {
    if (draft.kind !== 'relationship' && draft.kind !== 'character-state') return
    await this.#requireCharacterIds(draft.relatedEntityIds)
  }

  async #validateOutlineParticipants(draft: OutlineNodeDraft): Promise<void> {
    await this.#requireCharacterIds(draft.participantCharacterIds)
  }

  async #requireCharacterIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    const rows = await this.#database.all<{ id: string }>(
      `SELECT id FROM characters WHERE project_id = ? AND id IN (${placeholders})`,
      [this.#projectId, ...ids]
    )
    if (rows.length !== ids.length) {
      throw new BibleDomainError(
        'BIBLE_INVALID_COMMAND',
        'Character references must belong to existing characters in this project'
      )
    }
  }

  #outlineSelect(kind: OutlineNodeKind): string {
    const config = OUTLINE_TABLES[kind]
    const parent = config.parentColumn === null ? 'NULL' : config.parentColumn
    return `SELECT id, project_id, ${parent} AS parent_id, title, summary, goal, conflict,
                   turning_point, hook, target_words, participant_character_ids_json, position,
                   authority_status, current_version_id, created_at, updated_at
            FROM ${config.table}`
  }

  #outlineRow(kind: OutlineNodeKind, id: string): Promise<OutlineRow | undefined> {
    return this.#database.get<OutlineRow>(
      `${this.#outlineSelect(kind)} WHERE id = ? AND project_id = ?`, [id, this.#projectId]
    )
  }

  #outlineRows(kind: OutlineNodeKind): Promise<OutlineRow[]> {
    return this.#database.all<OutlineRow>(
      `${this.#outlineSelect(kind)} WHERE project_id = ? ORDER BY parent_id, position, id`,
      [this.#projectId]
    )
  }

  async #findOutlineNode(id: string): Promise<{ kind: OutlineNodeKind; row: OutlineRow } | undefined> {
    for (const kind of OUTLINE_ORDER) {
      const row = await this.#outlineRow(kind, id)
      if (row !== undefined) return { kind, row }
    }
    return undefined
  }

  async #siblingCount(kind: OutlineNodeKind, parentId: string | null): Promise<number> {
    const config = OUTLINE_TABLES[kind]
    const where = config.parentColumn === null
      ? 'project_id = ?'
      : `project_id = ? AND ${config.parentColumn} = ?`
    const params = config.parentColumn === null ? [this.#projectId] : [this.#projectId, parentId]
    const row = await this.#database.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${config.table} WHERE ${where}`, params
    )
    return Number(row?.count ?? 0)
  }

  #outlineSibling(
    kind: OutlineNodeKind,
    parentId: string | null,
    position: number
  ): Promise<OutlineRow | undefined> {
    const config = OUTLINE_TABLES[kind]
    const parentWhere = config.parentColumn === null ? '' : `AND ${config.parentColumn} = ?`
    const params = config.parentColumn === null
      ? [this.#projectId, position]
      : [this.#projectId, parentId, position]
    return this.#database.get<OutlineRow>(
      `${this.#outlineSelect(kind)} WHERE project_id = ? ${parentWhere} AND position = ?`, params
    )
  }
}
