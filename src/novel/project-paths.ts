import {
  mkdir,
  open as openFile,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { isAbsolute, join, parse, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ProjectDomainError,
  type ProjectManifest
} from '../shared/project.ts'

export type ProjectPaths = {
  root: string
  manifest: string
  database: string
  attachments: string
  backups: string
  exports: string
  lock: string
}

export type ProjectLock = {
  release(): Promise<void>
}

const fail = (code: ConstructorParameters<typeof ProjectDomainError>[0], message: string): never => {
  throw new ProjectDomainError(code, message)
}

export const resolveProjectPaths = (root: string): ProjectPaths => {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    fail('INVALID_PROJECT_PATH', 'Project location must be an absolute path')
  }
  const normalized = resolve(root)
  if (normalized === parse(normalized).root) {
    fail('INVALID_PROJECT_PATH', 'A filesystem root cannot be used as a project')
  }
  return {
    root: normalized,
    manifest: join(normalized, 'open-novel.json'),
    database: join(normalized, 'project.sqlite3'),
    attachments: join(normalized, 'attachments'),
    backups: join(normalized, 'backups'),
    exports: join(normalized, 'exports'),
    lock: join(normalized, '.open-novel.lock')
  }
}

export const prepareEmptyProjectDirectory = async (root: string): Promise<ProjectPaths> => {
  const paths = resolveProjectPaths(root)
  try {
    const details = await stat(paths.root)
    if (!details.isDirectory()) {
      fail('INVALID_PROJECT_PATH', 'Project location must be a directory')
    }
    if ((await readdir(paths.root)).length > 0) {
      fail('PROJECT_DIRECTORY_NOT_EMPTY', 'Choose an empty directory for the project')
    }
  } catch (error) {
    if (error instanceof ProjectDomainError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail('PROJECT_IO_FAILED', 'Project directory could not be inspected')
    }
    try {
      await mkdir(paths.root, { recursive: true })
    } catch {
      fail('PROJECT_IO_FAILED', 'Project directory could not be created')
    }
  }
  return paths
}

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

const isProjectManifest = (value: unknown): value is ProjectManifest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join('|') !== 'createdAt|formatVersion|projectId|title|updatedAt') return false
  return record.formatVersion === 1 &&
    typeof record.projectId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(record.projectId) &&
    typeof record.title === 'string' &&
    record.title === record.title.trim() &&
    record.title.length > 0 &&
    record.title.length <= 120 &&
    isIsoDate(record.createdAt) &&
    isIsoDate(record.updatedAt) &&
    Date.parse(record.updatedAt) >= Date.parse(record.createdAt)
}

export const readProjectManifest = async (root: string): Promise<ProjectManifest> => {
  const paths = resolveProjectPaths(root)
  try {
    const value: unknown = JSON.parse(await readFile(paths.manifest, 'utf8'))
    if (!isProjectManifest(value)) {
      return fail('INVALID_PROJECT_MANIFEST', 'Project manifest is invalid or unsupported')
    }
    return value
  } catch (error) {
    if (error instanceof ProjectDomainError) throw error
    return fail('INVALID_PROJECT_MANIFEST', 'Project manifest is invalid or unreadable')
  }
}

