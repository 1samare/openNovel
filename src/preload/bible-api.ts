import {
  NOVEL_BIBLE_IPC_CHANNELS,
  isBibleProposal,
  isBibleResult,
  isBibleSourceVersion,
  isNovelBibleSnapshot,
  type BibleProposal,
  type BibleResult,
  type BibleSourceVersion,
  type NovelBibleApi
} from '../shared/novel.ts'

export type BibleIpcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
}

const unavailable = (): BibleResult<never> => ({
  ok: false,
  error: {
    code: 'BIBLE_OPERATION_FAILED',
    message: 'Bible bridge returned an invalid result',
    retryable: false
  }
})

const invoke = async <T>(
  ipcRenderer: BibleIpcRenderer,
  channel: string,
  args: readonly unknown[],
  validateData: (value: unknown) => value is T
): Promise<BibleResult<T>> => {
  try {
    const result = await ipcRenderer.invoke(channel, ...args)
    return isBibleResult(result, validateData)
      ? structuredClone(result) as BibleResult<T>
      : unavailable()
  } catch {
    return unavailable()
  }
}

const isNull = (value: unknown): value is null => value === null
const isProposalList = (value: unknown): value is BibleProposal[] =>
  Array.isArray(value) && value.every(isBibleProposal)
const isVersionList = (value: unknown): value is BibleSourceVersion[] =>
  Array.isArray(value) && value.every(isBibleSourceVersion)

export const createBibleApi = (ipcRenderer: BibleIpcRenderer): NovelBibleApi => ({
  getSnapshot: () => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.getSnapshot, [], isNovelBibleSnapshot
  ),
  saveProfile: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.saveProfile, [input], isNovelBibleSnapshot
  ),
  saveEntry: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.saveEntry, [input], isNovelBibleSnapshot
  ),
  saveOutlineNode: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.saveOutlineNode, [input], isNovelBibleSnapshot
  ),
  moveOutlineNode: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.moveOutlineNode, [input], isNovelBibleSnapshot
  ),
  listVersions: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.listVersions, [input], isVersionList
  ),
  restoreVersion: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.restoreVersion, [input], isNovelBibleSnapshot
  ),
  generateProposals: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.generateProposals, [input], isProposalList
  ),
  cancelGeneration: (requestId) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.cancelGeneration, [requestId], isNull
  ),
  decideProposal: (input) => invoke(
    ipcRenderer, NOVEL_BIBLE_IPC_CHANNELS.decideProposal, [input], isNovelBibleSnapshot
  )
})
