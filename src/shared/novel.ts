import { z } from 'zod'
import type { GenerationMode } from './model.ts'

export const NOVEL_GENRES = ['urban-campus', 'sci-fi-future'] as const
export const BIBLE_ENTRY_KINDS = [
  'world-setting',
  'location',
  'faction',
  'item',
  'character',
  'relationship',
  'character-state',
  'timeline-event',
  'foreshadow'
] as const
export const OUTLINE_NODE_KINDS = ['story', 'volume', 'stage', 'chapter-plan'] as const
export const BIBLE_AUTHORITY_STATUSES = [
  'user_confirmed',
  'proposed',
  'approved',
  'rejected',
  'superseded'
] as const
export const PROPOSAL_STATUSES = ['proposed', 'approved', 'rejected', 'superseded'] as const
export const PROPOSAL_DOMAINS = ['setting', 'character', 'plot'] as const

export type NovelGenre = typeof NOVEL_GENRES[number]
export type BibleEntryKind = typeof BIBLE_ENTRY_KINDS[number]
export type OutlineNodeKind = typeof OUTLINE_NODE_KINDS[number]
export type BibleAuthorityStatus = typeof BIBLE_AUTHORITY_STATUSES[number]
export type ProposalStatus = typeof PROPOSAL_STATUSES[number]
export type ProposalDomain = typeof PROPOSAL_DOMAINS[number]
export type VersionedEntityType = 'novel-profile' | BibleEntryKind | OutlineNodeKind

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/)
const canonicalTimestampSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
})
const titleSchema = z.string().trim().min(1).max(160)
const proseSchema = z.string().max(20_000)

export const bibleFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  value: z.string().max(10_000)
}).strict()

export type BibleField = z.infer<typeof bibleFieldSchema>

export const novelProfileDraftSchema = z.object({
  genre: z.enum(NOVEL_GENRES),
  audience: z.string().trim().min(1).max(200),
  theme: z.string().trim().min(1).max(500),
  narrativePov: z.string().trim().min(1).max(120),
  tone: z.string().trim().min(1).max(240),
  styleSample: z.string().max(10_000),
  bannedExpressions: z.array(z.string().trim().min(1).max(120)).max(100)
}).strict()

export type NovelProfileDraft = z.infer<typeof novelProfileDraftSchema>

export const bibleEntryDraftSchema = z.object({
  kind: z.enum(BIBLE_ENTRY_KINDS),
  title: titleSchema,
  summary: proseSchema,
  fields: z.array(bibleFieldSchema).max(40).refine(
    (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
    'Bible field keys must be unique'
  ),
  relatedEntityIds: z.array(identifierSchema).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    'Related entity IDs must be unique'
  )
}).strict().superRefine((draft, context) => {
  if (draft.kind === 'relationship' && draft.relatedEntityIds.length < 2) {
    context.addIssue({
      code: 'custom', path: ['relatedEntityIds'],
      message: 'Relationships must reference at least two characters'
    })
  }
  if (draft.kind === 'character-state' && draft.relatedEntityIds.length < 1) {
    context.addIssue({
      code: 'custom', path: ['relatedEntityIds'],
      message: 'Character states must reference at least one character'
    })
  }
})

export type BibleEntryDraft = z.infer<typeof bibleEntryDraftSchema>

export const outlineNodeDraftSchema = z.object({
  kind: z.enum(OUTLINE_NODE_KINDS),
  parentId: identifierSchema.nullable(),
  title: titleSchema,
  summary: proseSchema,
  goal: proseSchema,
  conflict: proseSchema,
  turningPoint: proseSchema,
  hook: proseSchema,
  targetWords: z.number().int().min(0).max(20_000),
  participantCharacterIds: z.array(identifierSchema).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    'Participant IDs must be unique'
  ),
  position: z.number().int().min(0)
}).strict()

export type OutlineNodeDraft = z.infer<typeof outlineNodeDraftSchema>

export const proposalConflictSchema = z.object({
  field: z.string().trim().min(1).max(120),
  oldValue: z.string().max(10_000),
  newValue: z.string().max(10_000),
  sourceVersionId: identifierSchema,
  affectedEntityIds: z.array(identifierSchema).max(100)
}).strict()

export type ProposalConflict = z.infer<typeof proposalConflictSchema>

