import {
  CHAPTER_IPC_CHANNELS,
  isChapterDocument,
  isChapterSummary,
  isChapterVersionSummary,
  isExportSummary,
  isImportPreview,
  type ChapterApi
} from '../shared/chapter.ts'
import { isProjectResult, type ProjectResult } from '../shared/project.ts'

export type ChapterIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

const unavailable = (): ProjectResult<never> => ({
  ok: false,
  error: { code: 'CHAPTER_OPERATION_FAILED', message: 'Chapter bridge returned an invalid result' }
})

const invoke = async <T>(
  ipcRenderer: ChapterIpcRenderer,
  channel: string,
  args: readonly unknown[],
  validateData: (data: unknown) => data is T
): Promise<ProjectResult<T>> => {
  try {
    const result = await ipcRenderer.invoke(channel, ...args)
    return isProjectResult(result, validateData)
      ? structuredClone(result) as ProjectResult<T>
      : unavailable()
  } catch {
    return unavailable()
  }
}

const isNull = (value: unknown): value is null => value === null
const isChapterList = (value: unknown): value is import('../shared/chapter.ts').ChapterSummary[] =>
  Array.isArray(value) && value.every(isChapterSummary)
const isVersionList = (value: unknown): value is import('../shared/chapter.ts').ChapterVersionSummary[] =>
  Array.isArray(value) && value.every(isChapterVersionSummary)
const isNullablePreview = (value: unknown): value is import('../shared/chapter.ts').ImportPreview | null =>
  value === null || isImportPreview(value)
const isNullableExport = (value: unknown): value is import('../shared/chapter.ts').ExportSummary | null =>
  value === null || isExportSummary(value)

export const createChapterApi = (ipcRenderer: ChapterIpcRenderer): ChapterApi => ({
  list: () => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.list, [], isChapterList),
  create: (input) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.create, [input], isChapterDocument),
  rename: (input) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.rename, [input], isChapterSummary),
  move: (input) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.move, [input], isChapterList),
  remove: (chapterId) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.remove, [chapterId], isNull),
  load: (chapterId) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.load, [chapterId], isChapterDocument),
  saveDraft: (input) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.saveDraft, [input], isChapterDocument),
  confirmVersion: (chapterId) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.confirmVersion, [chapterId], isChapterVersionSummary),
  listVersions: (chapterId) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.listVersions, [chapterId], isVersionList),
  restoreVersion: (input) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.restoreVersion, [input], isChapterDocument),
  previewImport: (input) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.previewImport, [input], isNullablePreview),
  confirmImport: (preview) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.confirmImport, [preview], isChapterList),
  exportBook: (format) => invoke(ipcRenderer, CHAPTER_IPC_CHANNELS.exportBook, [format], isNullableExport)
})
