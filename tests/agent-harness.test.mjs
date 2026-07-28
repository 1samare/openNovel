import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createAgentHarnessController } from '../src/renderer/src/agent/use-agent-harness.ts'

const projectFile = (path) => new URL(`../${path}`, import.meta.url)
const readProjectFile = (path) => readFile(projectFile(path), 'utf8')

const successful = (data) => ({ ok: true, data })
const failed = (code, retryable = false) => ({
  ok: false,
  error: { code, message: `${code} from bridge`, retryable }
})

const event = (runId, sequence, type, payload = {}) => ({
  runId,
  sequence,
  type,
  timestamp: `2026-07-28T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  payload
})

const run = (id, status, events = []) => ({
  id,
  prompt: `Prompt for ${id}`,
  status,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
  events,
  output: { analysis: '', final: '' },
  checkpoint: { phase: 'analysis', nextChunkIndex: 0 }
})

const eventually = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.fail('Timed out waiting for the observable controller result')
}

test('subscribes before loading and merges an event received during the run-list load', async () => {
  const calls = []
  let listener
  let resolveList
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async () => failed('RUN_NOT_FOUND'),
    listRuns: () => {
      calls.push('list')
      return new Promise((resolve) => { resolveList = resolve })
    },
    getEvents: async () => successful([]),
    approveRun: async () => failed('INVALID_STATE'),
    cancelRun: async () => failed('INVALID_STATE'),
    resumeRun: async () => failed('INVALID_STATE'),
    subscribeEvents: (next) => {
      calls.push('subscribe')
      listener = next
      return () => calls.push('unsubscribe')
    }
  }
  const controller = createAgentHarnessController(api)

  const loading = controller.initialize()
  assert.deepEqual(calls, ['subscribe', 'list'])
  listener(event('run-1', 2, 'run.started'))
  resolveList(successful({
    runs: [run('run-1', 'queued', [event('run-1', 1, 'run.created')])],
    issues: []
  }))
  await loading

  assert.equal(controller.state.runs[0].status, 'running')
  assert.deepEqual(controller.state.runs[0].events.map((value) => value.sequence), [1, 2])
})

test('backfills a sequence gap, deduplicates the live event, and refreshes the run', async () => {
  const calls = []
  let listener
  const first = event('run-1', 1, 'run.created')
  const second = event('run-1', 2, 'step.delta', { phase: 'analysis', text: 'analysis' })
  const third = event('run-1', 3, 'run.completed')
  const refreshed = {
    ...run('run-1', 'completed', [first, second, third]),
    output: { analysis: 'analysis', final: 'final' }
  }
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async (id) => {
      calls.push(`get:${id}`)
      return successful(refreshed)
    },
    listRuns: async () => successful({ runs: [run('run-1', 'queued', [first])], issues: [] }),
    getEvents: async (id, after) => {
      calls.push(`events:${id}:${after}`)
      return successful([second])
    },
    approveRun: async () => failed('INVALID_STATE'),
    cancelRun: async () => failed('INVALID_STATE'),
    resumeRun: async () => failed('INVALID_STATE'),
    subscribeEvents: (next) => {
      listener = next
      return () => undefined
    }
  }
  const controller = createAgentHarnessController(api)
  await controller.initialize()

  listener(third)
  await eventually(() => calls.includes('get:run-1'))

  assert.deepEqual(calls.slice(-2), ['events:run-1:1', 'get:run-1'])
  assert.deepEqual(controller.state.runs[0].events.map((value) => value.sequence), [1, 2, 3])
  assert.equal(controller.state.runs[0].output.analysis, 'analysis')
  assert.equal(controller.state.runs[0].status, 'completed')
})

test('only sends state-gated commands and replaces runs with command results', async () => {
  const calls = []
  const awaiting = run('awaiting', 'awaiting_approval', [event('awaiting', 1, 'approval.requested')])
  const interrupted = run('interrupted', 'interrupted', [event('interrupted', 1, 'run.interrupted')])
  const completed = run('completed', 'completed', [event('completed', 1, 'run.completed')])
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async () => failed('RUN_NOT_FOUND'),
    listRuns: async () => successful({ runs: [awaiting, interrupted, completed], issues: [] }),
    getEvents: async () => successful([]),
    approveRun: async (id) => {
      calls.push(`approve:${id}`)
      return successful({ ...awaiting, status: 'running' })
    },
    cancelRun: async (id) => {
      calls.push(`cancel:${id}`)
      return successful({ ...awaiting, status: 'cancelled' })
    },
    resumeRun: async (id) => {
      calls.push(`resume:${id}`)
      return successful({ ...interrupted, status: 'running' })
    },
    subscribeEvents: () => () => undefined
  }
  const controller = createAgentHarnessController(api)
  await controller.initialize()

  assert.equal(controller.canApprove(completed), false)
  assert.equal(controller.canCancel(completed), false)
  assert.equal(controller.canResume(interrupted), true)
  assert.equal(await controller.approve('completed'), false)
  assert.deepEqual(calls, [])
  assert.equal(controller.state.error?.code, 'INVALID_STATE')

  assert.equal(await controller.approve('awaiting'), true)
  assert.equal(controller.runFor('awaiting')?.status, 'running')
  assert.equal(await controller.cancel('awaiting'), true)
  assert.equal(controller.runFor('awaiting')?.status, 'cancelled')
  assert.equal(await controller.resume('interrupted'), true)
  assert.equal(controller.runFor('interrupted')?.status, 'running')
  assert.deepEqual(calls, ['approve:awaiting', 'cancel:awaiting', 'resume:interrupted'])
})

test('presents retryable and non-retryable bridge errors and releases the subscription', async () => {
  let listCalls = 0
  let unsubscribeCalls = 0
  const active = run('active', 'running', [event('active', 1, 'run.started')])
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async () => failed('RUN_NOT_FOUND'),
    listRuns: async () => {
      listCalls += 1
      return listCalls === 1
        ? failed('PERSISTENCE_FAILED', true)
        : successful({ runs: [active], issues: [{ id: 'bad-run', code: 'CORRUPT_JSON', message: 'Unreadable snapshot' }] })
    },
    getEvents: async () => successful([]),
    approveRun: async () => failed('INVALID_STATE'),
    cancelRun: async () => failed('INVALID_STATE', false),
    resumeRun: async () => failed('INVALID_STATE'),
    subscribeEvents: () => () => { unsubscribeCalls += 1 }
  }
  const controller = createAgentHarnessController(api)

  await controller.initialize()
  assert.equal(controller.state.error?.retryable, true)
  assert.equal(controller.canRetry, true)
  await controller.retry()
  assert.equal(controller.state.issues[0].code, 'CORRUPT_JSON')
  assert.equal(await controller.cancel('active'), false)
  assert.equal(controller.state.error?.retryable, false)
  assert.equal(controller.canRetry, false)

  controller.dispose()
  controller.dispose()
  assert.equal(unsubscribeCalls, 1)
})

test('registers the dedicated chat route and exposes labelled harness controls', async () => {
  const [router, view] = await Promise.all([
    readProjectFile('src/renderer/src/router/index.ts'),
    readProjectFile('src/renderer/src/views/AgentHarnessView.vue')
  ])

  assert.match(router, /path: 'chat',[\s\S]*component: AgentHarnessView/)
  assert.match(view, /<label[^>]*for="agent-prompt"[^>]*>Prompt<\/label>/)
  assert.match(view, /aria-live="polite"/)
  assert.match(view, /审批通过/)
  assert.match(view, /恢复执行/)
  assert.match(view, /取消 Run/)
})