export const writeProjectManifest = async (
  paths: ProjectPaths,
  manifest: ProjectManifest
): Promise<void> => {
  if (!isProjectManifest(manifest)) {
    fail('INVALID_PROJECT_MANIFEST', 'Project manifest is invalid')
  }
  const temporary = join(paths.root, `.open-novel.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    await rename(temporary, paths.manifest)
  } catch {
    await unlink(temporary).catch(() => undefined)
    fail('PROJECT_IO_FAILED', 'Project manifest could not be saved')
  }
}

type LockRecord = {
  projectId: string
  pid: number
  createdAt: string
  token?: string
}

type RecoveryClaim = {
  pid: number
  createdAt: string
  token: string
}

const readLock = async (path: string): Promise<LockRecord | undefined> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    if (
      typeof record.projectId !== 'string' ||
      typeof record.pid !== 'number' ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.createdAt !== 'string'
    ) return undefined
    return {
      projectId: record.projectId,
      pid: record.pid,
      createdAt: record.createdAt,
      ...(typeof record.token === 'string' ? { token: record.token } : {})
    }
  } catch {
    return undefined
  }
}

const readRecoveryClaim = async (
  path: string
): Promise<{ claim?: RecoveryClaim; signature: string } | undefined> => {
  let signature: string
  try {
    signature = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return { signature: '' }
  }
  try {
    const value: unknown = JSON.parse(signature)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { signature }
    }
    const record = value as Record<string, unknown>
    if (
      typeof record.pid !== 'number' ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      !isIsoDate(record.createdAt) ||
      typeof record.token !== 'string' ||
      record.token.length === 0
    ) return { signature }
    return {
      claim: {
        pid: record.pid,
        createdAt: record.createdAt,
        token: record.token
      },
      signature
    }
  } catch {
    return { signature }
  }
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const acquireProjectLock = async (
  root: string,
  projectId: string,
  options: { recoverStale?: boolean } = {}
): Promise<ProjectLock> => {
  const paths = resolveProjectPaths(root)
  const token = randomUUID()
  const record: Required<LockRecord> = {
    projectId,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    token
  }

  const recoveryPath = `${paths.lock}.recovery`
  const existingRecovery = await readRecoveryClaim(recoveryPath)
  if (existingRecovery !== undefined) {
    if (existingRecovery.claim !== undefined && isProcessAlive(existingRecovery.claim.pid)) {
      fail('PROJECT_LOCKED', 'Another process is recovering this project lock')
    }
    if (options.recoverStale !== true) {
      fail('PROJECT_LOCKED', 'A stale project lock recovery claim requires confirmation')
    }
    const confirmedSignature = await readFile(recoveryPath, 'utf8').catch(() => undefined)
    if (confirmedSignature !== existingRecovery.signature) {
      fail('PROJECT_LOCKED', 'Project lock recovery ownership changed before reclamation')
    }
    try {
      await unlink(recoveryPath)
    } catch {
      fail('PROJECT_LOCKED', 'Project lock recovery ownership changed during reclamation')
    }
  }

  const install = async (): Promise<ProjectLock> => {
    const handle = await openFile(paths.lock, 'wx')
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        const current = await readLock(paths.lock)
        if (current?.token === token) {
          await unlink(paths.lock).catch(() => undefined)
        }
      }
    }
  }

  try {
    return await install()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      fail('PROJECT_IO_FAILED', 'Project lock could not be created')
    }
  }

  const current = await readLock(paths.lock)
  const currentSignature = await readFile(paths.lock, 'utf8').catch(() => undefined)
  if (current !== undefined && isProcessAlive(current.pid)) {
    fail('PROJECT_LOCKED', 'Project is already open in another process')
  }
  if (options.recoverStale !== true) {
    fail('STALE_PROJECT_LOCK', 'Project has a stale lock that requires confirmation')
  }
  if (currentSignature === undefined) {
    return fail('PROJECT_LOCKED', 'Project lock changed before recovery could begin')
  }

  try {
    const recoveryHandle = await openFile(recoveryPath, 'wx')
    try {
      await recoveryHandle.writeFile(`${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token
      })}\n`, 'utf8')
    } finally {
      await recoveryHandle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      fail('PROJECT_LOCKED', 'Another process is recovering this project lock')
    }
    fail('PROJECT_IO_FAILED', 'Project recovery claim could not be created')
  }

  try {
    const confirmed = await readLock(paths.lock)
    const confirmedSignature = await readFile(paths.lock, 'utf8').catch(() => undefined)
    if (confirmedSignature !== currentSignature) {
      fail('PROJECT_LOCKED', 'Project lock changed while recovery was being confirmed')
    }
    if (confirmed !== undefined && isProcessAlive(confirmed.pid)) {
      fail('PROJECT_LOCKED', 'Project became active while recovery was being confirmed')
    }
    await unlink(paths.lock)
    try {
      return await install()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        fail('PROJECT_LOCKED', 'Project lock changed while it was being recovered')
      }
      fail('PROJECT_IO_FAILED', 'Recovered project lock could not be created')
    }
  } finally {
    const ownedRecovery = await readRecoveryClaim(recoveryPath)
    if (
      ownedRecovery?.claim?.pid === process.pid &&
      ownedRecovery.claim.token === token
    ) {
      await unlink(recoveryPath).catch(() => undefined)
    }
  }
  return fail('PROJECT_LOCKED', 'Project lock recovery did not complete')
}
