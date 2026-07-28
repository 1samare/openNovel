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
    this.saveHistory = []
    this.readError = undefined
    this.listResult = undefined
  }

  async save(run) {
    this.saveHistory.push(clone(run))
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
    if (this.readError) return clone(this.readError)
    return { ok: true, data: this.runs.has(id) ? clone(this.runs.get(id)) : undefined }
  }

  async list() {
    if (this.listResult) return clone(this.listResult)
    return { runs: [...this.runs.values()].map(clone), issues: [] }
  }

  async getEvents(id, afterSequence = 0) {
    if (this.readError) return clone(this.readError)
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

class LateChunkExecutor {
  constructor() {
    this.release = undefined
  }

  async *stream({ phase }) {
    yield `${phase}-first`
    await new Promise((resolve) => {
      this.release = resolve
    })
    yield `${phase}-late`
  }
}

const createOrchestrator = (repository, executor = new MockExecutor()) => {
  let index = 0
  let nextId = 0
  return new AgentOrchestrator({
    repository,
    executor,
    clock: () => times[index++] ?? `2026-07-28T10:01:${String(index).padStart(2, '0')}.000Z`,
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
  assert.deepEqual(paused.events.map(({ sequence, type, payload }) => ({ sequence, type, payload })), [
    { sequence: 1, type: 'run.created', payload: {} },
    { sequence: 2, type: 'run.started', payload: {} },
    { sequence: 3, type: 'step.started', payload: { phase: 'analysis' } },
    { sequence: 4, type: 'step.delta', payload: { phase: 'analysis', text: 'analyze-1' } },
    { sequence: 5, type: 'step.delta', payload: { phase: 'analysis', text: 'analyze-2' } },
    { sequence: 6, type: 'step.completed', payload: { phase: 'analysis' } },
    { sequence: 7, type: 'approval.requested', payload: {} }
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
  assert.deepEqual(completed.events.slice(7).map(({ sequence, type, payload }) => ({ sequence, type, payload })), [
    { sequence: 8, type: 'approval.resolved', payload: {} },
    { sequence: 9, type: 'step.started', payload: { phase: 'final' } },
    { sequence: 10, type: 'step.delta', payload: { phase: 'final', text: 'final-1' } },
    { sequence: 11, type: 'step.completed', payload: { phase: 'final' } },
    { sequence: 12, type: 'run.completed', payload: {} }
  ])
  assert.deepEqual(notified.map((event) => event.sequence), Array.from({ length: 12 }, (_, index) => index + 1))
})

const snapshot = (overrides = {}) => ({
  id: 'stored-run',
  prompt: 'Stored prompt.',
  status: 'completed',
  createdAt: times[0],
  updatedAt: times[0],
  events: [{ runId: 'stored-run', sequence: 1, type: 'run.created', timestamp: times[0], payload: {} }],
  output: { analysis: '', final: '' },
  checkpoint: { phase: 'analysis', nextChunkIndex: 0 },
  ...overrides
})

const legacyFinalSnapshot = (overrides = {}) => snapshot({
  id: 'legacy-run',
  status: 'running',
  events: [
    { runId: 'legacy-run', sequence: 1, type: 'run.created', timestamp: times[0], payload: {} },
    { runId: 'legacy-run', sequence: 2, type: 'run.started', timestamp: times[1], payload: {} },
    { runId: 'legacy-run', sequence: 3, type: 'step.started', timestamp: times[2], payload: { phase: 'analysis' } },
    { runId: 'legacy-run', sequence: 4, type: 'step.delta', timestamp: times[3], payload: { phase: 'analysis', text: 'analysis-1' } },
    { runId: 'legacy-run', sequence: 5, type: 'step.completed', timestamp: times[4], payload: { phase: 'analysis' } }
  ],
  output: { analysis: 'analysis-1', final: '' },
  checkpoint: { phase: 'final', nextChunkIndex: 0 },
  ...overrides
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
  assert.deepEqual(cancelled.data.events.at(-1), {
    runId: 'run-1', sequence: 5, type: 'run.cancelled', timestamp: times[4], payload: {}
  })
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
  assert.deepEqual(failed.events.at(-1), {
    runId: 'run-1', sequence: 4, type: 'run.failed', timestamp: times[3],
    payload: { code: 'EXECUTION_FAILED' }
  })
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
  assert.equal(recovered.data.runs[0].status, 'interrupted')
  assert.deepEqual(recovered.data.runs[0].events.at(-1), {
    runId: 'run-1', sequence: 5, type: 'run.interrupted', timestamp: times[0], payload: {}
  })

  assert.equal((await restarted.resumeRun(created.data.id)).ok, true)
  const paused = await eventually(async () => {
    const run = await restarted.getRun(created.data.id)
    return run.ok && run.data.status === 'awaiting_approval' ? run.data : undefined
  })
  assert.equal(paused.output.analysis, 'analysis-firstanalysis-2')
  assert.equal(paused.output.analysis.includes('analysis-1'), false)
  assert.deepEqual(paused.events.find((event) => event.type === 'run.resumed'), {
    runId: 'run-1', sequence: 6, type: 'run.resumed', timestamp: times[1], payload: {}
  })
})

test('keeps the analysis checkpoint until approval.requested persists, then recovers without final bypass', async () => {
  const repository = new MemoryRepository()
  repository.failWhen = (run) => run.events.at(-1)?.type === 'approval.requested'
  const chunks = { analysis: ['analysis-1'], final: ['final-1'] }
  const first = createOrchestrator(repository, new SequenceExecutor(chunks))
  const created = await first.createRun('Require approval after restart.')

  const persistedBeforeApproval = await eventually(async () => {
    const stored = await repository.get(created.data.id)
    return stored.ok && stored.data?.events.at(-1)?.type === 'step.completed' ? stored.data : undefined
  })
  assert.deepEqual(persistedBeforeApproval.checkpoint, { phase: 'analysis', nextChunkIndex: 1 })
  assert.equal(persistedBeforeApproval.output.final, '')
  assert.equal(persistedBeforeApproval.events.some((event) => event.type === 'run.completed'), false)

  repository.failWhen = undefined
  const restarted = createOrchestrator(repository, new SequenceExecutor(chunks))
  const recovered = await restarted.recoverInterruptedRuns()
  assert.equal(recovered.ok, true)
  assert.equal(recovered.data.runs[0].status, 'interrupted')
  assert.equal((await restarted.resumeRun(created.data.id)).ok, true)

  const awaitingApproval = await eventually(async () => {
    const run = await restarted.getRun(created.data.id)
    return run.ok && run.data.status === 'awaiting_approval' ? run.data : undefined
  })
  assert.equal(awaitingApproval.output.analysis, 'analysis-1')
  assert.equal(awaitingApproval.output.final, '')
  assert.equal(awaitingApproval.events.filter((event) => event.type === 'step.delta').length, 1)
  assert.equal(awaitingApproval.events.some((event) => event.type === 'approval.resolved'), false)
  assert.equal(awaitingApproval.events.some((event) => event.type === 'run.completed'), false)

  assert.equal((await restarted.approveRun(created.data.id)).ok, true)
  const completed = await eventually(async () => {
    const run = await restarted.getRun(created.data.id)
    return run.ok && run.data.status === 'completed' ? run.data : undefined
  })
  assert.equal(completed.output.final, 'final-1')
})

test('isolates listener snapshots and failures, and unsubscribe stops only that listener', async () => {
  const repository = new MemoryRepository()
  const executor = new LateChunkExecutor()
  const orchestrator = createOrchestrator(repository, executor)
  const mutated = []
  const delivered = []
  const unsubscribe = orchestrator.subscribe((event) => {
    mutated.push(event)
    event.payload.poisoned = true
    throw new Error('listener failure must be isolated')
  })
  orchestrator.subscribe((event) => delivered.push(event))

  const created = await orchestrator.createRun('Keep event snapshots isolated.')
  assert.equal(created.ok, true)
  assert.deepEqual(delivered[0], {
    runId: 'run-1', sequence: 1, type: 'run.created', timestamp: times[0], payload: {}
  })
  assert.deepEqual((await repository.get(created.data.id)).data.events[0].payload, {})
  assert.deepEqual((await orchestrator.getRun(created.data.id)).data.events[0].payload, {})

  unsubscribe()
  await eventually(async () => executor.release)
  const beforeCancelCalls = mutated.length
  const cancelled = await orchestrator.cancelRun(created.data.id)
  executor.release()
  assert.equal(cancelled.ok, true)
  assert.equal(mutated.length, beforeCancelCalls)
  assert.equal(delivered.at(-1).type, 'run.cancelled')
})

test('propagates repository read errors and retains list issues while recovering non-running runs', async () => {
  const corrupt = {
    ok: false,
    error: { code: 'VALIDATION_ERROR', message: 'Run snapshot is not valid JSON', retryable: false }
  }
  const unavailable = {
    ok: false,
    error: { code: 'PERSISTENCE_FAILED', message: 'Unable to load run snapshot', retryable: true }
  }
  const readRepository = new MemoryRepository()
  readRepository.readError = corrupt
  const reader = createOrchestrator(readRepository)
  for (const command of [
    () => reader.getRun('corrupt'),
    () => reader.getEvents('corrupt'),
    () => reader.approveRun('corrupt'),
    () => reader.cancelRun('corrupt'),
    () => reader.resumeRun('corrupt')
  ]) {
    assert.deepEqual(await command(), corrupt)
  }
  readRepository.readError = unavailable
  assert.deepEqual(await reader.getRun('unavailable'), unavailable)

  const issues = [{ id: 'corrupt', code: 'CORRUPT_JSON', message: 'Run snapshot is not valid JSON' }]
  const listRepository = new MemoryRepository()
  listRepository.listResult = { runs: [snapshot()], issues }
  const orchestrator = createOrchestrator(listRepository)
  assert.deepEqual(await orchestrator.listRuns(), {
    ok: true,
    data: { runs: [snapshot()], issues }
  })
  assert.deepEqual(await orchestrator.recoverInterruptedRuns(), {
    ok: true,
    data: { runs: [snapshot()], issues }
  })
})

test('streams deterministic mock chunks from the requested checkpoint and stops for an aborted signal', async () => {
  const delaySignals = []
  const executor = new MockExecutor({
    analysisChunks: ['analysis-1', 'analysis-2'],
    finalChunks: ['final-1'],
    delay: async (signal) => delaySignals.push(signal)
  })
  const active = new AbortController()
  const analysis = []
  for await (const chunk of executor.stream({
    prompt: 'Ignored by deterministic chunks.', phase: 'analysis', nextChunkIndex: 1, signal: active.signal
  })) analysis.push(chunk)
  const aborted = new AbortController()
  aborted.abort()
  const final = []
  for await (const chunk of executor.stream({
    prompt: 'Ignored by deterministic chunks.', phase: 'final', nextChunkIndex: 0, signal: aborted.signal
  })) final.push(chunk)

  assert.deepEqual(analysis, ['analysis-2'])
  assert.deepEqual(final, [])
  assert.deepEqual(delaySignals, [active.signal])
})

test('returns a persisted queued snapshot before the asynchronous driver can mutate it', async () => {
  const repository = new MemoryRepository()
  const executor = new LateChunkExecutor()
  const orchestrator = createOrchestrator(repository, executor)

  const created = await orchestrator.createRun('Queue first.')

  assert.equal(created.ok, true)
  assert.deepEqual(repository.saveHistory.map((run) => run.status), ['queued'])
  assert.deepEqual(repository.saveHistory[0].events.map((event) => event.type), ['run.created'])
  await eventually(async () => executor.release)
  executor.release()
})

test('rejects duplicate approval and cancellation and does not append a late chunk after cancellation', async () => {
  const approvalRepository = new MemoryRepository()
  const approvalOrchestrator = createOrchestrator(
    approvalRepository,
    new SequenceExecutor({ analysis: ['analysis'], final: ['final'] })
  )
  const approvalRun = await approvalOrchestrator.createRun('Approve once.')
  await eventually(async () => (await approvalOrchestrator.getRun(approvalRun.data.id)).data?.status === 'awaiting_approval')
  assert.equal((await approvalOrchestrator.approveRun(approvalRun.data.id)).ok, true)
  assert.deepEqual(await approvalOrchestrator.approveRun(approvalRun.data.id), {
    ok: false,
    error: { code: 'INVALID_STATE', message: 'Cannot transition from running to running', retryable: false }
  })

  const cancellationRepository = new MemoryRepository()
  const executor = new LateChunkExecutor()
  const cancellationOrchestrator = createOrchestrator(cancellationRepository, executor)
  const cancellationRun = await cancellationOrchestrator.createRun('Cancel late output.')
  await eventually(async () => executor.release)
  const firstCancel = await cancellationOrchestrator.cancelRun(cancellationRun.data.id)
  const secondCancel = await cancellationOrchestrator.cancelRun(cancellationRun.data.id)
  executor.release()
  assert.equal(firstCancel.ok, true)
  assert.deepEqual(secondCancel, {
    ok: false,
    error: { code: 'INVALID_STATE', message: 'Cannot transition from cancelled to cancelled', retryable: false }
  })
  const cancelled = await cancellationOrchestrator.getRun(cancellationRun.data.id)
  assert.equal(cancelled.data.output.analysis, 'analysis-first')
  assert.equal(cancelled.data.output.analysis.includes('analysis-late'), false)
})

test('repairs a legacy final checkpoint without approval proof before it can stream final output', async () => {
  const repository = new MemoryRepository()
  repository.listResult = { runs: [legacyFinalSnapshot()], issues: [] }
  const orchestrator = createOrchestrator(
    repository,
    new SequenceExecutor({ analysis: ['analysis-1'], final: ['final-1'] })
  )

  const recovered = await orchestrator.recoverInterruptedRuns()
  assert.equal(recovered.ok, true)
  assert.deepEqual(recovered.data.runs[0].checkpoint, { phase: 'analysis', nextChunkIndex: 1 })
  assert.deepEqual(recovered.data.runs[0].events.at(-1), {
    runId: 'legacy-run', sequence: 6, type: 'run.interrupted', timestamp: times[0], payload: {}
  })

  assert.equal((await orchestrator.resumeRun('legacy-run')).ok, true)
  const awaitingApproval = await eventually(async () => {
    const run = await orchestrator.getRun('legacy-run')
    return run.ok && run.data.status === 'awaiting_approval' ? run.data : undefined
  })
  assert.equal(awaitingApproval.output.analysis, 'analysis-1')
  assert.equal(awaitingApproval.output.final, '')
  assert.equal(awaitingApproval.events.filter((event) => event.type === 'step.delta').length, 1)
  assert.equal(awaitingApproval.events.some((event) => event.type === 'run.completed'), false)

  const approved = await orchestrator.approveRun('legacy-run')
  assert.equal(approved.ok, true)
  assert.deepEqual(approved.data.events.at(-1), {
    runId: 'legacy-run', sequence: 11, type: 'approval.resolved', timestamp: times[5], payload: {}
  })
  const completed = await eventually(async () => {
    const run = await orchestrator.getRun('legacy-run')
    return run.ok && run.data.status === 'completed' ? run.data : undefined
  })
  assert.equal(completed.output.final, 'final-1')
  assert.deepEqual(completed.events.at(-1), {
    runId: 'legacy-run', sequence: 15, type: 'run.completed', timestamp: times[9], payload: {}
  })
})

test('refuses an interrupted final checkpoint without a durable approval proof', async () => {
  const repository = new MemoryRepository()
  repository.runs.set('legacy-run', legacyFinalSnapshot({ status: 'interrupted' }))
  const orchestrator = createOrchestrator(repository, new SequenceExecutor({ analysis: [], final: ['must-not-run'] }))

  assert.deepEqual(await orchestrator.resumeRun('legacy-run'), {
    ok: false,
    error: {
      code: 'INVALID_STATE',
      message: 'Cannot execute final phase before approval is resolved',
      retryable: false
    }
  })
  assert.equal((await orchestrator.getRun('legacy-run')).data.output.final, '')
})

test('mock executor delays active analysis and final streams and stops when aborted during delay', async () => {
  const delaySignals = []
  let releaseDelay
  const executor = new MockExecutor({
    analysisChunks: ['analysis-1', 'analysis-2'],
    finalChunks: ['final-1', 'final-2'],
    delay: async (signal) => {
      delaySignals.push(signal)
      await new Promise((resolve) => {
        releaseDelay = resolve
        signal.addEventListener('abort', resolve, { once: true })
      })
    }
  })
  const analysisController = new AbortController()
  const analysisIterator = executor.stream({
    prompt: 'Prompt.', phase: 'analysis', nextChunkIndex: 1, signal: analysisController.signal
  })[Symbol.asyncIterator]()
  const firstAnalysis = analysisIterator.next()
  await eventually(async () => releaseDelay)
  releaseDelay()
  assert.deepEqual(await firstAnalysis, { value: 'analysis-2', done: false })

  const finalController = new AbortController()
  const finalIterator = executor.stream({
    prompt: 'Prompt.', phase: 'final', nextChunkIndex: 0, signal: finalController.signal
  })[Symbol.asyncIterator]()
  const firstFinal = finalIterator.next()
  await eventually(async () => releaseDelay)
  finalController.abort()
  assert.deepEqual(await firstFinal, { value: undefined, done: true })
  assert.deepEqual(delaySignals, [analysisController.signal, finalController.signal])
})

test('serializes genuinely concurrent duplicate approval and cancellation commands', async () => {
  const approvalRepository = new MemoryRepository()
  const approvalOrchestrator = createOrchestrator(approvalRepository, new ApprovalThenBlockingExecutor())
  const approvalRun = await approvalOrchestrator.createRun('Approve concurrently.')
  await eventually(async () => (await approvalOrchestrator.getRun(approvalRun.data.id)).data?.status === 'awaiting_approval')
  const approvals = await Promise.all([
    approvalOrchestrator.approveRun(approvalRun.data.id),
    approvalOrchestrator.approveRun(approvalRun.data.id)
  ])
  assert.deepEqual(approvals.map((result) => result.ok), [true, false])

  const cancellationRepository = new MemoryRepository()
  const cancellationOrchestrator = createOrchestrator(cancellationRepository, new BlockingExecutor())
  const cancellationRun = await cancellationOrchestrator.createRun('Cancel concurrently.')
  await eventually(async () => (await cancellationOrchestrator.getRun(cancellationRun.data.id)).data?.events.some((event) => event.type === 'step.delta'))
  const cancellations = await Promise.all([
    cancellationOrchestrator.cancelRun(cancellationRun.data.id),
    cancellationOrchestrator.cancelRun(cancellationRun.data.id)
  ])
  assert.deepEqual(cancellations.map((result) => result.ok), [true, false])
})
