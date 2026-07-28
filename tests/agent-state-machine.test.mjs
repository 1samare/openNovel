import assert from 'node:assert/strict'
import test from 'node:test'

import { isAgentError, toAgentError } from '../src/agent/errors.ts'
import { transitionRun } from '../src/agent/state-machine.ts'
import { isAgentEvent, isAgentResult, isAgentRun, validatePrompt } from '../src/agent/validation.ts'

const createdAt = '2026-07-28T09:00:00.000Z'

const createRun = (status = 'queued') => ({
  id: 'run-1',
  prompt: 'Draft an opening scene.',
  status,
  createdAt,
  updatedAt: createdAt,
  events: [
    {
      runId: 'run-1',
      sequence: 1,
      type: 'run.created',
      timestamp: createdAt,
      payload: {}
    }
  ],
  output: {
    analysis: '',
    final: ''
  },
  checkpoint: {
    phase: 'analysis',
    nextChunkIndex: 0
  }
})

const transition = (run, status) => {
  const result = transitionRun(run, status, '2026-07-28T09:01:00.000Z')
  assert.equal(result.ok, true)
  return result.data
}

test('accepts exactly the approved public event names and common event fields', () => {
  const eventTypes = [
    'run.created',
    'run.started',
    'run.interrupted',
    'run.resumed',
    'run.completed',
    'run.cancelled',
    'run.failed',
    'step.started',
    'step.delta',
    'step.completed',
    'approval.requested',
    'approval.resolved'
  ]

  const events = eventTypes.map((type, index) => ({
    runId: 'run-1',
    sequence: index + 1,
    type,
    timestamp: createdAt,
    payload: { index }
  }))

  assert.equal(events.every(isAgentEvent), true)
  assert.equal(
    isAgentEvent({
      sequence: 1,
      type: 'status_changed',
      at: createdAt,
      status: 'queued'
    }),
    false
  )
  assert.equal(
    isAgentEvent({
      runId: 'run-1',
      sequence: 1,
      type: 'run.created',
      timestamp: createdAt
    }),
    false
  )
})

test('allows the queued, approval, and completion lifecycle', () => {
  let run = createRun()
  run = transition(run, 'running')
  run = transition(run, 'awaiting_approval')
  run = transition(run, 'running')
  run = transition(run, 'completed')

  assert.equal(run.status, 'completed')
  assert.equal(run.updatedAt, '2026-07-28T09:01:00.000Z')
  assert.equal(isAgentRun(run), true)
})

test('allows cancellation from every non-terminal state', () => {
  for (const status of ['queued', 'running', 'awaiting_approval', 'interrupted']) {
    const cancelled = transition(createRun(status), 'cancelled')
    assert.equal(cancelled.status, 'cancelled')
  }
})

test('allows a running run to fail with a safe error representation', () => {
  const failed = transition(createRun('running'), 'failed')
  const converted = toAgentError(new Error('executor stopped'))

  assert.equal(failed.status, 'failed')
  assert.deepEqual(converted, {
    code: 'EXECUTION_FAILED',
    message: 'executor stopped',
    retryable: true
  })
  assert.equal('stack' in converted, false)
})

test('normalizes a valid-coded Error without retaining stack or extra fields', () => {
  const unsafeError = Object.assign(new Error('invalid transition'), {
    code: 'INVALID_STATE',
    retryable: false,
    extra: 'do not expose'
  })
  const normalized = toAgentError(unsafeError)

  assert.notEqual(normalized, unsafeError)
  assert.deepEqual(normalized, {
    code: 'INVALID_STATE',
    message: 'invalid transition',
    retryable: false
  })
  assert.equal('stack' in normalized, false)
  assert.equal('extra' in normalized, false)
})

test('rejects native errors and every extra own key from the public error shape', () => {
  const publicError = {
    code: 'EXECUTION_FAILED',
    message: 'Executor stopped',
    retryable: true
  }
  const nativeError = Object.assign(new Error('Executor stopped'), {
    code: 'EXECUTION_FAILED',
    retryable: true,
    extra: 'enumerable camouflage'
  })
  const nonEnumerableExtra = Object.defineProperty({ ...publicError }, 'extra', {
    value: 'hidden camouflage',
    enumerable: false
  })
  const symbolExtra = { ...publicError, [Symbol('extra')]: 'symbol camouflage' }

  assert.equal(isAgentError(publicError), true)
  assert.equal(isAgentError(nativeError), false)
  assert.equal(isAgentError({ ...publicError, extra: 'extra field' }), false)
  assert.equal(isAgentError(nonEnumerableExtra), false)
  assert.equal(isAgentError(symbolExtra), false)
})

