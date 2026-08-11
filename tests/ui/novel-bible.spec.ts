import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'

import type {
  BibleProposal,
  BibleResult,
  BibleSourceVersion,
  NovelBibleApi,
  NovelBibleSnapshot,
  SaveBibleEntryInput
} from '../../src/shared/novel'
import { createNovelBibleController } from '../../src/renderer/src/bible/use-novel-bible'
import BibleEntryEditor from '../../src/renderer/src/components/BibleEntryEditor.vue'
import ProposalReviewPanel from '../../src/renderer/src/components/ProposalReviewPanel.vue'
import CharacterBibleView from '../../src/renderer/src/views/CharacterBibleView.vue'
import OutlineBibleView from '../../src/renderer/src/views/OutlineBibleView.vue'
import WorldBibleView from '../../src/renderer/src/views/WorldBibleView.vue'

const now = '2026-08-11T07:00:00.000Z'
const profileDraft = {
  genre: 'urban-campus' as const,
  audience: '青年',
  theme: '选择',
  narrativePov: '限知',
  tone: '克制',
  styleSample: '',
  bannedExpressions: []
}

const emptySnapshot = (projectId = 'project-ui-one'): NovelBibleSnapshot => ({
  projectId,
  profile: null,
  entries: [],
  outline: [],
  proposals: [],
  loadedAt: now
})

const ok = <T>(data: T): BibleResult<T> => ({ ok: true, data })

const createApi = (snapshot: NovelBibleSnapshot, overrides: Partial<NovelBibleApi> = {}): NovelBibleApi => ({
  getSnapshot: vi.fn(async () => ok(snapshot)),
  saveProfile: vi.fn(async (input) => ok({
    ...snapshot,
    profile: {
      ...input.draft,
      id: 'novel-profile-one',
      projectId: snapshot.projectId,
      authorityStatus: 'user_confirmed',
      currentVersionId: 'profile-version-one',
      createdAt: now,
      updatedAt: now
    }
  })),
  saveEntry: vi.fn(async () => ok(snapshot)),
  saveOutlineNode: vi.fn(async () => ok(snapshot)),
  moveOutlineNode: vi.fn(async () => ok(snapshot)),
  listVersions: vi.fn(async () => ok([])),
  restoreVersion: vi.fn(async () => ok(snapshot)),
  generateProposals: vi.fn(async () => ok([])),
  cancelGeneration: vi.fn(async () => ok(null)),
  decideProposal: vi.fn(async () => ok(snapshot)),
  ...overrides
})

const installApi = (api: NovelBibleApi): void => {
  Object.defineProperty(window, 'openNovel', {
    configurable: true,
    value: { novelBible: api }
  })
}

const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text().includes(label))
  if (found === undefined) throw new Error(`Button not found: ${label}`)
  return found
}

test('isolates stale loads and locks duplicate mutations in the shared Bible controller', async () => {
  let resolveFirst!: (result: BibleResult<NovelBibleSnapshot>) => void
  let resolveSecond!: (result: BibleResult<NovelBibleSnapshot>) => void
  const getSnapshot = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
  let resolveSave!: (result: BibleResult<NovelBibleSnapshot>) => void
  const saveProfile: NovelBibleApi['saveProfile'] = vi.fn(() =>
    new Promise<BibleResult<NovelBibleSnapshot>>((resolve) => { resolveSave = resolve }))
  const api = createApi(emptySnapshot(), { getSnapshot, saveProfile })
  const controller = createNovelBibleController(api)

  const first = controller.load()
  const second = controller.load()
  resolveSecond(ok(emptySnapshot('project-newest')))
  await second
  resolveFirst(ok(emptySnapshot('project-stale')))
  await first
  expect(controller.snapshot.value?.projectId).toBe('project-newest')

  const draft = {
    genre: 'urban-campus' as const,
    audience: '青年', theme: '选择', narrativePov: '限知', tone: '克制',
    styleSample: '', bannedExpressions: []
  }
  const input = { expectedVersionId: null, draft }
  const saving = controller.saveProfile(input)
  const duplicate = controller.saveProfile(input)
  expect(saveProfile).toHaveBeenCalledTimes(1)
  resolveSave(ok(emptySnapshot('project-saved')))
  await Promise.all([saving, duplicate])
  expect(controller.snapshot.value?.projectId).toBe('project-saved')
})

