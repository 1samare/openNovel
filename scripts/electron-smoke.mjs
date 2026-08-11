import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
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
export const EXPECTED_MODEL_API_KEYS = [
  'cancelConnectionTest',
  'getBindings',
  'listConnections',
  'listModels',
  'listProfiles',
  'saveBindings',
  'saveConnection',
  'saveProfile',
  'testConnection'
]
export const EXPECTED_BIBLE_API_KEYS = [
  'cancelGeneration',
  'decideProposal',
  'generateProposals',
  'getSnapshot',
  'listVersions',
  'moveOutlineNode',
  'restoreVersion',
  'saveEntry',
  'saveOutlineNode',
  'saveProfile'
]
export const EXPECTED_LIFECYCLE_API_KEYS = ['completeFlush', 'onFlushRequest']

const SMOKE_MODEL_ID = 'smoke-model'
const SMOKE_MODEL_SECRET = 'local-smoke-secret'

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

const listFiles = async (directory) => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  }))
  return nested.flat()
}

export const assertNoPlaintextModelArtifacts = async (userDataDir, secret) => {
  assert.equal(typeof secret, 'string')
  assert.equal(secret.length > 0, true)
  const controlArtifacts = [
    join(userDataDir, 'control.sqlite3'),
    join(userDataDir, 'control.sqlite3-wal'),
    join(userDataDir, 'control.sqlite3-shm')
  ]
  const secretArtifacts = await listFiles(join(userDataDir, 'model-secrets'))
  const sentinel = Buffer.from(secret, 'utf8')
  for (const artifact of [...controlArtifacts, ...secretArtifacts]) {
    let bytes
    try {
      bytes = await readFile(artifact)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    assert.equal(
      bytes.includes(sentinel),
      false,
      'plaintext model secret found in persisted artifacts'
    )
  }
}

const startFakeModelProvider = async () => {
  const server = createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = chunks.length === 0
        ? {}
        : JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (request.headers.authorization !== `Bearer ${SMOKE_MODEL_SECRET}`) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { code: 'invalid_api_key' } }))
        return
      }
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: SMOKE_MODEL_ID, name: 'Smoke Model' }] }))
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const serialized = JSON.stringify(body)
        const replacement = /SMOKE_REPLACE entity=([A-Za-z0-9_-]+) version=([A-Za-z0-9_-]+) genre=(urban-campus|sci-fi-future)/.exec(serialized)
        const rejection = /SMOKE_REJECT genre=(urban-campus|sci-fi-future)/.exec(serialized)
        const character = /SMOKE_CHARACTER genre=(urban-campus|sci-fi-future)/.exec(serialized)
        const plot = /SMOKE_PLOT parent=([A-Za-z0-9_-]+) character=([A-Za-z0-9_-]+) position=([0-9]+) genre=(urban-campus|sci-fi-future)/.exec(serialized)
        let content = 'OK'
        if (replacement !== null) {
          const [, entityId, versionId, genre] = replacement
          content = JSON.stringify({
            proposals: [{
              operation: 'update',
              targetEntityId: entityId,
              sourceVersionId: versionId,
              title: `${genre} 结构化替代`,
              rationale: '以明确规则强化题材辨识度',
              impact: '更新世界核心约束并影响前三章行动',
              priority: 5,
              affectedEntityIds: [entityId],
              conflicts: [{
                field: 'summary',
                oldValue: '手工确认的初始规则',
                newValue: '经用户确认的结构化规则',
                sourceVersionId: versionId,
                affectedEntityIds: [entityId]
              }],
              entry: {
                kind: 'world-setting',
                title: `${genre} 核心规则`,
                summary: '经用户确认的结构化规则',
                fields: [{ key: 'constraint', label: '约束', value: '规则必须在前三章产生可观察代价' }],
                relatedEntityIds: []
              }
            }]
          })
        } else if (character !== null) {
          const genre = character[1]
          const name = genre === 'urban-campus' ? '林夏' : '顾星河'
          content = JSON.stringify({
            proposals: [{
              operation: 'create', targetEntityId: null, sourceVersionId: null,
              title: `${name}人物档案`, rationale: '建立承担前三章选择的主要人物',
              impact: '约束人物目标、代价与章节行动', priority: 5,
              affectedEntityIds: [], conflicts: [],
              entry: {
                kind: 'character', title: name, summary: '承担前三章核心选择的主要人物',
                fields: [{ key: 'goal', label: '目标', value: '查明异常并保护同伴' }],
                relatedEntityIds: []
              }
            }]
          })
        } else if (plot !== null) {
          const [, parentId, characterId, rawPosition, genre] = plot
          const position = Number(rawPosition)
          content = JSON.stringify({
            proposals: [{
              operation: 'create', targetEntityId: null, sourceVersionId: null,
              title: `${genre} 第${position + 1}章规划`, rationale: '用结构化目标推进前三章因果链',
              impact: '明确本章目标、冲突、转折和钩子', priority: 5,
              affectedEntityIds: [parentId, characterId], conflicts: [],
              outline: {
                kind: 'chapter-plan', parentId, title: `第${position + 1}章规划`,
                summary: '阶段四结构化共创章节规划', goal: '建立目标与代价',
                conflict: '主角必须在真相和安全之间选择', turningPoint: '第一条可靠证据出现',
                hook: '证据指向更大的秘密', targetWords: 2000,
                participantCharacterIds: [characterId], position
              }
            }]
          })
        } else if (rejection !== null) {
          const genre = rejection[1]
          content = JSON.stringify({
            proposals: [{
              operation: 'create',
              targetEntityId: null,
              sourceVersionId: null,
              title: `${genre} 待拒绝候选`,
              rationale: '用于验证拒绝隔离',
              impact: '若批准将增加一条世界设定',
              priority: 3,
              affectedEntityIds: [],
              conflicts: [],
              entry: {
                kind: 'world-setting',
                title: `${genre} 待拒绝候选`,
                summary: '这条候选不得进入权威资料',
                fields: [],
                relatedEntityIds: []
              }
            }]
          })
        }
        response.writeHead(200, {
          'content-type': 'application/json',
          'x-request-id': 'smoke-provider-request'
        })
        response.end(JSON.stringify({
          id: 'smoke-completion',
          object: 'chat.completion',
          created: 1,
          model: SMOKE_MODEL_ID,
          choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
        }))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'not_found' } }))
    } catch {
      response.destroy()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.equal(typeof address, 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    }
  }
}

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
  let observedKeys = []
  let keys
  try {
    keys = await waitFor(async () => {
      const actual = await session.cdp.evaluate(
        `Object.keys(window.openNovel?.[${JSON.stringify(namespace)}] ?? {}).sort()`
      )
      observedKeys = actual
      return JSON.stringify(actual) === expectedKeysJson ? actual : undefined
    }, label, START_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`${error.message}; observed ${namespace} keys: ${JSON.stringify(observedKeys)}`)
  }
  assert.deepEqual(keys, expectedKeys)

  const allFunctions = await session.cdp.evaluate(`(() => {
    const api = window.openNovel[${JSON.stringify(namespace)}]
    return ${expectedKeysJson}.every((key) => typeof api[key] === 'function')
  })()`)
  assert.equal(allFunctions, true, `all ${namespace} Preload APIs must be functions`)
}

