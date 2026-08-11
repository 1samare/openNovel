import { computed, ref, type Ref } from 'vue'

import type {
  BibleProposal,
  BibleSourceVersion,
  DecideBibleProposalInput,
  GenerateBibleProposalsInput,
  MoveOutlineNodeInput,
  NovelBibleApi,
  NovelBibleSnapshot,
  RestoreBibleVersionInput,
  SaveBibleEntryInput,
  SaveNovelProfileInput,
  SaveOutlineNodeInput,
  VersionTarget
} from '@shared/novel'

type ControllerStatus = 'idle' | 'loading' | 'ready' | 'error'

const messageFor = (code: string): string => {
  switch (code) {
    case 'BIBLE_CONFLICT': return '资料已变化，请刷新后检查冲突。'
    case 'BIBLE_MODEL_NOT_CONFIGURED': return '请先在设置中为对应 Agent 配置结构化输出模型。'
    case 'BIBLE_GENERATION_CANCELLED': return '本次候选生成已取消。'
    case 'BIBLE_NOT_AVAILABLE': return '当前没有可用的小说项目。'
    default: return '小说圣经操作未完成，请重试。'
  }
}

export type NovelBibleController = {
  snapshot: Ref<NovelBibleSnapshot | null>
  status: Ref<ControllerStatus>
  error: Ref<string>
  busyAction: Ref<string | null>
  isBusy: Readonly<Ref<boolean>>
  versions: Ref<BibleSourceVersion[]>
  versionTarget: Ref<VersionTarget | null>
  load(): Promise<void>
  saveProfile(input: SaveNovelProfileInput): Promise<boolean>
  saveEntry(input: SaveBibleEntryInput): Promise<boolean>
  saveOutlineNode(input: SaveOutlineNodeInput): Promise<boolean>
  moveOutlineNode(input: MoveOutlineNodeInput): Promise<boolean>
  openVersions(input: VersionTarget): Promise<void>
  restoreVersion(input: RestoreBibleVersionInput): Promise<boolean>
  generateProposals(input: Omit<GenerateBibleProposalsInput, 'requestId'>): Promise<void>
  cancelGeneration(): Promise<void>
  decideProposal(input: DecideBibleProposalInput): Promise<boolean>
  clearError(): void
}

export const createNovelBibleController = (api: NovelBibleApi): NovelBibleController => {
  const snapshot = ref<NovelBibleSnapshot | null>(null)
  const status = ref<ControllerStatus>('idle')
  const error = ref('')
  const busyAction = ref<string | null>(null)
  const versions = ref<BibleSourceVersion[]>([])
  const versionTarget = ref<VersionTarget | null>(null)
  const isBusy = computed(() => busyAction.value !== null)
  let loadGeneration = 0
  let stateRevision = 0
  let activeRequestId: string | null = null

  const applySnapshot = (value: NovelBibleSnapshot): void => {
    const projectChanged = snapshot.value !== null && snapshot.value.projectId !== value.projectId
    if (projectChanged) {
      versions.value = []
      versionTarget.value = null
      if (activeRequestId !== null) void api.cancelGeneration(activeRequestId)
    }
    snapshot.value = value
    status.value = 'ready'
    error.value = ''
    stateRevision += 1
  }

  const load = async (): Promise<void> => {
    const generation = ++loadGeneration
    const revision = stateRevision
    if (snapshot.value === null) status.value = 'loading'
    const result = await api.getSnapshot()
    if (generation !== loadGeneration || revision !== stateRevision) return
    if (!result.ok) {
      status.value = 'error'
      error.value = messageFor(result.error.code)
      return
    }
    applySnapshot(result.data)
  }

  const mutateSnapshot = async (
    action: string,
    operation: () => ReturnType<NovelBibleApi['getSnapshot']>
  ): Promise<boolean> => {
    if (busyAction.value !== null) return false
    busyAction.value = action
    stateRevision += 1
    error.value = ''
    try {
      const result = await operation()
      if (!result.ok) {
        error.value = messageFor(result.error.code)
        return false
      }
      applySnapshot(result.data)
      return true
    } finally {
      busyAction.value = null
    }
  }

  return {
    snapshot,
    status,
    error,
    busyAction,
    isBusy,
    versions,
    versionTarget,
    load,
    saveProfile: (input) => mutateSnapshot('save-profile', () => api.saveProfile(input)),
    saveEntry: (input) => mutateSnapshot('save-entry', () => api.saveEntry(input)),
    saveOutlineNode: (input) => mutateSnapshot('save-outline', () => api.saveOutlineNode(input)),
    moveOutlineNode: (input) => mutateSnapshot('move-outline', () => api.moveOutlineNode(input)),
    openVersions: async (input) => {
      if (busyAction.value !== null) return
      const revision = stateRevision
      const projectId = snapshot.value?.projectId
      busyAction.value = 'list-versions'
      error.value = ''
      try {
        const result = await api.listVersions(input)
        if (!result.ok) {
          error.value = messageFor(result.error.code)
          return
        }
        if (revision === stateRevision && snapshot.value?.projectId === projectId) {
          versionTarget.value = input
          versions.value = result.data
        }
      } finally {
        busyAction.value = null
      }
    },
    restoreVersion: (input) => mutateSnapshot('restore-version', async () => {
      const result = await api.restoreVersion(input)
      if (result.ok) {
        versions.value = []
        versionTarget.value = null
      }
      return result
    }),
    generateProposals: async (input) => {
      if (busyAction.value !== null) return
      const requestId = globalThis.crypto?.randomUUID?.() ?? `bible-${Date.now()}`
      const revision = stateRevision
      const projectId = snapshot.value?.projectId
      activeRequestId = requestId
      busyAction.value = 'generate-proposals'
      error.value = ''
      try {
        const result = await api.generateProposals({ requestId, ...input })
        if (!result.ok) {
          error.value = messageFor(result.error.code)
          return
        }
        if (
          snapshot.value !== null &&
          snapshot.value.projectId === projectId &&
          stateRevision === revision
        ) {
          const ids = new Set(result.data.map((proposal) => proposal.id))
          snapshot.value = {
            ...snapshot.value,
            proposals: [...result.data, ...snapshot.value.proposals.filter((item) => !ids.has(item.id))]
          }
          stateRevision += 1
        }
      } finally {
        if (activeRequestId === requestId) activeRequestId = null
        busyAction.value = null
      }
    },
    cancelGeneration: async () => {
      if (activeRequestId === null) return
      await api.cancelGeneration(activeRequestId)
    },
    decideProposal: (input) => mutateSnapshot('decide-proposal', () => api.decideProposal(input)),
    clearError: () => { error.value = '' }
  }
}

export const proposedForDomain = (
  snapshot: NovelBibleSnapshot | null,
  domain: BibleProposal['domain']
): BibleProposal[] => snapshot?.proposals.filter((proposal) => proposal.domain === domain) ?? []