test('discards old-project proposal and version results after a newer snapshot loads', async () => {
  const old = emptySnapshot('project-old')
  const current = emptySnapshot('project-current')
  let resolveGeneration!: (result: BibleResult<BibleProposal[]>) => void
  let resolveVersions!: (result: BibleResult<BibleSourceVersion[]>) => void
  const generateProposals: NovelBibleApi['generateProposals'] = vi.fn(() =>
    new Promise<BibleResult<BibleProposal[]>>((resolve) => { resolveGeneration = resolve }))
  const listVersions: NovelBibleApi['listVersions'] = vi.fn(() =>
    new Promise<BibleResult<BibleSourceVersion[]>>((resolve) => { resolveVersions = resolve }))
  const api = createApi(old, {
    getSnapshot: vi.fn()
      .mockResolvedValueOnce(ok(old))
      .mockResolvedValueOnce(ok(current)),
    generateProposals,
    listVersions
  })
  const controller = createNovelBibleController(api)
  await controller.load()
  const generating = controller.generateProposals({
    domain: 'setting', mode: 'standard', request: '旧项目生成', targetEntityId: null
  })
  // Simulate an externally initiated project reload while the old generation is still pending.
  controller.busyAction.value = null
  const versions = controller.openVersions({ entityType: 'world-setting', entityId: 'entry-old' })
  controller.busyAction.value = null
  await controller.load()
  resolveGeneration(ok([]))
  resolveVersions(ok([]))
  await Promise.all([generating, versions])
  expect(controller.snapshot.value?.projectId).toBe('project-current')
  expect(controller.versionTarget.value).toBeNull()
  expect(controller.versions.value).toEqual([])
})

test('renders recoverable world empty state, labelled profile fields, templates, and a locked primary genre', async () => {
  const snapshot = emptySnapshot()
  const list = vi.fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: 'BIBLE_OPERATION_FAILED', message: 'private', retryable: true }
    })
    .mockResolvedValue(ok(snapshot))
  const saveProfile = vi.fn(async (input) => ok({
    ...snapshot,
    profile: {
      ...input.draft, id: 'novel-profile-one', projectId: snapshot.projectId,
      authorityStatus: 'user_confirmed', currentVersionId: 'profile-version-one',
      createdAt: now, updatedAt: now
    }
  }))
  const api = createApi(snapshot, { getSnapshot: list, saveProfile })
  installApi(api)
  const wrapper = mount(WorldBibleView)
  await flushPromises()

  expect(wrapper.get('h1').text()).toContain('世界观圣经')
  expect(wrapper.get('[role="alert"]').text()).toContain('小说圣经加载失败')
  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('先确定作品方向')
  expect(wrapper.get('label[for="novel-genre"]').text()).toContain('主类型')
  expect(wrapper.get('label[for="novel-audience"]').text()).toContain('目标读者')
  await button(wrapper, '都市校园模板').trigger('click')
  expect(wrapper.get<HTMLSelectElement>('#novel-genre').element.value).toBe('urban-campus')
  await wrapper.get('[data-testid="novel-profile-form"]').trigger('submit')
  await flushPromises()
  expect(saveProfile).toHaveBeenCalled()
  expect(wrapper.get<HTMLSelectElement>('#novel-genre').attributes()).toHaveProperty('disabled')
  expect(wrapper.text()).toContain('主类型已锁定')
  expect(wrapper.findAll('.bible-button').every((item) => item.classes().includes('bible-button'))).toBe(true)
  await wrapper.get('[data-testid="novel-profile-form"]').trigger('submit')
  await flushPromises()
  expect(saveProfile.mock.calls[1][0].expectedVersionId).toBe('profile-version-one')
  expect(Object.keys(saveProfile.mock.calls[1][0].draft).sort()).toEqual([
    'audience', 'bannedExpressions', 'genre', 'narrativePov', 'styleSample', 'theme', 'tone'
  ])
  expect(wrapper.text()).toContain('查看档案版本')
  await button(wrapper, '查看档案版本').trigger('click')
  await flushPromises()
  expect(api.listVersions).toHaveBeenCalledWith({
    entityType: 'novel-profile', entityId: 'novel-profile-one'
  })
})

