export type ProjectErrorCode =
  | 'INVALID_PROJECT_PATH'
  | 'PROJECT_DIRECTORY_NOT_EMPTY'
  | 'INVALID_PROJECT_MANIFEST'
  | 'PROJECT_LOCKED'
  | 'STALE_PROJECT_LOCK'
  | 'PROJECT_IO_FAILED'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_MIGRATION_FAILED'
  | 'DATABASE_TRANSACTION_FAILED'
  | 'DATABASE_EXPECTED_CHANGES_MISMATCH'
  | 'DATABASE_WORKER_FAILED'
  | 'DATABASE_CLOSED'
  | 'INVALID_PROJECT_TITLE'
  | 'PROJECT_NOT_OPEN'
  | 'PROJECT_ALREADY_OPEN'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_DATA_MISMATCH'
  | 'PROJECT_BACKUP_FAILED'
  | 'INVALID_PROJECT_BACKUP'
  | 'PROJECT_RESTORE_FAILED'
  | 'INVALID_CHAPTER_TITLE'
  | 'INVALID_CHAPTER_HIERARCHY'
  | 'CHAPTER_NOT_FOUND'
  | 'CHAPTER_HAS_CHILDREN'
  | 'CHAPTER_SAVE_CONFLICT'
  | 'CHAPTER_OPERATION_FAILED'
  | 'IPC_NOT_AUTHORIZED'
  | 'INVALID_PROJECT_COMMAND'
  | 'PROJECT_OPERATION_FAILED'

export class ProjectDomainError extends Error {
  readonly code: ProjectErrorCode

  constructor(code: ProjectErrorCode, message: string) {
    super(message)
    this.name = 'ProjectDomainError'
    this.code = code
  }
}

export type ProjectManifest = {
  formatVersion: 1
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type ProjectSummary = {
  projectId: string
  title: string
  root: string
  createdAt: string
  updatedAt: string
}

export type RecentProjectSummary = {
  projectId: string
  title: string
  projectPath: string
  lastOpenedAt: string
  lastBackupPath?: string
  pathAvailable: boolean
}

export type ProjectBackupSummary = {
  projectId: string
  backupPath: string
  createdAt: string
}

export type ProjectPublicError = {
  code: ProjectErrorCode
  message: string
}

export type ProjectResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProjectPublicError }

export const PROJECT_IPC_CHANNELS = {
  listRecent: 'projects:list-recent',
  create: 'projects:create',
  open: 'projects:open',
  openRecent: 'projects:open-recent',
  close: 'projects:close',
  rename: 'projects:rename',
  backup: 'projects:backup',
  restoreBackup: 'projects:restore-backup',
  removeRecent: 'projects:remove-recent'
} as const

export type ProjectIpcChannel = typeof PROJECT_IPC_CHANNELS[keyof typeof PROJECT_IPC_CHANNELS]

export type ProjectApi = {
  listRecent(): Promise<ProjectResult<RecentProjectSummary[]>>
  create(title: string): Promise<ProjectResult<ProjectSummary | null>>
  open(): Promise<ProjectResult<ProjectSummary | null>>
  openRecent(projectId: string): Promise<ProjectResult<ProjectSummary>>
  close(): Promise<ProjectResult<null>>
  rename(title: string): Promise<ProjectResult<ProjectSummary>>
  backup(): Promise<ProjectResult<ProjectBackupSummary | null>>
  restoreBackup(): Promise<ProjectResult<ProjectSummary | null>>
  removeRecent(projectId: string): Promise<ProjectResult<null>>
}

