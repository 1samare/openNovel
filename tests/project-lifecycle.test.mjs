import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { ProjectService } from '../src/novel/project-service.ts'
import { PROJECT_MIGRATIONS } from '../src/novel/schema.ts'
import { readProjectManifest } from '../src/novel/project-paths.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

const hasCode = (code) => (error) => {
  assert.equal(error instanceof ProjectDomainError, true)
  assert.equal(error.code, code)
  return true
}

const createDependencies = () => {
  let id = 0
  let tick = 0
  return {
    createId: () => `id-${++id}`,
    now: () => new Date(Date.UTC(2026, 7, 7, 8, 0, tick++)).toISOString()
  }
}

test('creates an independent project and reopens its renamed state after service restart', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-lifecycle-'))
  const projectRoot = join(sandbox, 'novel')
  const controlPath = join(sandbox, 'control.sqlite3')
  const dependencies = createDependencies()
  let service = await ProjectService.start(controlPath, dependencies)
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const created = await service.create({ root: projectRoot, title: '星海来信' })
  assert.equal(created.title, '星海来信')
  assert.deepEqual((await readdir(projectRoot)).sort(), [
    '.open-novel.lock',
    'attachments',
    'backups',
    'exports',
    'open-novel.json',
    'project.sqlite3',
    'project.sqlite3-shm',
    'project.sqlite3-wal'
  ])

  await service.rename('月海回声')
  await service.shutdown()
  service = await ProjectService.start(controlPath, dependencies)
  const reopened = await service.open({ root: projectRoot })

  assert.equal(reopened.projectId, created.projectId)
  assert.equal(reopened.title, '月海回声')
  assert.equal((await service.listRecent())[0].title, '月海回声')
})

test('marks missing recent paths and removes only the control record', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-recent-'))
  const projectRoot = join(sandbox, 'novel')
  const movedRoot = join(sandbox, 'moved-novel')
  const service = await ProjectService.start(join(sandbox, 'control.sqlite3'), createDependencies())
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const created = await service.create({ root: projectRoot, title: '旧城夏日' })
  await service.close()
  assert.equal((await service.listRecent())[0].pathAvailable, true)

  const databasePath = join(projectRoot, 'project.sqlite3')
  const hiddenDatabasePath = join(projectRoot, 'project.sqlite3.missing')
  await rename(databasePath, hiddenDatabasePath)
  assert.equal((await service.listRecent())[0].pathAvailable, false)
  await rename(hiddenDatabasePath, databasePath)
  assert.equal((await service.listRecent())[0].pathAvailable, true)

  await rename(projectRoot, movedRoot)
  assert.equal((await service.listRecent())[0].pathAvailable, false)
  await service.removeRecent(created.projectId)

  assert.deepEqual(await service.listRecent(), [])
  await access(join(movedRoot, 'open-novel.json'))
  await access(join(movedRoot, 'project.sqlite3'))
})

test('creates a verified backup and restores it into an empty destination', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-backup-'))
  const projectRoot = join(sandbox, 'novel')
  const restoredRoot = join(sandbox, 'restored')
  const externalBackups = join(sandbox, 'external-backups')
  const service = await ProjectService.start(join(sandbox, 'control.sqlite3'), createDependencies())
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const created = await service.create({ root: projectRoot, title: '逆光列车' })
  const backup = await service.backup(externalBackups)
  await service.close()
  await rm(projectRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })

  const restored = await service.restore({
    backupRoot: backup.backupPath,
    destinationRoot: restoredRoot
  })

  assert.equal(restored.projectId, created.projectId)
  assert.equal(restored.title, '逆光列车')
  assert.equal(restored.root, restoredRoot)
  assert.equal((await service.listRecent())[0].projectPath, restoredRoot)
  await access(join(restoredRoot, 'attachments'))
  await access(join(restoredRoot, 'project.sqlite3'))
})

test('preserves a pre-migration backup when opening an invalid version zero database', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-migration-backup-'))
  const projectRoot = join(sandbox, 'novel')
  const service = await ProjectService.start(join(sandbox, 'control.sqlite3'), createDependencies())
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await service.create({ root: projectRoot, title: '迁移测试' })
  await service.close()
  const database = await DatabaseWorkerClient.open(join(projectRoot, 'project.sqlite3'), [])
  await database.run('PRAGMA user_version = 0')
  await database.close()

  await assert.rejects(service.open({ root: projectRoot }), hasCode('DATABASE_MIGRATION_FAILED'))
  const backups = await readdir(join(projectRoot, 'backups'))
  assert.equal(backups.length, 1)
  assert.match(backups[0], /^migration-/)
  const migrationBackup = join(projectRoot, 'backups', backups[0])
  await access(join(migrationBackup, 'open-novel.json'))
  const backupDatabase = await DatabaseWorkerClient.open(
    join(migrationBackup, 'project.sqlite3'),
    []
  )
  const backupHealth = await backupDatabase.health()
  await backupDatabase.close()
  assert.equal(backupHealth.quickCheck, 'ok')
  assert.equal(backupHealth.userVersion, 0)
})

