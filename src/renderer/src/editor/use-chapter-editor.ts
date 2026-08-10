import { computed, readonly, ref, shallowRef } from 'vue'

import type {
  ChapterApi,
  ChapterDocument,
  ChapterSummary,
  CreateChapterInput
} from '@shared/chapter'

export type ChapterSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

const SAVE_DELAY_MS = 800

export function useChapterEditor(api: ChapterApi, saveDelayMs = SAVE_DELAY_MS) {
  const chapters = shallowRef<ChapterSummary[]>([])
  const activeDocument = shallowRef<ChapterDocument | null>(null)
  const content = ref('')
  const loading = ref(false)
  const error = ref('')
  const saveState = ref<ChapterSaveState>('idle')
  const dirty = ref(false)
  const transitioning = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let savePromise: Promise<boolean> | undefined
  let editGeneration = 0
  let replacementSequence = 0

  const activeChapter = computed(() => activeDocument.value?.chapter ?? null)

  const clearSaveTimer = () => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = undefined
  }

  const replaceChapter = (chapter: ChapterSummary) => {
    chapters.value = chapters.value
      .map((item) => item.id === chapter.id ? chapter : item)
      .sort((left, right) => left.position - right.position)
  }

  const replaceTree = (nextChapters: ChapterSummary[]) => {
    chapters.value = nextChapters
    const active = activeDocument.value
    if (active === null) return
    const updated = nextChapters.find((chapter) => chapter.id === active.chapter.id)
    if (updated !== undefined) activeDocument.value = { ...active, chapter: updated }
  }

  const loadDocument = (document: ChapterDocument) => {
    clearSaveTimer()
    editGeneration += 1
    activeDocument.value = document
    content.value = document.content
    dirty.value = false
    saveState.value = document.savedAt === null ? 'idle' : 'saved'
    error.value = ''
    replaceChapter(document.chapter)
  }

  const describeFailure = (code: string): string => {
    if (code === 'CHAPTER_SAVE_CONFLICT') return '正文在其他修改后发生冲突；当前文字仍保留，请重新打开章节后手动合并。'
    if (code === 'CHAPTER_NOT_FOUND') return '章节已不存在，请刷新章节树。'
    return '正文尚未保存；当前文字仍保留，请检查后重试。'
  }

  const performSave = async (): Promise<boolean> => {
    const document = activeDocument.value
    if (document === null || !dirty.value) return true

    const chapterId = document.chapter.id
    const expectedRevision = document.draftRevision
    const savingContent = content.value
    saveState.value = 'saving'
    error.value = ''

    try {
      const result = await api.saveDraft({ chapterId, content: savingContent, expectedRevision })
      if (!result.ok) {
        saveState.value = result.error.code === 'CHAPTER_SAVE_CONFLICT' ? 'conflict' : 'error'
        error.value = describeFailure(result.error.code)
        return false
      }
      if (activeDocument.value?.chapter.id !== chapterId) return true

      replaceChapter(result.data.chapter)
      if (content.value === savingContent) {
        activeDocument.value = result.data
        content.value = result.data.content
        dirty.value = false
        saveState.value = 'saved'
      } else {
        activeDocument.value = { ...result.data, content: savingContent }
        dirty.value = true
        saveState.value = 'dirty'
      }
      return true
    } catch {
      saveState.value = 'error'
      error.value = describeFailure('CHAPTER_OPERATION_FAILED')
      return false
    }
  }

  async function flush(): Promise<boolean> {
    clearSaveTimer()
    if (savePromise !== undefined) {
      const previousResult = await savePromise
      if (!previousResult) return false
      return dirty.value ? flush() : true
    }
    if (!dirty.value) return true
    const currentSave = performSave()
    savePromise = currentSave
    try {
      const saved = await currentSave
      if (!saved) return false
    } finally {
      if (savePromise === currentSave) savePromise = undefined
    }
    return dirty.value ? flush() : true
  }

  function updateContent(nextContent: string) {
    if (activeDocument.value === null || nextContent === content.value) return
    editGeneration += 1
    content.value = nextContent
    dirty.value = nextContent !== activeDocument.value.content
    saveState.value = dirty.value ? 'dirty' : 'saved'
    error.value = ''
    clearSaveTimer()
    if (dirty.value) saveTimer = setTimeout(() => void flush(), saveDelayMs)
  }

  async function loadChapter(chapterId: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const result = await api.load(chapterId)
      if (!result.ok) {
        error.value = '无法打开章节，请刷新后重试。'
        return false
      }
      loadDocument(result.data)
      return true
    } catch {
      error.value = '无法打开章节，请刷新后重试。'
      return false
    } finally {
      loading.value = false
    }
  }

  async function selectChapter(chapterId: string): Promise<boolean> {
    if (activeDocument.value?.chapter.id === chapterId) return true
    const operation = ++replacementSequence
    transitioning.value = true
    error.value = ''
    try {
      if (!await flush() || operation !== replacementSequence) return false
      const sourceChapterId = activeDocument.value?.chapter.id ?? null
      const sourceGeneration = editGeneration
      loading.value = true
      const result = await api.load(chapterId)
      if (operation !== replacementSequence) return false
      if (!result.ok) {
        error.value = '无法打开章节，请刷新后重试。'
        return false
      }
      if (
        (activeDocument.value?.chapter.id ?? null) !== sourceChapterId ||
        editGeneration !== sourceGeneration
      ) {
        error.value = '正文在章节切换期间发生改动，当前文字已保留。'
        return false
      }
      loadDocument(result.data)
      return true
    } catch {
      if (operation === replacementSequence) error.value = '无法打开章节，请刷新后重试。'
      return false
    } finally {
      if (operation === replacementSequence) {
        loading.value = false
        transitioning.value = false
      }
    }
  }

  async function restoreVersion(versionId: string): Promise<boolean> {
    const chapter = activeDocument.value?.chapter
    if (chapter === undefined) return false
    const operation = ++replacementSequence
    transitioning.value = true
    error.value = ''
    try {
      if (!await flush() || operation !== replacementSequence) return false
      const sourceGeneration = editGeneration
      const result = await api.restoreVersion({ chapterId: chapter.id, versionId })
      if (operation !== replacementSequence) return false
      if (!result.ok) {
        error.value = '无法恢复所选版本。'
        return false
      }
      if (activeDocument.value?.chapter.id !== chapter.id) {
        error.value = '正文在版本恢复期间发生改动，当前文字已保留。'
        return false
      }
      if (editGeneration !== sourceGeneration) {
        activeDocument.value = result.data
        replaceChapter(result.data.chapter)
        dirty.value = content.value !== result.data.content
        saveState.value = dirty.value ? 'dirty' : 'saved'
        error.value = '正文在版本恢复期间发生改动，当前文字已保留并可继续保存。'
        return false
      }
      loadDocument(result.data)
      return true
    } catch {
      if (operation === replacementSequence) error.value = '无法恢复所选版本。'
      return false
    } finally {
      if (operation === replacementSequence) transitioning.value = false
    }
  }

  async function initialize(): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const result = await api.list()
      if (!result.ok) {
        error.value = '无法读取章节树，请重试。'
        return false
      }
      chapters.value = result.data
      const firstChapter = result.data.find((chapter) => chapter.kind === 'chapter')
      if (firstChapter !== undefined) return await loadChapter(firstChapter.id)
      return true
    } catch {
      error.value = '无法读取章节树，请重试。'
      return false
    } finally {
      loading.value = false
    }
  }

  async function refreshTree(): Promise<boolean> {
    try {
      const result = await api.list()
      if (!result.ok) return false
      chapters.value = result.data
      return true
    } catch {
      return false
    }
  }

  async function createChapter(input: CreateChapterInput): Promise<boolean> {
    if (!await flush()) return false
    const result = await api.create(input)
    if (!result.ok) {
      error.value = '无法创建章节，请检查名称和层级。'
      return false
    }
    await refreshTree()
    if (result.data.chapter.kind === 'chapter') loadDocument(result.data)
    return true
  }

  async function renameActive(title: string): Promise<boolean> {
    const chapter = activeDocument.value?.chapter
    if (chapter === undefined) return false
    return renameNode(chapter.id, title)
  }

  async function renameNode(chapterId: string, title: string): Promise<boolean> {
    if (activeDocument.value?.chapter.id === chapterId && !await flush()) return false
    const result = await api.rename({ chapterId, title })
    if (!result.ok) {
      error.value = '章节名称未更新，请检查后重试。'
      return false
    }
    if (activeDocument.value?.chapter.id === chapterId) {
      activeDocument.value = { ...activeDocument.value, chapter: result.data }
    }
    replaceChapter(result.data)
    return true
  }

  async function removeActive(): Promise<boolean> {
    const chapter = activeDocument.value?.chapter
    if (chapter === undefined) return false
    return removeNode(chapter.id)
  }

  async function removeNode(chapterId: string): Promise<boolean> {
    const removesActive = activeDocument.value?.chapter.id === chapterId
    if (removesActive && !await flush()) return false
    const result = await api.remove(chapterId)
    if (!result.ok) {
      error.value = result.error.code === 'CHAPTER_HAS_CHILDREN'
        ? '分卷仍包含章节，需先移动或删除子章节。'
        : '无法删除章节，请重试。'
      return false
    }
    if (removesActive) {
      activeDocument.value = null
      content.value = ''
      saveState.value = 'idle'
    }
    await refreshTree()
    if (removesActive) {
      const next = chapters.value.find((item) => item.kind === 'chapter')
      if (next !== undefined) await loadChapter(next.id)
    }
    return true
  }

  async function moveActive(offset: -1 | 1): Promise<boolean> {
    const chapter = activeDocument.value?.chapter
    if (chapter === undefined || !await flush()) return false
    const siblings = chapters.value.filter((item) => item.parentId === chapter.parentId)
      .sort((left, right) => left.position - right.position)
    const index = siblings.findIndex((item) => item.id === chapter.id)
    const position = index + offset
    if (index < 0 || position < 0 || position >= siblings.length) return true
    return moveNode(chapter.id, chapter.parentId, position)
  }

  async function moveNode(
    chapterId: string,
    parentId: string | null,
    position: number
  ): Promise<boolean> {
    if (activeDocument.value?.chapter.id === chapterId && !await flush()) return false
    const result = await api.move({ chapterId, parentId, position })
    if (!result.ok) {
      error.value = '无法调整章节顺序，请重试。'
      return false
    }
    replaceTree(result.data)
    return true
  }

  function replaceActiveDocument(document: ChapterDocument) {
    loadDocument(document)
  }

  function dispose() {
    clearSaveTimer()
  }

  return {
    activeChapter,
    activeDocument: readonly(activeDocument),
    chapters: readonly(chapters),
    content: readonly(content),
    createChapter,
    dirty: readonly(dirty),
    dispose,
    error,
    flush,
    initialize,
    loading: readonly(loading),
    moveActive,
    moveNode,
    refreshTree,
    removeActive,
    removeNode,
    renameActive,
    renameNode,
    replaceActiveDocument,
    restoreVersion,
    saveState: readonly(saveState),
    selectChapter,
    transitioning: readonly(transitioning),
    updateContent
  }
}
