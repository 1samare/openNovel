import assert from 'node:assert/strict'
import test from 'node:test'

import { MockExecutor } from '../src/agent/mock-executor.ts'
import { AgentOrchestrator } from '../src/agent/orchestrator.ts'

const times = [
  '2026-07-28T10:00:00.000Z',
  '2026-07-28T10:00:01.000Z',
  '2026-07-28T10:00:02.000Z',
  '2026-07-28T10:00:03.000Z',
  '2026-07-28T10:00:04.000Z',
  '2026-07-28T10:00:05.000Z',
  '2026-07-28T10:00:06.000Z',
  '2026-07-28T10:00:07.000Z',
  '2026-07-28T10:00:08.000Z',
  '2026-07-28T10:00:09.000Z',
  '2026-07-28T10:00:10.000Z',
  '2026-07-28T10:00:11.000Z',
  '2026-07-28T10:00:12.000Z',
  '2026-07-28T10:00:13.000Z',
  '2026-07-28T10:00:14.000Z'
]

const eventually = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  assert.fail('Timed out waiting for agent state')
}

const clone = (value) => structuredClone(value)

class MemoryRepository {
  constructor() {
    this.runs = new Map()
    this.failWhen = undefined
  }

  async save(run) {
    if (this.failWhen?.(run)) {
      return {
        ok: false,
        error: { code: 'PERSISTENCE_FAILED', message: 'Storage is unavailable', retryable: true }
      }
    }
    this.runs.set(run.id, clone(run))
    return { ok: true, data: undefined }
  }

  async get(id) {
    return { ok: true, data: this.runs.has(id) ? clone(this.runs.get(id)) : undefined }
  }

  async list() {
    return { runs: [...this.runs.values()].map(clone), issues: [] }
  }

  async getEvents(id, afterSequence = 0) {
    const run = this.runs.get(id)
    return { ok: true, data: run ? clone(run.events.filter((event) => event.sequence > afterSequence)) : [] }
  }
}

class SequenceExecutor {
  constructor(chunks) {
    this.chunks = chunks
  }

  async *stream({ phase, nextChunkIndex, signal }) {
    for (const text of this.chunks[phase].slice(nextChunkIndex)) {
      if (signal.aborted) return
      yield text
    }
  }
}

class BlockingExecutor {
  async *stream({ phase, nextChunkIndex, signal }) {
    if (nextChunkIndex === 0) yield `${phase}-first`
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    if (!signal.aborted) yield `${phase}-second`
  }
}

class ApprovalThenBlockingExecutor {
  async *stream({ phase, signal }) {
    if (phase === 'analysis') {
      yield 'analysis-complete'
      return
    }
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  }
}

class FailingExecutor {
  async *stream() {
    throw new Error('Mock executor failed')
  }
}

const createOrchestrator = (repository, executor = new MockExecutor()) => {
  let index = 0
  let nextId = 0
  return new AgentOrchestrator({
    repository,
    executor,
    clock: () => times[index++],
    id: () => `run-${++nextId}`
  })
}

test('creates, streams, pauses for approval, and completes in the strict event order', async () => {
  const repository = new MemoryRepository()
  const orchestrator = createOrchestrator(
    repository,
    new SequenceExecutor({ analysis: ['analyze-1', 'analyze-2'], final: ['final-1'] })
  )
  const notified = []
  orchestrator.subscribe((event) => notified.push(event))

  const created = await orchestrator.createRun('Draft an opening scene.')
  assert.deepEqual(created.data.events.map((event) => event.type), ['run.created'])

  const paused = await eventually(async () => {
    const run = await orchestrator.getRun('run-1')
    return run.ok && run.data.status === 'awaiting_approval' ? run.data : undefined
  })
  assert.equal(paused.output.analysis, 'analyze-1analyze-2')
  assert.deepEqual(paused.checkpoint, { phase: 'final', nextChunkIndex: 0 })
  assert.deepEqual(paused.events.map((event) => event.type), [
    'run.created',
    'run.started',
    'step.started',
    'step.delta',
    'step.delta',
    'step.completed',
    'approval.requested'
  ])

  const approved = await orchestrator.approveRun('run-1')
  assert.equal(approved.ok, true)
  assert.equal(approved.data.status, 'running')
  assert.equal(approved.data.events.at(-1).type, 'approval.resolved')

  const completed = await eventually(async () => {
    const run = await orchestrator.getRun('run-1')
    return run.ok && run.data.status === 'completed' ? run.data : undefined
  })
  assert.equal(completed.output.final, 'final-1')
  assert.deepEqual(completed.events.map((event) => event.type), [
    'run.created', 'run.started', 'step.started', 'step.delta', 'step.delta', 'step.completed',
    'approval.requested', 'approval.resolved', 'step.started', 'step.delta', 'step.completed', 'run.completed'
  ])
  assert.deepEqual(notified.map((event) => event.sequence), Array.from({ length: 12 }, (_, index) => index + 1))
})

