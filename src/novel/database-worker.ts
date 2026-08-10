import { Worker } from 'node:worker_threads'
import { ProjectDomainError, type ProjectErrorCode } from '../shared/project.ts'
import { PROJECT_MIGRATIONS, type DatabaseMigration } from './schema.ts'

export type SqlParameters = readonly (string | number | bigint | null | Uint8Array)[]

export type TransactionStatement = {
  sql: string
  params?: SqlParameters
}

export type DatabaseHealth = {
  quickCheck: string
  userVersion: number
  journalMode: string
  foreignKeys: number
  busyTimeout: number
}

type RpcOperation =
  | { type: 'get'; sql: string; params: SqlParameters }
  | { type: 'all'; sql: string; params: SqlParameters }
  | { type: 'run'; sql: string; params: SqlParameters }
  | { type: 'transaction'; statements: TransactionStatement[] }
  | { type: 'health' }
  | { type: 'backup'; destination: string }
  | { type: 'close' }

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'fatal'; code: ProjectErrorCode }
  | { type: 'result'; id: number; ok: true; data: unknown }
  | { type: 'result'; id: number; ok: false; code: ProjectErrorCode }

type DatabaseWorkerPort = Pick<Worker, 'on' | 'once' | 'off' | 'postMessage' | 'terminate'>

export type DatabaseWorkerOptions = {
  workerFactory?: (
    source: string,
    options: ConstructorParameters<typeof Worker>[1]
  ) => DatabaseWorkerPort
}

const WORKER_SOURCE = String.raw`
  const { parentPort, workerData } = require('node:worker_threads')
  const { DatabaseSync } = require('node:sqlite')

  let database

  const plainRow = (row) => row == null ? row : Object.fromEntries(Object.entries(row))
  const execute = (statement) => {
    const prepared = database.prepare(statement.sql)
    const params = statement.params || []
    if (statement.type === 'get') return plainRow(prepared.get(...params))
    if (statement.type === 'all') return prepared.all(...params).map(plainRow)
    const result = prepared.run(...params)
    return {
      changes: Number(result.changes),
      lastInsertRowid: typeof result.lastInsertRowid === 'bigint'
        ? result.lastInsertRowid.toString()
        : result.lastInsertRowid
    }
  }

  const migrate = () => {
    const current = Number(database.prepare('PRAGMA user_version').get().user_version)
    for (const migration of workerData.migrations) {
      if (migration.version <= current) continue
      database.exec('BEGIN IMMEDIATE')
      try {
        database.exec(migration.sql)
        database.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, new Date().toISOString())
        database.exec('PRAGMA user_version = ' + Number(migration.version))
        database.exec('COMMIT')
      } catch (error) {
        try { database.exec('ROLLBACK') } catch {}
        throw error
      }
    }
  }

  try {
    database = new DatabaseSync(workerData.databasePath)
    database.exec('PRAGMA foreign_keys = ON')
    database.exec('PRAGMA journal_mode = WAL')
    database.exec('PRAGMA busy_timeout = 5000')
    migrate()
    parentPort.postMessage({ type: 'ready' })
  } catch {
    try { database?.close() } catch {}
    parentPort.postMessage({ type: 'fatal', code: 'DATABASE_MIGRATION_FAILED' })
  }

  parentPort.on('message', ({ id, operation }) => {
    try {
      let data
      if (operation.type === 'get' || operation.type === 'all' || operation.type === 'run') {
        data = execute(operation)
      } else if (operation.type === 'transaction') {
        database.exec('BEGIN IMMEDIATE')
        try {
          for (const statement of operation.statements) {
            execute({ type: 'run', sql: statement.sql, params: statement.params || [] })
          }
          database.exec('COMMIT')
          data = undefined
        } catch {
          try { database.exec('ROLLBACK') } catch {}
          parentPort.postMessage({
            type: 'result', id, ok: false, code: 'DATABASE_TRANSACTION_FAILED'
          })
          return
        }
      } else if (operation.type === 'health') {
        data = {
          quickCheck: String(database.prepare('PRAGMA quick_check').get().quick_check),
          userVersion: Number(database.prepare('PRAGMA user_version').get().user_version),
          journalMode: String(database.prepare('PRAGMA journal_mode').get().journal_mode),
          foreignKeys: Number(database.prepare('PRAGMA foreign_keys').get().foreign_keys),
          busyTimeout: Number(database.prepare('PRAGMA busy_timeout').get().timeout)
        }
      } else if (operation.type === 'backup') {
        database.prepare('VACUUM INTO ?').run(operation.destination)
        data = undefined
      } else if (operation.type === 'close') {
        database.close()
        database = undefined
        parentPort.postMessage({ type: 'result', id, ok: true, data: undefined })
        parentPort.close()
        return
      }
      parentPort.postMessage({ type: 'result', id, ok: true, data })
    } catch {
      parentPort.postMessage({
        type: 'result', id, ok: false, code: 'DATABASE_WORKER_FAILED'
      })
    }
  })
`

