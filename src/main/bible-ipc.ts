import {
  NOVEL_BIBLE_IPC_CHANNELS,
  isBibleProposal,
  isBibleResult,
  isBibleSourceVersion,
  isNovelBibleSnapshot,
  validateNovelBibleCommand,
  type BibleResult,
  type BibleSourceVersion,
  type DecideBibleProposalInput,
  type GenerateBibleProposalsInput,
  type MoveOutlineNodeInput,
  type NovelBibleSnapshot,
  type SaveNovelProfileInput,
  type RestoreBibleVersionInput,
  type SaveBibleEntryInput,
  type SaveOutlineNodeInput,
  type VersionTarget
} from '../shared/novel.ts'
import {
  isAllowedAgentIpcSender,
  type AgentIpcSenderEvent,
  type AgentSenderPolicy
} from './agent-ipc-security.ts'

export type BibleRuntimePort = {
  senderPolicy: AgentSenderPolicy
  getSnapshot(): Promise<BibleResult<NovelBibleSnapshot>>
  saveProfile(input: SaveNovelProfileInput): Promise<BibleResult<NovelBibleSnapshot>>
  saveEntry(input: SaveBibleEntryInput): Promise<BibleResult<NovelBibleSnapshot>>
  saveOutlineNode(input: SaveOutlineNodeInput): Promise<BibleResult<NovelBibleSnapshot>>
  moveOutlineNode(input: MoveOutlineNodeInput): Promise<BibleResult<NovelBibleSnapshot>>
  listVersions(input: VersionTarget): Promise<BibleResult<BibleSourceVersion[]>>
  restoreVersion(input: RestoreBibleVersionInput): Promise<BibleResult<NovelBibleSnapshot>>
  generateProposals(input: GenerateBibleProposalsInput): Promise<BibleResult<import('../shared/novel.ts').BibleProposal[]>>
  cancelGeneration(requestId: string): Promise<BibleResult<null>>
  decideProposal(input: DecideBibleProposalInput): Promise<BibleResult<NovelBibleSnapshot>>
}

export type BibleIpcMain = {
  handle(channel: string, handler: (event: AgentIpcSenderEvent, ...args: unknown[]) => Promise<unknown>): void
  removeHandler(channel: string): void
}

const failure = (
  code: 'BIBLE_IPC_NOT_AUTHORIZED' | 'BIBLE_INVALID_COMMAND' | 'BIBLE_OPERATION_FAILED'
): BibleResult<never> => ({
  ok: false,
  error: {
    code,
    message: code === 'BIBLE_IPC_NOT_AUTHORIZED'
      ? 'Bible command is not authorized'
      : code === 'BIBLE_INVALID_COMMAND'
        ? 'Bible command arguments are invalid'
        : 'Bible operation failed',
    retryable: false
  }
})

const dispatch = (
  runtime: BibleRuntimePort,
  channel: string,
  args: readonly unknown[]
): Promise<BibleResult<unknown>> => {
  switch (channel) {
    case NOVEL_BIBLE_IPC_CHANNELS.getSnapshot: return runtime.getSnapshot()
    case NOVEL_BIBLE_IPC_CHANNELS.saveProfile:
      return runtime.saveProfile(args[0] as SaveNovelProfileInput)
    case NOVEL_BIBLE_IPC_CHANNELS.saveEntry:
      return runtime.saveEntry(args[0] as SaveBibleEntryInput)
    case NOVEL_BIBLE_IPC_CHANNELS.saveOutlineNode:
      return runtime.saveOutlineNode(args[0] as SaveOutlineNodeInput)
    case NOVEL_BIBLE_IPC_CHANNELS.moveOutlineNode:
      return runtime.moveOutlineNode(args[0] as MoveOutlineNodeInput)
    case NOVEL_BIBLE_IPC_CHANNELS.listVersions:
      return runtime.listVersions(args[0] as VersionTarget)
    case NOVEL_BIBLE_IPC_CHANNELS.restoreVersion:
      return runtime.restoreVersion(args[0] as RestoreBibleVersionInput)
    case NOVEL_BIBLE_IPC_CHANNELS.generateProposals:
      return runtime.generateProposals(args[0] as GenerateBibleProposalsInput)
    case NOVEL_BIBLE_IPC_CHANNELS.cancelGeneration:
      return runtime.cancelGeneration(args[0] as string)
    case NOVEL_BIBLE_IPC_CHANNELS.decideProposal:
      return runtime.decideProposal(args[0] as DecideBibleProposalInput)
    default: return Promise.resolve(failure('BIBLE_INVALID_COMMAND'))
  }
}

const validateRuntimeResult = (channel: string, value: unknown): value is BibleResult<unknown> => {
  if (typeof value === 'object' && value !== null && 'ok' in value &&
    (value as { ok?: unknown }).ok === false) {
    return isBibleResult(value)
  }
  switch (channel) {
    case NOVEL_BIBLE_IPC_CHANNELS.getSnapshot:
    case NOVEL_BIBLE_IPC_CHANNELS.saveProfile:
    case NOVEL_BIBLE_IPC_CHANNELS.saveEntry:
    case NOVEL_BIBLE_IPC_CHANNELS.saveOutlineNode:
    case NOVEL_BIBLE_IPC_CHANNELS.moveOutlineNode:
    case NOVEL_BIBLE_IPC_CHANNELS.restoreVersion:
    case NOVEL_BIBLE_IPC_CHANNELS.decideProposal:
      return isBibleResult(value, isNovelBibleSnapshot)
    case NOVEL_BIBLE_IPC_CHANNELS.listVersions:
      return isBibleResult(value, (data): data is BibleSourceVersion[] => (
        Array.isArray(data) && data.every(isBibleSourceVersion)
      ))
    case NOVEL_BIBLE_IPC_CHANNELS.generateProposals:
      return isBibleResult(value, (data): data is import('../shared/novel.ts').BibleProposal[] => (
        Array.isArray(data) && data.every(isBibleProposal)
      ))
    case NOVEL_BIBLE_IPC_CHANNELS.cancelGeneration:
      return isBibleResult(value, (data): data is null => data === null)
    default:
      return false
  }
}

const registrations = new WeakMap<BibleIpcMain, () => void>()

export const registerBibleIpcHandlers = (
  ipcMain: BibleIpcMain,
  runtime: BibleRuntimePort
): (() => void) => {
  const existing = registrations.get(ipcMain)
  if (existing !== undefined) return existing
  const channels = Object.values(NOVEL_BIBLE_IPC_CHANNELS)
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAllowedAgentIpcSender(event, runtime.senderPolicy)) {
        return failure('BIBLE_IPC_NOT_AUTHORIZED')
      }
      if (!validateNovelBibleCommand(channel, args)) return failure('BIBLE_INVALID_COMMAND')
      try {
        const result = await dispatch(runtime, channel, args)
        return validateRuntimeResult(channel, result)
          ? structuredClone(result)
          : failure('BIBLE_OPERATION_FAILED')
      } catch {
        return failure('BIBLE_OPERATION_FAILED')
      }
    })
  }
  const dispose = (): void => {
    if (registrations.get(ipcMain) !== dispose) return
    for (const channel of channels) ipcMain.removeHandler(channel)
    registrations.delete(ipcMain)
  }
  registrations.set(ipcMain, dispose)
  return dispose
}
