import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import type { ChapterApi, ChapterDocument, ChapterSummary, ImportPreview } from '../../src/shared/chapter'
import type { ProjectResult } from '../../src/shared/project'
import ChapterTextEditor from '../../src/renderer/src/components/ChapterTextEditor.vue'
import ChapterEditorView from '../../src/renderer/src/views/ChapterEditorView.vue'

const now = '2026-08-10T08:00:00.000Z'
const chapter: ChapterSummary = {
  id: 'chapter-1', projectId: 'project-1', parentId: null, kind: 'chapter', title: '第一章',
  position: 0, currentVersionId: null, createdAt: now, updatedAt: now
}
const volume: ChapterSummary = {
  id: 'volume-1', projectId: 'project-1', parentId: null, kind: 'volume', title: '第一卷',
  position: 0, currentVersionId: null, createdAt: now, updatedAt: now
}
const chapterDocument = (content: string): ChapterDocument => ({
  chapter, content, draftRevision: 0, savedAt: null, characterCount: content.length
})
const ok = <T>(data: T): ProjectResult<T> => ({ ok: true, data })
const createApi = (overrides: Partial<ChapterApi> = {}): ChapterApi => ({
  list: vi.fn(async () => ok([chapter])),
  create: vi.fn(async () => ok(chapterDocument(''))),
  rename: vi.fn(async (input) => ok({ ...chapter, title: input.title })),
  move: vi.fn(async () => ok([chapter])),
  remove: vi.fn(async () => ok(null)),
  load: vi.fn(async () => ok(chapterDocument('雾从海面升起。'))),
  saveDraft: vi.fn(async (input) => ok({ ...chapterDocument(input.content), draftRevision: input.expectedRevision + 1 })),
  confirmVersion: vi.fn(async () => ok({ id: 'version-1', chapterId: chapter.id, status: 'confirmed' as const, content: '雾从海面升起。', characterCount: 7, sourceVersionId: null, createdAt: now })),
  listVersions: vi.fn(async () => ok([])),
  restoreVersion: vi.fn(async () => ok(chapterDocument('恢复后的正文'))),
  previewImport: vi.fn(async () => ok(null)),
  confirmImport: vi.fn(async () => ok([chapter])),
  exportBook: vi.fn(async () => ok(null)),
  ...overrides
})
const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (found === undefined) throw new Error(`Button not found: ${label}`)
  return found
}
const mountView = async (api: ChapterApi, props: Record<string, unknown> = {}) => {
  Object.defineProperty(window, 'openNovel', { configurable: true, value: { chapters: api } })
  const wrapper = mount(ChapterEditorView, { props })
  await flushPromises()
  return wrapper
}

test('renders a labelled chapter tree and a real editor with accessible writing tools', async () => {
  const create = vi.fn(async () => ok(chapterDocument('')))
  const wrapper = await mountView(createApi({ create }))

  expect(wrapper.get('nav[aria-label="章节树"]').text()).toContain('第一章')
  expect((wrapper.get('[data-testid="chapter-editor-heading"]').element as HTMLInputElement).value).toBe('第一章')
  expect(wrapper.text()).toContain('雾从海面升起。')
  expect(wrapper.text()).toContain('6 字')
  expect(button(wrapper, '撤销').attributes('type')).toBe('button')
  expect(button(wrapper, '重做').attributes('type')).toBe('button')
  expect(button(wrapper, '搜索与替换').attributes('aria-label')).toContain('搜索与替换')
  expect(button(wrapper, '全屏写作').attributes('aria-pressed')).toBe('false')

  await button(wrapper, '删除').trigger('click')
  expect(wrapper.text()).toContain('草稿及全部版本将永久删除')

  await wrapper.get('[data-testid="new-chapter-title"]').setValue('第二章')
  await wrapper.get('[data-testid="new-chapter-form"]').trigger('submit')
  await flushPromises()
  expect(create).toHaveBeenCalledWith({ kind: 'chapter', parentId: null, title: '第二章' })
})

