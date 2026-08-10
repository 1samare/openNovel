import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'

import type {
  ConnectionTestResult,
  ModelApi,
  ModelBindingConfiguration,
  ModelProfile,
  ModelResult,
  ProviderConnectionSummary
} from '../../src/shared/model'
import ModelSettingsView from '../../src/renderer/src/views/ModelSettingsView.vue'

const now = '2026-08-10T08:00:00.000Z'

const deepSeekConnection: ProviderConnectionSummary = {
  id: 'connection-deepseek',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  hasSecret: true,
  secretHint: '••••1234',
  createdAt: now,
  updatedAt: now
}

const geminiConnection: ProviderConnectionSummary = {
  id: 'connection-gemini',
  name: 'Google Gemini',
  kind: 'gemini',
  enabled: true,
  hasSecret: true,
  secretHint: '••••5678',
  createdAt: now,
  updatedAt: now
}

const profiles: ModelProfile[] = [
  {
    id: 'profile-deepseek-flash',
    connectionId: deepSeekConnection.id,
    label: 'DeepSeek Flash',
    modelId: 'deepseek-v4-flash',
    temperature: 0.7,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    capabilities: ['stream-text', 'structured-output', 'usage']
  },
  {
    id: 'profile-stream-only',
    connectionId: deepSeekConnection.id,
    label: '续写专用',
    modelId: 'deepseek-v4-pro',
    temperature: 0.8,
    maxOutputTokens: 8192,
    contextWindow: 128000,
    capabilities: ['stream-text']
  },
  {
    id: 'profile-gemini',
    connectionId: geminiConnection.id,
    label: 'Gemini Pro',
    modelId: 'gemini-3-pro',
    temperature: 0.6,
    maxOutputTokens: 4096,
    contextWindow: 128000,
    capabilities: ['structured-output', 'usage']
  }
]

const bindings: ModelBindingConfiguration = {
  modeDefaults: [
    {
      mode: 'quick',
      primaryProfileId: 'profile-deepseek-flash',
      fallbackProfileIds: [],
      allowCrossProviderFallback: false
    },
    {
      mode: 'standard',
      primaryProfileId: 'profile-deepseek-flash',
      fallbackProfileIds: [],
      allowCrossProviderFallback: false
    },
    {
      mode: 'deep',
      primaryProfileId: 'profile-deepseek-flash',
      fallbackProfileIds: [],
      allowCrossProviderFallback: false
    }
  ],
  roleBindings: [
    {
      role: 'writer',
      mode: 'standard',
      primaryProfileId: 'profile-deepseek-flash',
      fallbackProfileIds: [],
      allowCrossProviderFallback: false
    }
  ]
}

const ok = <T>(data: T): ModelResult<T> => ({ ok: true, data })

const createApi = (overrides: Partial<ModelApi> = {}): ModelApi => ({
  listConnections: vi.fn(async () => ok([deepSeekConnection, geminiConnection])),
  saveConnection: vi.fn(async (input) => ok({
    ...deepSeekConnection,
    id: input.id ?? deepSeekConnection.id,
    name: input.name,
    kind: input.kind,
    baseUrl: input.baseUrl,
    enabled: input.enabled
  })),
  testConnection: vi.fn(async ({ connectionId, modelId }: Parameters<ModelApi['testConnection']>[0]) => ok<ConnectionTestResult>({
    connectionId,
    modelId,
    authenticated: true,
    modelAvailable: true,
    capabilities: ['stream-text', 'structured-output', 'usage'],
    latencyMs: 42
  })),
  cancelConnectionTest: vi.fn(async () => ok(null)),
  listModels: vi.fn(async () => ok([
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }
  ])),
  listProfiles: vi.fn(async () => ok(profiles)),
  saveProfile: vi.fn(async (input) => ok({ ...input, id: input.id ?? 'profile-new' })),
  getBindings: vi.fn(async () => ok(bindings)),
  saveBindings: vi.fn(async (input) => ok({
    modeDefaults: input.modeDefaults,
    roleBindings: input.roleBindings
  })),
  ...overrides
})

const mountSettings = async (api: ModelApi): Promise<VueWrapper> => {
  Object.defineProperty(window, 'openNovel', {
    configurable: true,
    value: { models: api }
  })
  const wrapper = mount(ModelSettingsView)
  await flushPromises()
  return wrapper
}

const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (found === undefined) throw new Error(`Button not found: ${label}`)
  return found
}

