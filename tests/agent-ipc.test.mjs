import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  AGENT_IPC_CHANNELS,
  validateAgentCommand
} from '../src/shared/agent-ipc.ts'
import { createAgentApi } from '../src/preload/agent-api.ts'
import {
  isAllowedAgentIpcSender,
  isAllowedLiveAgentWebContents
} from '../src/main/agent-ipc-security.ts'
import { registerAgentIpcHandlers } from '../src/main/agent-ipc.ts'
import { createAgentLogger } from '../src/main/agent-logger.ts'
import { createAgentRuntime } from '../src/main/agent-runtime.ts'

const eventFor = (runId = 'run-1') => ({
  runId,
  sequence: 1,
  type: 'run.created',
  timestamp: '2026-07-28T00:00:00.000Z',
  payload: {}
})

const senderFor = (url, {
  topLevel = true,
  senderDestroyed = false,
  frameDestroyed = false,
  frameThrows = false,
  frameUrl = url
} = {}) => {
  const mainFrame = {
    url: frameUrl,
    isDestroyed: () => {
      if (frameThrows) throw new Error('frame failed')
      return frameDestroyed
    }
  }
  return {
    sender: {
      mainFrame,
      getURL: () => url,
      isDestroyed: () => senderDestroyed
    },
    senderFrame: topLevel ? mainFrame : { url: frameUrl, parent: mainFrame }
  }
}

test('Agent command validators reject malformed arguments before orchestration', () => {
  assert.deepEqual(validateAgentCommand(AGENT_IPC_CHANNELS.createRun, ['']), {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid agent command arguments',
      retryable: false
    }
  })
  assert.deepEqual(validateAgentCommand(AGENT_IPC_CHANNELS.getEvents, ['run-1', -1]), {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid agent command arguments',
      retryable: false
    }
  })
  assert.deepEqual(validateAgentCommand('agent:unknown', []), {
    ok: false,
    error: {
      code: 'IPC_FORBIDDEN',
      message: 'IPC channel is not allowed',
      retryable: false
    }
  })
})

test('Agent sender allowlist accepts only the configured top-level app page or dev origin', () => {
  const production = { appPageUrl: 'file:///app/renderer/index.html' }
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/index.html'), production),
    true
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/foreign.html'), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/index.html', { topLevel: false }), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('not a url'), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(
      senderFor('http://localhost:5173/workspace/chat'),
      { devServerOrigin: 'http://localhost:5173' }
    ),
    true
  )
  assert.equal(
    isAllowedAgentIpcSender(
      senderFor('http://localhost:4173/workspace/chat'),
      { devServerOrigin: 'http://localhost:5173' }
    ),
    false
  )
})

test('Agent sender allowlist permits only file hash routes and rejects query, credentials, and destroyed frames', () => {
  const production = { appPageUrl: 'file:///app/renderer/index.html' }
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/index.html#/workspace/chat'), production),
    true
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/index.html?mode=debug'), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/index.html?'), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/index.html?#/workspace/chat'), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('file:///app/renderer/other.html#/workspace/chat'), production),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('http://localhost:5173/chat'), {
      devServerOrigin: 'http://user:secret@localhost:5173'
    }),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(senderFor('http://user:secret@localhost:5173/chat'), {
      devServerOrigin: 'http://localhost:5173'
    }),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(
      senderFor('file:///app/renderer/index.html', { frameDestroyed: true }),
      production
    ),
    false
  )
  assert.equal(
    isAllowedAgentIpcSender(
      senderFor('file:///app/renderer/index.html', { frameThrows: true }),
      production
    ),
    false
  )
})