const projectErrorCodes: ReadonlySet<string> = new Set([
  'INVALID_PROJECT_PATH',
  'PROJECT_DIRECTORY_NOT_EMPTY',
  'INVALID_PROJECT_MANIFEST',
  'PROJECT_LOCKED',
  'STALE_PROJECT_LOCK',
  'PROJECT_IO_FAILED',
  'DATABASE_OPEN_FAILED',
  'DATABASE_MIGRATION_FAILED',
  'DATABASE_TRANSACTION_FAILED',
  'DATABASE_EXPECTED_CHANGES_MISMATCH',
  'DATABASE_WORKER_FAILED',
  'DATABASE_CLOSED',
  'INVALID_PROJECT_TITLE',
  'PROJECT_NOT_OPEN',
  'PROJECT_ALREADY_OPEN',
  'PROJECT_NOT_FOUND',
  'PROJECT_DATA_MISMATCH',
  'PROJECT_BACKUP_FAILED',
  'INVALID_PROJECT_BACKUP',
  'PROJECT_RESTORE_FAILED',
  'INVALID_CHAPTER_TITLE',
  'INVALID_CHAPTER_HIERARCHY',
  'CHAPTER_NOT_FOUND',
  'CHAPTER_HAS_CHILDREN',
  'CHAPTER_SAVE_CONFLICT',
  'CHAPTER_OPERATION_FAILED',
  'IPC_NOT_AUTHORIZED',
  'INVALID_PROJECT_COMMAND',
  'PROJECT_OPERATION_FAILED'
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|')

const isProjectId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value)

const isTitle = (value: unknown): value is string =>
  typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 120

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

export const isProjectSummary = (value: unknown): value is ProjectSummary => {
  if (!isRecord(value) || !hasExactKeys(
    value,
    ['projectId', 'title', 'root', 'createdAt', 'updatedAt']
  )) return false
  return isProjectId(value.projectId) &&
    isTitle(value.title) &&
    typeof value.root === 'string' &&
    value.root.length > 0 &&
    isCanonicalTimestamp(value.createdAt) &&
    isCanonicalTimestamp(value.updatedAt) &&
    Date.parse(value.updatedAt) >= Date.parse(value.createdAt)
}

export const isRecentProjectSummary = (value: unknown): value is RecentProjectSummary => {
  if (!isRecord(value)) return false
  const keys = value.lastBackupPath === undefined
    ? ['projectId', 'title', 'projectPath', 'lastOpenedAt', 'pathAvailable']
    : ['projectId', 'title', 'projectPath', 'lastOpenedAt', 'lastBackupPath', 'pathAvailable']
  return hasExactKeys(value, keys) &&
    isProjectId(value.projectId) &&
    isTitle(value.title) &&
    typeof value.projectPath === 'string' &&
    value.projectPath.length > 0 &&
    isCanonicalTimestamp(value.lastOpenedAt) &&
    (value.lastBackupPath === undefined || (
      typeof value.lastBackupPath === 'string' && value.lastBackupPath.length > 0
    )) &&
    typeof value.pathAvailable === 'boolean'
}

export const isProjectBackupSummary = (value: unknown): value is ProjectBackupSummary =>
  isRecord(value) &&
  hasExactKeys(value, ['projectId', 'backupPath', 'createdAt']) &&
  isProjectId(value.projectId) &&
  typeof value.backupPath === 'string' &&
  value.backupPath.length > 0 &&
  isCanonicalTimestamp(value.createdAt)

export function isProjectResult(value: unknown): value is ProjectResult<unknown>
export function isProjectResult<T>(
  value: unknown,
  validateData: (data: unknown) => data is T
): value is ProjectResult<T>
export function isProjectResult<T>(
  value: unknown,
  validateData: (data: unknown) => data is T = (_data): _data is T => true
): value is ProjectResult<T> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) return hasExactKeys(value, ['ok', 'data']) && validateData(value.data)
  if (!hasExactKeys(value, ['ok', 'error']) || !isRecord(value.error)) return false
  return hasExactKeys(value.error, ['code', 'message']) &&
    typeof value.error.code === 'string' &&
    projectErrorCodes.has(value.error.code) &&
    typeof value.error.message === 'string'
}

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 120

export const validateProjectCommand = (channel: string, args: readonly unknown[]): boolean => {
  switch (channel) {
    case PROJECT_IPC_CHANNELS.listRecent:
    case PROJECT_IPC_CHANNELS.open:
    case PROJECT_IPC_CHANNELS.close:
    case PROJECT_IPC_CHANNELS.backup:
    case PROJECT_IPC_CHANNELS.restoreBackup:
      return args.length === 0
    case PROJECT_IPC_CHANNELS.create:
    case PROJECT_IPC_CHANNELS.rename:
    case PROJECT_IPC_CHANNELS.openRecent:
    case PROJECT_IPC_CHANNELS.removeRecent:
      return args.length === 1 && isNonBlankString(args[0])
    default:
      return false
  }
}
