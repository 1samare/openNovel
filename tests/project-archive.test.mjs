import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { unzipSync, zipSync } from 'fflate'

import {
  createProjectArchive,
  inspectProjectArchive
} from '../src/export/project-archive.ts'
import { DatabaseWorkerClient } from '../src/novel/database-worker.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

const encoder = new TextEncoder()

const createFixture = async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-archive-'))
  const projectRoot = join(sandbox, 'project')
  await Promise.all([
    mkdir(join(projectRoot, 'attachments'), { recursive: true }),
    mkdir(join(projectRoot, 'backups'), { recursive: true }),
    mkdir(join(projectRoot, 'exports'), { recursive: true })
  ])
  const manifest = {
    formatVersion: 1,
    projectId: 'project-1',
    title: '星海来信',
    createdAt: '2026-08-10T05:00:00.000Z',
    updatedAt: '2026-08-10T05:00:00.000Z'
  }
  await Promise.all([
    writeFile(join(projectRoot, 'open-novel.json'), `${JSON.stringify(manifest)}\n`, 'utf8'),
    writeFile(join(projectRoot, 'attachments', '资料.txt'), '本地资料。', 'utf8'),
    writeFile(join(projectRoot, 'exports', '正文.txt'), '不应进入备份', 'utf8'),
    writeFile(join(projectRoot, 'backups', '旧备份.zip'), '不应递归', 'utf8'),
    writeFile(join(projectRoot, '.open-novel.lock'), 'private lock', 'utf8'),
    writeFile(join(projectRoot, 'api-key.txt'), 'sk-test-secret', 'utf8')
  ])
  const databasePath = join(projectRoot, 'project.sqlite3')
  const database = await DatabaseWorkerClient.open(databasePath)
  await database.run(
    'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['project-1', '星海来信', manifest.createdAt, manifest.updatedAt]
  )
  await database.close()
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }))
  return { sandbox, projectRoot, databasePath, manifest }
}

test('creates a verified project archive with only manifest, SQLite, and attachments', async (t) => {
  const fixture = await createFixture(t)
  const destinationFile = join(fixture.sandbox, '星海来信.opennovel.zip')
  await createProjectArchive({
    projectRoot: fixture.projectRoot,
    databaseSnapshotPath: fixture.databasePath,
    destinationFile,
    projectId: 'project-1',
    createdAt: '2026-08-10T05:01:00.000Z'
  })

  const inspected = await inspectProjectArchive(destinationFile)
  assert.equal(inspected.projectId, 'project-1')
  assert.deepEqual(inspected.files.map(({ path }) => path), [
    'attachments/资料.txt',
    'open-novel.json',
    'project.sqlite3'
  ])
  const archive = unzipSync(await readFile(destinationFile))
  assert.deepEqual(Object.keys(archive).sort(), [
    'archive-manifest.json',
    'attachments/资料.txt',
    'open-novel.json',
    'project.sqlite3'
  ])
  assert.doesNotMatch(new TextDecoder().decode(await readFile(destinationFile)), /sk-test-secret/)
})

test('rejects changed hashes and does not replace an existing destination', async (t) => {
  const fixture = await createFixture(t)
  const validPath = join(fixture.sandbox, 'valid.opennovel.zip')
  await createProjectArchive({
    projectRoot: fixture.projectRoot,
    databaseSnapshotPath: fixture.databasePath,
    destinationFile: validPath,
    projectId: 'project-1',
    createdAt: '2026-08-10T05:01:00.000Z'
  })
  const changed = unzipSync(await readFile(validPath))
  changed['attachments/资料.txt'] = encoder.encode('篡改后的资料')
  const changedPath = join(fixture.sandbox, 'changed.opennovel.zip')
  await writeFile(changedPath, zipSync(changed))

  await assert.rejects(inspectProjectArchive(changedPath), (error) => {
    assert.equal(error instanceof ProjectDomainError, true)
    assert.equal(error.code, 'INVALID_PROJECT_BACKUP')
    return true
  })

  const existingPath = join(fixture.sandbox, 'existing.opennovel.zip')
  await writeFile(existingPath, 'keep me', 'utf8')
  await assert.rejects(createProjectArchive({
    projectRoot: fixture.projectRoot,
    databaseSnapshotPath: fixture.databasePath,
    destinationFile: existingPath,
    projectId: 'project-1',
    createdAt: '2026-08-10T05:02:00.000Z'
  }), (error) => {
    assert.equal(error instanceof ProjectDomainError, true)
    assert.equal(error.code, 'PROJECT_BACKUP_FAILED')
    return true
  })
  assert.equal(await readFile(existingPath, 'utf8'), 'keep me')
})

test('rejects excessive expansion ratios before accepting archive contents', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-archive-bomb-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }))
  const bombPath = join(sandbox, 'bomb.opennovel.zip')
  await writeFile(bombPath, zipSync({
    'attachments/repeated.bin': new Uint8Array(2 * 1024 * 1024)
  }, { level: 9 }))

  await assert.rejects(inspectProjectArchive(bombPath), (error) => {
    assert.equal(error instanceof ProjectDomainError, true)
    assert.equal(error.code, 'INVALID_PROJECT_BACKUP')
    assert.match(error.message, /limit/i)
    return true
  })
})

test('rejects a manifest that omits required project files with a domain error', async (t) => {
  const fixture = await createFixture(t)
  const validPath = join(fixture.sandbox, 'required-valid.opennovel.zip')
  await createProjectArchive({
    projectRoot: fixture.projectRoot,
    databaseSnapshotPath: fixture.databasePath,
    destinationFile: validPath,
    projectId: 'project-1',
    createdAt: '2026-08-10T05:01:00.000Z'
  })
  const archive = unzipSync(await readFile(validPath))
  const manifest = JSON.parse(new TextDecoder().decode(archive['archive-manifest.json']))
  manifest.files = manifest.files.filter((file) => file.path !== 'project.sqlite3')
  archive['archive-manifest.json'] = encoder.encode(JSON.stringify(manifest))
  delete archive['project.sqlite3']
  const missingPath = join(fixture.sandbox, 'required-missing.opennovel.zip')
  await writeFile(missingPath, zipSync(archive))

  await assert.rejects(inspectProjectArchive(missingPath), (error) => {
    assert.equal(error instanceof ProjectDomainError, true)
    assert.equal(error.code, 'INVALID_PROJECT_BACKUP')
    return true
  })
})