test('keeps an unsaved profile draft when an unrelated world entry mutation refreshes the snapshot', async () => {
  const snapshot = emptySnapshot()
  snapshot.profile = {
    ...profileDraft,
    id: 'novel-profile-one', projectId: snapshot.projectId,
    authorityStatus: 'user_confirmed', currentVersionId: 'profile-version-one',
    createdAt: now, updatedAt: now
  }
  const saveEntry = vi.fn(async () => ok({
    ...snapshot,
    profile: { ...snapshot.profile! },
    loadedAt: '2026-08-11T08:00:00.000Z'
  }))
  installApi(createApi(snapshot, { saveEntry }))
  const wrapper = mount(WorldBibleView)
  await flushPromises()

  await wrapper.get('#novel-audience').setValue('尚未保存的档案草稿')
  await wrapper.get('#bible-entry-title').setValue('钟楼规则')
  await wrapper.get('[data-testid="bible-entry-form"]').trigger('submit')
  await flushPromises()

  expect(saveEntry).toHaveBeenCalledTimes(1)
  expect(wrapper.get<HTMLInputElement>('#novel-audience').element.value).toBe('尚未保存的档案草稿')
})

test('preserves structured entry fields and captures required character relations', async () => {
  const selected = {
    kind: 'character' as const, id: 'character-one', projectId: 'project-ui-one',
    title: '林澈', summary: '校史社社长',
    fields: [
      { key: 'motivation', label: '核心动机', value: '查明钟楼真相' },
      { key: 'fear', label: '恐惧', value: '重复父亲的失败' }
    ],
    relatedEntityIds: [], authorityStatus: 'approved' as const,
    currentVersionId: 'version-character-one', createdAt: now, updatedAt: now
  }
  const wrapper = mount(BibleEntryEditor, {
    props: { allowedKinds: ['character'], selected, busy: false, relationOptions: [] }
  })
  await wrapper.get('[data-testid="bible-entry-form"]').trigger('submit')
  const emitted = wrapper.emitted('save') as Array<[SaveBibleEntryInput]>
  expect(emitted[0][0].draft.fields).toEqual(selected.fields)

  await wrapper.setProps({
    allowedKinds: ['relationship'],
    selected: null,
    relationOptions: [
      selected,
      { ...selected, id: 'character-two', title: '许遥', currentVersionId: 'version-character-two' }
    ]
  })
  await flushPromises()
  await wrapper.get('#bible-entry-title').setValue('共同调查')
  const relations = wrapper.findAll('input[name="bible-entry-relation"]')
  expect(relations).toHaveLength(2)
  await relations[0].setValue(true)
  await relations[1].setValue(true)
  await wrapper.get('[data-testid="bible-entry-form"]').trigger('submit')
  expect((wrapper.emitted('save') as Array<[SaveBibleEntryInput]>)[1][0].draft.relatedEntityIds).toEqual([
    'character-one', 'character-two'
  ])
})

test('requires an unselected replacement confirmation and shows conflict evidence in text', async () => {
  const proposal: BibleProposal = {
    id: 'proposal-one',
    projectId: 'project-ui-one',
    sourceRunId: 'request-one',
    schemaVersion: 1,
    domain: 'setting',
    status: 'proposed',
    sourceVersionIds: ['version-old'],
    candidate: {
      operation: 'update',
      targetEntityId: 'entry-one',
      sourceVersionId: 'version-old',
      title: '替代钟楼规则',
      rationale: '解决时间矛盾',
      impact: '影响前三章调查',
      priority: 5,
      affectedEntityIds: ['entry-one'],
      conflicts: [{
        field: 'summary', oldValue: '每晚开放', newValue: '仅月蚀开放',
        sourceVersionId: 'version-old', affectedEntityIds: ['entry-one']
      }],
      entry: {
        kind: 'world-setting', title: '钟楼规则', summary: '仅月蚀开放',
        fields: [], relatedEntityIds: []
      }
    },
    createdAt: now,
    decidedAt: null
  }
  const wrapper = mount(ProposalReviewPanel, {
    props: { proposals: [proposal], busy: false }
  })
  expect(wrapper.text()).toContain('旧值：每晚开放')
  expect(wrapper.text()).toContain('新值：仅月蚀开放')
  expect(wrapper.text()).toContain('来源版本：version-old')
  expect(wrapper.text()).toContain('仅月蚀开放')
  expect(wrapper.text()).toContain('钟楼规则')
  const checkbox = wrapper.get<HTMLInputElement>('#replace-proposal-one')
  expect(checkbox.element.checked).toBe(false)
  expect(button(wrapper, '批准候选').attributes()).toHaveProperty('disabled')
  await checkbox.setValue(true)
  await button(wrapper, '批准候选').trigger('click')
  expect(wrapper.emitted('decide')?.[0]).toEqual([proposal.id, 'approve', true])
  await button(wrapper, '拒绝').trigger('click')
  expect(wrapper.emitted('decide')?.[1]).toEqual([proposal.id, 'reject', false])
})