test('loads a redacted, labelled settings experience with all modes and agent roles', async () => {
  const wrapper = await mountSettings(createApi())

  expect(wrapper.get('h1').text()).toContain('模型与 API 密钥')
  expect(wrapper.text()).toContain('同一 Windows 用户下运行的其他程序')
  expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  expect(wrapper.get<HTMLInputElement>('#connection-api-key').element.value).toBe('')
  expect(wrapper.text()).not.toContain('sk-existing-secret')
  expect(wrapper.text()).toContain('留空将保留已保存密钥')
  expect(wrapper.get('label[for="connection-api-key"]').text()).toContain('API 密钥')
  expect(wrapper.get('label[for="profile-temperature"]').text()).toContain('温度')
  expect(wrapper.text()).toContain('流式文本')
  expect(wrapper.text()).toContain('结构化输出')
  expect(wrapper.get<HTMLInputElement>('#capability-stream-text').element.checked).toBe(false)
  expect(wrapper.get<HTMLInputElement>('#capability-structured-output').element.checked).toBe(false)

  for (const label of ['快速', '标准', '深度']) expect(wrapper.text()).toContain(label)
  for (const label of ['编辑', '设定', '角色', '情节', '续写', '审校']) {
    expect(wrapper.text()).toContain(label)
  }

  expect(button(wrapper, '保存连接').classes()).toContain('model-button')
  expect(wrapper.find('.model-settings-grid').exists()).toBe(true)
  expect(wrapper.get('.model-settings').classes()).toContain('workspace-page')
})

test('recovers from loading failure and applies the current DeepSeek preset without exposing a saved key', async () => {
  const saveConnection = vi.fn(async (input) => ok({
    ...deepSeekConnection,
    name: input.name,
    kind: input.kind,
    baseUrl: input.baseUrl,
    enabled: input.enabled
  }))
  const listConnections = vi.fn()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: 'MODEL_OFFLINE', message: 'Network details are private', retryable: true }
    })
    .mockResolvedValue(ok([deepSeekConnection, geminiConnection]))
  const wrapper = await mountSettings(createApi({ listConnections, saveConnection }))

  expect(wrapper.get('[role="alert"]').text()).toContain('模型设置加载失败')
  await button(wrapper, '重试加载').trigger('click')
  await flushPromises()
  expect(listConnections).toHaveBeenCalledTimes(2)

  await button(wrapper, '使用 DeepSeek 预设').trigger('click')
  expect(wrapper.get<HTMLInputElement>('#connection-name').element.value).toBe('DeepSeek')
  expect(wrapper.get<HTMLSelectElement>('#connection-kind').element.value).toBe('openai-compatible')
  expect(wrapper.get<HTMLInputElement>('#connection-base-url').element.value).toBe('https://api.deepseek.com')
  expect(wrapper.get<HTMLInputElement>('#connection-test-model').element.value).toBe('deepseek-v4-flash')
  expect(wrapper.text()).toContain('deepseek-v4-pro')
  expect(wrapper.text()).toContain('仅允许 HTTPS；本机开发可使用回环 HTTP')

  await wrapper.get('#connection-api-key').setValue('test-secret-value')
  await wrapper.get('[data-testid="connection-form"]').trigger('submit')
  await flushPromises()
  expect(saveConnection).toHaveBeenCalledWith(expect.objectContaining({
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'test-secret-value'
  }))
  expect(wrapper.get<HTMLInputElement>('#connection-api-key').element.value).toBe('')
  expect(wrapper.text()).not.toContain('test-secret-value')
})

test('lists optional models, keeps a manual model id, and cancels an active connection test', async () => {
  let resolveTest!: (value: ModelResult<never>) => void
  const testConnection = vi.fn(() => new Promise<ModelResult<never>>((resolve) => {
    resolveTest = resolve
  }))
  const cancelConnectionTest = vi.fn(async () => ok(null))
  const listModels = vi.fn(async () => ok([
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
  ]))
  const wrapper = await mountSettings(createApi({
    testConnection: testConnection as ModelApi['testConnection'],
    cancelConnectionTest,
    listModels
  }))

  await button(wrapper, '获取模型列表').trigger('click')
  await flushPromises()
  expect(listModels).toHaveBeenCalledWith('connection-deepseek')
  expect(wrapper.text()).toContain('DeepSeek V4 Pro')

  await wrapper.get('#connection-test-model').setValue('deepseek-custom-model')
  await button(wrapper, '测试连接').trigger('click')
  expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({
    connectionId: 'connection-deepseek',
    modelId: 'deepseek-custom-model'
  }))
  await button(wrapper, '取消测试').trigger('click')
  await flushPromises()
  expect(cancelConnectionTest).toHaveBeenCalledWith(expect.any(String))

  resolveTest({
    ok: false,
    error: { code: 'MODEL_CANCELLED', message: 'Cancelled', retryable: false }
  })
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('连接测试已取消')
})

test('uses native provider endpoints when Anthropic or Gemini Base URL is blank', async () => {
  const saveConnection = vi.fn(async (input) => ok({
    ...deepSeekConnection,
    id: 'connection-native',
    name: input.name,
    kind: input.kind,
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    enabled: input.enabled
  }))
  const wrapper = await mountSettings(createApi({ saveConnection }))

  await button(wrapper, '新建连接').trigger('click')
  await wrapper.get('#connection-name').setValue('Anthropic 官方')
  await wrapper.get('#connection-kind').setValue('anthropic')
  await wrapper.get('#connection-base-url').setValue('')
  await wrapper.get('#connection-api-key').setValue('native-test-secret')
  await wrapper.get('[data-testid="connection-form"]').trigger('submit')
  await flushPromises()

  expect(saveConnection).toHaveBeenCalledWith({
    name: 'Anthropic 官方',
    kind: 'anthropic',
    apiKey: 'native-test-secret',
    enabled: true
  })
})