test('restores a consistent pre-migration snapshot after a transient migration failure', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-migration-restore-'))
  const projectRoot = join(sandbox, 'novel')
  const restoredRoot = join(sandbox, 'restored')
  const projectMigrations = [
    ...PROJECT_MIGRATIONS,
    {
      version: 2,
      name: 'test-project-title-index',
      sql: 'CREATE INDEX project_title_index ON projects(title);'
    }
  ]
  const service = await ProjectService.start(join(sandbox, 'control.sqlite3'), {
    ...createDependencies(),
    projectMigrations
  })
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const created = await service.create({ root: projectRoot, title: '迁移恢复' })
  await service.close()
  const databasePath = join(projectRoot, 'project.sqlite3')
  const prepareVersionOne = await DatabaseWorkerClient.open(databasePath, [])
  await prepareVersionOne.run('DROP INDEX project_title_index')
  await prepareVersionOne.run('DELETE FROM schema_migrations WHERE version = 2')
  await prepareVersionOne.run('PRAGMA user_version = 1')
  await prepareVersionOne.close()

  const blocker = new DatabaseSync(databasePath)
  blocker.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE')
  await assert.rejects(
    service.open({ root: projectRoot }),
    hasCode('DATABASE_MIGRATION_FAILED')
  )
  blocker.exec('ROLLBACK')
  blocker.close()

  const migrationBackups = (await readdir(join(projectRoot, 'backups')))
    .filter((entry) => entry.startsWith('migration-'))
  assert.equal(migrationBackups.length, 1)
  const restored = await service.restore({
    backupRoot: join(projectRoot, 'backups', migrationBackups[0]),
    destinationRoot: restoredRoot
  })

  assert.equal(restored.projectId, created.projectId)
  assert.equal(restored.title, '迁移恢复')
  const restoredDatabase = await DatabaseWorkerClient.open(join(restoredRoot, 'project.sqlite3'), [])
  assert.equal((await restoredDatabase.health()).userVersion, 2)
  await restoredDatabase.close()
})

test('does not allow a second service to write the active project', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-concurrent-'))
  const first = await ProjectService.start(join(sandbox, 'control-1.sqlite3'), createDependencies())
  const second = await ProjectService.start(join(sandbox, 'control-2.sqlite3'), createDependencies())
  t.after(async () => {
    await first.shutdown()
    await second.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const projectRoot = join(sandbox, 'novel')
  await first.create({ root: projectRoot, title: '双实例测试' })

  await assert.rejects(second.open({ root: projectRoot }), hasCode('PROJECT_LOCKED'))
})

test('serializes a concurrent create and close without leaving an active project', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-serialized-lifecycle-'))
  const service = await ProjectService.start(
    join(sandbox, 'control.sqlite3'),
    createDependencies()
  )
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await Promise.all([
    service.create({ root: join(sandbox, 'novel'), title: '串行生命周期' }),
    service.close()
  ])

  assert.equal(service.current(), undefined)
})

