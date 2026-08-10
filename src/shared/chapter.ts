export type ChapterKind = 'volume' | 'chapter'
export type ChapterVersionStatus = 'draft' | 'confirmed' | 'superseded'

export type ChapterSummary = {
  id: string
  projectId: string
  parentId: string | null
  kind: ChapterKind
  title: string
  position: number
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
}

export type ChapterDocument = {
  chapter: ChapterSummary
  content: string
  draftRevision: number
  savedAt: string | null
  characterCount: number
}

export type SaveChapterDraftInput = {
  chapterId: string
  content: string
  expectedRevision: number
}

export type ChapterVersionSummary = {
  id: string
  chapterId: string
  status: ChapterVersionStatus
  content: string
  characterCount: number
  sourceVersionId: string | null
  createdAt: string
}

export type ImportSourceFormat = 'txt' | 'markdown' | 'paste'
export type ImportMode = 'reference' | 'single-chapter' | 'split-chapters'

export type ImportPreviewChapter = {
  title: string
  content: string
  characterCount: number
}

export type ImportPreview = {
  sourceName: string
  format: ImportSourceFormat
  mode: ImportMode
  referenceContent: string | null
  chapters: ImportPreviewChapter[]
}

export type BookExportChapter = {
  id: string
  title: string
  volumeTitle: string | null
  content: string
  characterCount: number
}

export type BookExportSnapshot = {
  projectId: string
  title: string
  createdAt: string
  chapters: BookExportChapter[]
}

export type CreateChapterInput = {
  kind: ChapterKind
  parentId: string | null
  title: string
}

export type RenameChapterInput = { chapterId: string; title: string }
export type MoveChapterInput = { chapterId: string; parentId: string | null; position: number }
export type RestoreChapterVersionInput = { chapterId: string; versionId: string }
export type PreviewImportRequest = {
  mode: ImportMode
  text: string | null
  sourceName: string | null
}
export type ExportFormat = 'txt' | 'markdown' | 'docx'
export type ExportSummary = {
  format: ExportFormat
  path: string
  chapterCount: number
  characterCount: number
  createdAt: string
}

export const CHAPTER_IPC_CHANNELS = {
  list: 'chapters:list',
  create: 'chapters:create',
  rename: 'chapters:rename',
  move: 'chapters:move',
  remove: 'chapters:remove',
  load: 'chapters:load',
  saveDraft: 'chapters:save-draft',
  confirmVersion: 'chapters:confirm-version',
  listVersions: 'chapters:list-versions',
  restoreVersion: 'chapters:restore-version',
  previewImport: 'chapters:preview-import',
  confirmImport: 'chapters:confirm-import',
  exportBook: 'chapters:export-book'
} as const

export type ChapterApi = {
  list(): Promise<import('./project.ts').ProjectResult<ChapterSummary[]>>
  create(input: CreateChapterInput): Promise<import('./project.ts').ProjectResult<ChapterDocument>>
  rename(input: RenameChapterInput): Promise<import('./project.ts').ProjectResult<ChapterSummary>>
  move(input: MoveChapterInput): Promise<import('./project.ts').ProjectResult<ChapterSummary[]>>
  remove(chapterId: string): Promise<import('./project.ts').ProjectResult<null>>
  load(chapterId: string): Promise<import('./project.ts').ProjectResult<ChapterDocument>>
  saveDraft(input: SaveChapterDraftInput): Promise<import('./project.ts').ProjectResult<ChapterDocument>>
  confirmVersion(chapterId: string): Promise<import('./project.ts').ProjectResult<ChapterVersionSummary>>
  listVersions(chapterId: string): Promise<import('./project.ts').ProjectResult<ChapterVersionSummary[]>>
  restoreVersion(input: RestoreChapterVersionInput): Promise<import('./project.ts').ProjectResult<ChapterDocument>>
  previewImport(input: PreviewImportRequest): Promise<import('./project.ts').ProjectResult<ImportPreview | null>>
  confirmImport(preview: ImportPreview): Promise<import('./project.ts').ProjectResult<ChapterSummary[]>>
  exportBook(format: ExportFormat): Promise<import('./project.ts').ProjectResult<ExportSummary | null>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|')

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value)

const isTitle = (value: unknown): value is string =>
  typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 120

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

export const countChineseProseCharacters = (content: string): number =>
  Array.from(content.normalize('NFC').replace(/[\p{White_Space}\p{P}]/gu, '')).length

export const isChapterSummary = (value: unknown): value is ChapterSummary => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id',
    'projectId',
    'parentId',
    'kind',
    'title',
    'position',
    'currentVersionId',
    'createdAt',
    'updatedAt'
  ])) return false
  return isIdentifier(value.id) &&
    isIdentifier(value.projectId) &&
    (value.parentId === null || isIdentifier(value.parentId)) &&
    (value.kind === 'volume' || value.kind === 'chapter') &&
    isTitle(value.title) &&
    Number.isSafeInteger(value.position) && Number(value.position) >= 0 &&
    (value.currentVersionId === null || isIdentifier(value.currentVersionId)) &&
    isCanonicalTimestamp(value.createdAt) &&
    isCanonicalTimestamp(value.updatedAt) &&
    Date.parse(value.updatedAt as string) >= Date.parse(value.createdAt as string)
}

