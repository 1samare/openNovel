import { randomUUID } from 'node:crypto'
import {
  countChineseProseCharacters,
  type BookExportSnapshot,
  type ChapterDocument,
  type ChapterKind,
  type ChapterSummary,
  type ChapterVersionSummary,
  type ImportPreview,
  type SaveChapterDraftInput
} from '../shared/chapter.ts'
import { ProjectDomainError } from '../shared/project.ts'
import { DatabaseWorkerClient, type TransactionStatement } from './database-worker.ts'

type ChapterRow = {
  id: string
  project_id: string
  parent_id: string | null
  kind: ChapterKind
  title: string
  position: number
  current_version_id: string | null
  created_at: string
  updated_at: string
}

type DraftRow = {
  content: string
  revision: number
  saved_at: string
}

type VersionRow = {
  id: string
  chapter_id: string
  status: ChapterVersionSummary['status']
  content: string
  character_count: number
  source_version_id: string | null
  created_at: string
}

export type ChapterServiceDependencies = {
  createId(): string
  now(): string
}

const defaults: ChapterServiceDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString()
}

const normalizeTitle = (title: string): string => {
  if (typeof title !== 'string') {
    throw new ProjectDomainError('INVALID_CHAPTER_TITLE', 'Chapter title is required')
  }
  const normalized = title.trim()
  if (normalized.length === 0 || normalized.length > 120) {
    throw new ProjectDomainError('INVALID_CHAPTER_TITLE', 'Chapter title must be 1–120 characters')
  }
  return normalized
}