type PendingRpc = {
  resolve(value: unknown): void
  reject(error: ProjectDomainError): void
}

export class DatabaseWorkerClient {
  readonly #worker: DatabaseWorkerPort
  readonly #pending = new Map<number, PendingRpc>()
  #nextId = 1
  #state: 'open' | 'closing' | 'closed' | 'failed' = 'open'
  #closePromise?: Promise<void>

  private constructor(worker: DatabaseWorkerPort) {
    this.#worker = worker
    worker.on('message', (message: WorkerMessage) => this.#receive(message))
    worker.on('error', () => this.#failPending('DATABASE_WORKER_FAILED'))
    worker.on('exit', () => {
      if (this.#state !== 'closed' && this.#state !== 'failed') {
        this.#failPending('DATABASE_WORKER_FAILED')
      }
    })
  }

  static async open(
    databasePath: string,
    migrations: readonly DatabaseMigration[] = PROJECT_MIGRATIONS,
    options: DatabaseWorkerOptions = {}
  ): Promise<DatabaseWorkerClient> {
    const workerOptions = {
      eval: true,
      workerData: { databasePath, migrations }
    } satisfies ConstructorParameters<typeof Worker>[1]
    const worker = options.workerFactory === undefined
      ? new Worker(WORKER_SOURCE, workerOptions)
      : options.workerFactory(WORKER_SOURCE, workerOptions)
    const client = new DatabaseWorkerClient(worker)
    await new Promise<void>((resolve, reject) => {
      const cleanupStartupListeners = (): void => {
        worker.off('message', ready)
        worker.off('error', failedToStart)
        worker.off('exit', failedToStart)
      }
      const failedToStart = (): void => {
        cleanupStartupListeners()
        client.#state = 'failed'
        void worker.terminate()
        reject(new ProjectDomainError('DATABASE_OPEN_FAILED', 'Database worker failed to start'))
      }
      const ready = (message: WorkerMessage): void => {
        if (message.type === 'ready') {
          cleanupStartupListeners()
          resolve()
        } else if (message.type === 'fatal') {
          cleanupStartupListeners()
          client.#state = 'failed'
          void worker.terminate()
          reject(new ProjectDomainError(message.code, 'Database migration failed'))
        }
      }
      worker.on('message', ready)
      worker.once('error', failedToStart)
      worker.once('exit', failedToStart)
    })
    return client
  }

  async get<T extends Record<string, unknown>>(
    sql: string,
    params: SqlParameters = []
  ): Promise<T | undefined> {
    return this.#call({ type: 'get', sql, params }) as Promise<T | undefined>
  }

  async all<T extends Record<string, unknown>>(
    sql: string,
    params: SqlParameters = []
  ): Promise<T[]> {
    return this.#call({ type: 'all', sql, params }) as Promise<T[]>
  }

  async run(sql: string, params: SqlParameters = []): Promise<void> {
    await this.#call({ type: 'run', sql, params })
  }

  async transaction(statements: readonly TransactionStatement[]): Promise<void> {
    await this.#call({ type: 'transaction', statements: [...statements] })
  }

  async health(): Promise<DatabaseHealth> {
    return this.#call({ type: 'health' }) as Promise<DatabaseHealth>
  }

  async backupTo(destination: string): Promise<void> {
    await this.#call({ type: 'backup', destination })
  }

  async close(): Promise<void> {
    if (this.#state === 'closed' || this.#state === 'failed') return
    if (this.#closePromise !== undefined) return this.#closePromise

    this.#state = 'closing'
    this.#closePromise = (async () => {
      try {
        await this.#call({ type: 'close' }, true)
      } finally {
        if (this.#state !== 'failed') this.#state = 'closed'
        await this.#worker.terminate()
      }
    })()
    return this.#closePromise
  }

  #call(operation: RpcOperation, allowClosing = false): Promise<unknown> {
    if (this.#state !== 'open' && !(allowClosing && this.#state === 'closing')) {
      return Promise.reject(new ProjectDomainError('DATABASE_CLOSED', 'Database is closed'))
    }
    const id = this.#nextId
    this.#nextId += 1
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      try {
        this.#worker.postMessage({ id, operation })
      } catch {
        this.#pending.delete(id)
        reject(new ProjectDomainError('DATABASE_WORKER_FAILED', 'Database command could not be sent'))
      }
    })
  }

  #receive(message: WorkerMessage): void {
    if (message.type !== 'result') return
    const pending = this.#pending.get(message.id)
    if (pending === undefined) return
    this.#pending.delete(message.id)
    if (message.ok) {
      pending.resolve(message.data)
    } else {
      pending.reject(new ProjectDomainError(message.code, 'Database operation failed'))
    }
  }

  #failPending(code: ProjectErrorCode): void {
    this.#state = 'failed'
    const error = new ProjectDomainError(code, 'Database worker stopped unexpectedly')
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}