test('previews imports before confirmation and exposes version restore and three export formats', async () => {
  const preview: ImportPreview = {
    sourceName: '粘贴内容', format: 'paste', mode: 'split-chapters', referenceContent: null,
    chapters: [{ title: '第二章', content: '新的正文', characterCount: 4 }]
  }
  const previewImport = vi.fn(async () => ok(preview))
  const confirmImport = vi.fn(async () => ok([chapter]))
  const confirmVersion = vi.fn(async () => ok({ id: 'version-1', chapterId: chapter.id, status: 'confirmed' as const, content: '雾从海面升起。', characterCount: 7, sourceVersionId: null, createdAt: now }))
  const listVersions = vi.fn(async () => ok([
    { id: 'version-2', chapterId: chapter.id, status: 'draft' as const, content: '导入草稿', characterCount: 4, sourceVersionId: null, createdAt: '2026-08-10T08:01:00.000Z' },
    { id: 'version-1', chapterId: chapter.id, status: 'confirmed' as const, content: '雾从海面升起。', characterCount: 7, sourceVersionId: null, createdAt: now }
  ]))
  const restoreVersion = vi.fn(async () => ok(chapterDocument('恢复后的正文')))
  const exportBook = vi.fn(async () => ok(null))
  const wrapper = await mountView(createApi({ previewImport, confirmImport, confirmVersion, listVersions, restoreVersion, exportBook }), { initialPanel: 'versions' })

  await button(wrapper, '确认当前版本').trigger('click')
  await flushPromises()
  expect(confirmVersion).toHaveBeenCalledWith(chapter.id)
  expect(wrapper.get('[aria-label="版本历史"]').text()).toContain('已确认')
  expect(wrapper.get('[aria-label="版本历史"]').text()).toContain('草稿快照')
  await button(wrapper, '预览此版本').trigger('click')
  expect(wrapper.get('[aria-label="历史版本只读预览"]').attributes('contenteditable')).toBe('false')
  await button(wrapper, '恢复此版本').trigger('click')
  expect(wrapper.text()).toContain('再次点击确认')
  expect(restoreVersion).not.toHaveBeenCalled()
  await button(wrapper, '确认恢复此版本').trigger('click')
  await flushPromises()
  expect(restoreVersion).toHaveBeenCalledWith({ chapterId: chapter.id, versionId: 'version-2' })

  await button(wrapper, '导入').trigger('click')
  await wrapper.get('textarea#chapter-import-text').setValue('# 第二章\n新的正文')
  await button(wrapper, '预览粘贴内容').trigger('click')
  await flushPromises()
  expect(previewImport).toHaveBeenCalledWith({ mode: 'split-chapters', text: '# 第二章\n新的正文', sourceName: '粘贴内容' })
  expect(wrapper.get('[data-testid="import-preview"]').text()).toContain('第二章')
  await button(wrapper, '确认导入').trigger('click')
  await flushPromises()
  expect(confirmImport).toHaveBeenCalledWith(preview)

  for (const [label, format] of [['导出 TXT', 'txt'], ['导出 Markdown', 'markdown'], ['导出 DOCX', 'docx']] as const) {
    await button(wrapper, label).trigger('click')
    await flushPromises()
    expect(exportBook).toHaveBeenCalledWith(format)
  }
})