const rowToSummary = (row: ChapterRow): ChapterSummary => ({
  id: row.id,
  projectId: row.project_id,
  parentId: row.parent_id,
  kind: row.kind,
  title: row.title,
  position: Number(row.position),
  currentVersionId: row.current_version_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const rowToVersion = (row: VersionRow): ChapterVersionSummary => ({
  id: row.id,
  chapterId: row.chapter_id,
  status: row.status,
  content: row.content,
  characterCount: Number(row.character_count),
  sourceVersionId: row.source_version_id,
  createdAt: row.created_at
})

export class ChapterService {
  readonly #database: DatabaseWorkerClient
  readonly #projectId: string
  readonly #dependencies: ChapterServiceDependencies

  private constructor(
    database: DatabaseWorkerClient,
    projectId: string,
    dependencies: ChapterServiceDependencies
  ) {
    this.#database = database
    this.#projectId = projectId
    this.#dependencies = dependencies
  }

  static async open(
    databasePath: string,
    projectId: string,
    dependencies: Partial<ChapterServiceDependencies> = {}
  ): Promise<ChapterService> {
    const database = await DatabaseWorkerClient.open(databasePath)
    const project = await database.get<{ id: string }>('SELECT id FROM projects WHERE id = ?', [projectId])
    if (project === undefined) {
      await database.close()
      throw new ProjectDomainError('PROJECT_NOT_FOUND', 'Project data is missing')
    }
    return new ChapterService(database, projectId, { ...defaults, ...dependencies })
  }

  async listTree(): Promise<ChapterSummary[]> {
    const rows = await this.#database.all<ChapterRow>(
      `SELECT id, project_id, parent_id, kind, title, position,
              current_version_id, created_at, updated_at
       FROM chapters WHERE project_id = ?`,
      [this.#projectId]
    )
    const summaries = rows.map(rowToSummary)
    const children = new Map<string | null, ChapterSummary[]>()
    for (const summary of summaries) {
      const siblings = children.get(summary.parentId) ?? []
      siblings.push(summary)
      children.set(summary.parentId, siblings)
    }
    for (const siblings of children.values()) {
      siblings.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    }
    const ordered: ChapterSummary[] = []
    const visit = (parentId: string | null): void => {
      for (const summary of children.get(parentId) ?? []) {
        ordered.push(summary)
        visit(summary.id)
      }
    }
    visit(null)
    return ordered
  }

  async create(input: {
    parentId?: string
    kind: ChapterKind
    title: string
  }): Promise<ChapterDocument> {
    const title = normalizeTitle(input.title)
    const parentId = input.parentId ?? null
    await this.#validateParent(input.kind, parentId)
    const positionRow = await this.#database.get<{ position: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS position
       FROM chapters WHERE project_id = ? AND parent_id IS ?`,
      [this.#projectId, parentId]
    )
    const id = this.#dependencies.createId()
    const now = this.#dependencies.now()
    await this.#database.transaction([
      {
        sql: `INSERT INTO chapters (
                id, project_id, parent_id, kind, title, position,
                current_version_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        params: [id, this.#projectId, parentId, input.kind, title, positionRow?.position ?? 0, now, now]
      },
      this.#audit('chapter.created', { chapterId: id, kind: input.kind }, now)
    ])
    return {
      chapter: await this.#requireChapter(id),
      content: '',
      draftRevision: 0,
      savedAt: null,
      characterCount: 0
    }
  }

  async rename(chapterId: string, title: string): Promise<ChapterSummary> {
    await this.#requireChapter(chapterId)
    const normalized = normalizeTitle(title)
    const now = this.#dependencies.now()
    await this.#database.transaction([
      {
        sql: 'UPDATE chapters SET title = ?, updated_at = ? WHERE id = ? AND project_id = ?',
        params: [normalized, now, chapterId, this.#projectId]
      },
      this.#audit('chapter.renamed', { chapterId, title: normalized }, now)
    ])
    return this.#requireChapter(chapterId)
  }

  async move(
    chapterId: string,
    parentId: string | undefined,
    position: number
  ): Promise<ChapterSummary[]> {
    const moving = await this.#requireChapter(chapterId)
    const nextParentId = parentId ?? null
    await this.#validateParent(moving.kind, nextParentId)
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new ProjectDomainError('INVALID_CHAPTER_HIERARCHY', 'Chapter position is invalid')
    }
    const tree = await this.listTree()
    const oldSiblings = tree.filter((item) => item.parentId === moving.parentId && item.id !== chapterId)
    const nextSiblings = moving.parentId === nextParentId
      ? [...oldSiblings]
      : tree.filter((item) => item.parentId === nextParentId && item.id !== chapterId)
    nextSiblings.splice(Math.min(position, nextSiblings.length), 0, moving)
    const affected = new Map<string, ChapterSummary>()
    for (const item of [...oldSiblings, ...nextSiblings, moving]) affected.set(item.id, item)
    const statements: TransactionStatement[] = []
    let temporary = 1_000_000
    for (const item of affected.values()) {
      statements.push({
        sql: 'UPDATE chapters SET position = ? WHERE id = ? AND project_id = ?',
        params: [temporary++, item.id, this.#projectId]
      })
    }
    statements.push({
      sql: 'UPDATE chapters SET parent_id = ?, position = ? WHERE id = ? AND project_id = ?',
      params: [nextParentId, 2_000_000, chapterId, this.#projectId]
    })
    const groups = moving.parentId === nextParentId
      ? [{ parentId: nextParentId, items: nextSiblings }]
      : [
          { parentId: moving.parentId, items: oldSiblings },
          { parentId: nextParentId, items: nextSiblings }
        ]
    const now = this.#dependencies.now()
    for (const group of groups) {
      group.items.forEach((item, index) => statements.push({
        sql: `UPDATE chapters SET parent_id = ?, position = ?, updated_at = ?
              WHERE id = ? AND project_id = ?`,
        params: [group.parentId, index, now, item.id, this.#projectId]
      }))
    }
    statements.push(this.#audit('chapter.moved', { chapterId, parentId: nextParentId, position }, now))
    await this.#database.transaction(statements)
    return this.listTree()
  }

  async remove(chapterId: string): Promise<void> {
    const chapter = await this.#requireChapter(chapterId)
    const child = await this.#database.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM chapters WHERE parent_id = ?',
      [chapterId]
    )
    if (Number(child?.count ?? 0) > 0) {
      throw new ProjectDomainError('CHAPTER_HAS_CHILDREN', 'Chapter group still has children')
    }
    const siblings = (await this.listTree()).filter(
      (item) => item.parentId === chapter.parentId && item.id !== chapterId
    )
    const now = this.#dependencies.now()
    const statements: TransactionStatement[] = [
      { sql: 'DELETE FROM chapters WHERE id = ? AND project_id = ?', params: [chapterId, this.#projectId] }
    ]
    siblings.forEach((item, index) => statements.push({
      sql: 'UPDATE chapters SET position = ?, updated_at = ? WHERE id = ? AND project_id = ?',
      params: [index, now, item.id, this.#projectId]
    }))
    statements.push(this.#audit('chapter.removed', { chapterId }, now))
    await this.#database.transaction(statements)
  }

  async load(chapterId: string): Promise<ChapterDocument> {
    const chapter = await this.#requireChapter(chapterId)
    const draft = await this.#database.get<DraftRow>(
      'SELECT content, revision, saved_at FROM chapter_drafts WHERE chapter_id = ?',
      [chapterId]
    )
    if (draft !== undefined) {
      return {
        chapter,
        content: draft.content,
        draftRevision: Number(draft.revision),
        savedAt: draft.saved_at,
        characterCount: countChineseProseCharacters(draft.content)
      }
    }
    const version = chapter.currentVersionId === null
      ? undefined
      : await this.#database.get<{ content: string }>(
          'SELECT content FROM chapter_versions WHERE id = ? AND chapter_id = ?',
          [chapter.currentVersionId, chapterId]
        )
    const content = version?.content ?? ''
    return { chapter, content, draftRevision: 0, savedAt: null, characterCount: countChineseProseCharacters(content) }
  }

  async saveDraft(input: SaveChapterDraftInput): Promise<ChapterDocument> {
    await this.#requireChapter(input.chapterId)
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new ProjectDomainError('CHAPTER_SAVE_CONFLICT', 'Draft revision is invalid')
    }
    const now = this.#dependencies.now()
    const nextRevision = input.expectedRevision + 1
    try {
      await this.#database.transaction([
        {
          sql: `INSERT INTO chapter_drafts (chapter_id, content, revision, saved_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(chapter_id) DO UPDATE SET
                  content = excluded.content,
                  revision = excluded.revision,
                  saved_at = excluded.saved_at
                WHERE chapter_drafts.revision = ?`,
          params: [input.chapterId, input.content, nextRevision, now, input.expectedRevision],
          expectedChanges: 1
        },
        {
          sql: 'UPDATE chapters SET updated_at = ? WHERE id = ? AND project_id = ?',
          params: [now, input.chapterId, this.#projectId]
        },
        this.#audit('chapter.draft-saved', { chapterId: input.chapterId, revision: nextRevision }, now)
      ])
    } catch (error) {
      if (error instanceof ProjectDomainError && error.code === 'DATABASE_EXPECTED_CHANGES_MISMATCH') {
        throw new ProjectDomainError('CHAPTER_SAVE_CONFLICT', 'Draft changed while saving')
      }
      throw error
    }
    const saved = await this.load(input.chapterId)
    if (saved.draftRevision !== nextRevision) {
      throw new ProjectDomainError('CHAPTER_SAVE_CONFLICT', 'Draft changed while saving')
    }
    return saved
  }

  async confirm(chapterId: string): Promise<ChapterVersionSummary> {
    const document = await this.load(chapterId)
    const id = this.#dependencies.createId()
    const now = this.#dependencies.now()
    await this.#database.transaction([
      {
        sql: `UPDATE chapter_versions SET status = 'superseded'
              WHERE chapter_id = ? AND status = 'confirmed'`,
        params: [chapterId]
      },
      {
        sql: `INSERT INTO chapter_versions (
                id, chapter_id, status, content, character_count, source_version_id, created_at
              ) VALUES (?, ?, 'confirmed', ?, ?, ?, ?)`,
        params: [
          id,
          chapterId,
          document.content,
          document.characterCount,
          document.chapter.currentVersionId,
          now
        ]
      },
      {
        sql: 'UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ? AND project_id = ?',
        params: [id, now, chapterId, this.#projectId]
      },
      this.#audit('chapter.version-confirmed', { chapterId, versionId: id }, now)
    ])
    const version = await this.#database.get<VersionRow>(
      `SELECT id, chapter_id, status, content, character_count, source_version_id, created_at
       FROM chapter_versions WHERE id = ?`,
      [id]
    )
    if (version === undefined) throw new ProjectDomainError('CHAPTER_OPERATION_FAILED', 'Version was not saved')
    return rowToVersion(version)
  }

  async listVersions(chapterId: string): Promise<ChapterVersionSummary[]> {
    await this.#requireChapter(chapterId)
    const rows = await this.#database.all<VersionRow>(
      `SELECT id, chapter_id, status, content, character_count, source_version_id, created_at
       FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC, id DESC`,
      [chapterId]
    )
    return rows.map(rowToVersion)
  }

  async restoreVersion(chapterId: string, versionId: string): Promise<ChapterDocument> {
    await this.#requireChapter(chapterId)
    const version = await this.#database.get<VersionRow>(
      `SELECT id, chapter_id, status, content, character_count, source_version_id, created_at
       FROM chapter_versions WHERE id = ? AND chapter_id = ?`,
      [versionId, chapterId]
    )
    if (version === undefined) throw new ProjectDomainError('CHAPTER_NOT_FOUND', 'Chapter version does not exist')
    const current = await this.load(chapterId)
    return this.saveDraft({ chapterId, content: version.content, expectedRevision: current.draftRevision })
  }

  async confirmImport(preview: ImportPreview): Promise<ChapterSummary[]> {
    if (preview.mode === 'reference' || preview.chapters.length === 0) {
      throw new ProjectDomainError('CHAPTER_OPERATION_FAILED', 'Import preview has no chapters')
    }
    const starting = await this.#database.get<{ position: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS position
       FROM chapters WHERE project_id = ? AND parent_id IS NULL`,
      [this.#projectId]
    )
    const now = this.#dependencies.now()
    const jobId = this.#dependencies.createId()
    const chapterIds: string[] = []
    const statements: TransactionStatement[] = [{
      sql: `INSERT INTO import_jobs (
              id, project_id, source_name, source_format, mode, status,
              preview_json, error_code, created_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, 'completed', ?, NULL, ?, ?)`,
      params: [
        jobId,
        this.#projectId,
        preview.sourceName,
        preview.format,
        preview.mode,
        JSON.stringify(preview),
        now,
        now
      ]
    }]
    preview.chapters.forEach((chapter, index) => {
      const chapterId = this.#dependencies.createId()
      const versionId = this.#dependencies.createId()
      chapterIds.push(chapterId)
      statements.push(
        {
          sql: `INSERT INTO chapters (
                  id, project_id, parent_id, kind, title, position,
                  current_version_id, created_at, updated_at
                ) VALUES (?, ?, NULL, 'chapter', ?, ?, NULL, ?, ?)`,
          params: [chapterId, this.#projectId, chapter.title, (starting?.position ?? 0) + index, now, now]
        },
        {
          sql: `INSERT INTO chapter_versions (
                  id, chapter_id, status, content, character_count, source_version_id, created_at
                ) VALUES (?, ?, 'draft', ?, ?, NULL, ?)`,
          params: [versionId, chapterId, chapter.content, chapter.characterCount, now]
        },
        {
          sql: `INSERT INTO chapter_drafts (chapter_id, content, revision, saved_at)
                VALUES (?, ?, 1, ?)`,
          params: [chapterId, chapter.content, now]
        }
      )
    })
    statements.push(this.#audit('chapters.imported', { jobId, chapterIds }, now))
    await this.#database.transaction(statements)
    const tree = await this.listTree()
    const imported = new Set(chapterIds)
    return tree.filter((chapter) => imported.has(chapter.id))
  }

  async recordReferenceImport(preview: ImportPreview, relativePath: string): Promise<void> {
    if (preview.mode !== 'reference' || preview.referenceContent === null) {
      throw new ProjectDomainError('CHAPTER_OPERATION_FAILED', 'Reference preview is invalid')
    }
    const now = this.#dependencies.now()
    const jobId = this.#dependencies.createId()
    await this.#database.transaction([
      {
        sql: `INSERT INTO import_jobs (
                id, project_id, source_name, source_format, mode, status,
                preview_json, error_code, created_at, completed_at
              ) VALUES (?, ?, ?, ?, 'reference', 'completed', ?, NULL, ?, ?)`,
        params: [
          jobId,
          this.#projectId,
          preview.sourceName,
          preview.format,
          JSON.stringify({ ...preview, attachmentPath: relativePath }),
          now,
          now
        ]
      },
      this.#audit('reference.imported', { jobId, relativePath }, now)
    ])
  }

  async recordExport(
    format: 'txt' | 'markdown' | 'docx',
    destinationPath: string,
    snapshotHash: string
  ): Promise<void> {
    const now = this.#dependencies.now()
    const jobId = this.#dependencies.createId()
    await this.#database.transaction([
      {
        sql: `INSERT INTO export_jobs (
                id, project_id, format, status, destination_path,
                snapshot_hash, created_at, completed_at
              ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
        params: [jobId, this.#projectId, format, destinationPath, snapshotHash, now, now]
      },
      this.#audit('book.exported', { jobId, format }, now)
    ])
  }

  async exportSnapshot(): Promise<BookExportSnapshot> {
    const [project, rows] = await this.#database.readTransaction<[
      { id: string; title: string; created_at: string } | undefined,
      Array<ChapterRow & { content: string }>
    ]>([
      {
        type: 'get',
        sql: 'SELECT id, title, created_at FROM projects WHERE id = ?',
        params: [this.#projectId]
      },
      {
        type: 'all',
        sql: `SELECT c.id, c.project_id, c.parent_id, c.kind, c.title, c.position,
                     c.current_version_id, c.created_at, c.updated_at,
                     COALESCE(d.content, v.content, '') AS content
              FROM chapters c
              LEFT JOIN chapter_drafts d ON d.chapter_id = c.id
              LEFT JOIN chapter_versions v ON v.id = c.current_version_id
              WHERE c.project_id = ?`,
        params: [this.#projectId]
      }
    ])
    if (project === undefined) throw new ProjectDomainError('PROJECT_NOT_FOUND', 'Project data is missing')
    const summaries = rows.map(rowToSummary)
    const byId = new Map(summaries.map((chapter) => [chapter.id, chapter]))
    const contentById = new Map(rows.map((row) => [row.id, row.content]))
    const children = new Map<string | null, ChapterSummary[]>()
    for (const chapter of summaries) {
      const siblings = children.get(chapter.parentId) ?? []
      siblings.push(chapter)
      children.set(chapter.parentId, siblings)
    }
    for (const siblings of children.values()) siblings.sort((a, b) => a.position - b.position)
    const ordered: ChapterSummary[] = []
    const visit = (parentId: string | null): void => {
      for (const chapter of children.get(parentId) ?? []) {
        if (chapter.kind === 'chapter') ordered.push(chapter)
        visit(chapter.id)
      }
    }
    visit(null)
    return {
      projectId: project.id,
      title: project.title,
      createdAt: project.created_at,
      chapters: ordered.map((chapter) => {
        const content = contentById.get(chapter.id) ?? ''
        const parent = chapter.parentId === null ? undefined : byId.get(chapter.parentId)
        return {
          id: chapter.id,
          title: chapter.title,
          volumeTitle: parent?.kind === 'volume' ? parent.title : null,
          content,
          characterCount: countChineseProseCharacters(content)
        }
      })
    }
  }

  close(): Promise<void> {
    return this.#database.close()
  }

  async #requireChapter(chapterId: string): Promise<ChapterSummary> {
    const row = await this.#database.get<ChapterRow>(
      `SELECT id, project_id, parent_id, kind, title, position,
              current_version_id, created_at, updated_at
       FROM chapters WHERE id = ? AND project_id = ?`,
      [chapterId, this.#projectId]
    )
    if (row === undefined) throw new ProjectDomainError('CHAPTER_NOT_FOUND', 'Chapter does not exist')
    return rowToSummary(row)
  }

  async #validateParent(kind: ChapterKind, parentId: string | null): Promise<void> {
    if (kind === 'volume' && parentId !== null) {
      throw new ProjectDomainError('INVALID_CHAPTER_HIERARCHY', 'Volumes must be at the root')
    }
    if (parentId === null) return
    const parent = await this.#requireChapter(parentId)
    if (kind !== 'chapter' || parent.kind !== 'volume') {
      throw new ProjectDomainError('INVALID_CHAPTER_HIERARCHY', 'Chapters may only belong to a volume')
    }
  }

  #audit(eventType: string, payload: Record<string, unknown>, createdAt: string): TransactionStatement {
    return {
      sql: `INSERT INTO audit_events (id, project_id, event_type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      params: [this.#dependencies.createId(), this.#projectId, eventType, JSON.stringify(payload), createdAt]
    }
  }
}
