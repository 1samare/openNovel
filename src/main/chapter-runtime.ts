import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import {
  previewImport as buildImportPreview,
  writeReferenceAttachment
} from '../export/import-service.ts'
import { renderDocx, renderMarkdown, renderText } from '../export/export-service.ts'
import { ChapterService } from '../novel/chapter-service.ts'
import type {
  CreateChapterInput,
  ExportFormat,
  ImportPreview,
  MoveChapterInput,
  PreviewImportRequest,
  RenameChapterInput,
  RestoreChapterVersionInput,
  SaveChapterDraftInput
} from '../shared/chapter.ts'
import { ProjectDomainError, type ProjectResult, type ProjectSummary } from '../shared/project.ts'
import type { AgentSenderPolicy } from './agent-ipc-security.ts'
import type { ChapterRuntimePort } from './chapter-ipc.ts'

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export type ChapterDialogs = {
  chooseImportFile(): Promise<string | undefined>
  chooseExportFile(format: ExportFormat, projectTitle: string): Promise<string | undefined>
}

type ProjectAccessor = { current(): ProjectSummary | undefined }

const safeFailure = (error: unknown): ProjectResult<never> => {
  if (error instanceof ProjectDomainError) {
    return { ok: false, error: { code: error.code, message: 'Chapter operation failed' } }
  }
  return { ok: false, error: { code: 'CHAPTER_OPERATION_FAILED', message: 'Chapter operation failed' } }
}

export const createChapterRuntime = (options: {
  project: ProjectAccessor
  dialogs: Partial<ChapterDialogs>
  senderPolicy: AgentSenderPolicy
  now?: () => string
}): ChapterRuntimePort & { close(): Promise<void> } => {
  let active: { projectId: string; root: string; service: ChapterService } | undefined
  let pendingPreview: string | undefined
  const now = options.now ?? (() => new Date().toISOString())

  const service = async (): Promise<{ summary: ProjectSummary; service: ChapterService }> => {
    const summary = options.project.current()
    if (summary === undefined) throw new ProjectDomainError('PROJECT_NOT_OPEN', 'No project is open')
    if (active !== undefined && (active.projectId !== summary.projectId || active.root !== summary.root)) {
      await active.service.close()
      active = undefined
    }
    if (active === undefined) {
      active = {
        projectId: summary.projectId,
        root: summary.root,
        service: await ChapterService.open(join(summary.root, 'project.sqlite3'), summary.projectId)
      }
    }
    return { summary, service: active.service }
  }

  const run = async <T>(operation: () => Promise<T>): Promise<ProjectResult<T>> => {
    try {
      return { ok: true, data: await operation() }
    } catch (error) {
      return safeFailure(error)
    }
  }

  const writeExport = async (path: string, bytes: Uint8Array): Promise<void> => {
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
    await mkdir(dirname(path), { recursive: true })
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  return {
    senderPolicy: options.senderPolicy,
    list: () => run(async () => (await service()).service.listTree()),
    create: (input: CreateChapterInput) => run(async () => (await service()).service.create({
      kind: input.kind,
      parentId: input.parentId ?? undefined,
      title: input.title
    })),
    rename: (input: RenameChapterInput) => run(async () =>
      (await service()).service.rename(input.chapterId, input.title)),
    move: (input: MoveChapterInput) => run(async () =>
      (await service()).service.move(input.chapterId, input.parentId ?? undefined, input.position)),
    remove: (chapterId: string) => run(async () => {
      await (await service()).service.remove(chapterId)
      return null
    }),
    load: (chapterId: string) => run(async () => (await service()).service.load(chapterId)),
    saveDraft: (input: SaveChapterDraftInput) => run(async () =>
      (await service()).service.saveDraft(input)),
    confirmVersion: (chapterId: string) => run(async () =>
      (await service()).service.confirm(chapterId)),
    listVersions: (chapterId: string) => run(async () =>
      (await service()).service.listVersions(chapterId)),
    restoreVersion: (input: RestoreChapterVersionInput) => run(async () =>
      (await service()).service.restoreVersion(input.chapterId, input.versionId)),
    previewImport: (input: PreviewImportRequest) => run(async () => {
      await service()
      let text = input.text
      let sourceName = input.sourceName
      let format: ImportPreview['format'] = 'paste'
      if (text === null || sourceName === null) {
        const selected = await options.dialogs.chooseImportFile?.()
        if (selected === undefined) return null
        if ((await stat(selected)).size > 20 * 1024 * 1024) {
          throw new ProjectDomainError('CHAPTER_OPERATION_FAILED', 'Import file is too large')
        }
        text = utf8Decoder.decode(await readFile(selected))
        sourceName = basename(selected)
        format = ['.md', '.markdown'].includes(extname(selected).toLowerCase()) ? 'markdown' : 'txt'
      }
      const preview = buildImportPreview({ sourceName, text, format, mode: input.mode })
      pendingPreview = JSON.stringify(preview)
      return preview
    }),
    confirmImport: (preview: ImportPreview) => run(async () => {
      if (pendingPreview === undefined || pendingPreview !== JSON.stringify(preview)) {
        throw new ProjectDomainError('INVALID_PROJECT_COMMAND', 'Import preview changed before confirmation')
      }
      const current = await service()
      pendingPreview = undefined
      if (preview.mode !== 'reference') return current.service.confirmImport(preview)
      const fileId = randomUUID()
      const attachment = await writeReferenceAttachment({
        attachmentsRoot: join(current.summary.root, 'attachments'),
        preview,
        fileId
      })
      try {
        await current.service.recordReferenceImport(preview, attachment.relativePath)
      } catch (error) {
        await unlink(attachment.absolutePath).catch(() => undefined)
        throw error
      }
      return []
    }),
    exportBook: (format: ExportFormat) => run(async () => {
      const current = await service()
      const destination = await options.dialogs.chooseExportFile?.(format, current.summary.title)
      if (destination === undefined) return null
      const snapshot = await current.service.exportSnapshot()
      const bytes = format === 'txt'
        ? renderText(snapshot)
        : format === 'markdown'
          ? renderMarkdown(snapshot)
          : await renderDocx(snapshot)
      await writeExport(destination, bytes)
      const hash = createHash('sha256').update(bytes).digest('hex')
      await current.service.recordExport(format, destination, hash)
      return {
        format,
        path: destination,
        chapterCount: snapshot.chapters.length,
        characterCount: snapshot.chapters.reduce((sum, chapter) => sum + chapter.characterCount, 0),
        createdAt: now()
      }
    }),
    close: async () => {
      pendingPreview = undefined
      const closing = active
      active = undefined
      await closing?.service.close()
    }
  }
}