test('keeps IME composition text stable, reports selection, opens search, and exits fullscreen with Escape', async () => {
  const selectionChange = vi.fn()
  const wrapper = mount(ChapterTextEditor, {
    props: { modelValue: '中文输入', onSelectionChange: selectionChange }
  })
  const content = wrapper.get('.cm-content')

  await content.trigger('compositionstart')
  await wrapper.setProps({ modelValue: '外部替换' })
  expect(content.text()).toBe('中文输入')
  await content.trigger('compositionend')
  await flushPromises()
  expect(content.text()).toBe('中文输入')

  await wrapper.setProps({ modelValue: '甲乙' })
  await flushPromises()
  expect(selectionChange).toHaveBeenCalledWith(expect.objectContaining({
    from: expect.any(Number), to: expect.any(Number), text: expect.any(String)
  }))

  await button(wrapper, '搜索与替换').trigger('click')
  expect(wrapper.find('.cm-search').exists()).toBe(true)
  await button(wrapper, '全屏写作').trigger('click')
  expect(button(wrapper, '退出全屏').attributes('aria-pressed')).toBe('true')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(button(wrapper, '全屏写作').attributes('aria-pressed')).toBe('false')
})

test('cancels route navigation when the latest chapter text cannot be flushed', async () => {
  const saveDraft = vi.fn(async (): Promise<ProjectResult<ChapterDocument>> => ({
    ok: false,
    error: { code: 'CHAPTER_OPERATION_FAILED', message: 'save failed' }
  }))
  Object.defineProperty(window, 'openNovel', {
    configurable: true,
    value: { chapters: createApi({ saveDraft }) }
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/chapters', component: ChapterEditorView },
      { path: '/other', component: { template: '<main>其他页面</main>' } }
    ]
  })
  await router.push('/chapters')
  await router.isReady()
  const wrapper = mount(RouterView, { global: { plugins: [router] } })
  await flushPromises()

  wrapper.findComponent(ChapterTextEditor).vm.$emit('update:modelValue', '尚未保存的新正文')
  await flushPromises()
  await router.push('/other')
  await flushPromises()

  expect(saveDraft).toHaveBeenCalledTimes(1)
  expect(router.currentRoute.value.fullPath).toBe('/chapters')
  expect(wrapper.get('[role="alert"]').text()).toContain('尚未保存')
})

test('selects a volume and exposes rename, ordering, and guarded deletion controls', async () => {
  const tree = [volume, { ...chapter, position: 1 }]
  const rename = vi.fn(async (input) => ok({ ...volume, title: input.title }))
  const move = vi.fn(async () => ok(tree))
  const remove = vi.fn(async () => ok(null))
  const wrapper = await mountView(createApi({
    list: vi.fn(async () => ok(tree)),
    rename,
    move,
    remove
  }))

  await wrapper.get('[data-testid="tree-node-volume-1"]').trigger('click')
  expect(wrapper.get('[data-testid="tree-node-volume-1"]').attributes('aria-pressed')).toBe('true')
  await wrapper.get('input[aria-label="选中项名称"]').setValue('远航卷')
  await button(wrapper, '重命名选中项').trigger('click')
  await flushPromises()
  expect(rename).toHaveBeenCalledWith({ chapterId: volume.id, title: '远航卷' })

  await button(wrapper, '下移选中项').trigger('click')
  await flushPromises()
  expect(move).toHaveBeenCalledWith({ chapterId: volume.id, parentId: null, position: 1 })

  await button(wrapper, '删除选中项').trigger('click')
  expect(wrapper.text()).toContain('空分卷')
  await button(wrapper, '确认删除选中项').trigger('click')
  await flushPromises()
  expect(remove).toHaveBeenCalledWith(volume.id)
})

test('moves a selected root chapter into a volume through the tree organizer', async () => {
  const tree = [volume, { ...chapter, position: 1 }]
  const move = vi.fn(async () => ok([
    volume,
    { ...chapter, parentId: volume.id, position: 0 }
  ]))
  const wrapper = await mountView(createApi({ list: vi.fn(async () => ok(tree)), move }))

  await wrapper.get('select[aria-label="移动章节到分卷"]').setValue(volume.id)
  await button(wrapper, '移动到所选分卷').trigger('click')
  await flushPromises()

  expect(move).toHaveBeenCalledWith({ chapterId: chapter.id, parentId: volume.id, position: 0 })
})