test('validates profile ranges and saves explicit capabilities for a manual model id', async () => {
  const saveProfile = vi.fn(async (input) => ok({ ...input, id: 'profile-created' }))
  const wrapper = await mountSettings(createApi({ saveProfile }))

  await wrapper.get('#profile-label').setValue('长篇续写')
  await wrapper.get('#profile-model-id').setValue('deepseek-custom-model')
  await wrapper.get('#profile-temperature').setValue('2.5')
  await wrapper.get('[data-testid="profile-form"]').trigger('submit')
  expect(saveProfile).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="profile-error"]').text()).toContain('0 到 2')

  await wrapper.get('#profile-temperature').setValue('0.65')
  await wrapper.get('#profile-max-output-tokens').setValue('6000')
  await wrapper.get('#profile-context-window').setValue('128000')
  const structured = wrapper.get<HTMLInputElement>('#capability-structured-output')
  if (!structured.element.checked) await structured.setValue(true)
  const stream = wrapper.get<HTMLInputElement>('#capability-stream-text')
  if (!stream.element.checked) await stream.setValue(true)
  await wrapper.get('[data-testid="profile-form"]').trigger('submit')
  await flushPromises()

  expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({
    label: '长篇续写',
    modelId: 'deepseek-custom-model',
    temperature: 0.65,
    maxOutputTokens: 6000,
    contextWindow: 128000,
    capabilities: expect.arrayContaining(['stream-text', 'structured-output'])
  }))
})

test('disables incapable role targets and requires explicit confirmation for cross-provider fallback', async () => {
  const capableGemini: ModelProfile = {
    ...profiles[2],
    id: 'profile-gemini-capable',
    label: 'Gemini Complete',
    capabilities: ['stream-text', 'structured-output', 'usage']
  }
  const saveBindings = vi.fn(async (input) => ok({
    modeDefaults: input.modeDefaults,
    roleBindings: input.roleBindings
  }))
  const wrapper = await mountSettings(createApi({
    saveBindings,
    listProfiles: vi.fn(async () => ok([...profiles, capableGemini]))
  }))

  expect(wrapper.get<HTMLOptionElement>(
    '#mode-standard-primary option[value="profile-stream-only"]'
  ).element.disabled).toBe(true)
  expect(wrapper.get<HTMLOptionElement>(
    '#mode-standard-fallbacks option[value="profile-gemini"]'
  ).element.disabled).toBe(true)

  expect(wrapper.get<HTMLOptionElement>(
    '#role-editor-primary option[value="profile-stream-only"]'
  ).element.disabled).toBe(true)
  expect(wrapper.get<HTMLOptionElement>(
    '#role-writer-primary option[value="profile-gemini"]'
  ).element.disabled).toBe(true)

  await wrapper.get('#mode-standard-fallbacks').setValue(['profile-gemini-capable'])
  expect(wrapper.get('[data-testid="cross-provider-warning"]').text()).toContain(
    'Gemini Complete（Google Gemini）'
  )
  expect(wrapper.get<HTMLInputElement>('#confirm-cross-provider').element.checked).toBe(false)
  await wrapper.get('[data-testid="bindings-form"]').trigger('submit')
  expect(saveBindings).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="bindings-error"]').text()).toContain('确认跨供应商')

  await wrapper.get('#confirm-cross-provider').setValue(true)
  await wrapper.get('[data-testid="bindings-form"]').trigger('submit')
  await flushPromises()
  expect(saveBindings).toHaveBeenCalledWith(expect.objectContaining({
    confirmCrossProviderRouting: true,
    modeDefaults: expect.arrayContaining([
      expect.objectContaining({
        mode: 'standard',
        fallbackProfileIds: ['profile-gemini-capable'],
        allowCrossProviderFallback: true
      })
    ])
  }))
})

test('does not require cross-provider consent for two connections of the same provider kind', async () => {
  const secondConnection: ProviderConnectionSummary = {
    ...deepSeekConnection,
    id: 'connection-openai-second',
    name: 'OpenAI-compatible 备用'
  }
  const secondProfile: ModelProfile = {
    ...profiles[0],
    id: 'profile-openai-second',
    connectionId: secondConnection.id,
    label: '同协议备用'
  }
  const wrapper = await mountSettings(createApi({
    listConnections: vi.fn(async () => ok([
      deepSeekConnection,
      secondConnection,
      geminiConnection
    ])),
    listProfiles: vi.fn(async () => ok([...profiles, secondProfile]))
  }))

  await wrapper.get('#mode-standard-fallbacks').setValue(['profile-openai-second'])
  expect(wrapper.find('[data-testid="cross-provider-warning"]').exists()).toBe(false)
})

test('explains the blocked state when no model profile has been configured', async () => {
  const wrapper = await mountSettings(createApi({
    listProfiles: vi.fn(async () => ok([])),
    getBindings: vi.fn(async () => ok({ modeDefaults: [], roleBindings: [] }))
  }))

  expect(wrapper.text()).toContain('尚未配置模型档案')
  expect(button(wrapper, '保存角色绑定').attributes()).toHaveProperty('disabled')
})