test('shows character, relationship, and state cards with AI and version actions', async () => {
  const snapshot = emptySnapshot()
  snapshot.entries = [
    {
      kind: 'character', id: 'character-one', projectId: snapshot.projectId,
      title: '林澈', summary: '校史社社长', fields: [], relatedEntityIds: [],
      authorityStatus: 'user_confirmed', currentVersionId: 'version-character', createdAt: now, updatedAt: now
    },
    {
      kind: 'relationship', id: 'relationship-one', projectId: snapshot.projectId,
      title: '林澈与许遥', summary: '互相隐瞒真相', fields: [], relatedEntityIds: ['character-one'],
      authorityStatus: 'approved', currentVersionId: 'version-relationship', createdAt: now, updatedAt: now
    },
    {
      kind: 'character-state', id: 'state-one', projectId: snapshot.projectId,
      title: '林澈·第三章前', summary: '开始怀疑钟楼', fields: [], relatedEntityIds: ['character-one'],
      authorityStatus: 'approved', currentVersionId: 'version-state', createdAt: now, updatedAt: now
    }
  ]
  const api = createApi(snapshot)
  installApi(api)
  const wrapper = mount(CharacterBibleView)
  await flushPromises()
  expect(wrapper.get('h1').text()).toContain('人物圣经')
  expect(wrapper.text()).toContain('林澈')
  expect(wrapper.text()).toContain('人物关系')
  expect(wrapper.text()).toContain('阶段状态')
  expect(wrapper.text()).toContain('AI 完善人物')
  await button(wrapper, '查看版本').trigger('click')
  await flushPromises()
  expect(api.listVersions).toHaveBeenCalled()
})

test('keeps character edit state after a failed save', async () => {
  const snapshot = emptySnapshot()
  snapshot.entries = [{
    kind: 'character', id: 'character-one', projectId: snapshot.projectId,
    title: '林澈', summary: '校史社社长', fields: [], relatedEntityIds: [],
    authorityStatus: 'user_confirmed', currentVersionId: 'version-character', createdAt: now, updatedAt: now
  }]
  const saveEntry = vi.fn(async () => ({
    ok: false as const,
    error: { code: 'BIBLE_CONFLICT' as const, message: 'conflict', retryable: false }
  }))
  installApi(createApi(snapshot, { saveEntry }))
  const wrapper = mount(CharacterBibleView)
  await flushPromises()
  await button(wrapper, '编辑').trigger('click')
  await wrapper.get('#bible-entry-title').setValue('林澈（修订）')
  await wrapper.get('[data-testid="bible-entry-form"]').trigger('submit')
  await flushPromises()
  expect(wrapper.get<HTMLInputElement>('#bible-entry-title').element.value).toBe('林澈（修订）')
  expect(wrapper.text()).toContain('编辑人物资料')
  expect(wrapper.get('[role="alert"]').text()).toContain('资料已变化')
})