test('shutdown waits for an admitted create and rejects later lifecycle work', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-serialized-shutdown-'))
  const service = await ProjectService.start(
    join(sandbox, 'control.sqlite3'),
    createDependencies()
  )
  t.after(async () => {
    await service.shutdown().catch(() => undefined)
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const creating = service.create({ root: join(sandbox, 'novel'), title: '退出等待' })
  const shuttingDown = service.shutdown()
  await Promise.all([creating, shuttingDown])

  assert.equal(service.current(), undefined)
  await assert.rejects(
    service.create({ root: join(sandbox, 'late'), title: '不得接纳' }),
    hasCode('DATABASE_CLOSED')
  )
})

test('clears acquired project resources when recent-project persistence fails', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-control-failure-'))
  const controlPath = join(sandbox, 'control.sqlite3')
  const projectRoot = join(sandbox, 'failed-novel')
  const service = await ProjectService.start(controlPath, createDependencies())
  const controlFault = await DatabaseWorkerClient.open(controlPath, [])
  t.after(async () => {
    await controlFault.close()
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await controlFault.run(`
    CREATE TRIGGER fail_recent_insert
    BEFORE INSERT ON recent_projects
    BEGIN
      SELECT RAISE(ABORT, 'forced recent-project failure');
    END
  `)

  await assert.rejects(
    service.create({ root: projectRoot, title: '失败清理' }),
    hasCode('DATABASE_TRANSACTION_FAILED')
  )
  assert.equal(service.current(), undefined)
  await assert.rejects(access(projectRoot))

  await controlFault.run('DROP TRIGGER fail_recent_insert')
  const recovered = await service.create({
    root: join(sandbox, 'recovered-novel'),
    title: '恢复创建'
  })
  assert.equal(recovered.title, '恢复创建')
})

test('reconciles a retained recent record when the same path receives a new project id', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-reused-path-'))
  const projectRoot = join(sandbox, 'novel')
  const service = await ProjectService.start(
    join(sandbox, 'control.sqlite3'),
    createDependencies()
  )
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  const previous = await service.create({ root: projectRoot, title: '旧项目' })
  await service.close()
  await rm(projectRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })

  const replacement = await service.create({ root: projectRoot, title: '新项目' })
  assert.notEqual(replacement.projectId, previous.projectId)
  assert.deepEqual((await service.listRecent()).map(({ projectId, title }) => ({
    projectId,
    title
  })), [{ projectId: replacement.projectId, title: '新项目' }])
})

test('rolls back database and manifest rename when recent-project bookkeeping fails', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-rename-rollback-'))
  const controlPath = join(sandbox, 'control.sqlite3')
  const projectRoot = join(sandbox, 'novel')
  const service = await ProjectService.start(controlPath, createDependencies())
  const controlFault = await DatabaseWorkerClient.open(controlPath, [])
  t.after(async () => {
    await controlFault.close()
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await service.create({ root: projectRoot, title: '原名称' })
  await controlFault.run(`
    CREATE TRIGGER fail_recent_update
    BEFORE UPDATE ON recent_projects
    BEGIN
      SELECT RAISE(ABORT, 'forced recent-project update failure');
    END
  `)

  await assert.rejects(service.rename('不应保留的新名称'), hasCode('DATABASE_TRANSACTION_FAILED'))
  assert.equal(service.current().title, '原名称')
  assert.equal((await readProjectManifest(projectRoot)).title, '原名称')

  await controlFault.run('DROP TRIGGER fail_recent_update')
  assert.equal((await service.rename('最终名称')).title, '最终名称')
})

test('removes a finalized backup when control metadata persistence fails', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-backup-metadata-rollback-'))
  const controlPath = join(sandbox, 'control.sqlite3')
  const backupRoot = join(sandbox, 'external-backups')
  const service = await ProjectService.start(controlPath, createDependencies())
  const controlFault = await DatabaseWorkerClient.open(controlPath, [])
  t.after(async () => {
    await controlFault.close()
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await service.create({ root: join(sandbox, 'novel'), title: '备份补偿' })
  await controlFault.run(`
    CREATE TRIGGER fail_backup_metadata
    BEFORE UPDATE OF last_backup_path ON recent_projects
    BEGIN
      SELECT RAISE(ABORT, 'forced backup metadata failure');
    END
  `)

  await assert.rejects(service.backup(backupRoot), hasCode('DATABASE_WORKER_FAILED'))
  assert.deepEqual(await readdir(backupRoot), [])

  await controlFault.run('DROP TRIGGER fail_backup_metadata')
  const backup = await service.backup(backupRoot)
  await access(join(backup.backupPath, 'project.sqlite3'))
})

test('rejects backup and restore destinations nested inside their source data', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-contained-backup-'))
  const projectRoot = join(sandbox, 'novel')
  const externalBackups = join(sandbox, 'external-backups')
  const service = await ProjectService.start(
    join(sandbox, 'control.sqlite3'),
    createDependencies()
  )
  t.after(async () => {
    await service.shutdown()
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
  })

  await service.create({ root: projectRoot, title: '路径包含测试' })
  await assert.rejects(
    service.backup(join(projectRoot, 'attachments', 'nested-backups')),
    hasCode('INVALID_PROJECT_PATH')
  )

  const backup = await service.backup(externalBackups)
  await service.close()
  await assert.rejects(
    service.restore({
      backupRoot: backup.backupPath,
      destinationRoot: join(backup.backupPath, 'attachments', 'nested-restore')
    }),
    hasCode('INVALID_PROJECT_PATH')
  )
})