const assertModelSuccess = (result, label) => {
  assert.equal(result?.ok, true, `${label} must succeed`)
  return result.data
}

const assertBibleSuccess = (result, label) => {
  assert.equal(result?.ok, true, `${label} must succeed`)
  return result.data
}

const verifyModelApi = async (session, modelBaseUrl) => {
  let connections = assertModelSuccess(
    await session.cdp.evaluate(buildNamedApiInvokeExpression('models', 'listConnections', [])),
    'models.listConnections'
  )
  let profiles = assertModelSuccess(
    await session.cdp.evaluate(buildNamedApiInvokeExpression('models', 'listProfiles', [])),
    'models.listProfiles'
  )
  if (connections.length === 0) {
    const connection = assertModelSuccess(await session.cdp.evaluate(buildNamedApiInvokeExpression(
      'models',
      'saveConnection',
      [{
        name: 'Smoke OpenAI-compatible',
        kind: 'openai-compatible',
        baseUrl: modelBaseUrl,
        apiKey: SMOKE_MODEL_SECRET,
        enabled: true
      }]
    )), 'models.saveConnection')
    assert.equal(JSON.stringify(connection).includes(SMOKE_MODEL_SECRET), false)
    assertModelSuccess(await session.cdp.evaluate(buildNamedApiInvokeExpression(
      'models',
      'saveProfile',
      [{
        connectionId: connection.id,
        label: 'Smoke Profile',
        modelId: SMOKE_MODEL_ID,
        temperature: 0.5,
        maxOutputTokens: 128,
        contextWindow: 4096,
        capabilities: ['stream-text', 'structured-output', 'usage']
      }]
    )), 'models.saveProfile')
    connections = assertModelSuccess(
      await session.cdp.evaluate(buildNamedApiInvokeExpression('models', 'listConnections', [])),
      'models.listConnections after save'
    )
    profiles = assertModelSuccess(
      await session.cdp.evaluate(buildNamedApiInvokeExpression('models', 'listProfiles', [])),
      'models.listProfiles after save'
    )
  }
  assert.equal(connections.length, 1, 'the encrypted connection must persist across restart')
  assert.equal(profiles.length, 1, 'the model profile must persist across restart')
  assert.equal(JSON.stringify([connections, profiles]).includes(SMOKE_MODEL_SECRET), false)
  const connection = connections[0]
  const tested = assertModelSuccess(await session.cdp.evaluate(buildNamedApiInvokeExpression(
    'models',
    'testConnection',
    [{ requestId: `electron-smoke-model-test-${Date.now()}`, connectionId: connection.id, modelId: SMOKE_MODEL_ID }]
  )), 'models.testConnection')
  assert.equal(tested.authenticated, true)
  assert.deepEqual(tested.capabilities, ['usage'])
  const listed = assertModelSuccess(await session.cdp.evaluate(buildNamedApiInvokeExpression(
    'models', 'listModels', [connection.id]
  )), 'models.listModels')
  assert.deepEqual(listed, [{ id: SMOKE_MODEL_ID, label: 'Smoke Model' }])

  const bindings = await session.cdp.evaluate(buildNamedApiInvokeExpression('models', 'getBindings', []))
  assert.equal(bindings?.ok, false, 'models.getBindings must fail safely before opening a project')
  assert.equal(bindings?.error?.code, 'MODEL_OPERATION_FAILED')
  return profiles[0]
}