const proposalBaseShape = {
  operation: z.enum(['create', 'update']),
  targetEntityId: identifierSchema.nullable(),
  sourceVersionId: identifierSchema.nullable(),
  title: titleSchema,
  rationale: proseSchema,
  impact: proseSchema,
  priority: z.number().int().min(1).max(5),
  affectedEntityIds: z.array(identifierSchema).max(100),
  conflicts: z.array(proposalConflictSchema).max(20)
} as const

const settingKinds = ['world-setting', 'location', 'faction', 'item', 'timeline-event', 'foreshadow'] as const
const characterKinds = ['character', 'relationship', 'character-state'] as const

const settingEntryDraftSchema = bibleEntryDraftSchema.safeExtend({ kind: z.enum(settingKinds) }).strict()
const characterEntryDraftSchema = bibleEntryDraftSchema.safeExtend({ kind: z.enum(characterKinds) }).strict()

export const settingProposalCandidateSchema = z.object({
  ...proposalBaseShape,
  entry: settingEntryDraftSchema
}).strict()

export const characterProposalCandidateSchema = z.object({
  ...proposalBaseShape,
  entry: characterEntryDraftSchema
}).strict()

export const plotProposalCandidateSchema = z.object({
  ...proposalBaseShape,
  outline: outlineNodeDraftSchema
}).strict()

export const settingProposalBatchSchema = z.object({
  proposals: z.array(settingProposalCandidateSchema).max(3)
}).strict()

export const characterProposalBatchSchema = z.object({
  proposals: z.array(characterProposalCandidateSchema).max(3)
}).strict()

export const plotProposalBatchSchema = z.object({
  proposals: z.array(plotProposalCandidateSchema).max(3)
}).strict()

export type SettingProposalCandidate = z.infer<typeof settingProposalCandidateSchema>
export type CharacterProposalCandidate = z.infer<typeof characterProposalCandidateSchema>
export type PlotProposalCandidate = z.infer<typeof plotProposalCandidateSchema>
export type ProposalCandidate = SettingProposalCandidate | CharacterProposalCandidate | PlotProposalCandidate

const authoritySchema = z.enum(['user_confirmed', 'approved'])

export const novelProfileSchema = novelProfileDraftSchema.extend({
  id: identifierSchema,
  projectId: identifierSchema,
  authorityStatus: authoritySchema,
  currentVersionId: identifierSchema,
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema
}).strict()

export type NovelProfile = z.infer<typeof novelProfileSchema>

export const bibleEntrySchema = bibleEntryDraftSchema.extend({
  id: identifierSchema,
  projectId: identifierSchema,
  authorityStatus: authoritySchema,
  currentVersionId: identifierSchema,
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema
}).strict()

export type BibleEntry = z.infer<typeof bibleEntrySchema>

export const outlineNodeSchema = outlineNodeDraftSchema.extend({
  id: identifierSchema,
  projectId: identifierSchema,
  authorityStatus: authoritySchema,
  currentVersionId: identifierSchema,
  createdAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema
}).strict()

export type OutlineNode = z.infer<typeof outlineNodeSchema>

const proposalCandidateSchema = z.union([
  settingProposalCandidateSchema,
  characterProposalCandidateSchema,
  plotProposalCandidateSchema
])

export const bibleProposalSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
  sourceRunId: identifierSchema,
  schemaVersion: z.literal(1),
  domain: z.enum(PROPOSAL_DOMAINS),
  status: z.enum(PROPOSAL_STATUSES),
  sourceVersionIds: z.array(identifierSchema).max(500),
  candidate: proposalCandidateSchema,
  createdAt: canonicalTimestampSchema,
  decidedAt: canonicalTimestampSchema.nullable()
}).strict()

export type BibleProposal = z.infer<typeof bibleProposalSchema>

export const bibleSourceVersionSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
  entityType: z.enum(['novel-profile', ...BIBLE_ENTRY_KINDS, ...OUTLINE_NODE_KINDS]),
  entityId: identifierSchema,
  versionNumber: z.number().int().positive(),
  authorityStatus: authoritySchema,
  sourceKind: z.enum(['user', 'agent', 'restore']),
  sourceRunId: identifierSchema.nullable(),
  proposalId: identifierSchema.nullable(),
  snapshot: z.union([novelProfileDraftSchema, bibleEntryDraftSchema, outlineNodeDraftSchema]),
  supersedesVersionId: identifierSchema.nullable(),
  restoredFromVersionId: identifierSchema.nullable(),
  createdAt: canonicalTimestampSchema
}).strict()

