import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ChapterApi, ChapterDocument, ChapterSummary } from '../../src/shared/chapter'
import type { ProjectResult } from '../../src/shared/project'
import { useChapterEditor } from '../../src/renderer/src/editor/use-chapter-editor'
import { installBeforeUnloadFlush } from '../../src/renderer/src/editor/workspace-flush'

const now = '2026-08-10T08:00:00.000Z'
const summary = (id: string, title: string, position: number): ChapterSummary => ({
  id, projectId: 'project-1', parentId: null, kind: 'chapter', title, position,
  currentVersionId: null, createdAt: now, updatedAt: now
})
const document = (chapter: ChapterSummary, content: string, draftRevision = 0): ChapterDocument => ({
  chapter, content, draftRevision, savedAt: draftRevision === 0 ? null : now,
  characterCount: content.length
})
const first = summary('chapter-1', '第一章', 0)
const second = summary('chapter-2', '第二章', 1)
const third = summary('chapter-3', '第三章', 2)
const ok = <T>(data: T): ProjectResult<T> => ({ ok: true, data })
const createApi = (overrides: Partial<ChapterApi> = {}): ChapterApi => ({
  list: vi.fn(async () => ok([first, second])),
  create: vi.fn(async () => ok(document(first, ''))),
  rename: vi.fn(async () => ok(first)),
  move: vi.fn(async () => ok([first, second])),
  remove: vi.fn(async () => ok(null)),
  load: vi.fn(async (chapterId) => ok(document(chapterId === first.id ? first : second, chapterId === first.id ? '开篇' : '续章'))),
  saveDraft: vi.fn(async (input) => ok(document(input.chapterId === first.id ? first : second, input.content, input.expectedRevision + 1))),
  confirmVersion: vi.fn(async () => ok({ id: 'version-1', chapterId: first.id, status: 'confirmed' as const, content: '开篇', characterCount: 2, sourceVersionId: null, createdAt: now })),
  listVersions: vi.fn(async () => ok([])),
  restoreVersion: vi.fn(async () => ok(document(first, '开篇', 1))),
  previewImport: vi.fn(async () => ok(null)),
  confirmImport: vi.fn(async () => ok([])),
  exportBook: vi.fn(async () => ok(null)),
  ...overrides
})

afterEach(() => vi.useRealTimers())

