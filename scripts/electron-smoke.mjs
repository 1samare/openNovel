import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  assertContiguousEventSequences,
  assertUniqueDeltaChunks,
  redactText,
  summarizeRun,
  writeDiagnostics
} from './electron-smoke-diagnostics.mjs'
import { connectCdp, waitForPageTarget } from './electron-smoke-cdp.mjs'
import {
  allocatePort,
  buildNpmScriptInvocation,
  createSmokeUserDataDirectory,
  removeSmokeUserDataDirectory,
  runCommand,
  spawnElectronProcess,
  terminateProcessTree,
  waitForExit
} from './electron-smoke-process.mjs'

export const EXPECTED_AGENT_API_KEYS = [
  'approveRun',
  'cancelRun',
  'createRun',
  'getEvents',
  'getRun',
  'listRuns',
  'resumeRun',
  'subscribeEvents'
]
export const EXPECTED_PROJECT_API_KEYS = [
  'backup',
  'close',
  'create',
  'listRecent',
  'open',
  'openRecent',
  'removeRecent',
  'rename',
  'restoreBackup'
]
export const EXPECTED_CHAPTER_API_KEYS = [
  'confirmImport',
  'confirmVersion',
  'create',
  'exportBook',
  'list',
  'listVersions',
  'load',
  'move',
  'previewImport',
  'remove',
  'rename',
  'restoreVersion',
  'saveDraft'
]
export const EXPECTED_LIFECYCLE_API_KEYS = ['completeFlush', 'onFlushRequest']

const SMOKE_INTERVAL_MS = 100
const BUILD_TIMEOUT_MS = 120000
const START_TIMEOUT_MS = 30000
const SCENARIO_TIMEOUT_MS = 30000
const CLOSE_TIMEOUT_MS = 10000
const CANCEL_SETTLE_MS = 700

const APPROVAL_EVENT_TYPES = [
  'run.created',
  'run.started',
  'step.started',
  'step.delta',
  'step.delta',
  'step.completed',
  'approval.requested',
  'approval.resolved',
  'step.started',
  'step.delta',
  'step.delta',
  'step.completed',
  'run.completed'
]

const RECOVERY_EVENT_TYPES = [
  'run.created',
  'run.started',
  'step.started',
  'step.delta',
  'run.interrupted',
  'run.resumed',
  'step.started',
  'step.delta',
  'step.completed',
  'approval.requested',
  'approval.resolved',
  'step.started',
  'step.delta',
  'step.delta',
  'step.completed',
  'run.completed'
]

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

export const buildNamedApiInvokeExpression = (namespace, method, args) =>
  `(async () => window.openNovel[${JSON.stringify(namespace)}][${JSON.stringify(method)}](...${JSON.stringify(args)}))()`

export const buildAgentInvokeExpression = (method, args) =>
  `(async () => window.openNovel.agent[${JSON.stringify(method)}](...${JSON.stringify(args)}))()`

const drainExpression = `(() => {
  const events = Array.isArray(window.__openNovelSmokeEvents) ? window.__openNovelSmokeEvents : []
  window.__openNovelSmokeEvents = []
  return events
})()`

const assertAgentSuccess = (result, label) => {
  if (result?.ok !== true) {
    throw new Error(`${label} returned ${result?.error?.code ?? 'an invalid result'}`)
  }
  return result.data
}