const verifyPreloadApis = async (session, modelBaseUrl, expectedProjectIds) => {
  await verifyNamedApi(session, 'agent', EXPECTED_AGENT_API_KEYS, 'the eight Preload Agent APIs')
  await verifyNamedApi(session, 'projects', EXPECTED_PROJECT_API_KEYS, 'the nine Preload Project APIs')
  await verifyNamedApi(session, 'chapters', EXPECTED_CHAPTER_API_KEYS, 'the thirteen Preload Chapter APIs')
  await verifyNamedApi(session, 'models', EXPECTED_MODEL_API_KEYS, 'the nine Preload Model APIs')
  await verifyNamedApi(session, 'novelBible', EXPECTED_BIBLE_API_KEYS, 'the ten Preload Bible APIs')
  await verifyNamedApi(session, 'lifecycle', EXPECTED_LIFECYCLE_API_KEYS, 'the two Preload lifecycle APIs')

  const recent = await session.cdp.evaluate(buildNamedApiInvokeExpression('projects', 'listRecent', []))
  assert.equal(recent?.ok, true, 'projects.listRecent must succeed in an isolated profile')
  assert.deepEqual(
    recent.data.map((project) => project.projectId).sort(),
    [...expectedProjectIds].sort(),
    'the two seeded smoke projects must be available'
  )
  const chapters = await session.cdp.evaluate(buildNamedApiInvokeExpression('chapters', 'list', []))
  assert.equal(chapters?.ok, false, 'chapters.list must fail safely before opening a project')
  assert.equal(chapters?.error?.code, 'PROJECT_NOT_OPEN')
  const bible = await session.cdp.evaluate(buildNamedApiInvokeExpression('novelBible', 'getSnapshot', []))
  assert.equal(bible?.ok, false, 'novelBible.getSnapshot must fail safely before opening a project')
  assert.equal(bible?.error?.code, 'BIBLE_NOT_AVAILABLE')
  const modelProfile = await verifyModelApi(session, modelBaseUrl)
  await installEventProbe(session)
  return { recentProjects: recent.data, modelProfile }
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
    state.console.push(`page.target ${redactText(target.url)}`)
    session.cdp = await connectCdp(target.webSocketDebuggerUrl)
    session.cdp.on('Runtime.consoleAPICalled', (params) => {
      state.console.push(`console.${params.type ?? 'unknown'} args=${params.args?.length ?? 0}`)
    })
    session.cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails ?? {}
      const description = details.exception?.description ?? details.text ?? 'unknown exception'
      state.console.push(`runtime.exceptionThrown ${redactText(description)}`)
    })
    const preload = await verifyPreloadApis(
      session,
      state.modelBaseUrl,
      state.seededProjects.map((project) => project.projectId)
    )
    session.recentProjects = preload.recentProjects
    session.modelProfile = preload.modelProfile
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