export type BibleSourceVersion = z.infer<typeof bibleSourceVersionSchema>

export const novelBibleSnapshotSchema = z.object({
  projectId: identifierSchema,
  profile: novelProfileSchema.nullable(),
  entries: z.array(bibleEntrySchema),
  outline: z.array(outlineNodeSchema),
  proposals: z.array(bibleProposalSchema),
  loadedAt: canonicalTimestampSchema
}).strict()

export type NovelBibleSnapshot = z.infer<typeof novelBibleSnapshotSchema>

export type BibleErrorCode =
  | 'BIBLE_INVALID_COMMAND'
  | 'BIBLE_IPC_NOT_AUTHORIZED'
  | 'BIBLE_NOT_AVAILABLE'
  | 'BIBLE_CONFLICT'
  | 'BIBLE_PROPOSAL_STATE'
  | 'BIBLE_GENERATION_CANCELLED'
  | 'BIBLE_MODEL_NOT_CONFIGURED'
  | 'BIBLE_OPERATION_FAILED'

export type BiblePublicError = { code: BibleErrorCode; message: string; retryable: boolean }
export type BibleResult<T> = { ok: true; data: T } | { ok: false; error: BiblePublicError }

export class BibleDomainError extends Error {
  readonly code: BibleErrorCode
  readonly retryable: boolean

  constructor(code: BibleErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'BibleDomainError'
    this.code = code
    this.retryable = retryable
  }
}

export type SaveNovelProfileInput = {
  expectedVersionId: string | null
  draft: NovelProfileDraft
}
export type SaveBibleEntryInput = {
  entryId: string | null
  expectedVersionId: string | null
  draft: BibleEntryDraft
}
export type SaveOutlineNodeInput = {
  nodeId: string | null
  expectedVersionId: string | null
  draft: OutlineNodeDraft
}
export type MoveOutlineNodeInput = { nodeId: string; direction: 'up' | 'down' }
export type VersionTarget = { entityType: VersionedEntityType; entityId: string }
export type RestoreBibleVersionInput = VersionTarget & { versionId: string }
export type GenerateBibleProposalsInput = {
  requestId: string
  domain: ProposalDomain
  mode: GenerationMode
  request: string
  targetEntityId: string | null
}
export type DecideBibleProposalInput = {
  proposalId: string
  decision: 'approve' | 'reject'
  confirmReplacement: boolean
}

export const NOVEL_BIBLE_IPC_CHANNELS = {
  getSnapshot: 'novel-bible:get-snapshot',
  saveProfile: 'novel-bible:save-profile',
  saveEntry: 'novel-bible:save-entry',
  saveOutlineNode: 'novel-bible:save-outline-node',
  moveOutlineNode: 'novel-bible:move-outline-node',
  listVersions: 'novel-bible:list-versions',
  restoreVersion: 'novel-bible:restore-version',
  generateProposals: 'novel-bible:generate-proposals',
  cancelGeneration: 'novel-bible:cancel-generation',
  decideProposal: 'novel-bible:decide-proposal'
} as const

export type NovelBibleApi = {
  getSnapshot(): Promise<BibleResult<NovelBibleSnapshot>>
  saveProfile(input: SaveNovelProfileInput): Promise<BibleResult<NovelBibleSnapshot>>
  saveEntry(input: SaveBibleEntryInput): Promise<BibleResult<NovelBibleSnapshot>>
  saveOutlineNode(input: SaveOutlineNodeInput): Promise<BibleResult<NovelBibleSnapshot>>
  moveOutlineNode(input: MoveOutlineNodeInput): Promise<BibleResult<NovelBibleSnapshot>>
  listVersions(input: VersionTarget): Promise<BibleResult<BibleSourceVersion[]>>
  restoreVersion(input: RestoreBibleVersionInput): Promise<BibleResult<NovelBibleSnapshot>>
  generateProposals(input: GenerateBibleProposalsInput): Promise<BibleResult<BibleProposal[]>>
  cancelGeneration(requestId: string): Promise<BibleResult<null>>
  decideProposal(input: DecideBibleProposalInput): Promise<BibleResult<NovelBibleSnapshot>>
}

