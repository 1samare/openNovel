import assert from 'node:assert/strict'
import test from 'node:test'

import { z } from 'zod'

import { createModelRuntime } from '../src/main/model-runtime.ts'
import { buildCoauthorPrompt } from '../src/novel/prompt-templates.ts'
import { ProposalService } from '../src/novel/proposal-service.ts'
import { ModelDomainError } from '../src/shared/model.ts'

const profile = {
  id: 'profile-role-setting',
  connectionId: 'connection-one',
  label: '设定模型',
  modelId: 'model-one',
  temperature: 0.4,
  maxOutputTokens: 2048,
  contextWindow: 64000,
  capabilities: ['structured-output']
}

const servicePort = (bindings) => ({
  listConnections: async () => [],
  saveConnection: async () => { throw new Error('unused') },
  listProfiles: async () => [profile],
  saveProfile: async () => { throw new Error('unused') },
  getBindings: async () => bindings,
  saveBindings: async () => bindings,
  shutdown: async () => undefined
})

const settingCandidate = {
  operation: 'create',
  targetEntityId: null,
  sourceVersionId: null,
  title: '回声钟楼',
  rationale: '用可验证规则支撑悬疑',
  impact: '影响人物夜间行动与前三章线索',
  priority: 5,
  affectedEntityIds: [],
  conflicts: [],
  entry: {
    kind: 'world-setting',
    title: '回声钟楼',
    summary: '钟楼只在雷雨夜重复十三次钟声',
    fields: [{ key: 'rule', label: '规则', value: '钟声不可被录音设备记录' }],
    relatedEntityIds: []
  }
}

const characterCandidate = {
  ...settingCandidate,
  title: '林澈',
  entry: {
    kind: 'character', title: '林澈', summary: '校史社社长',
    fields: [{ key: 'motivation', label: '动机', value: '查明钟楼真相' }], relatedEntityIds: []
  }
}

const { entry: _settingEntry, ...candidateBase } = settingCandidate
const plotCandidate = {
  ...candidateBase,
  title: '第一章',
  outline: {
    kind: 'story', parentId: null, title: '雨夜第十三响', summary: '调查钟楼',
    goal: '找到录音缺口', conflict: '校方阻拦', turningPoint: '第十三响无法录制',
    hook: '旧档案室亮灯', targetWords: 0, participantCharacterIds: [], position: 0
  }
}

test('builds distinct genre prompts from authoritative data only', () => {
  const context = {
    profile: {
      id: 'profile-novel',
      projectId: 'project-one',
      genre: 'urban-campus',
      audience: '青年读者',
      theme: '选择与代价',
      narrativePov: '第三人称限知',
      tone: '克制悬疑',
      styleSample: '雨水沿着旧窗滑落。',
      bannedExpressions: ['命运的齿轮'],
      authorityStatus: 'user_confirmed',
      currentVersionId: 'version-profile',
      createdAt: '2026-08-11T05:00:00.000Z',
      updatedAt: '2026-08-11T05:00:00.000Z'
    },
    entries: [
      {
        ...settingCandidate.entry,
        id: 'entry-confirmed',
        projectId: 'project-one',
        authorityStatus: 'approved',
        currentVersionId: 'version-confirmed',
        createdAt: '2026-08-11T05:00:00.000Z',
        updatedAt: '2026-08-11T05:00:00.000Z'
      },
      {
        ...settingCandidate.entry,
        title: '不得泄露的拒绝候选',
        summary: 'REJECTED_SENTINEL',
        id: 'entry-rejected',
        projectId: 'project-one',
        authorityStatus: 'rejected',
        currentVersionId: 'version-rejected',
        createdAt: '2026-08-11T05:00:00.000Z',
        updatedAt: '2026-08-11T05:00:00.000Z'
      }
    ],
    outline: [],
    sourceVersionIds: ['version-profile', 'version-confirmed']
  }
  const urban = buildCoauthorPrompt({
    domain: 'setting',
    genre: 'urban-campus',
    request: '补全校园钟楼规则',
    targetEntityId: null,
    context
  })
  const scienceFiction = buildCoauthorPrompt({
    ...urban.input,
    genre: 'sci-fi-future',
    context: { ...context, profile: { ...context.profile, genre: 'sci-fi-future' } }
  })

  assert.match(urban.system, /设定 Agent|最多 3 条|候选/)
  assert.match(urban.prompt, /现实社会|校园/)
  assert.match(scienceFiction.prompt, /技术边界|代价/)
  assert.match(urban.prompt, /回声钟楼/)
  assert.doesNotMatch(urban.prompt, /REJECTED_SENTINEL|不得泄露的拒绝候选/)
})

test('routes structured generation by role before mode default and uses validated fallbacks', async () => {
  const calls = []
  const runtime = createModelRuntime({
    service: servicePort({
      modeDefaults: [{
        mode: 'quick',
        primaryProfileId: 'profile-mode-quick',
        fallbackProfileIds: [],
        allowCrossProviderFallback: false
      }],
      roleBindings: [{
        role: 'setting',
        mode: 'standard',
        primaryProfileId: 'profile-role-setting',
        fallbackProfileIds: ['profile-role-fallback'],
        allowCrossProviderFallback: true
      }]
    }),
    gateway: {
      testConnection: async () => { throw new Error('unused') },
      listModels: async () => [],
      async generateObject(input) {
        calls.push(input.profileId)
        if (input.profileId === 'profile-role-setting') {
          throw new ModelDomainError('MODEL_OFFLINE', 'offline', { retryable: true })
        }
        return { value: input.schema.parse({ proposals: [] }) }
      }
    },
    senderPolicy: { isAllowed: () => true }
  })

  await runtime.structuredCoauthor.generate({
    role: 'setting',
    mode: 'standard',
    schema: z.object({ proposals: z.array(z.unknown()) }).strict(),
    system: 'system',
    prompt: 'prompt',
    signal: new AbortController().signal
  })
  await runtime.structuredCoauthor.generate({
    role: 'character',
    mode: 'quick',
    schema: z.object({ proposals: z.array(z.unknown()) }).strict(),
    system: 'system',
    prompt: 'prompt',
    signal: new AbortController().signal
  })
  assert.deepEqual(calls, [
    'profile-role-setting', 'profile-role-fallback', 'profile-mode-quick'
  ])
})