test('cancels active work before serially committing the cancellation', async () => {
  const repository = new MemoryRepository()
  const orchestrator = createOrchestrator(repository, new BlockingExecutor())
  const created = await orchestrator.createRun('Cancel this run.')

  await eventually(async () => {
    const run = await orchestrator.getRun(created.data.id)
    return run.ok && run.data.events.some((event) => event.type === 'step.delta')
  })
  const cancelled = await orchestrator.cancelRun(created.data.id)

  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.data.status, 'cancelled')
  assert.equal(cancelled.data.events.at(-1).type, 'run.cancelled')
  assert.equal(cancelled.data.output.analysis, 'analysis-first')
})

test('maps executor failures and unknown ids to exact public errors', async () => {
  const repository = new MemoryRepository()
  const orchestrator = createOrchestrator(repository, new FailingExecutor())
  const created = await orchestrator.createRun('Make the executor fail.')

  const failed = await eventually(async () => {
    const run = await orchestrator.getRun(created.data.id)
    return run.ok && run.data.status === 'failed' ? run.data : undefined
  })
  assert.deepEqual(failed.error, {
    code: 'EXECUTION_FAILED', message: 'Mock executor failed', retryable: true
  })
  assert.equal(failed.events.at(-1).type, 'run.failed')
  assert.deepEqual(await orchestrator.getRun('missing'), {
    ok: false,
    error: { code: 'RUN_NOT_FOUND', message: 'Run was not found', retryable: false }
  })
})

test('serializes concurrent approval and cancellation commands without completing the run', async () => {
  const repository = new MemoryRepository()
  const orchestrator = createOrchestrator(repository, new ApprovalThenBlockingExecutor())
  const created = await orchestrator.createRun('Race commands.')
  await eventually(async () => {
    const run = await orchestrator.getRun(created.data.id)
    return run.ok && run.data.status === 'awaiting_approval'
  })

  await Promise.all([orchestrator.approveRun(created.data.id), orchestrator.cancelRun(created.data.id)])
  const run = await orchestrator.getRun(created.data.id)

  assert.equal(run.ok, true)
  assert.equal(run.data.status, 'cancelled')
  assert.equal(run.data.events.some((event) => event.type === 'run.completed'), false)
})

test('persists each event before notifying it and supports event backfill', async () => {
  const repository = new MemoryRepository()
  repository.failWhen = (run) => run.events.at(-1)?.type === 'step.delta'
  const orchestrator = createOrchestrator(
    repository,
    new SequenceExecutor({ analysis: ['will-not-persist'], final: ['final'] })
  )
  const notified = []
  orchestrator.subscribe((event) => notified.push(event))
  const created = await orchestrator.createRun('Persist before notify.')

  await eventually(async () => {
    const run = await orchestrator.getRun(created.data.id)
    return run.ok && run.data.events.some((event) => event.type === 'run.started')
  })
  assert.deepEqual(notified.map((event) => event.type), ['run.created', 'run.started', 'step.started'])
  assert.deepEqual((await repository.get(created.data.id)).data.events.map((event) => event.type), [
    'run.created', 'run.started', 'step.started'
  ])
  assert.deepEqual(await orchestrator.getEvents(created.data.id, 1), {
    ok: true,
    data: (await repository.get(created.data.id)).data.events.slice(1)
  })
})

test('recovers persisted running work as interrupted and resumes from its checkpoint without duplicate chunks', async () => {
  const repository = new MemoryRepository()
  const chunks = { analysis: ['analysis-1', 'analysis-2'], final: ['final-1'] }
  const first = createOrchestrator(repository, new BlockingExecutor())
  const created = await first.createRun('Recover this run.')
  await eventually(async () => {
    const run = await first.getRun(created.data.id)
    return run.ok && run.data.checkpoint.nextChunkIndex === 1
  })

  const restarted = createOrchestrator(repository, new SequenceExecutor(chunks))
  const recovered = await restarted.recoverInterruptedRuns()
  assert.equal(recovered.ok, true)
  assert.equal(recovered.data[0].status, 'interrupted')
  assert.equal(recovered.data[0].events.at(-1).type, 'run.interrupted')

  assert.equal((await restarted.resumeRun(created.data.id)).ok, true)
  const paused = await eventually(async () => {
    const run = await restarted.getRun(created.data.id)
    return run.ok && run.data.status === 'awaiting_approval' ? run.data : undefined
  })
  assert.equal(paused.output.analysis, 'analysis-firstanalysis-2')
  assert.equal(paused.output.analysis.includes('analysis-1'), false)
})