export const isChapterDocument = (value: unknown): value is ChapterDocument => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'chapter',
    'content',
    'draftRevision',
    'savedAt',
    'characterCount'
  ])) return false
  return isChapterSummary(value.chapter) &&
    typeof value.content === 'string' &&
    Number.isSafeInteger(value.draftRevision) && Number(value.draftRevision) >= 0 &&
    (value.savedAt === null || isCanonicalTimestamp(value.savedAt)) &&
    Number.isSafeInteger(value.characterCount) &&
    value.characterCount === countChineseProseCharacters(value.content)
}

export const isChapterVersionSummary = (value: unknown): value is ChapterVersionSummary => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'chapterId', 'status', 'content', 'characterCount', 'sourceVersionId', 'createdAt'
  ])) return false
  return isIdentifier(value.id) &&
    isIdentifier(value.chapterId) &&
    (value.status === 'draft' || value.status === 'confirmed' || value.status === 'superseded') &&
    typeof value.content === 'string' &&
    value.characterCount === countChineseProseCharacters(value.content) &&
    (value.sourceVersionId === null || isIdentifier(value.sourceVersionId)) &&
    isCanonicalTimestamp(value.createdAt)
}

const isImportMode = (value: unknown): value is ImportMode =>
  value === 'reference' || value === 'single-chapter' || value === 'split-chapters'

export const isImportPreview = (value: unknown): value is ImportPreview => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'sourceName', 'format', 'mode', 'referenceContent', 'chapters'
  ])) return false
  if (
    typeof value.sourceName !== 'string' || value.sourceName.length === 0 || value.sourceName.length > 260 ||
    (value.format !== 'txt' && value.format !== 'markdown' && value.format !== 'paste') ||
    !isImportMode(value.mode) ||
    (value.referenceContent !== null && typeof value.referenceContent !== 'string') ||
    !Array.isArray(value.chapters)
  ) return false
  const chaptersValid = value.chapters.every((chapter) =>
    isRecord(chapter) &&
    hasExactKeys(chapter, ['title', 'content', 'characterCount']) &&
    isTitle(chapter.title) &&
    typeof chapter.content === 'string' &&
    chapter.characterCount === countChineseProseCharacters(chapter.content)
  )
  return chaptersValid && (value.mode === 'reference'
    ? value.referenceContent !== null && value.chapters.length === 0
    : value.referenceContent === null)
}

export const isExportSummary = (value: unknown): value is ExportSummary =>
  isRecord(value) &&
  hasExactKeys(value, ['format', 'path', 'chapterCount', 'characterCount', 'createdAt']) &&
  (value.format === 'txt' || value.format === 'markdown' || value.format === 'docx') &&
  typeof value.path === 'string' && value.path.length > 0 &&
  Number.isSafeInteger(value.chapterCount) && Number(value.chapterCount) >= 0 &&
  Number.isSafeInteger(value.characterCount) && Number(value.characterCount) >= 0 &&
  isCanonicalTimestamp(value.createdAt)

const exactObject = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isRecord(value) && hasExactKeys(value, keys)

export const validateChapterCommand = (channel: string, args: readonly unknown[]): boolean => {
  const input = args[0]
  switch (channel) {
    case CHAPTER_IPC_CHANNELS.list:
      return args.length === 0
    case CHAPTER_IPC_CHANNELS.create:
      return args.length === 1 && exactObject(input, ['kind', 'parentId', 'title']) &&
        (input.kind === 'volume' || input.kind === 'chapter') &&
        (input.parentId === null || isIdentifier(input.parentId)) && isTitle(input.title)
    case CHAPTER_IPC_CHANNELS.rename:
      return args.length === 1 && exactObject(input, ['chapterId', 'title']) &&
        isIdentifier(input.chapterId) && isTitle(input.title)
    case CHAPTER_IPC_CHANNELS.move:
      return args.length === 1 && exactObject(input, ['chapterId', 'parentId', 'position']) &&
        isIdentifier(input.chapterId) && (input.parentId === null || isIdentifier(input.parentId)) &&
        Number.isSafeInteger(input.position) && Number(input.position) >= 0
    case CHAPTER_IPC_CHANNELS.remove:
    case CHAPTER_IPC_CHANNELS.load:
    case CHAPTER_IPC_CHANNELS.confirmVersion:
    case CHAPTER_IPC_CHANNELS.listVersions:
      return args.length === 1 && isIdentifier(input)
    case CHAPTER_IPC_CHANNELS.saveDraft:
      return args.length === 1 && exactObject(input, ['chapterId', 'content', 'expectedRevision']) &&
        isIdentifier(input.chapterId) && typeof input.content === 'string' &&
        Number.isSafeInteger(input.expectedRevision) && Number(input.expectedRevision) >= 0
    case CHAPTER_IPC_CHANNELS.restoreVersion:
      return args.length === 1 && exactObject(input, ['chapterId', 'versionId']) &&
        isIdentifier(input.chapterId) && isIdentifier(input.versionId)
    case CHAPTER_IPC_CHANNELS.previewImport:
      return args.length === 1 && exactObject(input, ['mode', 'text', 'sourceName']) &&
        isImportMode(input.mode) && (
          (input.text === null && input.sourceName === null) ||
          (typeof input.text === 'string' && typeof input.sourceName === 'string' && input.sourceName.length > 0)
        )
    case CHAPTER_IPC_CHANNELS.confirmImport:
      return args.length === 1 && isImportPreview(input)
    case CHAPTER_IPC_CHANNELS.exportBook:
      return args.length === 1 && (input === 'txt' || input === 'markdown' || input === 'docx')
    default:
      return false
  }
}
