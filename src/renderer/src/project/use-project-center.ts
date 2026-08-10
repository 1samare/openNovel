import { computed, ref } from 'vue'
import type {
  ProjectApi,
  ProjectPublicError,
  ProjectResult,
  ProjectSummary,
  RecentProjectSummary
} from '@shared/project'

type BusyAction = 'loading' | 'creating' | 'opening' | 'restoring' | 'removing' | null

function errorMessage(error: ProjectPublicError, context: 'loading' | 'action'): string {
  switch (error.code) {
    case 'PROJECT_DIRECTORY_NOT_EMPTY':
      return '所选目录不是空目录，请重新选择一个空目录。'
    case 'PROJECT_LOCKED':
      return '该项目已在其他窗口中打开，请先关闭对应窗口后重试。'
    case 'STALE_PROJECT_LOCK':
      return '检测到上次异常退出留下的锁定信息，请重试并确认恢复。'
    case 'INVALID_PROJECT_MANIFEST':
    case 'PROJECT_DATA_MISMATCH':
      return '项目数据校验失败，请从已验证的备份恢复。'
    case 'PROJECT_NOT_FOUND':
      return '项目路径不可用，请重新定位项目或从备份恢复。'
    case 'INVALID_PROJECT_BACKUP':
    case 'PROJECT_BACKUP_FAILED':
    case 'PROJECT_RESTORE_FAILED':
      return '备份文件校验失败，请选择其他备份。'
    default:
      return context === 'loading'
        ? '无法读取最近项目，请检查本地项目文件后重试。'
        : '项目操作未完成，请检查所选目录后重试。'
  }
}

export function useProjectCenter(api: ProjectApi, onOpened: (project: ProjectSummary) => void) {
  const recentProjects = ref<RecentProjectSummary[]>([])
  const loading = ref(true)
  const busyAction = ref<BusyAction>('loading')
  const error = ref('')
  const retryAvailable = ref(false)
  const showCreateForm = ref(false)
  const title = ref('')
  const titleError = ref('')

  const isBusy = computed(() => busyAction.value !== null)
  const actionStatus = computed(() => {
    switch (busyAction.value) {
      case 'creating':
        return '正在创建项目…'
      case 'opening':
        return '正在打开项目…'
      case 'restoring':
        return '正在验证并恢复备份…'
      case 'removing':
        return '正在更新最近项目…'
      default:
        return ''
    }
  })

  function reportFailure(result: Extract<ProjectResult<unknown>, { ok: false }>, context: 'loading' | 'action') {
    error.value = errorMessage(result.error, context)
    retryAvailable.value = context === 'loading'
  }

  function finishOpen(result: ProjectResult<ProjectSummary | null>) {
    if (result.ok) {
      error.value = ''
      retryAvailable.value = false
      if (result.data !== null) onOpened(result.data)
      return
    }

    reportFailure(result, 'action')
  }

  async function run(action: Exclude<BusyAction, 'loading' | null>, operation: () => Promise<void>) {
    if (isBusy.value) return

    busyAction.value = action
    error.value = ''
    retryAvailable.value = false
    try {
      await operation()
    } finally {
      busyAction.value = null
    }
  }

  async function load() {
    if (busyAction.value && busyAction.value !== 'loading') return

    loading.value = true
    busyAction.value = 'loading'
    error.value = ''
    retryAvailable.value = false
    try {
      const result = await api.listRecent()
      if (result.ok) {
        recentProjects.value = result.data
      } else {
        reportFailure(result, 'loading')
      }
    } finally {
      loading.value = false
      busyAction.value = null
    }
  }

  async function createProject() {
    const normalizedTitle = title.value.trim()
    if (!normalizedTitle) {
      titleError.value = '请输入小说名称。'
      return
    }

    titleError.value = ''
    await run('creating', async () => {
      finishOpen(await api.create(normalizedTitle))
    })
  }

  async function openExisting() {
    await run('opening', async () => {
      finishOpen(await api.open())
    })
  }

  async function openRecent(projectId: string) {
    await run('opening', async () => {
      finishOpen(await api.openRecent(projectId))
    })
  }

  async function restoreBackup() {
    await run('restoring', async () => {
      finishOpen(await api.restoreBackup())
    })
  }

  async function removeRecent(projectId: string) {
    await run('removing', async () => {
      const result = await api.removeRecent(projectId)
      if (result.ok) {
        recentProjects.value = recentProjects.value.filter((project) => project.projectId !== projectId)
        return
      }

      reportFailure(result, 'action')
    })
  }

  return {
    actionStatus,
    busyAction,
    createProject,
    error,
    isBusy,
    load,
    loading,
    openExisting,
    openRecent,
    recentProjects,
    removeRecent,
    restoreBackup,
    retryAvailable,
    showCreateForm,
    title,
    titleError
  }
}