test('IPC handlers register only fixed commands and serialize thrown failures without stack paths', async () => {
  const handlers = new Map()
  const runtime = {
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    orchestrator: {
      createRun: async () => {
        throw new Error('C:\\Users\\secret\\agent-runs\\snapshot.json')
      }
    }
  }
  registerAgentIpcHandlers({
    handle: (channel, handler) => handlers.set(channel, handler)
  }, runtime)
  assert.deepEqual([...handlers.keys()].sort(), Object.values(AGENT_IPC_CHANNELS)
    .filter((channel) => channel !== AGENT_IPC_CHANNELS.event)
    .sort())

  const handler = handlers.get(AGENT_IPC_CHANNELS.createRun)
  const result = await handler(senderFor('file:///app/renderer/index.html'), 'A safe prompt')
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'EXECUTION_FAILED',
      message: 'Agent IPC command failed',
      retryable: false
    }
  })
  assert.doesNotMatch(JSON.stringify(result), /Users|agent-runs|snapshot|stack/i)
})

test('IPC registration is idempotent and stale disposal cannot remove a newer registration', () => {
  const handlers = new Map()
  const removed = []
  let registrations = 0
  const ipcMain = {
    handle: (channel, handler) => {
      registrations += 1
      handlers.set(channel, handler)
    },
    removeHandler: (channel) => {
      removed.push(channel)
      handlers.delete(channel)
    }
  }
  const runtime = {
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    orchestrator: {}
  }

  const first = registerAgentIpcHandlers(ipcMain, runtime)
  const repeated = registerAgentIpcHandlers(ipcMain, runtime)
  assert.equal(registrations, 7)
  assert.equal(first, repeated)

  first()
  assert.equal(removed.length, 7)
  const newer = registerAgentIpcHandlers(ipcMain, runtime)
  first()
  assert.equal(removed.length, 7)
  newer()
  assert.equal(removed.length, 14)
})

test('runtime lifecycle awaits recovery before IPC registration and window creation, and handles recovery rejection', async () => {
  const { initializeAgentRuntime } = await import('../src/main/agent-runtime.ts')
  const calls = []
  const runtime = {
    recover: async () => {
      calls.push('recover')
      await new Promise((resolve) => setImmediate(resolve))
      calls.push('recovered')
    },
    dispose: () => calls.push('runtime.dispose')
  }
  const dispose = await initializeAgentRuntime({
    runtime,
    registerIpc: () => {
      calls.push('ipc.register')
      return () => calls.push('ipc.dispose')
    },
    createWindow: () => calls.push('window.create'),
    onRecoveryFailure: () => calls.push('recovery.failure')
  })
  assert.deepEqual(calls, ['recover', 'recovered', 'ipc.register', 'window.create'])
  dispose()
  assert.deepEqual(calls.slice(-2), ['ipc.dispose', 'runtime.dispose'])

  const rejected = []
  await initializeAgentRuntime({
    runtime: { recover: async () => { throw new Error('storage path must stay private') }, dispose: () => undefined },
    registerIpc: () => {
      rejected.push('ipc.register')
      return () => undefined
    },
    createWindow: () => rejected.push('window.create'),
    onRecoveryFailure: () => rejected.push('recovery.failure')
  })
  assert.deepEqual(rejected, ['recovery.failure', 'ipc.register', 'window.create'])
})

test('event forwarding attaches only after an authorized load and detaches on destruction or close', async () => {
  const { bindAgentWindowForwarding } = await import('../src/main/agent-runtime.ts')
  const handlers = new Map()
  const webContents = {
    getURL: () => webContents.url,
    isDestroyed: () => false,
    send: () => undefined,
    url: 'file:///app/renderer/index.html#/workspace/chat',
    on: (event, listener) => handlers.set(`web:${event}`, listener)
  }
  const window = {
    webContents,
    once: (event, listener) => handlers.set(`window:${event}`, listener)
  }
  let attached = 0
  let detached = 0
  const runtime = {
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    attachWebContents: () => {
      attached += 1
      return () => { detached += 1 }
    }
  }
  const dispose = bindAgentWindowForwarding(window, runtime)
  assert.equal(attached, 0)
  handlers.get('web:did-finish-load')()
  assert.equal(attached, 1)
  webContents.url = 'file:///app/renderer/index.html#/workspace/projects'
  assert.equal(attached, 1)
  handlers.get('web:destroyed')()
  assert.equal(detached, 1)
  dispose()
  handlers.get('window:closed')()
  assert.equal(detached, 1)
})

