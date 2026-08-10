import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

class ControlledWorker extends EventEmitter {
  constructor(handler) {
    super()
    this.handler = handler
  }

  postMessage(message) {
    this.handler?.(message, this)
  }

  async terminate() {
    return 1
  }
}

const hasCode = (code) => (error) => {
  assert.equal(error instanceof ProjectDomainError, true)
  assert.equal(error.code, code)
  return true
}

test('opens schema version one with durable SQLite pragmas in a worker', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-database-'))

  const client = await DatabaseWorkerClient.open(join(sandbox, 'project.sqlite3'))
  t.after(async () => {
    await client.close()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  assert.deepEqual(await client.health(), {
    quickCheck: 'ok',
    userVersion: 1,
    journalMode: 'wal',
    foreignKeys: 1,
    busyTimeout: 5000
  })
  const tables = await client.all(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `)
  assert.deepEqual(tables, [
    { name: 'audit_events' },
    { name: 'project_settings' },
    { name: 'projects' },
    { name: 'schema_migrations' }
  ])
})

test('rolls back a failed transaction without partially writing audit data', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-transaction-'))
  const client = await DatabaseWorkerClient.open(join(sandbox, 'project.sqlite3'))
  t.after(async () => {
    await client.close()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await client.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['project-1', '星海来信', '2026-08-07T08:00:00.000Z', '2026-08-07T08:00:00.000Z']
  )

  await assert.rejects(client.transaction([
    {
      sql: `INSERT INTO audit_events (id, project_id, event_type, created_at)
            VALUES (?, ?, ?, ?)`,
      params: ['audit-1', 'project-1', 'created', '2026-08-07T08:00:00.000Z']
    },
    { sql: 'INSERT INTO table_that_does_not_exist (id) VALUES (?)', params: ['broken'] }
  ]), hasCode('DATABASE_TRANSACTION_FAILED'))

  assert.deepEqual(await client.get('SELECT COUNT(*) AS count FROM audit_events'), { count: 0 })
})

test('does not advance user_version when a schema migration fails', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-migration-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const databasePath = join(sandbox, 'project.sqlite3')
  const conflicting = new DatabaseSync(databasePath)
  conflicting.exec('CREATE TABLE projects (wrong_column TEXT)')
  conflicting.close()

  await assert.rejects(
    DatabaseWorkerClient.open(databasePath),
    hasCode('DATABASE_MIGRATION_FAILED')
  )

  const inspected = new DatabaseSync(databasePath)
  assert.equal(inspected.prepare('PRAGMA user_version').get().user_version, 0)
  assert.equal(
    inspected.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'schema_migrations'").get().count,
    0
  )
  inspected.close()
})

test('keeps the host event loop responsive during worker SQL and rejects commands after close', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-worker-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const client = await DatabaseWorkerClient.open(join(sandbox, 'project.sqlite3'))

  let ticks = 0
  const timer = setInterval(() => { ticks += 1 }, 1)
  const result = await client.get(`
    WITH RECURSIVE counter(value) AS (
      VALUES(1) UNION ALL SELECT value + 1 FROM counter WHERE value < 750000
    )
    SELECT SUM(value) AS total FROM counter
  `)
  clearInterval(timer)

  assert.deepEqual(result, { total: 281250375000 })
  assert.equal(ticks > 0, true)
  await client.close()
  await assert.rejects(client.health(), hasCode('DATABASE_CLOSED'))
})

test('closes the client after an unexpected worker exit so later calls cannot hang', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-worker-exit-'))
  let worker
  const client = await DatabaseWorkerClient.open(
    join(sandbox, 'unused.sqlite3'),
    [],
    {
      workerFactory: () => {
        worker = new ControlledWorker()
        queueMicrotask(() => worker.emit('message', { type: 'ready' }))
        return worker
      }
    }
  )
  t.after(async () => {
    await client.close()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  assert.ok(worker instanceof ControlledWorker)
  const pending = client.health()
  worker.emit('exit', 1)

  await assert.rejects(pending, hasCode('DATABASE_WORKER_FAILED'))
  await assert.rejects(client.health(), hasCode('DATABASE_CLOSED'))
})

test('rejects opening when the worker exits before reporting ready', async () => {
  let timeout
  const opening = DatabaseWorkerClient.open(
    'unused.sqlite3',
    [],
    {
      workerFactory: () => {
        const worker = new ControlledWorker()
        queueMicrotask(() => worker.emit('exit', 1))
        return worker
      }
    }
  )
  const boundedOpening = Promise.race([
    opening,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Database worker startup timed out')), 50)
    })
  ])

  await assert.rejects(boundedOpening, hasCode('DATABASE_OPEN_FAILED'))
  clearTimeout(timeout)
})

test('blocks new commands as soon as close starts', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-worker-closing-'))
  const client = await DatabaseWorkerClient.open(
    join(sandbox, 'unused.sqlite3'),
    [],
    {
      workerFactory: () => {
        const worker = new ControlledWorker((message, target) => {
          queueMicrotask(() => target.emit('message', {
            type: 'result',
            id: message.id,
            ok: true,
            data: message.operation.type === 'health'
              ? {
                  quickCheck: 'ok',
                  userVersion: 1,
                  journalMode: 'wal',
                  foreignKeys: 1,
                  busyTimeout: 5000
                }
              : undefined
          }))
        })
        queueMicrotask(() => worker.emit('message', { type: 'ready' }))
        return worker
      }
    }
  )
  t.after(async () => {
    await client.close()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const closing = client.close()
  const afterCloseStarted = client.health()
  await closing

  await assert.rejects(afterCloseStarted, hasCode('DATABASE_CLOSED'))
})