const invokeNamed = (session, namespace, method, args = []) =>
  session.cdp.evaluate(buildNamedApiInvokeExpression(namespace, method, args))

const saveOutlineFixture = async (session, draft) => {
  const snapshot = assertBibleSuccess(await invokeNamed(
    session,
    'novelBible',
    'saveOutlineNode',
    [{ nodeId: null, expectedVersionId: null, draft }]
  ), `novelBible.saveOutlineNode ${draft.kind}`)
  return snapshot.outline.find((node) => node.kind === draft.kind && node.title === draft.title)
}

const runBibleGenreScenario = async (session, state, project) => {
  state.stage = `bible-${project.key}`
  assertModelSuccess(
    await invokeNamed(session, 'projects', 'openRecent', [project.projectId]),
    `projects.openRecent ${project.key}`
  )
  const route = (role) => ({
    role,
    mode: 'standard',
    primaryProfileId: session.modelProfile.id,
    fallbackProfileIds: [],
    allowCrossProviderFallback: false
  })
  assertModelSuccess(await invokeNamed(session, 'models', 'saveBindings', [{
    modeDefaults: [],
    roleBindings: ['setting', 'character', 'plot'].map(route),
    confirmCrossProviderRouting: false
  }]), `models.saveBindings ${project.key}`)

  let snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'saveProfile', [{
    expectedVersionId: null,
    draft: {
      genre: project.key,
      audience: '青年读者',
      theme: project.key === 'urban-campus' ? '成长与选择' : '技术与人性',
      narrativePov: '第三人称限知',
      tone: '克制而有悬念',
      styleSample: '风穿过走廊，留下尚未解答的回声。',
      bannedExpressions: ['命运的齿轮']
    }
  }]), `novelBible.saveProfile ${project.key}`)
  assert.equal(snapshot.profile.genre, project.key)

  snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'saveEntry', [{
    entryId: null,
    expectedVersionId: null,
    draft: {
      kind: 'world-setting',
      title: `${project.key} 核心规则`,
      summary: '手工确认的初始规则',
      fields: [{ key: 'constraint', label: '约束', value: '所有异常都必须留下可验证线索' }],
      relatedEntityIds: []
    }
  }]), `novelBible.saveEntry world ${project.key}`)
  const world = snapshot.entries.find((entry) => entry.kind === 'world-setting')
  assert.ok(world)
  const initialWorldVersionId = world.currentVersionId

  const characterProposals = assertBibleSuccess(await invokeNamed(
    session, 'novelBible', 'generateProposals', [{
      requestId: `smoke-character-${project.key}`, domain: 'character', mode: 'standard',
      request: `SMOKE_CHARACTER genre=${project.key}`, targetEntityId: null
    }]
  ), `novelBible.generateProposals character ${project.key}`)
  assert.equal(characterProposals.length, 1)
  snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'decideProposal', [{
    proposalId: characterProposals[0].id, decision: 'approve', confirmReplacement: false
  }]), `novelBible.decideProposal character ${project.key}`)
  const character = snapshot.entries.find((entry) => entry.kind === 'character')
  assert.ok(character)
  assert.equal(character.authorityStatus, 'approved')

  const outlineBase = {
    summary: '阶段四生产验收大纲',
    goal: '建立目标与代价',
    conflict: '主角必须在真相和安全之间选择',
    turningPoint: '第一条可靠证据出现',
    hook: '证据指向更大的秘密',
    targetWords: 2000,
    participantCharacterIds: [character.id]
  }
  const story = await saveOutlineFixture(session, {
    ...outlineBase, kind: 'story', parentId: null, title: '故事总纲', position: 0
  })
  assert.ok(story)
  const volume = await saveOutlineFixture(session, {
    ...outlineBase, kind: 'volume', parentId: story.id, title: '第一卷', position: 0
  })
  assert.ok(volume)
  const stage = await saveOutlineFixture(session, {
    ...outlineBase, kind: 'stage', parentId: volume.id, title: '开端阶段', position: 0
  })
  assert.ok(stage)
  for (let index = 0; index < 3; index += 1) {
    const plotProposals = assertBibleSuccess(await invokeNamed(
      session, 'novelBible', 'generateProposals', [{
        requestId: `smoke-plot-${project.key}-${index}`, domain: 'plot', mode: 'standard',
        request: `SMOKE_PLOT parent=${stage.id} character=${character.id} position=${index} genre=${project.key}`,
        targetEntityId: null
      }]
    ), `novelBible.generateProposals plot ${project.key} ${index}`)
    assert.equal(plotProposals.length, 1)
    snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'decideProposal', [{
      proposalId: plotProposals[0].id, decision: 'approve', confirmReplacement: false
    }]), `novelBible.decideProposal plot ${project.key} ${index}`)
    const chapter = snapshot.outline.find((node) => node.kind === 'chapter-plan' && node.position === index)
    assert.ok(chapter)
    assert.equal(chapter.authorityStatus, 'approved')
  }

  snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'saveEntry', [{
    entryId: world.id,
    expectedVersionId: world.currentVersionId,
    draft: {
      kind: world.kind,
      title: world.title,
      summary: '手工编辑后的第二版规则',
      fields: world.fields,
      relatedEntityIds: world.relatedEntityIds
    }
  }]), `novelBible.saveEntry second version ${project.key}`)
  let versions = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'listVersions', [{
    entityType: 'world-setting', entityId: world.id
  }]), `novelBible.listVersions ${project.key}`)
  assert.equal(versions.length, 2)
  snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'restoreVersion', [{
    entityType: 'world-setting', entityId: world.id, versionId: initialWorldVersionId
  }]), `novelBible.restoreVersion ${project.key}`)
  let currentWorld = snapshot.entries.find((entry) => entry.id === world.id)
  assert.equal(currentWorld.summary, '手工确认的初始规则')

  const replacement = assertBibleSuccess(await invokeNamed(
    session,
    'novelBible',
    'generateProposals',
    [{
      requestId: `smoke-replace-${project.key}`,
      domain: 'setting',
      mode: 'standard',
      request: `SMOKE_REPLACE entity=${world.id} version=${currentWorld.currentVersionId} genre=${project.key}`,
      targetEntityId: world.id
    }]
  ), `novelBible.generateProposals replacement ${project.key}`)
  assert.equal(replacement.length, 1)
  const blockedReplacement = await invokeNamed(session, 'novelBible', 'decideProposal', [{
    proposalId: replacement[0].id,
    decision: 'approve',
    confirmReplacement: false
  }])
  assert.equal(blockedReplacement?.ok, false)
  assert.equal(blockedReplacement?.error?.code, 'BIBLE_CONFLICT')
  snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'decideProposal', [{
    proposalId: replacement[0].id,
    decision: 'approve',
    confirmReplacement: true
  }]), `novelBible.decideProposal replacement ${project.key}`)
  currentWorld = snapshot.entries.find((entry) => entry.id === world.id)
  assert.equal(currentWorld.summary, '经用户确认的结构化规则')
  assert.equal(currentWorld.authorityStatus, 'approved')

  const rejected = assertBibleSuccess(await invokeNamed(
    session,
    'novelBible',
    'generateProposals',
    [{
      requestId: `smoke-reject-${project.key}`,
      domain: 'setting',
      mode: 'standard',
      request: `SMOKE_REJECT genre=${project.key}`,
      targetEntityId: null
    }]
  ), `novelBible.generateProposals rejection ${project.key}`)
  assert.equal(rejected.length, 1)
  snapshot = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'decideProposal', [{
    proposalId: rejected[0].id,
    decision: 'reject',
    confirmReplacement: false
  }]), `novelBible.decideProposal rejection ${project.key}`)
  assert.equal(snapshot.entries.some((entry) => entry.title.includes('待拒绝候选')), false)
  assert.equal(snapshot.outline.filter((node) => node.kind === 'chapter-plan').length, 3)
  assert.deepEqual(snapshot.proposals.map((proposal) => proposal.status).sort(), [
    'approved', 'approved', 'approved', 'approved', 'approved', 'rejected'
  ])

  versions = assertBibleSuccess(await invokeNamed(session, 'novelBible', 'listVersions', [{
    entityType: 'world-setting', entityId: world.id
  }]), `novelBible.listVersions after decisions ${project.key}`)
  assert.equal(versions.length, 4)
  assert.equal(versions.some((version) => version.sourceKind === 'restore'), true)
  assert.equal(versions.some((version) => version.sourceKind === 'agent'), true)
  state.bibleExpectations[project.projectId] = {
    genre: project.key,
    worldId: world.id,
    entryCount: 2,
    outlineCount: 6,
    proposalStatuses: ['approved', 'approved', 'approved', 'approved', 'approved', 'rejected']
  }
  assertModelSuccess(
    await invokeNamed(session, 'projects', 'close', []),
    `projects.close ${project.key}`
  )
}

