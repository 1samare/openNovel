import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { ProjectApi, ProjectResult, ProjectSummary } from '../../src/shared/project'
import WorkspaceLayout from '../../src/renderer/src/layouts/WorkspaceLayout.vue'
import {
  clearActiveProject,
  setActiveProject
} from '../../src/renderer/src/project/use-workspace-project'

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
  rename: vi.fn(async (title) => ok({ ...project, title })),
  backup: vi.fn(async () => ok({
    projectId: project.projectId,
    backupPath: 'D:\\Backups\\Star',
    createdAt: '2026-08-07T09:00:00.000Z'
  })),
  restoreBackup: vi.fn(async () => ok(project)),
  removeRecent: vi.fn(async () => ok(null)),
  ...overrides
})

const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (found === undefined) throw new Error(`Button not found: ${label}`)
  return found
}

const mountLayout = async (api: ProjectApi) => {
  Object.defineProperty(window, 'openNovel', {
    configurable: true,
    value: { projects: api }
  })
  setActiveProject(project)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<main>项目中心</main>' } },
      {
        path: '/workspace',
        component: WorkspaceLayout,
        children: [{ path: 'overview', component: { template: '<main>概览</main>' } }]
      },
      { path: '/:pathMatch(.*)*', component: { template: '<main />' } }
    ]
  })
  await router.push('/workspace/overview')
  await router.isReady()
  const wrapper = mount(WorkspaceLayout, { global: { plugins: [router] } })
  return { router, wrapper }
}

afterEach(() => clearActiveProject())

test('renames, backs up, and closes the active project from the workspace header', async () => {
  const rename = vi.fn(async (title: string) => ok({ ...project, title }))
  const backup = vi.fn(async () => ok({
    projectId: project.projectId,
    backupPath: 'D:\\Backups\\Star',
    createdAt: '2026-08-07T09:00:00.000Z'
  }))
  const close = vi.fn(async () => ok(null))
  const { router, wrapper } = await mountLayout(createApi({ rename, backup, close }))

  expect(wrapper.text()).toContain('星海来信')
  await button(wrapper, '重命名').trigger('click')
  expect(wrapper.get('label[for="workspace-project-title"]').text()).toContain('小说名称')
  await wrapper.get('input#workspace-project-title').setValue('  月海回声  ')
  await wrapper.get('[data-testid="workspace-rename-form"]').trigger('submit')
  await flushPromises()
  expect(rename).toHaveBeenCalledWith('月海回声')
  expect(wrapper.text()).toContain('月海回声')

  await button(wrapper, '创建备份').trigger('click')
  await flushPromises()
  expect(backup).toHaveBeenCalledTimes(1)
  expect(wrapper.get('[role="status"]').text()).toContain('备份已创建')

  await button(wrapper, '关闭并返回项目中心').trigger('click')
  await flushPromises()
  expect(close).toHaveBeenCalledTimes(1)
  expect(router.currentRoute.value.fullPath).toBe('/')
})

test('validates rename and locks duplicate backup commands with an actionable error', async () => {
  let resolveBackup!: (result: ProjectResult<null>) => void
  const backup = vi.fn(() => new Promise<ProjectResult<null>>((resolve) => {
    resolveBackup = resolve
  }))
  const { wrapper } = await mountLayout(createApi({ backup }))

  await button(wrapper, '重命名').trigger('click')
  await wrapper.get('input#workspace-project-title').setValue('   ')
  await wrapper.get('[data-testid="workspace-rename-form"]').trigger('submit')
  expect(wrapper.get('[data-testid="workspace-title-error"]').text()).toContain('请输入小说名称')

  await button(wrapper, '创建备份').trigger('click')
  await button(wrapper, '正在备份…').trigger('click')
  expect(backup).toHaveBeenCalledTimes(1)
  expect(button(wrapper, '正在备份…').attributes()).toHaveProperty('disabled')

  resolveBackup({
    ok: false,
    error: { code: 'PROJECT_BACKUP_FAILED', message: 'Project operation failed' }
  })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('备份未完成')
})

test('keeps brand navigation inside the workspace and disables actions without an active project', async () => {
  const close = vi.fn(async () => ok(null))
  const { router, wrapper } = await mountLayout(createApi({ close }))

  expect(wrapper.get('.workspace-brand').attributes('href')).toBe('/workspace/overview')
  await wrapper.get('.workspace-brand').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe('/workspace/overview')
  expect(close).not.toHaveBeenCalled()

  clearActiveProject()
  await flushPromises()
  for (const action of wrapper.findAll('.workspace-project-actions button')) {
    expect(action.attributes()).toHaveProperty('disabled')
  }
})
