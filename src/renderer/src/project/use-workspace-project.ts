import { computed, readonly, ref, shallowRef } from 'vue'
import { isProjectSummary, type ProjectApi, type ProjectResult, type ProjectSummary } from '@shared/project'

type WorkspaceAction = 'renaming' | 'backing-up' | 'closing' | null

const ACTIVE_PROJECT_KEY = 'openNovel.activeProject'

const loadActiveProject = (): ProjectSummary | undefined => {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(ACTIVE_PROJECT_KEY) ?? 'null')
    return isProjectSummary(value) ? value : undefined
  } catch {
    return undefined
  }
}

const activeProjectState = shallowRef<ProjectSummary | undefined>(loadActiveProject())

export const activeProject = readonly(activeProjectState)

export const setActiveProject = (project: ProjectSummary): void => {
  activeProjectState.value = { ...project }
  try {
    window.sessionStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(project))
  } catch {
    // In-memory state remains authoritative for the current renderer lifetime.
  }
}

export const clearActiveProject = (): void => {
  activeProjectState.value = undefined
  try {
    window.sessionStorage.removeItem(ACTIVE_PROJECT_KEY)
  } catch {
    // Storage cleanup is best-effort in restricted renderer environments.
  }
}

export function useWorkspaceProject(api: ProjectApi, onClosed: () => void) {
  const busyAction = ref<WorkspaceAction>(null)
  const showRenameForm = ref(false)
  const title = ref('')
  const titleError = ref('')
  const error = ref('')
  const status = ref('')

  const isBusy = computed(() => busyAction.value !== null)

  function beginRename() {
    title.value = activeProjectState.value?.title ?? ''
    titleError.value = ''
    error.value = ''
    status.value = ''
    showRenameForm.value = true
  }

  function reportFailure(action: Exclude<WorkspaceAction, null>) {
    if (action === 'backing-up') {
      error.value = '备份未完成，请检查保存目录后重试。'
    } else if (action === 'renaming') {
      error.value = '重命名未完成，请检查小说名称后重试。'
    } else {
      error.value = '项目关闭未完成，请重试后再返回项目中心。'
    }
  }

  async function run<T>(
    action: Exclude<WorkspaceAction, null>,
    operation: () => Promise<ProjectResult<T>>,
    onSuccess: (data: T) => void
  ) {
    if (isBusy.value) return
    busyAction.value = action
    error.value = ''
    status.value = ''
    try {
      const result = await operation()
      if (result.ok) onSuccess(result.data)
      else reportFailure(action)
    } catch {
      reportFailure(action)
    } finally {
      busyAction.value = null
    }
  }

  async function renameProject() {
    const normalized = title.value.trim()
    if (!normalized) {
      titleError.value = '请输入小说名称。'
      return
    }
    titleError.value = ''
    await run('renaming', () => api.rename(normalized), (project) => {
      setActiveProject(project)
      showRenameForm.value = false
      status.value = '小说名称已更新。'
    })
  }

  async function backupProject() {
    titleError.value = ''
    await run('backing-up', () => api.backup(), (backup) => {
      if (backup !== null) status.value = '备份已创建并完成校验。'
    })
  }

  async function closeProject() {
    await run('closing', () => api.close(), () => {
      clearActiveProject()
      onClosed()
    })
  }

  return {
    activeProject,
    backupProject,
    beginRename,
    busyAction,
    closeProject,
    error,
    isBusy,
    renameProject,
    showRenameForm,
    status,
    title,
    titleError
  }
}
