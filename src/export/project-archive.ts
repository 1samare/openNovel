import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { unzipSync, zipSync } from 'fflate'
import { ProjectDomainError } from '../shared/project.ts'

export type ProjectArchiveManifest = {
  formatVersion: 1
  projectId: string
  createdAt: string
  files: Array<{ path: string; sha256: string; size: number }>
}

type ArchiveInput = {
  projectRoot: string
  databaseSnapshotPath: string
  destinationFile: string
  projectId: string
  createdAt: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_COMPRESSION_RATIO = 200

const sha256 = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

const canonicalArchivePath = (path: string): string => path.split(sep).join('/')

const isAllowedPath = (path: string): boolean =>
  path === 'open-novel.json' ||
  path === 'project.sqlite3' ||
  (
    path.startsWith('attachments/') &&
    !path.includes('\\') &&
    !path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  )

const collectAttachments = async (
  root: string,
  directory: string,
  files: Record<string, Uint8Array>
): Promise<void> => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    const details = await lstat(absolute)
    if (details.isSymbolicLink()) {
      throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Attachment links cannot be archived')
    }
    if (details.isDirectory()) {
      await collectAttachments(root, absolute, files)
    } else if (details.isFile()) {
      const path = canonicalArchivePath(relative(root, absolute))
      if (!isAllowedPath(path)) {
        throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Attachment path is invalid')
      }
      files[path] = new Uint8Array(await readFile(absolute))
    }
  }
}

const quickCheck = (databasePath: string): boolean => {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    return String(database.prepare('PRAGMA quick_check').get()?.quick_check) === 'ok'
  } catch {
    return false
  } finally {
    database?.close()
  }
}

const parseManifest = (value: Uint8Array): ProjectArchiveManifest => {
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(value))
  } catch {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive manifest is invalid')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive manifest is invalid')
  }
  const record = parsed as Record<string, unknown>
  if (
    Object.keys(record).sort().join('|') !== 'createdAt|files|formatVersion|projectId' ||
    record.formatVersion !== 1 ||
    typeof record.projectId !== 'string' ||
    typeof record.createdAt !== 'string' ||
    !Array.isArray(record.files)
  ) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive manifest is invalid')
  }
  const files = record.files.map((file) => {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive file record is invalid')
    }
    const item = file as Record<string, unknown>
    if (
      Object.keys(item).sort().join('|') !== 'path|sha256|size' ||
      typeof item.path !== 'string' ||
      !isAllowedPath(item.path) ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.size) || Number(item.size) < 0
    ) {
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive file record is invalid')
    }
    return { path: item.path, sha256: item.sha256, size: Number(item.size) }
  })
  if (new Set(files.map(({ path }) => path)).size !== files.length) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive paths are duplicated')
  }
  return {
    formatVersion: 1,
    projectId: record.projectId,
    createdAt: record.createdAt,
    files
  }
}

const archiveLimitError = (): ProjectDomainError =>
  new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Project archive exceeds safety limits')

const readArchive = async (path: string) => {
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size > MAX_ARCHIVE_BYTES) throw archiveLimitError()
    let entryCount = 0
    let expandedBytes = 0
    return unzipSync(new Uint8Array(await readFile(path)), {
      filter: ({ size, originalSize }) => {
        entryCount += 1
        expandedBytes += originalSize
        if (
          entryCount > MAX_ARCHIVE_ENTRIES ||
          originalSize > MAX_ARCHIVE_ENTRY_BYTES ||
          expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES ||
          originalSize / Math.max(size, 1) > MAX_ARCHIVE_COMPRESSION_RATIO
        ) {
          throw archiveLimitError()
        }
        return true
      }
    })
  } catch (error) {
    if (error instanceof ProjectDomainError) throw error
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Project archive cannot be read')
  }
}

