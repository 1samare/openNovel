import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertContiguousEventSequences,
  assertUniqueDeltaChunks,
  redactText,
  summarizeRun
} from '../scripts/electron-smoke-diagnostics.mjs'
import {
  buildCdpEndpoint,
  findPageTarget
} from '../scripts/electron-smoke-cdp.mjs'
import {
  assertNoPlaintextModelArtifacts,
  buildAgentInvokeExpression,
  buildNamedApiInvokeExpression,
  EXPECTED_AGENT_API_KEYS,
  EXPECTED_CHAPTER_API_KEYS,
  EXPECTED_LIFECYCLE_API_KEYS,
  EXPECTED_MODEL_API_KEYS,
  EXPECTED_PROJECT_API_KEYS
} from '../scripts/electron-smoke.mjs'
import * as smokeProcess from '../scripts/electron-smoke-process.mjs'

const {
  buildElectronArgs,
  buildKillTreeArgs,
  isOwnedSmokeDirectory
} = smokeProcess

const event = (sequence, type, payload = {}) => ({
  runId: 'run-1',
  sequence,
  type,
  timestamp: '2026-07-28T00:00:00.000Z',
  payload
})

test('summarizes a run without exposing prompt, output, or delta text', () => {
  const summary = summarizeRun({
    prompt: 'private prompt',
    status: 'completed',
    events: [event(1, 'run.created'), event(2, 'step.delta', { phase: 'analysis', text: 'private draft' })],
    output: { analysis: 'private draft', final: 'private final' },
    checkpoint: { phase: 'analysis', nextChunkIndex: 1 },
    error: { code: 'EXECUTION_FAILED', message: 'private error', retryable: true }
  })

  assert.deepEqual(summary, {
    status: 'completed',
    eventCount: 2,
    eventSequences: [1, 2],
    eventTypes: ['run.created', 'step.delta'],
    deltaCount: 1,
    deltaLengths: [13],
    checkpoint: { phase: 'analysis', nextChunkIndex: 1 },
    errorCode: 'EXECUTION_FAILED'
  })
  assert.doesNotMatch(JSON.stringify(summary), /private/)
})

test('rejects non-contiguous event sequences and duplicate delta chunks', () => {
  assert.doesNotThrow(() => assertContiguousEventSequences([event(1, 'run.created'), event(2, 'run.started')]))
  assert.throws(
    () => assertContiguousEventSequences([event(1, 'run.created'), event(3, 'run.started')]),
    /contiguous/i
  )
  assert.doesNotThrow(() => assertUniqueDeltaChunks([
    event(1, 'step.delta', { phase: 'analysis', text: 'one' }),
    event(2, 'step.delta', { phase: 'analysis', text: 'two' })
  ]))
  assert.throws(
    () => assertUniqueDeltaChunks([
      event(1, 'step.delta', { phase: 'analysis', text: 'same' }),
      event(2, 'step.delta', { phase: 'analysis', text: 'same' })
    ]),
    /duplicate/i
  )
})

test('redacts absolute paths and sensitive key-value text from diagnostics', () => {
  const redacted = redactText('path=C:\\Users\\alice\\agent-runs\\run.json prompt=private output=private')

  assert.doesNotMatch(redacted, /C:\\Users\\alice/)
  assert.doesNotMatch(redacted, /private/)
  assert.match(redacted, /\[redacted\]/)
})

test('builds a production Electron command with isolated userData and CDP port', () => {
  assert.deepEqual(buildElectronArgs({
    mainPath: 'D:\\repo\\out\\main\\index.js',
    userDataDir: 'D:\\temp\\open-novel-electron-smoke-1',
    port: 9222
  }), [
    'D:\\repo\\out\\main\\index.js',
    '--user-data-dir=D:\\temp\\open-novel-electron-smoke-1',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9222'
  ])
  assert.deepEqual(buildKillTreeArgs(4321), ['/PID', '4321', '/T', '/F'])
  assert.equal(isOwnedSmokeDirectory('D:\\temp\\open-novel-electron-smoke-1'), true)
  assert.equal(isOwnedSmokeDirectory('D:\\temp\\unrelated'), false)
})