test('preload bridge exposes only named Agent methods and isolates validated event objects', async () => {
  let listener
  const invocations = []
  const ipcRenderer = {
    invoke: async (...args) => {
      invocations.push(args)
      return { ok: true, data: [] }
    },
    on: (_channel, callback) => {
      listener = callback
    },
    removeListener: () => undefined
  }
  const api = createAgentApi(ipcRenderer)
  assert.deepEqual(Object.keys(api).sort(), [
    'approveRun',
    'cancelRun',
    'createRun',
    'getEvents',
    'getRun',
    'listRuns',
    'resumeRun',
    'subscribeEvents'
  ])

  const received = []
  const unsubscribe = api.subscribeEvents((agentEvent) => {
    agentEvent.payload.changed = true
    received.push(agentEvent)
  })
  const original = eventFor()
  listener({}, original)
  listener({}, { ...original, sequence: 0 })
  unsubscribe()

  await api.createRun('A safe prompt')
  assert.deepEqual(invocations, [[AGENT_IPC_CHANNELS.createRun, 'A safe prompt']])
  assert.equal(received.length, 1)
  assert.notEqual(received[0], original)
  assert.equal(original.payload.changed, undefined)
})

test('structured Agent logger records safe metadata without prompt, output, stack or storage path', () => {
  const records = []
  const logger = createAgentLogger((record) => records.push(record))
  logger.operation({
    operation: 'createRun',
    runId: 'run-1',
    status: 'running',
    eventType: 'step.delta',
    durationMs: 12,
    errorCode: 'EXECUTION_FAILED',
    prompt: 'secret prompt',
    output: 'secret output',
    stack: 'Error: secret\n at C:\\Users\\secret',
    storagePath: 'C:\\Users\\secret\\agent-runs'
  })
  assert.deepEqual(records, [{
    operation: 'createRun',
    runId: 'run-1',
    status: 'running',
    eventType: 'step.delta',
    durationMs: 12,
    errorCode: 'EXECUTION_FAILED'
  }])
})

test('runtime recovers persisted Runs and forwards cloned events only to authorized live webContents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'open-novel-agent-ipc-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }))

  const sent = []
  const allowedWebContents = {
    getURL: () => 'file:///app/renderer/index.html',
    isDestroyed: () => false,
    send: (...args) => sent.push(args)
  }
  const foreignWebContents = {
    getURL: () => 'file:///app/renderer/foreign.html',
    isDestroyed: () => false,
    send: () => assert.fail('foreign page must not receive Agent events')
  }
  const runtime = createAgentRuntime({
    storageRoot: root,
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    logger: createAgentLogger(() => undefined)
  })
  runtime.attachWebContents(allowedWebContents)
  runtime.attachWebContents(foreignWebContents)
  const recovery = await runtime.recover()
  assert.equal(recovery.ok, true)
  assert.equal(isAllowedLiveAgentWebContents(allowedWebContents, runtime.senderPolicy), true)

  const created = await runtime.orchestrator.createRun('A safe prompt')
  assert.equal(created.ok, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sent[0][0], AGENT_IPC_CHANNELS.event)
  assert.notEqual(sent[0][1], created.data.events[0])
})

test('runtime passes an injected delay to the production Mock Executor composition', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'open-novel-agent-delay-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }))

  let delayCalls = 0
  let releaseFirstDelay
  const runtime = createAgentRuntime({
    storageRoot: root,
    senderPolicy: { appPageUrl: 'file:///app/renderer/index.html' },
    logger: createAgentLogger(() => undefined),
    executorDelay: async () => {
      delayCalls += 1
      if (delayCalls === 1) {
        await new Promise((resolve) => { releaseFirstDelay = resolve })
      }
    }
  })

  const created = await runtime.orchestrator.createRun('Observe the stream')
  assert.equal(created.ok, true)
  for (let attempt = 0; attempt < 200 && delayCalls === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.equal(delayCalls, 1)
  const paused = await runtime.orchestrator.getRun(created.data.id)
  assert.equal(paused.ok, true)
  assert.equal(paused.data.status, 'running')
  assert.equal(paused.data.output.analysis, '')

  releaseFirstDelay()
})