describe('chapter editor session', () => {
  test('debounces edits for 800 ms and saves only the latest content', async () => {
    vi.useFakeTimers()
    const saveDraft = vi.fn(async (input) => ok(document(first, input.content, input.expectedRevision + 1)))
    const session = useChapterEditor(createApi({ saveDraft }))

    await session.initialize()
    session.updateContent('开篇第一句')
    session.updateContent('开篇第一句。第二句')
    await vi.advanceTimersByTimeAsync(799)
    expect(saveDraft).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(saveDraft).toHaveBeenCalledWith({ chapterId: first.id, content: '开篇第一句。第二句', expectedRevision: 0 })
    expect(session.saveState.value).toBe('saved')
  })

  test('flushes the current chapter before switching and keeps text recoverable on failure', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const saveDraft = vi.fn(async (input) => {
      order.push(`save:${input.chapterId}`)
      return ok(document(first, input.content, input.expectedRevision + 1))
    })
    const load = vi.fn(async (chapterId: string) => {
      order.push(`load:${chapterId}`)
      return ok(document(chapterId === first.id ? first : second, chapterId === first.id ? '开篇' : '续章'))
    })
    const session = useChapterEditor(createApi({ load, saveDraft }))

    await session.initialize()
    order.length = 0
    session.updateContent('未到定时器的内容')
    expect(await session.selectChapter(second.id)).toBe(true)
    expect(order).toEqual([`save:${first.id}`, `load:${second.id}`])

    const failedSave = vi.fn(async (): Promise<ProjectResult<ChapterDocument>> => ({
      ok: false, error: { code: 'CHAPTER_SAVE_CONFLICT', message: 'conflict' }
    }))
    const failing = useChapterEditor(createApi({ saveDraft: failedSave }))
    await failing.initialize()
    failing.updateContent('必须保留的正文')

    expect(await failing.flush()).toBe(false)
    expect(failing.content.value).toBe('必须保留的正文')
    expect(failing.saveState.value).toBe('conflict')
    expect(failing.error.value).toContain('其他修改')
  })

  test('serializes a second flush behind an in-flight save with the new revision', async () => {
    let resolveFirst!: (result: ProjectResult<ChapterDocument>) => void
    let inFlight = 0
    let maxInFlight = 0
    const saveDraft = vi.fn(async (input) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (input.expectedRevision === 0) {
        const result = await new Promise<ProjectResult<ChapterDocument>>((resolve) => {
          resolveFirst = resolve
        })
        inFlight -= 1
        return result
      }
      inFlight -= 1
      return ok(document(first, input.content, input.expectedRevision + 1))
    })
    const session = useChapterEditor(createApi({ saveDraft }))
    await session.initialize()

    session.updateContent('第一稿')
    const firstFlush = session.flush()
    await Promise.resolve()
    session.updateContent('第二稿')
    const secondFlush = session.flush()
    expect(saveDraft).toHaveBeenCalledTimes(1)

    resolveFirst(ok(document(first, '第一稿', 1)))
    await Promise.all([firstFlush, secondFlush])
    expect(saveDraft).toHaveBeenCalledTimes(2)
    expect(saveDraft).toHaveBeenLastCalledWith({ chapterId: first.id, content: '第二稿', expectedRevision: 1 })
    expect(maxInFlight).toBe(1)
  })

  test('keeps text typed while a chapter load is pending instead of replacing it', async () => {
    let resolveSecond!: (result: ProjectResult<ChapterDocument>) => void
    const load = vi.fn(async (chapterId: string) => {
      if (chapterId === first.id) return ok(document(first, '开篇'))
      return new Promise<ProjectResult<ChapterDocument>>((resolve) => { resolveSecond = resolve })
    })
    const session = useChapterEditor(createApi({ load }))
    await session.initialize()

    const switching = session.selectChapter(second.id)
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(second.id))
    session.updateContent('加载期间继续输入的正文')
    resolveSecond(ok(document(second, '续章')))

    expect(await switching).toBe(false)
    expect(session.activeChapter.value?.id).toBe(first.id)
    expect(session.content.value).toBe('加载期间继续输入的正文')
    expect(session.dirty.value).toBe(true)
  })

  test('lets only the latest rapid chapter selection replace the active document', async () => {
    let resolveSecond!: (result: ProjectResult<ChapterDocument>) => void
    let resolveThird!: (result: ProjectResult<ChapterDocument>) => void
    const load = vi.fn(async (chapterId: string) => {
      if (chapterId === first.id) return ok(document(first, '开篇'))
      return new Promise<ProjectResult<ChapterDocument>>((resolve) => {
        if (chapterId === second.id) resolveSecond = resolve
        else resolveThird = resolve
      })
    })
    const session = useChapterEditor(createApi({
      list: vi.fn(async () => ok([first, second, third])),
      load
    }))
    await session.initialize()

    const toSecond = session.selectChapter(second.id)
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(second.id))
    const toThird = session.selectChapter(third.id)
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(third.id))
    resolveThird(ok(document(third, '终章')))
    expect(await toThird).toBe(true)
    resolveSecond(ok(document(second, '续章')))
    expect(await toSecond).toBe(false)
    expect(session.activeChapter.value?.id).toBe(third.id)
    expect(session.content.value).toBe('终章')
  })

  test('flushes before version restore and preserves input made while restore is pending', async () => {
    const order: string[] = []
    let resolveRestore!: (result: ProjectResult<ChapterDocument>) => void
    const saveDraft = vi.fn(async (input) => {
      order.push('save')
      return ok(document(first, input.content, input.expectedRevision + 1))
    })
    const restoreVersion = vi.fn(async () => {
      order.push('restore')
      return new Promise<ProjectResult<ChapterDocument>>((resolve) => { resolveRestore = resolve })
    })
    const session = useChapterEditor(createApi({ saveDraft, restoreVersion }))
    await session.initialize()
    session.updateContent('恢复前的未保存正文')

    const restoring = session.restoreVersion('version-1')
    await vi.waitFor(() => expect(restoreVersion).toHaveBeenCalled())
    expect(order).toEqual(['save', 'restore'])
    session.updateContent('恢复请求期间的新正文')
    resolveRestore(ok(document(first, '历史正文', 2)))

    expect(await restoring).toBe(false)
    expect(session.content.value).toBe('恢复请求期间的新正文')
    expect(session.dirty.value).toBe(true)
    expect(await session.flush()).toBe(true)
    expect(saveDraft).toHaveBeenLastCalledWith({
      chapterId: first.id,
      content: '恢复请求期间的新正文',
      expectedRevision: 2
    })
  })

  test('blocks window unload until a dirty editor flush succeeds', async () => {
    let resolveFlush!: (saved: boolean) => void
    const flush = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveFlush = resolve
    }))
    const close = vi.fn()
    const remove = installBeforeUnloadFlush(window, () => true, flush, close)

    const firstAttempt = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(firstAttempt)).toBe(false)
    expect(flush).toHaveBeenCalledTimes(1)
    resolveFlush(false)
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()

    const secondAttempt = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(secondAttempt)
    resolveFlush(true)
    await Promise.resolve()
    expect(close).toHaveBeenCalledTimes(1)
    remove()
  })
})