const verifyBibleRestart = async (session, state) => {
  state.stage = 'bible-restart'
  for (const project of state.seededProjects) {
    assertModelSuccess(
      await invokeNamed(session, 'projects', 'openRecent', [project.projectId]),
      `projects.openRecent restart ${project.key}`
    )
    const snapshot = assertBibleSuccess(
      await invokeNamed(session, 'novelBible', 'getSnapshot', []),
      `novelBible.getSnapshot restart ${project.key}`
    )
    const expected = state.bibleExpectations[project.projectId]
    assert.equal(snapshot.profile.genre, expected.genre)
    assert.equal(snapshot.entries.length, expected.entryCount)
    assert.equal(snapshot.outline.length, expected.outlineCount)
    assert.deepEqual(snapshot.proposals.map((proposal) => proposal.status).sort(), expected.proposalStatuses)
    const world = snapshot.entries.find((entry) => entry.id === expected.worldId)
    assert.equal(world.summary, '经用户确认的结构化规则')
    assert.equal(snapshot.entries.some((entry) => entry.title.includes('待拒绝候选')), false)
    assertModelSuccess(
      await invokeNamed(session, 'projects', 'close', []),
      `projects.close restart ${project.key}`
    )
  }
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

const seedSmokeProjects = async (cwd, userDataDir, state) => {
  const record = await runCommand(process.execPath, [
    '--experimental-strip-types',
    '--no-warnings',
    join(cwd, 'scripts', 'electron-smoke-seed.mjs'),
    userDataDir
  ], { cwd, timeoutMs: START_TIMEOUT_MS })
  state.processRecords.push(record)
  const projects = JSON.parse(record.logs.stdout)
  assert.equal(Array.isArray(projects), true)
  assert.deepEqual(projects.map((project) => project.key).sort(), [
    'sci-fi-future', 'urban-campus'
  ])
  assert.equal(projects.every((project) => typeof project.projectId === 'string'), true)
  return projects
}

const diagnosticDirectory = () => process.env.ELECTRON_SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'open-novel-electron-smoke-diagnostics')