test('renders a four-level outline tree with keyboard buttons and local proposal generation', async () => {
  const snapshot = emptySnapshot()
  snapshot.profile = {
    ...profileDraft,
    id: 'profile-one', projectId: snapshot.projectId, authorityStatus: 'user_confirmed',
    currentVersionId: 'version-profile', createdAt: now, updatedAt: now
  }
  snapshot.outline = [
    ['story-one', 'story', null, '故事总纲', 0],
    ['volume-one', 'volume', 'story-one', '第一卷', 0],
    ['stage-one', 'stage', 'volume-one', '调查钟楼', 0],
    ['chapter-one', 'chapter-plan', 'stage-one', '第一章', 0],
    ['chapter-two', 'chapter-plan', 'stage-one', '第二章', 1],
    ['chapter-three', 'chapter-plan', 'stage-one', '第三章', 2]
  ].map(([id, kind, parentId, title, position]) => ({
    id, kind, parentId, title, position,
    projectId: snapshot.projectId, summary: `${title}摘要`, goal: '目标', conflict: '冲突',
    turningPoint: '转折', hook: '钩子', targetWords: 2200, participantCharacterIds: [],
    authorityStatus: 'user_confirmed', currentVersionId: `version-${id}`, createdAt: now, updatedAt: now
  })) as NovelBibleSnapshot['outline']
  const api = createApi(snapshot)
  installApi(api)
  const wrapper = mount(OutlineBibleView)
  await flushPromises()
  expect(wrapper.get('h1').text()).toContain('结构化大纲')
  expect(wrapper.get('[role="tree"]').text()).toContain('故事总纲')
  expect(wrapper.text()).toContain('第一章')
  expect(wrapper.text()).toContain('第三章')
  for (const selector of ['#outline-summary', '#outline-goal', '#outline-conflict', '#outline-turning', '#outline-hook']) {
    expect(wrapper.get(selector).attributes('maxlength')).toBe('20000')
  }
  expect(wrapper.get('#outline-target-words').attributes()).toHaveProperty('required')
  await wrapper.get('button[aria-label="上移第三章"]').trigger('click')
  await flushPromises()
  expect(api.moveOutlineNode).toHaveBeenCalledWith({ nodeId: 'chapter-three', direction: 'up' })
  await wrapper.get('#outline-ai-request').setValue('重新规划前三章')
  await button(wrapper, '生成局部候选').trigger('click')
  await flushPromises()
  expect(api.generateProposals).toHaveBeenCalledWith(expect.objectContaining({
    domain: 'plot', request: '重新规划前三章'
  }))

  await wrapper.findAll('.outline-tree__body')[0].trigger('click')
  await wrapper.get('#outline-title').setValue('故事总纲（修订）')
  await wrapper.get('[data-testid="outline-form"]').trigger('submit')
  await flushPromises()
  const saved = vi.mocked(api.saveOutlineNode).mock.calls[0][0]
  expect(Object.keys(saved.draft).sort()).toEqual([
    'conflict', 'goal', 'hook', 'kind', 'parentId', 'participantCharacterIds',
    'position', 'summary', 'targetWords', 'title', 'turningPoint'
  ])
})

test('previews version snapshots and requires explicit restore confirmation', async () => {
  const snapshot = emptySnapshot()
  snapshot.entries = [{
    kind: 'world-setting', id: 'entry-one', projectId: snapshot.projectId,
    title: '钟楼规则', summary: '当前只在雨夜开放', fields: [], relatedEntityIds: [],
    authorityStatus: 'user_confirmed', currentVersionId: 'version-current', createdAt: now, updatedAt: now
  }]
  const historical = {
    id: 'version-old', projectId: snapshot.projectId, entityType: 'world-setting' as const,
    entityId: 'entry-one', versionNumber: 1, authorityStatus: 'user_confirmed' as const,
    sourceKind: 'user' as const, sourceRunId: null, proposalId: null,
    snapshot: {
      kind: 'world-setting' as const, title: '钟楼规则', summary: '历史版本：每天开放',
      fields: [{ key: 'hours', label: '开放时间', value: '全天' }], relatedEntityIds: []
    },
    supersedesVersionId: null, restoredFromVersionId: null, createdAt: now
  }
  const restoreVersion = vi.fn(async () => ok(snapshot))
  installApi(createApi(snapshot, {
    listVersions: vi.fn(async () => ok([historical])),
    restoreVersion
  }))
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  Object.defineProperty(window, 'confirm', { configurable: true, value: confirm })
  const wrapper = mount(WorldBibleView)
  await flushPromises()
  await button(wrapper, '查看版本').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('历史版本：每天开放')
  expect(wrapper.text()).toContain('开放时间：全天')
  await button(wrapper, '恢复此版本').trigger('click')
  expect(restoreVersion).not.toHaveBeenCalled()
  await button(wrapper, '恢复此版本').trigger('click')
  await flushPromises()
  expect(restoreVersion).toHaveBeenCalledWith({
    entityType: 'world-setting', entityId: 'entry-one', versionId: 'version-old'
  })
  Reflect.deleteProperty(window, 'confirm')
})