const saveProfileInputSchema = z.object({
  expectedVersionId: identifierSchema.nullable(),
  draft: novelProfileDraftSchema
}).strict()
const saveEntryInputSchema = z.object({
  entryId: identifierSchema.nullable(),
  expectedVersionId: identifierSchema.nullable(),
  draft: bibleEntryDraftSchema
}).strict()
const saveOutlineInputSchema = z.object({
  nodeId: identifierSchema.nullable(),
  expectedVersionId: identifierSchema.nullable(),
  draft: outlineNodeDraftSchema
}).strict()
const moveOutlineInputSchema = z.object({
  nodeId: identifierSchema,
  direction: z.enum(['up', 'down'])
}).strict()
const versionTargetSchema = z.object({
  entityType: z.enum(['novel-profile', ...BIBLE_ENTRY_KINDS, ...OUTLINE_NODE_KINDS]),
  entityId: identifierSchema
}).strict()
const restoreVersionInputSchema = versionTargetSchema.extend({ versionId: identifierSchema }).strict()
const generateProposalsInputSchema = z.object({
  requestId: identifierSchema,
  domain: z.enum(PROPOSAL_DOMAINS),
  mode: z.enum(['quick', 'standard', 'deep']),
  request: z.string().trim().min(1).max(8_000),
  targetEntityId: identifierSchema.nullable()
}).strict()
const decideProposalInputSchema = z.object({
  proposalId: identifierSchema,
  decision: z.enum(['approve', 'reject']),
  confirmReplacement: z.boolean()
}).strict()

export const validateNovelBibleCommand = (channel: string, args: readonly unknown[]): boolean => {
  const one = args.length === 1 ? args[0] : undefined
  switch (channel) {
    case NOVEL_BIBLE_IPC_CHANNELS.getSnapshot:
      return args.length === 0
    case NOVEL_BIBLE_IPC_CHANNELS.saveProfile:
      return args.length === 1 && saveProfileInputSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.saveEntry:
      return args.length === 1 && saveEntryInputSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.saveOutlineNode:
      return args.length === 1 && saveOutlineInputSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.moveOutlineNode:
      return args.length === 1 && moveOutlineInputSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.listVersions:
      return args.length === 1 && versionTargetSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.restoreVersion:
      return args.length === 1 && restoreVersionInputSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.generateProposals:
      return args.length === 1 && generateProposalsInputSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.cancelGeneration:
      return args.length === 1 && identifierSchema.safeParse(one).success
    case NOVEL_BIBLE_IPC_CHANNELS.decideProposal:
      return args.length === 1 && decideProposalInputSchema.safeParse(one).success
    default:
      return false
  }
}

export const isNovelBibleSnapshot = (value: unknown): value is NovelBibleSnapshot =>
  novelBibleSnapshotSchema.safeParse(value).success
export const isBibleProposal = (value: unknown): value is BibleProposal =>
  bibleProposalSchema.safeParse(value).success
export const isBibleSourceVersion = (value: unknown): value is BibleSourceVersion =>
  bibleSourceVersionSchema.safeParse(value).success

const bibleErrorSchema = z.object({
  code: z.enum([
    'BIBLE_INVALID_COMMAND',
    'BIBLE_IPC_NOT_AUTHORIZED',
    'BIBLE_NOT_AVAILABLE',
    'BIBLE_CONFLICT',
    'BIBLE_PROPOSAL_STATE',
    'BIBLE_GENERATION_CANCELLED',
    'BIBLE_MODEL_NOT_CONFIGURED',
    'BIBLE_OPERATION_FAILED'
  ]),
  message: z.string(),
  retryable: z.boolean()
}).strict()

export function isBibleResult(value: unknown): value is BibleResult<unknown>
export function isBibleResult<T>(
  value: unknown,
  validateData: (data: unknown) => data is T
): value is BibleResult<T>
export function isBibleResult<T>(
  value: unknown,
  validateData: (data: unknown) => data is T = (_data): _data is T => true
): value is BibleResult<T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.ok === true) {
    return Object.keys(record).sort().join('|') === 'data|ok' && validateData(record.data)
  }
  return record.ok === false && Object.keys(record).sort().join('|') === 'error|ok' &&
    bibleErrorSchema.safeParse(record.error).success
}