test('builds a Windows npm invocation without spawning npm.cmd directly', () => {
  const invocation = smokeProcess.buildNpmScriptInvocation?.('build', {
    platform: 'win32',
    nodeExecutable: 'C:\\node.exe',
    npmExecutable: 'C:\\npm-cli.js'
  })

  assert.deepEqual(invocation, {
    command: 'C:\\node.exe',
    args: ['C:\\npm-cli.js', 'run', 'build']
  })
})

test('builds the CDP endpoint and selects only a live page target', () => {
  assert.equal(buildCdpEndpoint('127.0.0.1', 9222, '/json/list'), 'http://127.0.0.1:9222/json/list')
  assert.deepEqual(findPageTarget([
    { type: 'other', url: 'devtools://devtools', webSocketDebuggerUrl: 'ws://other' },
    { type: 'page', url: 'file:///out/renderer/index.html#/workspace/chat', webSocketDebuggerUrl: 'ws://page' }
  ]), {
    type: 'page',
    url: 'file:///out/renderer/index.html#/workspace/chat',
    webSocketDebuggerUrl: 'ws://page'
  })
  assert.throws(() => findPageTarget([{ type: 'page', url: 'file:///out/renderer/index.html' }]), /target/i)
})

test('builds an isolated page expression for invoking a named Agent API', () => {
  assert.deepEqual(EXPECTED_AGENT_API_KEYS, [
    'approveRun',
    'cancelRun',
    'createRun',
    'getEvents',
    'getRun',
    'listRuns',
    'resumeRun',
    'subscribeEvents'
  ])
  const expression = buildAgentInvokeExpression('getRun', ['run-1'])
  assert.match(expression, /window\.openNovel\.agent/)
  assert.match(expression, /getRun/)
  assert.match(expression, /run-1/)

  assert.deepEqual(EXPECTED_PROJECT_API_KEYS, [
    'backup', 'close', 'create', 'listRecent', 'open', 'openRecent', 'removeRecent', 'rename', 'restoreBackup'
  ])
  assert.deepEqual(EXPECTED_CHAPTER_API_KEYS, [
    'confirmImport', 'confirmVersion', 'create', 'exportBook', 'list', 'listVersions', 'load',
    'move', 'previewImport', 'remove', 'rename', 'restoreVersion', 'saveDraft'
  ])
  assert.deepEqual(EXPECTED_LIFECYCLE_API_KEYS, ['completeFlush', 'onFlushRequest'])
  assert.deepEqual(EXPECTED_MODEL_API_KEYS, [
    'cancelConnectionTest', 'getBindings', 'listConnections', 'listModels', 'listProfiles',
    'saveBindings', 'saveConnection', 'saveProfile', 'testConnection'
  ])
  const chapterExpression = buildNamedApiInvokeExpression('chapters', 'list', [])
  assert.match(chapterExpression, /window\.openNovel\[['"]chapters['"]\]/)
  assert.match(chapterExpression, /list/)
  const modelExpression = buildNamedApiInvokeExpression('models', 'listConnections', [])
  assert.match(modelExpression, /window\.openNovel\[['"]models['"]\]/)
  assert.match(modelExpression, /listConnections/)
})

test('rejects plaintext secrets in persisted model artifacts before smoke cleanup', async (t) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'open-novel-model-artifacts-'))
  t.after(() => rm(userDataDir, { recursive: true, force: true }))
  await mkdir(join(userDataDir, 'model-secrets'))
  await writeFile(join(userDataDir, 'model-secrets', 'connection.bin'), Buffer.from([1, 2, 3, 4]))
  await writeFile(join(userDataDir, 'control.sqlite3'), 'safe metadata')

  await assertNoPlaintextModelArtifacts(userDataDir, 'smoke-secret-sentinel')
  await writeFile(join(userDataDir, 'control.sqlite3-wal'), 'smoke-secret-sentinel')
  await assert.rejects(
    assertNoPlaintextModelArtifacts(userDataDir, 'smoke-secret-sentinel'),
    /plaintext model secret/i
  )
})
