import assert from 'node:assert/strict'
import test from 'node:test'

import { toAgentError } from '../src/agent/errors.ts'
import { transitionRun } from '../src/agent/state-machine.ts'
import { isAgentRun, validatePrompt } from '../src/agent/validation.ts'

const createdAt = '2026-07-28T09:00:00.000Z'

const createRun = (status = 'queued') => ({
  id: 'run-1',
  prompt: 'Draft an opening scene.',
  status,
  createdAt,
  updatedAt: createdAt,
  events: []
})

const transition = (run, status) => {
  const result = transitionRun(run, status, '2026-07-28T09:01:00.000Z')
  assert.equal(result.ok, true)
  return result.value
}

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
    code: 'UNEXPECTED_ERROR',
    message: 'executor stopped'
  })
  assert.equal('stack' in converted, false)
})

test('rejects duplicate approval after a run has resumed', () => {
  const approved = transition(createRun('awaiting_approval'), 'running')
  const duplicateApproval = transitionRun(approved, 'running', '2026-07-28T09:02:00.000Z')

  assert.deepEqual(duplicateApproval, {
    ok: false,
    error: {
      code: 'INVALID_STATE',
      message: 'Cannot transition from running to running'
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
    value: 'Keep the scene grounded.'
  })

  for (const prompt of ['', '   ', 42, null]) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      error: {
        code: 'INVALID_PROMPT',
        message: 'Prompt must be a non-blank string'
      }
    })
  }

  assert.equal(isAgentRun({ ...createRun(), prompt: '   ' }), false)
})
