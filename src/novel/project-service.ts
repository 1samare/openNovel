import { randomUUID } from 'node:crypto'
import {
  access,
  copyFile,
  cp,
  mkdir,
  realpath,
  rm,
  stat,
  unlink,
  rename as renamePath
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import {
  ProjectDomainError,
  type ProjectBackupSummary,
  type ProjectManifest,
  type ProjectSummary,
  type RecentProjectSummary
} from '../shared/project.ts'
import { DatabaseWorkerClient } from './database-worker.ts'
import {
  acquireProjectLock,
  prepareEmptyProjectDirectory,
  readProjectManifest,
  resolveProjectPaths,
  writeProjectManifest,
  type ProjectLock,
  type ProjectPaths
} from './project-paths.ts'
import { ControlProjectRepository, ProjectRepository } from './project-repository.ts'
import { PROJECT_MIGRATIONS, type DatabaseMigration } from './schema.ts'

export type ProjectServiceDependencies = {
  createId(): string
  now(): string
  projectMigrations?: readonly DatabaseMigration[]
}

type ActiveProject = {
  summary: ProjectSummary
  manifest: ProjectManifest
  paths: ProjectPaths
  lock: ProjectLock
  repository: ProjectRepository
}

const defaults: ProjectServiceDependencies = {
  createId: randomUUID,
  now: () => new Date().toISOString()
}

const normalizeTitle = (title: string): string => {
  if (typeof title !== 'string') {
    throw new ProjectDomainError('INVALID_PROJECT_TITLE', 'Project title is required')
  }
  const normalized = title.trim()
  if (normalized.length === 0 || normalized.length > 120) {
    throw new ProjectDomainError('INVALID_PROJECT_TITLE', 'Project title must be 1–120 characters')
  }
  return normalized
}

const safeTimestamp = (value: string): string => value.replace(/[:.]/g, '-')

const normalizeSafeDestination = (root: string): string => {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new ProjectDomainError('INVALID_PROJECT_PATH', 'Destination must be an absolute path')
  }
  const normalized = resolve(root)
  if (normalized === parse(normalized).root) {
    throw new ProjectDomainError('INVALID_PROJECT_PATH', 'A filesystem root is not a safe destination')
  }
  return normalized
}

const canonicalizePath = async (path: string): Promise<string> => {
  let cursor = path
  const missingSegments: string[] = []
  while (true) {
    try {
      const canonical = await realpath(cursor)
      return resolve(canonical, ...missingSegments.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ProjectDomainError('INVALID_PROJECT_PATH', 'Project path could not be resolved')
      }
      const parent = dirname(cursor)
      if (parent === cursor) {
        throw new ProjectDomainError('INVALID_PROJECT_PATH', 'Project path could not be resolved')
      }
      missingSegments.push(basename(cursor))
      cursor = parent
    }
  }
}

const safeDestination = async (root: string): Promise<string> =>
  canonicalizePath(normalizeSafeDestination(root))

const containsPath = (parent: string, candidate: string): boolean => {
  const nested = relative(parent, candidate)
  return nested === '' || (!isAbsolute(nested) && nested !== '..' && !nested.startsWith(`..${sep}`))
}

const pathsOverlap = (left: string, right: string): boolean =>
  containsPath(left, right) || containsPath(right, left)