test('returns a fresh fallback error when getters or proxies throw during conversion', () => {
  const throwingGetter = Object.defineProperty({}, 'code', {
    enumerable: true,
    get: () => {
      throw new Error('getter should not escape')
    }
  })
  const throwingProxy = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('proxy should not escape')
      }
    }
  )

  for (const unsafeError of [throwingGetter, throwingProxy]) {
    let normalized
    assert.doesNotThrow(() => {
      normalized = toAgentError(unsafeError)
    })
    assert.deepEqual(normalized, {
      code: 'EXECUTION_FAILED',
      message: 'Unexpected agent error',
      retryable: true
    })
    assert.notEqual(normalized, unsafeError)
    assert.deepEqual(Reflect.ownKeys(normalized), ['code', 'message', 'retryable'])
  }
})

test('rejects duplicate approval after a run has resumed', () => {
  const approved = transition(createRun('awaiting_approval'), 'running')
  const duplicateApproval = transitionRun(approved, 'running', '2026-07-28T09:02:00.000Z')

  assert.deepEqual(duplicateApproval, {
    ok: false,
    error: {
      code: 'INVALID_STATE',
      message: 'Cannot transition from running to running',
      retryable: false
    }
  })
})

test('rejects all mutations from terminal states without changing the run', () => {
  for (const status of ['completed', 'cancelled', 'failed']) {
    const run = createRun(status)
    const result = transitionRun(run, 'running', '2026-07-28T09:02:00.000Z')

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_STATE')
    assert.equal(run.status, status)
  }
})

test('accepts a non-blank prompt and rejects malformed prompt input', () => {
  assert.deepEqual(validatePrompt('Keep the scene grounded.'), {
    ok: true,
    data: 'Keep the scene grounded.'
  })

  for (const prompt of ['', '   ', 42, null]) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Prompt must be a non-blank string',
        retryable: false
      }
    })
  }

  assert.equal(isAgentRun({ ...createRun(), prompt: '   ' }), false)
})

test('rejects non-plain or non-JSON event payloads', () => {
  const event = createRun().events[0]

  for (const payload of [[], new Date(createdAt), Object.create({ inherited: true }), { createdAt: new Date(createdAt) }]) {
    assert.equal(isAgentEvent({ ...event, payload }), false)
  }
})

test('requires the approved error shape, data result branch, output, and checkpoint', () => {
  assert.equal(
    isAgentError({
      code: 'PERSISTENCE_FAILED',
      message: 'Storage is unavailable',
      retryable: true
    }),
    true
  )
  assert.equal(isAgentError({ code: 'INVALID_PROMPT', message: 'Legacy code' }), false)
  assert.equal(
    isAgentError({ code: 'VALIDATION_ERROR', message: 'Missing retryability' }),
    false
  )
  assert.equal(isAgentResult({ ok: true, data: 'accepted' }), true)
  assert.equal(isAgentResult({ ok: true, value: 'legacy result' }), false)
  assert.equal(isAgentRun(createRun()), true)
  assert.equal(isAgentRun({ ...createRun(), result: 'Legacy output' }), false)
  assert.equal(isAgentRun({ ...createRun(), output: undefined }), false)
  assert.equal(isAgentRun({ ...createRun(), checkpoint: { phase: 'analysis' } }), false)
  assert.equal(
    isAgentRun({
      ...createRun(),
      events: [
        {
          sequence: 1,
          type: 'chunk',
          at: createdAt,
          phase: 'analysis',
          text: 'Legacy event'
        }
      ]
    }),
    false
  )
})

test('rejects non-contiguous and foreign event sequences in a run', () => {
  const event = createRun().events[0]
  const events = (sequences, runIds = sequences.map(() => 'run-1')) =>
    sequences.map((sequence, index) => ({
      ...event,
      sequence,
      runId: runIds[index]
    }))

  assert.equal(isAgentRun({ ...createRun(), events: events([2]) }), false)
  assert.equal(isAgentRun({ ...createRun(), events: events([1, 3]) }), false)
  assert.equal(isAgentRun({ ...createRun(), events: events([1, 1]) }), false)
  assert.equal(isAgentRun({ ...createRun(), events: events([1, 3, 2]) }), false)
  assert.equal(isAgentRun({ ...createRun(), events: events([1, 2], ['run-1', 'other-run']) }), false)
})