const waitFor = async (operation, label, timeoutMs = SCENARIO_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await delay(SMOKE_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for ${label}${lastError === undefined ? '' : `: ${lastError.message}`}`)
}

const invoke = async (session, method, args = []) =>
  session.cdp.evaluate(buildAgentInvokeExpression(method, args))

const drainEvents = async (session) => {
  if (session.cdp === undefined) return []
  const events = await session.cdp.evaluate(drainExpression)
  if (!Array.isArray(events)) return []
  session.liveEvents.push(...events)
  return events
}

const installEventProbe = async (session) => {
  const type = await session.cdp.evaluate(`(() => {
    window.__openNovelSmokeEvents = []
    window.__openNovelSmokeUnsubscribe = window.openNovel.agent.subscribeEvents((event) => {
      window.__openNovelSmokeEvents.push(event)
    })
    return typeof window.__openNovelSmokeUnsubscribe
  })()`)
  assert.equal(type, 'function', 'subscribeEvents must return an unsubscribe function')
}

const verifyNamedApi = async (session, namespace, expectedKeys, label) => {
  const expectedKeysJson = JSON.stringify(expectedKeys)
  const keys = await waitFor(async () => {
    const actual = await session.cdp.evaluate(
      `Object.keys(window.openNovel?.[${JSON.stringify(namespace)}] ?? {}).sort()`
    )
    return JSON.stringify(actual) === expectedKeysJson ? actual : undefined
  }, label, START_TIMEOUT_MS)
  assert.deepEqual(keys, expectedKeys)

  const allFunctions = await session.cdp.evaluate(`(() => {
    const api = window.openNovel[${JSON.stringify(namespace)}]
    return ${expectedKeysJson}.every((key) => typeof api[key] === 'function')
  })()`)
  assert.equal(allFunctions, true, `all ${namespace} Preload APIs must be functions`)
}

const verifyPreloadApis = async (session) => {
  await verifyNamedApi(session, 'agent', EXPECTED_AGENT_API_KEYS, 'the eight Preload Agent APIs')
  await verifyNamedApi(session, 'projects', EXPECTED_PROJECT_API_KEYS, 'the nine Preload Project APIs')
  await verifyNamedApi(session, 'chapters', EXPECTED_CHAPTER_API_KEYS, 'the thirteen Preload Chapter APIs')
  await verifyNamedApi(session, 'lifecycle', EXPECTED_LIFECYCLE_API_KEYS, 'the two Preload lifecycle APIs')

  const recent = await session.cdp.evaluate(buildNamedApiInvokeExpression('projects', 'listRecent', []))
  assert.equal(recent?.ok, true, 'projects.listRecent must succeed in an isolated profile')
  assert.deepEqual(recent.data, [])
  const chapters = await session.cdp.evaluate(buildNamedApiInvokeExpression('chapters', 'list', []))
  assert.equal(chapters?.ok, false, 'chapters.list must fail safely before opening a project')
  assert.equal(chapters?.error?.code, 'PROJECT_NOT_OPEN')
  await installEventProbe(session)
}

const startSession = async (cwd, userDataDir, state) => {
  const port = await allocatePort()
  const processRecord = spawnElectronProcess({ cwd, userDataDir, port })
  state.processRecords.push(processRecord)
  const session = {
    processRecord,
    port,
    cdp: undefined,
    liveEvents: []
  }
  try {
    const target = await waitForPageTarget({ port, timeoutMs: START_TIMEOUT_MS })
    session.cdp = await connectCdp(target.webSocketDebuggerUrl)
    session.cdp.on('Runtime.consoleAPICalled', (params) => {
      state.console.push(`console.${params.type ?? 'unknown'} args=${params.args?.length ?? 0}`)
    })
    session.cdp.on('Runtime.exceptionThrown', () => {
      state.console.push('runtime.exceptionThrown')
    })
    await verifyPreloadApis(session)
    state.sessions.push(session)
    return session
  } catch (error) {
    await closeSession(session)
    throw error
  }
}

const closeSession = async (session) => {
  if (session === undefined) return
  if (session.cdp !== undefined) {
    await Promise.race([
      session.cdp.call('Page.close'),
      delay(2000)
    ]).catch(() => undefined)
    session.cdp.close()
    session.cdp = undefined
  }
  await waitForExit(session.processRecord, CLOSE_TIMEOUT_MS).catch(() => undefined)
  await terminateProcessTree(session.processRecord, CLOSE_TIMEOUT_MS)
}

const getRun = async (session, state, id) => {
  const run = assertAgentSuccess(await invoke(session, 'getRun', [id]), 'getRun')
  state.runSummaries[id] = summarizeRun(run)
  return run
}

const getEvents = async (session, state, id) => {
  const events = assertAgentSuccess(await invoke(session, 'getEvents', [id, 0]), 'getEvents')
  state.runSummaries[id] = summarizeRun({
    ...(state.rawRuns?.[id] ?? {}),
    events
  })
  return events
}

const createRun = async (session, prompt) => {
  const run = assertAgentSuccess(await invoke(session, 'createRun', [prompt]), 'createRun')
  assert.equal(typeof run.id, 'string')
  return run.id
}

const waitForRun = async (session, state, id, predicate, label) =>
  waitFor(async () => {
    await drainEvents(session)
    const run = await getRun(session, state, id)
    return predicate(run) ? run : undefined
  }, label)

const assertRunEvents = (events, expectedTypes, label) => {
  assertContiguousEventSequences(events, label)
  assertUniqueDeltaChunks(events, label)
  assert.deepEqual(events.map((event) => event.type), expectedTypes, `${label} event types`)
}

const runApprovalScenario = async (session, state) => {
  state.stage = 'approval'
  const id = await createRun(session, 'electron smoke approval fixture')
  await waitForRun(session, state, id, (run) => run.status === 'awaiting_approval', 'approval request')
  assertAgentSuccess(await invoke(session, 'approveRun', [id]), 'approveRun')
  const completed = await waitForRun(session, state, id, (run) => run.status === 'completed', 'approval completion')
  const events = await getEvents(session, state, id)
  state.rawRuns = { ...(state.rawRuns ?? {}), [id]: completed }
  assertRunEvents(events, APPROVAL_EVENT_TYPES, 'approval Run')
  assert.equal(completed.output.final.length > 0, true)
}

const runCancellationScenario = async (session, state) => {
  state.stage = 'cancel'
  const id = await createRun(session, 'electron smoke cancellation fixture')
  await waitForRun(session, state, id, (run) => run.status === 'running' &&
    run.events.some((event) => event.type === 'step.delta'), 'running cancellation checkpoint')
  assertAgentSuccess(await invoke(session, 'cancelRun', [id]), 'cancelRun')
  const cancelled = await waitForRun(session, state, id, (run) => run.status === 'cancelled', 'cancelled Run')
  await delay(CANCEL_SETTLE_MS)
  const settled = await getRun(session, state, id)
  assert.equal(settled.status, 'cancelled')
  assert.equal(settled.events.at(-1)?.type, 'run.cancelled')
  assert.deepEqual(settled.events, cancelled.events)
  assertRunEvents(settled.events, [
    'run.created',
    'run.started',
    'step.started',
    'step.delta',
    'run.cancelled'
  ], 'cancelled Run')
}

const runRecoveryScenario = async (session, state, cwd, userDataDir) => {
  state.stage = 'recovery-before-close'
  const id = await createRun(session, 'electron smoke recovery fixture')
  const beforeClose = await waitForRun(session, state, id, (run) => run.status === 'running' &&
    run.checkpoint.phase === 'analysis' &&
    run.checkpoint.nextChunkIndex === 1 &&
    run.events.filter((event) => event.type === 'step.delta').length === 1, 'running recovery checkpoint')
  const beforeEvents = await getEvents(session, state, id)
  assertRunEvents(beforeEvents, [
    'run.created',
    'run.started',
    'step.started',
    'step.delta'
  ], 'pre-restart Run')
  assert.equal(beforeClose.output.analysis.length > 0, true)

  await closeSession(session)
  state.stage = 'recovery-after-restart'
  const restarted = await startSession(cwd, userDataDir, state)
  const interrupted = await waitForRun(restarted, state, id, (run) => run.status === 'interrupted' &&
    run.events.at(-1)?.type === 'run.interrupted', 'interrupted Run')
  assert.equal(interrupted.checkpoint.nextChunkIndex, 1)
  assertAgentSuccess(await invoke(restarted, 'resumeRun', [id]), 'resumeRun')
  await waitForRun(restarted, state, id, (run) => run.status === 'awaiting_approval', 'resumed approval request')
  assertAgentSuccess(await invoke(restarted, 'approveRun', [id]), 'approveRun after resume')
  const completed = await waitForRun(restarted, state, id, (run) => run.status === 'completed', 'resumed completion')
  const events = await getEvents(restarted, state, id)
  assertRunEvents(events, RECOVERY_EVENT_TYPES, 'recovered Run')
  assert.equal(events.filter((event) => event.type === 'step.delta').length, 4)
  assert.equal(completed.output.analysis.length > beforeClose.output.analysis.length, true)
  return restarted
}

const runBuild = async (cwd, state) => {
  const invocation = buildNpmScriptInvocation('build')
  try {
    return await runCommand(invocation.command, invocation.args, { cwd, timeoutMs: BUILD_TIMEOUT_MS })
  } catch (error) {
    if (error.record !== undefined) state.processRecords.push(error.record)
    throw error
  }
}

const diagnosticDirectory = () => process.env.ELECTRON_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'open-novel-electron-smoke-diagnostics')

export const runSmoke = async ({ cwd = resolve(fileURLToPath(new URL('..', import.meta.url))) } = {}) => {
  const state = {
    stage: 'initializing',
    sessions: [],
    processRecords: [],
    runSummaries: {},
    rawRuns: {},
    console: [],
    cleanup: []
  }
  let userDataDir
  let currentSession
  let failure

  try {
    state.stage = 'build'
    const build = await runBuild(cwd, state)
    state.processRecords.push(build)
    userDataDir = await createSmokeUserDataDirectory()
    state.stage = 'startup'
    currentSession = await startSession(cwd, userDataDir, state)
    assertAgentSuccess(await invoke(currentSession, 'listRuns'), 'listRuns')
    await runApprovalScenario(currentSession, state)
    await runCancellationScenario(currentSession, state)
    currentSession = await runRecoveryScenario(currentSession, state, cwd, userDataDir)
    await drainEvents(currentSession)
  } catch (error) {
    failure = error
  }

  try {
    await closeSession(currentSession)
  } catch (error) {
    state.cleanup.push(`session cleanup failed: ${redactText(error.message)}`)
  }
  if (userDataDir !== undefined) {
    try {
      await removeSmokeUserDataDirectory(userDataDir)
      state.cleanup.push('userData removed')
    } catch (error) {
      state.cleanup.push(`userData cleanup failed: ${redactText(error.message)}`)
      if (failure === undefined) failure = error
    }
  }

  if (failure !== undefined) {
    const diagnostic = {
      status: 'failed',
      stage: state.stage,
      errorCode: failure.code ?? 'ELECTRON_SMOKE_FAILED',
      errorMessage: failure.message,
      runs: state.runSummaries,
      process: state.processRecords.map((record) => ({
        command: record.command,
        pid: record.child.pid,
        exitCode: record.child.exitCode,
        signalCode: record.child.signalCode
      })),
      cleanup: state.cleanup,
      console: state.console.join('\n'),
      stdout: state.processRecords.map((record) => record.logs.stdout).join('\n'),
      stderr: state.processRecords.map((record) => record.logs.stderr).join('\n')
    }
    const directory = diagnosticDirectory()
    await writeDiagnostics(directory, diagnostic)
    const error = new Error(`Electron smoke failed at ${state.stage}: ${redactText(failure.message)}`)
    error.cause = failure
    error.diagnosticDirectory = directory
    throw error
  }

  return { ok: true, runs: state.runSummaries }
}

const isDirectExecution = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  runSmoke()
    .then(() => {
      console.log('Electron production smoke passed')
    })
    .catch((error) => {
      console.error(redactText(error.message))
      if (error.diagnosticDirectory !== undefined) {
        console.error(`Diagnostics: ${error.diagnosticDirectory}`)
      }
      process.exitCode = 1
    })
}
