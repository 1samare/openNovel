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

const deferred = () => {
  let resolve
  let reject
  return {
    promise: new Promise((nextResolve, nextReject) => {
      resolve = nextResolve
      reject = nextReject
    }),
    resolve,
    reject
  }
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

test('normalizes rejected bridge calls, clears busy state, and retries the exact failed create and action', async () => {
  let createCalls = 0
  let approveCalls = 0
  const awaiting = run('awaiting', 'awaiting_approval', [event('awaiting', 1, 'approval.requested')])
  const api = {
    createRun: async () => {
      createCalls += 1
      return createCalls === 1
        ? Promise.reject(new Error('bridge rejected create'))
        : successful(run('created', 'queued', [event('created', 1, 'run.created')]))
    },
    getRun: async () => failed('RUN_NOT_FOUND'),
    listRuns: async () => successful({ runs: [awaiting], issues: [] }),
    getEvents: async () => successful([]),
    approveRun: async () => {
      approveCalls += 1
      return approveCalls === 1
        ? Promise.reject(new Error('bridge rejected approval'))
        : successful({ ...awaiting, status: 'running', events: [...awaiting.events, event('awaiting', 2, 'approval.resolved')] })
    },
    cancelRun: async () => failed('INVALID_STATE'),
    resumeRun: async () => failed('INVALID_STATE'),
    subscribeEvents: () => () => undefined
  }
  const controller = createAgentHarnessController(api)
  await controller.initialize()

  controller.state.prompt = 'retry the exact create'
  assert.equal(await controller.create(), false)
  assert.equal(controller.state.action, undefined)
  assert.deepEqual(controller.state.error, {
    code: 'EXECUTION_FAILED',
    message: 'Agent operation failed unexpectedly.',
    retryable: true
  })
  assert.equal(controller.retryLabel, '重试创建 Run')
  await controller.retry()
  assert.equal(createCalls, 2)
  assert.equal(controller.runFor('created')?.prompt, 'Prompt for created')

  assert.equal(await controller.approve('awaiting'), false)
  assert.equal(controller.retryLabel, '重试审批')
  await controller.retry()
  assert.equal(approveCalls, 2)
  assert.equal(controller.runFor('awaiting')?.status, 'running')
})

test('serializes duplicate and conflicting commands without blocking event delivery', async () => {
  const createDeferred = deferred()
  const approvalDeferred = deferred()
  let listener
  let createCalls = 0
  let approveCalls = 0
  let cancelCalls = 0
  const awaiting = run('awaiting', 'awaiting_approval', [event('awaiting', 1, 'approval.requested')])
  const second = run('second', 'queued', [event('second', 1, 'run.created')])
  const api = {
    createRun: () => {
      createCalls += 1
      return createDeferred.promise
    },
    getRun: async () => failed('RUN_NOT_FOUND'),
    listRuns: async () => successful({ runs: [awaiting, second], issues: [] }),
    getEvents: async () => successful([]),
    approveRun: () => {
      approveCalls += 1
      return approvalDeferred.promise
    },
    cancelRun: async () => {
      cancelCalls += 1
      return successful({ ...awaiting, status: 'cancelled' })
    },
    resumeRun: async () => failed('INVALID_STATE'),
    subscribeEvents: (next) => {
      listener = next
      return () => undefined
    }
  }
  const controller = createAgentHarnessController(api)
  await controller.initialize()

  controller.state.prompt = 'one create only'
  const firstCreate = controller.create()
  const secondCreate = controller.create()
  assert.equal(createCalls, 1)
  assert.equal(await secondCreate, false)
  createDeferred.resolve(successful(run('created', 'queued', [event('created', 1, 'run.created')])))
  assert.equal(await firstCreate, true)

  const approval = controller.approve('awaiting')
  const cancellation = controller.cancel('awaiting')
  listener(event('second', 2, 'run.started'))
  assert.equal(approveCalls, 1)
  assert.equal(cancelCalls, 0)
  assert.equal(await cancellation, false)
  await eventually(() => controller.runFor('second')?.status === 'running')
  approvalDeferred.resolve(successful({ ...awaiting, status: 'running', events: [...awaiting.events, event('awaiting', 2, 'approval.resolved')] }))
  assert.equal(await approval, true)
})

test('recovers the event queue after a rejected backfill and retries the backfill with its original cursor', async () => {
  let listener
  let backfillCalls = 0
  const first = event('first', 1, 'run.created')
  const second = event('first', 2, 'step.delta', { phase: 'analysis', text: 'A' })
  const third = event('first', 3, 'run.completed')
  const otherFirst = event('other', 1, 'run.created')
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async (id) => successful(id === 'first'
      ? { ...run('first', 'completed', [first, second, third]), output: { analysis: 'A', final: '' } }
      : run('other', 'running', [otherFirst, event('other', 2, 'run.started')])
    ),
    listRuns: async () => successful({ runs: [run('first', 'queued', [first]), run('other', 'queued', [otherFirst])], issues: [] }),
    getEvents: async (id, after) => {
      if (id === 'first') {
        backfillCalls += 1
        if (backfillCalls === 1) throw new Error('backfill rejected')
        assert.equal(after, 1)
        return successful([second])
      }
      return successful([])
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
  listener(event('other', 2, 'run.started'))
  await eventually(() => controller.state.error?.code === 'EXECUTION_FAILED')
  await eventually(() => controller.runFor('other')?.status === 'running')
  assert.equal(controller.retryLabel, '重试同步事件')
  await controller.retry()
  assert.equal(backfillCalls, 2)
  assert.deepEqual(controller.runFor('first')?.events.map((value) => value.sequence), [1, 2, 3])
})

test('ignores stale load and refresh results, and dispose makes later initialization a safe no-op', async () => {
  const firstLoad = deferred()
  const secondLoad = deferred()
  const staleRefresh = deferred()
  let listCalls = 0
  let listener
  const started = event('active', 1, 'run.started')
  const next = event('active', 2, 'step.delta', { phase: 'analysis', text: 'new' })
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: () => staleRefresh.promise,
    listRuns: () => {
      listCalls += 1
      return listCalls === 1 ? firstLoad.promise : secondLoad.promise
    },
    getEvents: async () => successful([next]),
    approveRun: async () => failed('INVALID_STATE'),
    cancelRun: async () => failed('INVALID_STATE'),
    resumeRun: async () => failed('INVALID_STATE'),
    subscribeEvents: (nextListener) => {
      listener = nextListener
      return () => undefined
    }
  }
  const controller = createAgentHarnessController(api)
  const initial = controller.initialize()
  const retried = controller.retry()
  secondLoad.resolve(successful({ runs: [run('newer', 'running', [event('newer', 1, 'run.started')])], issues: [] }))
  await retried
  firstLoad.resolve(successful({ runs: [run('older', 'queued', [event('older', 1, 'run.created')])], issues: [] }))
  await initial
  assert.equal(controller.runFor('older'), undefined)
  assert.equal(controller.runFor('newer')?.status, 'running')

  controller.state.runs = [run('active', 'running', [started])]
  listener(event('active', 3, 'run.completed'))
  await eventually(() => controller.runFor('active')?.events.length === 3)
  controller.dispose()
  assert.equal(controller.state.loading, false)
  assert.equal(controller.state.action, undefined)
  staleRefresh.resolve(successful(run('stale', 'queued', [event('stale', 1, 'run.created')])))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await controller.initialize()
  assert.equal(listCalls, 2)
  assert.equal(controller.runFor('stale'), undefined)
})

test('refreshes persisted safe failure details after a consecutive run.failed event and keeps the event queue recoverable', async () => {
  let listener
  const getRunCalls = []
  let activeRefreshes = 0
  const started = event('active', 1, 'run.started')
  const failedEvent = event('active', 2, 'run.failed', { code: 'EXECUTION_FAILED' })
  const persistedFailure = {
    ...run('active', 'failed', [started, failedEvent]),
    error: { code: 'EXECUTION_FAILED', message: 'Persisted safe failure detail', retryable: true }
  }
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async (id) => {
      getRunCalls.push(id)
      if (id === 'active') {
        activeRefreshes += 1
        return activeRefreshes === 1
          ? failed('PERSISTENCE_FAILED', true)
          : successful(persistedFailure)
      }
      return successful(run('other', 'running', [event('other', 1, 'run.started')]))
    },
    listRuns: async () => successful({ runs: [run('active', 'running', [started])], issues: [] }),
    getEvents: async () => successful([]),
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

  listener(failedEvent)
  await eventually(() => getRunCalls.includes('active'))
  await eventually(() => controller.state.error?.code === 'PERSISTENCE_FAILED')
  assert.equal(controller.runFor('active')?.status, 'failed')
  assert.equal(controller.retryLabel, '重试刷新 Run')

  listener(event('other', 1, 'run.created'))
  await eventually(() => controller.runFor('other')?.status === 'running')
  await controller.retry()

  assert.equal(activeRefreshes, 2)
  assert.equal(controller.runFor('active')?.error?.message, 'Persisted safe failure detail')
})

test('keeps final streaming output and failed-run errors observable while the page advertises accessible prompt recovery', async () => {
  let listener
  const running = run('final', 'running', [event('final', 1, 'run.started')])
  const failedRun = {
    ...run('failed', 'failed', [event('failed', 1, 'run.failed')]),
    error: { code: 'EXECUTION_FAILED', message: 'Safe failure message', retryable: true }
  }
  const api = {
    createRun: async () => failed('EXECUTION_FAILED'),
    getRun: async () => failed('RUN_NOT_FOUND'),
    listRuns: async () => successful({ runs: [running, failedRun], issues: [] }),
    getEvents: async () => successful([]),
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
  listener(event('final', 2, 'step.delta', { phase: 'final', text: 'streaming final' }))
  await eventually(() => controller.runFor('final')?.output.final === 'streaming final')
  controller.selectRun('failed')
  assert.equal(controller.runFor(controller.state.selectedRunId)?.error?.message, 'Safe failure message')

  const [view, styles] = await Promise.all([
    readProjectFile('src/renderer/src/views/AgentHarnessView.vue'),
    readProjectFile('src/renderer/src/assets/base.css')
  ])
  assert.match(view, /aria-invalid/)
  assert.match(view, /agent-prompt-error/)
  assert.match(view, /ref="promptInput"/)
  assert.match(view, /role="status"/)
  assert.match(view, /class="agent-output" aria-labelledby="analysis-output-title" aria-live="polite"/)
  assert.doesNotMatch(view, /v-if="selected\.status === 'completed'"/)
  assert.doesNotMatch(view, /event\.payload\.text/)
  assert.match(view, /selected\.error\?\.message/)
  assert.match(styles, /@media \(max-width: 1100px\)/)
  assert.match(styles, /@media \(max-width: 520px\)/)
})

test('keeps the compact workspace topbar secondary link centered, 44px tall, and horizontally bounded', async () => {
  const styles = await readProjectFile('src/renderer/src/assets/base.css')
  const compactStyles = styles.slice(styles.indexOf('@media (max-width: 520px)'))

  assert.match(compactStyles, /grid-template-columns:\s*64px minmax\(0, 1fr\)/)
  assert.match(compactStyles, /\.workspace-topbar\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-x:\s*hidden;/)
  assert.match(compactStyles, /\.workspace-topbar \.secondary-link\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?min-height:\s*44px;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/)
})