const copyAttachments = async (source: string, destination: string): Promise<void> => {
  await mkdir(destination, { recursive: true })
  await cp(source, destination, { recursive: true, force: false }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}

export class ProjectService {
  readonly #control: ControlProjectRepository
  readonly #dependencies: ProjectServiceDependencies
  readonly #projectMigrations: readonly DatabaseMigration[]
  #active?: ActiveProject
  #shutdown = false
  #operationTail: Promise<void> = Promise.resolve()
  #shutdownPromise?: Promise<void>

  private constructor(
    control: ControlProjectRepository,
    dependencies: ProjectServiceDependencies
  ) {
    this.#control = control
    this.#dependencies = dependencies
    this.#projectMigrations = dependencies.projectMigrations ?? PROJECT_MIGRATIONS
  }

  static async start(
    controlDatabasePath: string,
    dependencies: ProjectServiceDependencies = defaults
  ): Promise<ProjectService> {
    return new ProjectService(
      await ControlProjectRepository.open(controlDatabasePath),
      dependencies
    )
  }

  current(): ProjectSummary | undefined {
    return this.#active === undefined ? undefined : { ...this.#active.summary }
  }

  create(input: { root: string; title: string }): Promise<ProjectSummary> {
    return this.#serialize(() => this.#create(input))
  }

  async #create(input: { root: string; title: string }): Promise<ProjectSummary> {
    this.#assertAvailable()
    const title = normalizeTitle(input.title)
    let rootExisted = true
    try {
      await stat(input.root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      rootExisted = false
    }
    const paths = await prepareEmptyProjectDirectory(input.root)
    const createdAt = this.#dependencies.now()
    const manifest: ProjectManifest = {
      formatVersion: 1,
      projectId: this.#dependencies.createId(),
      title,
      createdAt,
      updatedAt: createdAt
    }
    let lock: ProjectLock | undefined
    let repository: ProjectRepository | undefined
    try {
      await writeProjectManifest(paths, manifest)
      await Promise.all([
        mkdir(paths.attachments),
        mkdir(paths.backups),
        mkdir(paths.exports)
      ])
      lock = await acquireProjectLock(paths.root, manifest.projectId)
      repository = await ProjectRepository.open(paths.database, this.#projectMigrations)
      await repository.initialize(manifest, this.#dependencies.createId())
      const summary = await repository.load(manifest.projectId, paths.root)
      await this.#control.recordOpened(summary, this.#dependencies.now())
      this.#active = { summary, manifest, paths, lock, repository }
      return { ...summary }
    } catch (error) {
      await repository?.close().catch(() => undefined)
      await lock?.release().catch(() => undefined)
      await this.#cleanupFailedCreate(paths, rootExisted)
      throw error
    }
  }

  open(input: { root: string; recoverStaleLock?: boolean }): Promise<ProjectSummary> {
    return this.#serialize(() => this.#open(input))
  }

  async #open(
    input: { root: string; recoverStaleLock?: boolean },
    lastBackupPath?: string
  ): Promise<ProjectSummary> {
    this.#assertAvailable()
    const paths = resolveProjectPaths(input.root)
    const manifest = await readProjectManifest(paths.root)
    await access(paths.database).catch(() => {
      throw new ProjectDomainError('PROJECT_NOT_FOUND', 'Project database is missing')
    })
    const lock = await acquireProjectLock(paths.root, manifest.projectId, {
      recoverStale: input.recoverStaleLock === true
    })
    let inspector: DatabaseWorkerClient | undefined
    let repository: ProjectRepository | undefined
    try {
      inspector = await DatabaseWorkerClient.open(paths.database, [])
      const health = await inspector.health()
      const latestProjectVersion = this.#projectMigrations.at(-1)?.version ?? 0
      if (health.userVersion < latestProjectVersion) {
        await this.#createMigrationBackup(paths, inspector)
      }
      await inspector.close()
      inspector = undefined
      repository = await ProjectRepository.open(paths.database, this.#projectMigrations)
      const summary = await repository.load(manifest.projectId, paths.root)
      if (
        summary.title !== manifest.title ||
        summary.createdAt !== manifest.createdAt ||
        summary.updatedAt !== manifest.updatedAt
      ) {
        throw new ProjectDomainError('PROJECT_DATA_MISMATCH', 'Project manifest and database differ')
      }
      await this.#control.recordOpened(summary, this.#dependencies.now(), lastBackupPath)
      this.#active = { summary, manifest, paths, lock, repository }
      return { ...summary }
    } catch (error) {
      await inspector?.close().catch(() => undefined)
      await repository?.close().catch(() => undefined)
      await lock.release().catch(() => undefined)
      throw error
    }
  }

  rename(title: string): Promise<ProjectSummary> {
    return this.#serialize(() => this.#rename(title))
  }

  async #rename(title: string): Promise<ProjectSummary> {
    const active = this.#requireActive()
    const normalized = normalizeTitle(title)
    const previous = active.summary
    const previousManifest = active.manifest
    const updatedAt = this.#dependencies.now()
    await active.repository.rename(
      previous.projectId,
      normalized,
      updatedAt,
      this.#dependencies.createId()
    )
    const manifest: ProjectManifest = {
      ...previousManifest,
      title: normalized,
      updatedAt
    }
    try {
      await writeProjectManifest(active.paths, manifest)
      const summary = { ...previous, title: normalized, updatedAt }
      await this.#control.recordOpened(summary, this.#dependencies.now())
      active.manifest = manifest
      active.summary = summary
      return { ...summary }
    } catch (error) {
      await active.repository.rename(
        previous.projectId,
        previous.title,
        previous.updatedAt,
        this.#dependencies.createId()
      ).catch(() => undefined)
      await writeProjectManifest(active.paths, previousManifest).catch(() => undefined)
      throw error
    }
  }

  backup(destinationRoot?: string): Promise<ProjectBackupSummary> {
    return this.#serialize(() => this.#backup(destinationRoot))
  }

  async #backup(destinationRoot?: string): Promise<ProjectBackupSummary> {
    const active = this.#requireActive()
    const createdAt = this.#dependencies.now()
    const destination = await safeDestination(destinationRoot ?? active.paths.backups)
    const attachments = await canonicalizePath(active.paths.attachments)
    if (containsPath(attachments, destination)) {
      throw new ProjectDomainError(
        'INVALID_PROJECT_PATH',
        'Backup destination cannot be inside project attachments'
      )
    }
    await mkdir(destination, { recursive: true })
    const name = `backup-${safeTimestamp(createdAt)}-${this.#dependencies.createId()}`
    const temporary = join(destination, `.${name}.tmp`)
    const finalPath = join(destination, name)
    let finalized = false
    try {
      await mkdir(temporary)
      await copyFile(active.paths.manifest, join(temporary, 'open-novel.json'))
      await copyAttachments(active.paths.attachments, join(temporary, 'attachments'))
      await active.repository.backupTo(join(temporary, 'project.sqlite3'))
      let verification: DatabaseWorkerClient | undefined
      let quickCheck = ''
      try {
        verification = await DatabaseWorkerClient.open(join(temporary, 'project.sqlite3'), [])
        quickCheck = (await verification.health()).quickCheck
      } finally {
        await verification?.close()
      }
      if (quickCheck !== 'ok') {
        throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Backup database check failed')
      }
      await renamePath(temporary, finalPath)
      finalized = true
      await this.#control.setBackup(active.summary.projectId, finalPath)
      return { projectId: active.summary.projectId, backupPath: finalPath, createdAt }
    } catch (error) {
      await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
        .catch(() => undefined)
      if (finalized) {
        await rm(finalPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
          .catch(() => undefined)
      }
      if (error instanceof ProjectDomainError) throw error
      throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Project backup failed')
    }
  }

  restore(input: {
    backupRoot: string
    destinationRoot: string
  }): Promise<ProjectSummary> {
    return this.#serialize(() => this.#restore(input))
  }

  async #restore(input: {
    backupRoot: string
    destinationRoot: string
  }): Promise<ProjectSummary> {
    this.#assertAvailable()
    const backupRoot = await safeDestination(input.backupRoot)
    const destinationRoot = await safeDestination(input.destinationRoot)
    if (pathsOverlap(backupRoot, destinationRoot)) {
      throw new ProjectDomainError(
        'INVALID_PROJECT_PATH',
        'Backup source and restore destination cannot overlap'
      )
    }
    const manifest = await readProjectManifest(backupRoot).catch(() => {
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Backup manifest is invalid')
    })
    const backupDatabase = join(backupRoot, 'project.sqlite3')
    let verification: DatabaseWorkerClient | undefined
    try {
      verification = await DatabaseWorkerClient.open(backupDatabase, [])
      const health = await verification.health()
      if (health.quickCheck !== 'ok') {
        throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Backup database is invalid')
      }
    } catch (error) {
      if (error instanceof ProjectDomainError) throw error
      throw new ProjectDomainError('INVALID_PROJECT_BACKUP', 'Backup database is invalid')
    } finally {
      await verification?.close().catch(() => undefined)
    }

    let destinationExisted = true
    try {
      await stat(destinationRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      destinationExisted = false
    }
    const paths = await prepareEmptyProjectDirectory(destinationRoot)
    try {
      await Promise.all([
        mkdir(paths.attachments),
        mkdir(paths.backups),
        mkdir(paths.exports)
      ])
      await copyFile(join(backupRoot, 'open-novel.json'), paths.manifest)
      await copyFile(backupDatabase, paths.database)
      await copyAttachments(join(backupRoot, 'attachments'), paths.attachments)
      return await this.#open({ root: destinationRoot }, backupRoot)
    } catch (error) {
      if (this.#active?.summary.projectId !== manifest.projectId) {
        await this.#cleanupFailedCreate(paths, destinationExisted)
      }
      throw error
    }
  }

  listRecent(): Promise<RecentProjectSummary[]> {
    return this.#serialize(() => this.#control.list())
  }

  removeRecent(projectId: string): Promise<void> {
    return this.#serialize(() => this.#control.remove(projectId))
  }

  close(): Promise<void> {
    return this.#serialize(() => this.#closeActive())
  }

  async #closeActive(): Promise<void> {
    const active = this.#active
    if (active === undefined) return
    this.#active = undefined
    try {
      await active.repository.close()
    } finally {
      await active.lock.release()
    }
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise !== undefined) return this.#shutdownPromise
    this.#shutdownPromise = this.#serialize(async () => {
      this.#shutdown = true
      let failure: unknown
      try {
        await this.#closeActive()
      } catch (error) {
        failure = error
      }
      try {
        await this.#control.close()
      } catch (error) {
        failure ??= error
      }
      if (failure !== undefined) throw failure
    })
    return this.#shutdownPromise
  }

  #assertAvailable(): void {
    if (this.#shutdown) {
      throw new ProjectDomainError('DATABASE_CLOSED', 'Project service is shut down')
    }
    if (this.#active !== undefined) {
      throw new ProjectDomainError('PROJECT_ALREADY_OPEN', 'Close the current project first')
    }
  }

  #requireActive(): ActiveProject {
    if (this.#active === undefined) {
      throw new ProjectDomainError('PROJECT_NOT_OPEN', 'No project is open')
    }
    return this.#active
  }

  async #createMigrationBackup(
    paths: ProjectPaths,
    database: DatabaseWorkerClient
  ): Promise<void> {
    const name = `migration-${safeTimestamp(this.#dependencies.now())}-${this.#dependencies.createId()}`
    const temporary = join(paths.backups, `.${name}.tmp`)
    const finalPath = join(paths.backups, name)
    await mkdir(paths.backups, { recursive: true })
    try {
      await mkdir(temporary)
      await copyFile(paths.manifest, join(temporary, 'open-novel.json'))
      await copyAttachments(paths.attachments, join(temporary, 'attachments'))
      const backupDatabase = join(temporary, 'project.sqlite3')
      await database.backupTo(backupDatabase)
      let verification: DatabaseWorkerClient | undefined
      try {
        verification = await DatabaseWorkerClient.open(backupDatabase, [])
        if ((await verification.health()).quickCheck !== 'ok') {
          throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Pre-migration backup is invalid')
        }
      } finally {
        await verification?.close()
      }
      await renamePath(temporary, finalPath)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
      throw new ProjectDomainError('PROJECT_BACKUP_FAILED', 'Pre-migration backup failed')
    }
  }

  async #cleanupFailedCreate(paths: ProjectPaths, rootExisted: boolean): Promise<void> {
    if (!rootExisted) {
      await rm(paths.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
        .catch(() => undefined)
      return
    }
    await Promise.all([
      rm(paths.attachments, { recursive: true, force: true }),
      rm(paths.backups, { recursive: true, force: true }),
      rm(paths.exports, { recursive: true, force: true }),
      unlink(paths.manifest).catch(() => undefined),
      unlink(paths.database).catch(() => undefined),
      unlink(`${paths.database}-wal`).catch(() => undefined),
      unlink(`${paths.database}-shm`).catch(() => undefined),
      unlink(paths.lock).catch(() => undefined)
    ]).catch(() => undefined)
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation)
    this.#operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}
