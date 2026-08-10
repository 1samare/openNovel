import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  acquireProjectLock,
  prepareEmptyProjectDirectory,
  readProjectManifest,
  resolveProjectPaths,
  writeProjectManifest
} from '../src/novel/project-paths.ts'
import { ProjectDomainError } from '../src/shared/project.ts'

const manifest = {
  formatVersion: 1,
  projectId: 'project-123',
  title: '星海来信',
  createdAt: '2026-08-07T08:00:00.000Z',
  updatedAt: '2026-08-07T08:00:00.000Z'
}

const hasCode = (code) => (error) => {
  assert.equal(error instanceof ProjectDomainError, true)
  assert.equal(error.code, code)
  return true
}

test('rejects relative project roots and occupied project directories', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-paths-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))

  assert.throws(() => resolveProjectPaths('relative/project'), hasCode('INVALID_PROJECT_PATH'))

  const occupied = join(sandbox, 'occupied')
  await mkdir(occupied)
  await writeFile(join(occupied, 'notes.txt'), 'belongs to the user', 'utf8')

  await assert.rejects(
    prepareEmptyProjectDirectory(occupied),
    hasCode('PROJECT_DIRECTORY_NOT_EMPTY')
  )
  assert.equal(await readFile(join(occupied, 'notes.txt'), 'utf8'), 'belongs to the user')
})

test('writes and strictly reloads an atomic version one manifest', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-manifest-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))

  const root = join(sandbox, 'project')
  const paths = await prepareEmptyProjectDirectory(root)
  await writeProjectManifest(paths, manifest)

  assert.deepEqual(await readProjectManifest(root), manifest)
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(root))
  assert.deepEqual(entries, ['open-novel.json'])

  await writeFile(paths.manifest, JSON.stringify({ ...manifest, secretRef: 'must-not-pass' }), 'utf8')
  await assert.rejects(readProjectManifest(root), hasCode('INVALID_PROJECT_MANIFEST'))

  await writeFile(paths.manifest, JSON.stringify({
    ...manifest,
    createdAt: 'August 7, 2026 08:00:00 UTC'
  }), 'utf8')
  await assert.rejects(readProjectManifest(root), hasCode('INVALID_PROJECT_MANIFEST'))

  await writeFile(paths.manifest, JSON.stringify({
    ...manifest,
    updatedAt: '2026-08-07T07:59:59.000Z'
  }), 'utf8')
  await assert.rejects(readProjectManifest(root), hasCode('INVALID_PROJECT_MANIFEST'))
})

test('prevents concurrent project writers and requires confirmation for a stale lock', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-lock-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))

  const paths = await prepareEmptyProjectDirectory(join(sandbox, 'project'))
  const first = await acquireProjectLock(paths.root, manifest.projectId)
  await assert.rejects(
    acquireProjectLock(paths.root, manifest.projectId),
    hasCode('PROJECT_LOCKED')
  )
  await first.release()

  await writeFile(paths.lock, JSON.stringify({
    projectId: manifest.projectId,
    pid: 2147483647,
    createdAt: '2026-08-07T08:00:00.000Z'
  }), 'utf8')

  await assert.rejects(
    acquireProjectLock(paths.root, manifest.projectId),
    hasCode('STALE_PROJECT_LOCK')
  )
  const recovered = await acquireProjectLock(paths.root, manifest.projectId, {
    recoverStale: true
  })
  await recovered.release()

  await writeFile(paths.lock, '{malformed stale lock', 'utf8')
  await assert.rejects(
    acquireProjectLock(paths.root, manifest.projectId),
    hasCode('STALE_PROJECT_LOCK')
  )
  const recoveredMalformed = await acquireProjectLock(paths.root, manifest.projectId, {
    recoverStale: true
  })
  await recoveredMalformed.release()
})

test('allows only one simultaneous stale-lock recoverer to acquire ownership', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-lock-recovery-race-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const paths = await prepareEmptyProjectDirectory(join(sandbox, `project-${attempt}`))
    await writeFile(paths.lock, JSON.stringify({
      projectId: manifest.projectId,
      pid: 2147483647,
      createdAt: '2026-08-07T08:00:00.000Z',
      token: `stale-${attempt}`
    }), 'utf8')

    const results = await Promise.allSettled([
      acquireProjectLock(paths.root, manifest.projectId, { recoverStale: true }),
      acquireProjectLock(paths.root, manifest.projectId, { recoverStale: true })
    ])
    const acquired = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    await Promise.all(acquired.map((lock) => lock.release()))

    assert.equal(acquired.length, 1)
  }
})

test('does not recover while another stale-lock recovery claim is active', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-lock-recovery-claim-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const paths = await prepareEmptyProjectDirectory(join(sandbox, 'project'))
  await writeFile(paths.lock, JSON.stringify({
    projectId: manifest.projectId,
    pid: 2147483647,
    createdAt: '2026-08-07T08:00:00.000Z',
    token: 'stale-lock'
  }), 'utf8')
  await writeFile(`${paths.lock}.recovery`, JSON.stringify({
    pid: process.pid,
    createdAt: '2026-08-07T08:01:00.000Z',
    token: 'active-recoverer'
  }), 'utf8')

  await assert.rejects(
    acquireProjectLock(paths.root, manifest.projectId, { recoverStale: true }),
    hasCode('PROJECT_LOCKED')
  )
})

test('reclaims dead or incomplete recovery claims left by a crashed process', async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-lock-stale-recovery-claim-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const paths = await prepareEmptyProjectDirectory(join(sandbox, 'project'))
  await writeFile(paths.lock, JSON.stringify({
    projectId: manifest.projectId,
    pid: 2147483647,
    createdAt: '2026-08-07T08:00:00.000Z',
    token: 'stale-lock'
  }), 'utf8')
  await writeFile(`${paths.lock}.recovery`, JSON.stringify({
    pid: 2147483647,
    createdAt: '2026-08-07T08:01:00.000Z',
    token: 'stale-recoverer'
  }), 'utf8')

  const recovered = await acquireProjectLock(paths.root, manifest.projectId, {
    recoverStale: true
  })
  await recovered.release()

  await assert.rejects(readFile(`${paths.lock}.recovery`, 'utf8'), { code: 'ENOENT' })

  await writeFile(paths.lock, JSON.stringify({
    projectId: manifest.projectId,
    pid: 2147483647,
    createdAt: '2026-08-07T08:00:00.000Z',
    token: 'second-stale-lock'
  }), 'utf8')
  await writeFile(`${paths.lock}.recovery`, '{"pid":', 'utf8')

  const recoveredIncomplete = await acquireProjectLock(paths.root, manifest.projectId, {
    recoverStale: true
  })
  await recoveredIncomplete.release()
})
