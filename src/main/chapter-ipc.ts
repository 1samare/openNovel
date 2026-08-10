import type {
  ChapterDocument,
  ChapterSummary,
  ChapterVersionSummary,
  CreateChapterInput,
  ExportFormat,
  ExportSummary,
  ImportPreview,
  MoveChapterInput,
  PreviewImportRequest,
  RenameChapterInput,
  RestoreChapterVersionInput,
  SaveChapterDraftInput
} from '../shared/chapter.ts'
import { CHAPTER_IPC_CHANNELS, validateChapterCommand } from '../shared/chapter.ts'
import type { ProjectResult } from '../shared/project.ts'
import { isAllowedAgentIpcSender, type AgentIpcSenderEvent, type AgentSenderPolicy } from './agent-ipc-security.ts'

export type ChapterRuntimePort = {
  senderPolicy: AgentSenderPolicy
  list(): Promise<ProjectResult<ChapterSummary[]>>
  create(input: CreateChapterInput): Promise<ProjectResult<ChapterDocument>>
  rename(input: RenameChapterInput): Promise<ProjectResult<ChapterSummary>>
  move(input: MoveChapterInput): Promise<ProjectResult<ChapterSummary[]>>
  remove(chapterId: string): Promise<ProjectResult<null>>
  load(chapterId: string): Promise<ProjectResult<ChapterDocument>>
  saveDraft(input: SaveChapterDraftInput): Promise<ProjectResult<ChapterDocument>>
  confirmVersion(chapterId: string): Promise<ProjectResult<ChapterVersionSummary>>
  listVersions(chapterId: string): Promise<ProjectResult<ChapterVersionSummary[]>>
  restoreVersion(input: RestoreChapterVersionInput): Promise<ProjectResult<ChapterDocument>>
  previewImport(input: PreviewImportRequest): Promise<ProjectResult<ImportPreview | null>>
  confirmImport(preview: ImportPreview): Promise<ProjectResult<ChapterSummary[]>>
  exportBook(format: ExportFormat): Promise<ProjectResult<ExportSummary | null>>
}

export type ChapterIpcMain = {
  handle(channel: string, handler: (event: AgentIpcSenderEvent, ...args: unknown[]) => Promise<unknown>): void
  removeHandler(channel: string): void
}

const unauthorized = (): ProjectResult<never> => ({
  ok: false,
  error: { code: 'IPC_NOT_AUTHORIZED', message: 'Chapter command is not authorized' }
})

const invalid = (): ProjectResult<never> => ({
  ok: false,
  error: { code: 'INVALID_PROJECT_COMMAND', message: 'Chapter command arguments are invalid' }
})

export const registerChapterIpcHandlers = (
  ipcMain: ChapterIpcMain,
  runtime: ChapterRuntimePort
): (() => void) => {
  for (const channel of Object.values(CHAPTER_IPC_CHANNELS)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAllowedAgentIpcSender(event, runtime.senderPolicy)) return unauthorized()
      if (!validateChapterCommand(channel, args)) return invalid()
      switch (channel) {
        case CHAPTER_IPC_CHANNELS.list: return runtime.list()
        case CHAPTER_IPC_CHANNELS.create: return runtime.create(args[0] as CreateChapterInput)
        case CHAPTER_IPC_CHANNELS.rename: return runtime.rename(args[0] as RenameChapterInput)
        case CHAPTER_IPC_CHANNELS.move: return runtime.move(args[0] as MoveChapterInput)
        case CHAPTER_IPC_CHANNELS.remove: return runtime.remove(args[0] as string)
        case CHAPTER_IPC_CHANNELS.load: return runtime.load(args[0] as string)
        case CHAPTER_IPC_CHANNELS.saveDraft: return runtime.saveDraft(args[0] as SaveChapterDraftInput)
        case CHAPTER_IPC_CHANNELS.confirmVersion: return runtime.confirmVersion(args[0] as string)
        case CHAPTER_IPC_CHANNELS.listVersions: return runtime.listVersions(args[0] as string)
        case CHAPTER_IPC_CHANNELS.restoreVersion: return runtime.restoreVersion(args[0] as RestoreChapterVersionInput)
        case CHAPTER_IPC_CHANNELS.previewImport: return runtime.previewImport(args[0] as PreviewImportRequest)
        case CHAPTER_IPC_CHANNELS.confirmImport: return runtime.confirmImport(args[0] as ImportPreview)
        case CHAPTER_IPC_CHANNELS.exportBook: return runtime.exportBook(args[0] as ExportFormat)
      }
    })
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const channel of Object.values(CHAPTER_IPC_CHANNELS)) ipcMain.removeHandler(channel)
  }
}