test('repairs invalid proposal structure at most once and maps model cancellation', async () => {
  const calls = []
  const stored = []
  const repository = {
    authoritativeContext: async () => ({
      profile: {
        id: 'profile-novel', projectId: 'project-one', genre: 'urban-campus',
        audience: '青年', theme: '选择', narrativePov: '限知', tone: '克制', styleSample: '',
        bannedExpressions: [], authorityStatus: 'user_confirmed',
        currentVersionId: 'version-profile', createdAt: '2026-08-11T05:00:00.000Z',
        updatedAt: '2026-08-11T05:00:00.000Z'
      },
      entries: [], outline: [], sourceVersionIds: ['version-profile']
    }),
    async recordProposals(input) {
      stored.push(input)
      return []
    }
  }
  const service = new ProposalService(repository, {
    coauthor: {
      async generate(input) {
        calls.push(input)
        return calls.length === 1 ? { proposals: [{ extra: true }] } : { proposals: [settingCandidate] }
      }
    }
  })
  await service.generateProposals({
    requestId: 'request-repair-one',
    domain: 'setting',
    mode: 'standard',
    request: '提出一个高价值设定',
    targetEntityId: null
  }, new AbortController().signal)
  assert.equal(calls.length, 2)
  assert.match(calls[1].prompt, /上一次输出未通过结构校验/)
  assert.equal(stored[0].candidates.length, 1)
  assert.deepEqual(stored[0].sourceVersionIds, ['version-profile'])

  const cancelled = new ProposalService(repository, {
    coauthor: {
      async generate() {
        throw new ModelDomainError('MODEL_CANCELLED', 'cancelled')
      }
    }
  })
  await assert.rejects(cancelled.generateProposals({
    requestId: 'request-cancel-one',
    domain: 'setting',
    mode: 'standard',
    request: '取消这次生成',
    targetEntityId: null
  }, AbortSignal.abort()), (error) => error?.code === 'BIBLE_GENERATION_CANCELLED')
})

test('runs setting, character, and plot candidates through their domain schemas before storage', async () => {
  const stored = []
  const candidates = { setting: settingCandidate, character: characterCandidate, plot: plotCandidate }
  const repository = {
    authoritativeContext: async () => ({
      profile: {
        id: 'profile-novel', projectId: 'project-one', genre: 'urban-campus', audience: '青年',
        theme: '选择', narrativePov: '限知', tone: '克制', styleSample: '', bannedExpressions: [],
        authorityStatus: 'user_confirmed', currentVersionId: 'version-profile',
        createdAt: '2026-08-11T05:00:00.000Z', updatedAt: '2026-08-11T05:00:00.000Z'
      },
      entries: [], outline: [], sourceVersionIds: ['version-profile']
    }),
    async recordProposals(input) { stored.push(input); return [] }
  }
  const service = new ProposalService(repository, {
    coauthor: { async generate(input) { return input.schema.parse({ proposals: [candidates[input.role]] }) } }
  })

  for (const domain of ['setting', 'character', 'plot']) {
    await service.generateProposals({
      requestId: `request-${domain}-one`, domain, mode: 'standard', request: `生成${domain}`,
      targetEntityId: null
    }, new AbortController().signal)
  }
  assert.deepEqual(stored.map((item) => item.domain), ['setting', 'character', 'plot'])
  assert.deepEqual(stored.map((item) => item.candidates[0].title), ['回声钟楼', '林澈', '第一章'])
})

test('does not persist a generated candidate when cancellation arrives after model resolution', async () => {
  let resolveModel
  const controller = new AbortController()
  let stored = false
  const service = new ProposalService({
    authoritativeContext: async () => ({
      profile: {
        id: 'profile-novel', projectId: 'project-one', genre: 'urban-campus', audience: '青年',
        theme: '选择', narrativePov: '限知', tone: '克制', styleSample: '', bannedExpressions: [],
        authorityStatus: 'user_confirmed', currentVersionId: 'version-profile',
        createdAt: '2026-08-11T05:00:00.000Z', updatedAt: '2026-08-11T05:00:00.000Z'
      }, entries: [], outline: [], sourceVersionIds: ['version-profile']
    }),
    async recordProposals() { stored = true; return [] }
  }, {
    coauthor: { generate: async () => new Promise((resolve) => { resolveModel = resolve }) }
  })
  const pending = service.generateProposals({
    requestId: 'request-late-cancel', domain: 'setting', mode: 'standard',
    request: '生成后立即切换项目', targetEntityId: null
  }, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  resolveModel({ proposals: [settingCandidate] })
  await assert.rejects(pending, (error) => error?.code === 'BIBLE_GENERATION_CANCELLED')
  assert.equal(stored, false)
})