const readValidatedArchive = async (path: string) => {
  const archive = await readArchive(path)
  const manifestBytes = archive['archive-manifest.json']
  if (manifestBytes === undefined) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive manifest is missing')
  }
  const manifest = parseManifest(manifestBytes)
  const manifestPaths = new Set(manifest.files.map(({ path: entry }) => entry))
  if (!manifestPaths.has('open-novel.json') || !manifestPaths.has('project.sqlite3')) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive required files are missing')
  }
  const actualPaths = Object.keys(archive).filter((entry) => entry !== 'archive-manifest.json').sort()
  const expectedPaths = manifest.files.map(({ path: entry }) => entry).sort()
  if (actualPaths.join('|') !== expectedPaths.join('|')) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive contents do not match its manifest')
  }
  for (const file of manifest.files) {
    const bytes = archive[file.path]
    if (bytes === undefined || bytes.length !== file.size || sha256(bytes) !== file.sha256) {
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive file hash is invalid')
    }
  }
  let projectManifest: unknown
  try {
    projectManifest = JSON.parse(decoder.decode(archive['open-novel.json']))
  } catch {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Project manifest is invalid')
  }
  if (
    typeof projectManifest !== 'object' ||
    projectManifest === null ||
    (projectManifest as Record<string, unknown>).projectId !== manifest.projectId
  ) {
    throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Project identity does not match archive')
  }
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-archive-check-'))
  const databasePath = join(sandbox, 'project.sqlite3')
  try {
    await writeFile(databasePath, archive['project.sqlite3'], { flag: 'wx' })
    if (!quickCheck(databasePath)) {
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive database check failed')
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  }
  return { archive, manifest }
}

export const inspectProjectArchive = async (path: string): Promise<ProjectArchiveManifest> =>
  (await readValidatedArchive(path)).manifest

export const createProjectArchive = async (input: ArchiveInput): Promise<void> => {
  const temporary = join(dirname(input.destinationFile), `.${randomUUID()}.opennovel.tmp`)
  try {
    await stat(input.destinationFile).then(
      () => { throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Backup destination already exists') },
      (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    )
    const projectManifest = new Uint8Array(await readFile(join(input.projectRoot, 'open-novel.json')))
    let parsed: unknown
    try {
      parsed = JSON.parse(decoder.decode(projectManifest))
    } catch {
      throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Project manifest is invalid')
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>).projectId !== input.projectId
    ) {
      throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Project identity does not match manifest')
    }
    if (!quickCheck(input.databaseSnapshotPath)) {
      throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Backup database check failed')
    }
    const files: Record<string, Uint8Array> = {
      'open-novel.json': projectManifest,
      'project.sqlite3': new Uint8Array(await readFile(input.databaseSnapshotPath))
    }
    await collectAttachments(input.projectRoot, join(input.projectRoot, 'attachments'), files)
    const records = Object.entries(files)
      .map(([path, bytes]) => ({ path, sha256: sha256(bytes), size: bytes.length }))
      .sort((left, right) => left.path.localeCompare(right.path))
    const manifest: ProjectArchiveManifest = {
      formatVersion: 1,
      projectId: input.projectId,
      createdAt: input.createdAt,
      files: records
    }
    const archive = {
      ...files,
      'archive-manifest.json': encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`)
    }
    await writeFile(temporary, zipSync(archive, { level: 6 }), { flag: 'wx' })
    await inspectProjectArchive(temporary)
    await rename(temporary, input.destinationFile)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    if (error instanceof ProjectDomainError && error.code === 'PROJECT_BACKUP_FAILED') throw error
    throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Project backup failed')
  }
}

export const extractProjectArchive = async (
  archivePath: string,
  destinationRoot: string
): Promise<ProjectArchiveManifest> => {
  const { archive, manifest } = await readValidatedArchive(archivePath)
  for (const file of manifest.files) {
    const destination = resolve(destinationRoot, ...file.path.split('/'))
    const root = resolve(destinationRoot)
    if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Archive path escapes destination')
    }
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, archive[file.path], { flag: 'wx' })
  }
  return manifest
}