export const runSmoke = async ({ cwd = resolve(fileURLToPath(new URL('..', import.meta.url))) } = {}) => {
  const state = {
    stage: 'initializing',
    sessions: [],
    processRecords: [],
    runSummaries: {},
    rawRuns: {},
    bibleExpectations: {},
    console: [],
    cleanup: []
  }
  let userDataDir
  let currentSession
  let modelProvider
  let failure

  try {
    state.stage = 'build'
    const build = await runBuild(cwd, state)
    state.processRecords.push(build)
    state.stage = 'model-provider'
    modelProvider = await startFakeModelProvider()
    state.modelBaseUrl = modelProvider.baseUrl
    userDataDir = await createSmokeUserDataDirectory()
    state.stage = 'project-seed'
    state.seededProjects = await seedSmokeProjects(cwd, userDataDir, state)
    state.stage = 'startup'
    currentSession = await startSession(cwd, userDataDir, state)
    for (const project of state.seededProjects) {
      await runBibleGenreScenario(currentSession, state, project)
    }
    assertAgentSuccess(await invoke(currentSession, 'listRuns'), 'listRuns')
    await runApprovalScenario(currentSession, state)
    await runCancellationScenario(currentSession, state)
    currentSession = await runRecoveryScenario(currentSession, state, cwd, userDataDir)
    await verifyBibleRestart(currentSession, state)
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
      await assertNoPlaintextModelArtifacts(userDataDir, SMOKE_MODEL_SECRET)
      state.cleanup.push('model artifacts contain no plaintext secret')
    } catch (error) {
      state.cleanup.push(`model artifact scan failed: ${redactText(error.message)}`)
      if (failure === undefined) {
        state.stage = 'model-artifact-scan'
        failure = error
      }
    }
  }
  if (modelProvider !== undefined) {
    try {
      await modelProvider.close()
      state.cleanup.push('model provider closed')
    } catch (error) {
      state.cleanup.push(`model provider cleanup failed: ${redactText(error.message)}`)
      if (failure === undefined) failure = error
    }
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
