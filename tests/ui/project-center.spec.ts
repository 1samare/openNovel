import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { expect, test, vi } from 'vitest'

import type {
  ProjectApi,
  ProjectResult,
  ProjectSummary,
  RecentProjectSummary
} from '../../src/shared/project'
import ProjectCenterView from '../../src/renderer/src/views/ProjectCenterView.vue'

const project: ProjectSummary = {
  projectId: 'project-1',
  title: '星海来信',
  root: 'D:\\Novels\\Star',
  createdAt: '2026-08-07T08:00:00.000Z',
  updatedAt: '2026-08-07T08:00:00.000Z'
}

const ok = <T>(data: T): ProjectResult<T> => ({ ok: true, data })

const createApi = (overrides: Partial<ProjectApi> = {}): ProjectApi => ({
  listRecent: vi.fn(async () => ok([])),
  create: vi.fn(async () => ok(project)),
  open: vi.fn(async () => ok(project)),
  openRecent: vi.fn(async () => ok(project)),
  close: vi.fn(async () => ok(null)),
  rename: vi.fn(async () => ok(project)),
  backup: vi.fn(async () => ok(null)),
  restoreBackup: vi.fn(async () => ok(project)),
  removeRecent: vi.fn(async () => ok(null)),
  ...overrides
})

const mountView = async (api: ProjectApi) => {
  Object.defineProperty(window, 'openNovel', {
    configurable: true,
    value: { projects: api }
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/workspace/overview', component: { template: '<div />' } }
    ]
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ProjectCenterView, { global: { plugins: [router] } })
  return { wrapper, router }
}

const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (found === undefined) throw new Error(`Button not found: ${label}`)
  return found
}

test('announces recent-project loading and renders a guided empty state', async () => {
  let resolveRecent!: (value: ProjectResult<RecentProjectSummary[]>) => void
  const api = createApi({
    listRecent: vi.fn(() => new Promise<ProjectResult<RecentProjectSummary[]>>((resolve) => {
      resolveRecent = resolve
    }))
  })
  const { wrapper } = await mountView(api)

  expect(wrapper.get('[role="status"]').text()).toContain('正在读取最近项目')
  resolveRecent(ok([]))
  await flushPromises()

  expect(wrapper.get('h1').text()).toContain('独立项目')
  expect(wrapper.get('[data-testid="project-empty"]').text()).toContain('还没有最近项目')
  expect(button(wrapper, '新建小说项目').attributes('type')).toBe('button')
})

test('validates the labelled title field, locks duplicate create, and navigates on success', async () => {
  let resolveCreate!: (value: ProjectResult<ProjectSummary | null>) => void
  const create = vi.fn(() => new Promise<ProjectResult<ProjectSummary | null>>((resolve) => {
    resolveCreate = resolve
  }))
  const api = createApi({ create })
  const { wrapper, router } = await mountView(api)
  await flushPromises()

  await button(wrapper, '新建小说项目').trigger('click')
  const input = wrapper.get('input#project-title')
  expect(wrapper.get('label[for="project-title"]').text()).toContain('小说名称')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.get('[data-testid="title-error"]').text()).toContain('请输入小说名称')
  expect(create).not.toHaveBeenCalled()

  await input.setValue('  星海来信  ')
  await wrapper.get('form').trigger('submit')
  await wrapper.get('form').trigger('submit')
  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith('星海来信')
  expect(button(wrapper, '正在创建…').attributes()).toHaveProperty('disabled')

  resolveCreate(ok(project))
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/workspace/overview')
})

test('renders available and missing recent projects with distinct recovery actions', async () => {
  const openRecent = vi.fn(async () => ok(project))
  const removeRecent = vi.fn(async () => ok(null))
  const open = vi.fn(async () => ok(project))
  const restoreBackup = vi.fn(async () => ok(project))
  const api = createApi({
    listRecent: vi.fn(async () => ok([
      {
        projectId: 'project-1',
        title: '星海来信',
        projectPath: 'D:\\Novels\\Star',
        lastOpenedAt: '2026-08-07T08:00:00.000Z',
        pathAvailable: true
      },
      {
        projectId: 'project-2',
        title: '月海回声',
        projectPath: 'D:\\Novels\\Missing',
        lastOpenedAt: '2026-08-06T08:00:00.000Z',
        pathAvailable: false
      }
    ])),
    openRecent,
    removeRecent,
    open,
    restoreBackup
  })
  const { wrapper } = await mountView(api)
  await flushPromises()

  expect(wrapper.text()).toContain('路径不可用')
  await wrapper.get('[aria-label="仅移除记录 月海回声"]').trigger('click')
  expect(removeRecent).toHaveBeenCalledWith('project-2')
  expect(wrapper.text()).not.toContain('月海回声')

  await wrapper.get('[aria-label="打开 星海来信"]').trigger('click')
  expect(openRecent).toHaveBeenCalledWith('project-1')

  const secondMount = await mountView(createApi({
    listRecent: api.listRecent,
    open,
    restoreBackup
  }))
  await flushPromises()
  await secondMount.wrapper.get('[aria-label="重新定位 月海回声"]').trigger('click')
  expect(open).toHaveBeenCalled()
  await secondMount.wrapper.get('[aria-label="从备份恢复 月海回声"]').trigger('click')
  expect(restoreBackup).toHaveBeenCalled()
})

test('maps actionable errors into an alert and allows recent-project loading retry', async () => {
  const listRecent = vi.fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: 'DATABASE_WORKER_FAILED', message: 'Project operation failed' }
    })
    .mockResolvedValueOnce(ok([]))
  const api = createApi({ listRecent })
  const { wrapper } = await mountView(api)
  await flushPromises()

  expect(wrapper.get('[role="alert"]').text()).toContain('无法读取最近项目')
  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(listRecent).toHaveBeenCalledTimes(2)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)

  const createFailure = await mountView(createApi({
    create: vi.fn(async (): Promise<ProjectResult<ProjectSummary | null>> => ({
      ok: false,
      error: {
        code: 'PROJECT_DIRECTORY_NOT_EMPTY',
        message: 'Project operation failed'
      }
    }))
  }))
  await flushPromises()
  await button(createFailure.wrapper, '新建小说项目').trigger('click')
  await createFailure.wrapper.get('input#project-title').setValue('星海来信')
  await createFailure.wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(createFailure.wrapper.get('[role="alert"]').text()).toContain('所选目录不是空目录')
  expect((createFailure.wrapper.get('input#project-title').element as HTMLInputElement).value)
    .toBe('星海来信')
})
