import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { JsonRunRepository } from '../src/agent/repository.ts'

const createdAt = '2026-07-28T09:00:00.000Z'

const createRun = (overrides = {}) => ({
  id: 'run-1',
  prompt: 'Draft an opening scene.',
  status: 'queued',
  createdAt,
  updatedAt: createdAt,
  events: [
    {
      runId: 'run-1',
      sequence: 1,
      type: 'run.created',
      timestamp: createdAt,
      payload: {}
    },
    {
      runId: 'run-1',
      sequence: 2,
      type: 'step.delta',
      timestamp: '2026-07-28T09:01:00.000Z',
      payload: { phase: 'analysis', text: 'A storm gathers.' }
    }
  ],
  output: {
    analysis: 'A storm gathers.',
    final: ''
  },
  checkpoint: {
    phase: 'analysis',
    nextChunkIndex: 1
  },
  ...overrides
})

const createStorage = async (t) => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'open-novel-agent-runs-'))
  t.after(() => rm(storageRoot, { recursive: true, force: true }))
  return storageRoot
}

test('saves the first run with the version 1 JSON envelope', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  const run = createRun()

  assert.deepEqual(await repository.save(run), { ok: true, data: undefined })

  const persisted = JSON.parse(await readFile(join(storageRoot, 'run-1.json'), 'utf8'))
  assert.deepEqual(persisted, { schemaVersion: 1, run })
})

test('replaces a saved run and reloads it from a new repository instance', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  const original = createRun()
  const replacement = createRun({
    status: 'completed',
    updatedAt: '2026-07-28T09:02:00.000Z',
    output: {
      analysis: 'A storm gathers.',
      final: 'Opening drafted.'
    },
    checkpoint: {
      phase: 'final',
      nextChunkIndex: 0
    }
  })

  await repository.save(original)
  assert.deepEqual(await repository.save(replacement), { ok: true, data: undefined })

  const reloaded = new JsonRunRepository(storageRoot)
  assert.deepEqual(await reloaded.get('run-1'), { ok: true, data: replacement })
})

test('filters persisted events strictly after the requested sequence', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  const run = createRun({
    events: [
      ...createRun().events,
      {
        runId: 'run-1',
        sequence: 3,
        type: 'approval.requested',
        timestamp: '2026-07-28T09:02:00.000Z',
        payload: {}
      }
    ]
  })

  await repository.save(run)

  assert.deepEqual(await repository.getEvents('run-1', 1), {
    ok: true,
    data: run.events.slice(1)
  })
})

test('lists valid runs while reporting corrupt, unknown-schema, and invalid snapshots safely', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  const validRun = createRun()
  await repository.save(validRun)
  await writeFile(join(storageRoot, 'corrupt.json'), '{not json', 'utf8')
  await writeFile(
    join(storageRoot, 'unknown-schema.json'),
    JSON.stringify({ schemaVersion: 2, run: validRun }),
    'utf8'
  )
  await writeFile(
    join(storageRoot, 'invalid-run.json'),
    JSON.stringify({ schemaVersion: 1, run: { ...validRun, prompt: '' } }),
    'utf8'
  )

  const listed = await repository.list()

  assert.deepEqual(listed.runs, [validRun])
  assert.deepEqual(listed.issues, [
    { id: 'corrupt', code: 'CORRUPT_JSON', message: 'Run snapshot is not valid JSON' },
    { id: 'invalid-run', code: 'INVALID_RUN', message: 'Run snapshot failed validation' },
    { id: 'unknown-schema', code: 'UNSUPPORTED_SCHEMA', message: 'Run snapshot schema is not supported' }
  ])
  for (const issue of listed.issues) {
    assert.equal(issue.message.includes(storageRoot), false)
  }
})

test('does not expose an absolute path encoded in a corrupt snapshot filename', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  await writeFile(join(storageRoot, '%2Fprivate%2Fagent-runs.json'), '{not json', 'utf8')

  const listed = await repository.list()

  assert.deepEqual(listed.issues, [
    { id: '%2Fprivate%2Fagent-runs', code: 'CORRUPT_JSON', message: 'Run snapshot is not valid JSON' }
  ])
  assert.equal(JSON.stringify(listed.issues).includes('/private/agent-runs'), false)
})

test('rejects an envelope with extra top-level keys through get and list', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  await writeFile(
    join(storageRoot, 'extra-envelope.json'),
    JSON.stringify({ schemaVersion: 1, run: createRun(), extra: true }),
    'utf8'
  )

  assert.deepEqual(await repository.get('extra-envelope'), {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Run snapshot failed validation',
      retryable: false
    }
  })
  assert.deepEqual(await repository.list(), {
    runs: [],
    issues: [
      { id: 'extra-envelope', code: 'INVALID_RUN', message: 'Run snapshot failed validation' }
    ]
  })
})

test('rejects malformed public values without replacing the existing snapshot', async (t) => {
  const storageRoot = await createStorage(t)
  const repository = new JsonRunRepository(storageRoot)
  const validRun = createRun()
  await repository.save(validRun)
  const snapshotPath = join(storageRoot, 'run-1.json')
  const originalBytes = await readFile(snapshotPath)
  const publicLookingError = Object.assign(new Error('Will not survive JSON'), {
    code: 'EXECUTION_FAILED',
    retryable: true,
    extra: 'camouflage'
  })
  const nonEnumerableMessageError = Object.defineProperty(
    {
      code: 'INVALID_STATE',
      retryable: false
    },
    'message',
    {
      value: 'Will disappear from JSON',
      enumerable: false
    }
  )
  const statefulMessageError = {
    code: 'INVALID_STATE',
    get message() {
      return 'Accessor is not serializable'
    },
    retryable: false
  }
  const invalidRuns = [
    createRun({ prompt: '' }),
    createRun({ error: publicLookingError }),
    createRun({ error: nonEnumerableMessageError }),
    createRun({ error: statefulMessageError }),
    createRun({
      events: createRun().events.map((event, index) =>
        index === 0 ? { ...event, payload: [] } : event
      )
    }),
    createRun({
      events: [
        createRun().events[0],
        { ...createRun().events[1], sequence: 4, runId: 'other-run' }
      ]
    })
  ]

  for (const invalidRun of invalidRuns) {
    assert.deepEqual(await repository.save(invalidRun), {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Run snapshot failed validation',
        retryable: false
      }
    })
    assert.deepEqual(await readFile(snapshotPath), originalBytes)
  }

  assert.deepEqual(await repository.get('run-1'), { ok: true, data: validRun })
})

test('preserves a repository-managed snapshot when replacement fails', async (t) => {
  const storageRoot = await createStorage(t)
  const original = createRun()
  const repository = new JsonRunRepository(storageRoot)
  await repository.save(original)
  const snapshotPath = join(storageRoot, 'run-1.json')
  const originalBytes = await readFile(snapshotPath)
  const replacementRepository = new JsonRunRepository(storageRoot, async () => {
    throw new Error('replace failed')
  })

  const result = await replacementRepository.save(createRun({ prompt: 'Replacement prompt.' }))

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'PERSISTENCE_FAILED',
      message: 'Unable to save run snapshot',
      retryable: true
    }
  })
  assert.deepEqual(await readFile(snapshotPath), originalBytes)
  assert.deepEqual(await repository.get('run-1'), { ok: true, data: original })
})
