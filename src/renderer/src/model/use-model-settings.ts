import { computed, reactive, ref, watch } from 'vue'

import {
  AGENT_ROLES,
  GENERATION_MODES,
  MODEL_CAPABILITIES,
  requiredCapabilitiesForRole,
  type AgentRole,
  type GenerationMode,
  type ModelApi,
  type ModelBindingConfiguration,
  type ModelCapability,
  type ModelProfile,
  type ModelPublicError,
  type ModelRoute,
  type ProviderConnectionSummary,
  type ProviderKind,
  type ProviderModelOption,
  type SaveModelBindingsInput
} from '@shared/model'

export const DEEPSEEK_PRESET = {
  name: 'DeepSeek',
  kind: 'openai-compatible' as const,
  baseUrl: 'https://api.deepseek.com',
  models: ['deepseek-v4-flash', 'deepseek-v4-pro'] as const
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible / DeepSeek',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini'
}

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  'stream-text': '流式文本',
  'structured-output': '结构化输出',
  tools: '工具调用',
  usage: '用量统计'
}

export const MODE_LABELS: Record<GenerationMode, string> = {
  quick: '快速',
  standard: '标准',
  deep: '深度'
}

export const ROLE_LABELS: Record<AgentRole, string> = {
  editor: '编辑',
  setting: '设定',
  character: '角色',
  plot: '情节',
  writer: '续写',
  reviewer: '审校'
}

type ConnectionDraft = {
  id?: string
  name: string
  kind: ProviderKind
  baseUrl: string
  enabled: boolean
}

type ProfileDraft = {
  id?: string
  connectionId: string
  label: string
  modelId: string
  temperature: number
  maxOutputTokens: number
  contextWindow: number
  capabilities: ModelCapability[]
}

export type RouteDraft = {
  primaryProfileId: string
  fallbackProfileIds: string[]
}

export type ModeRouteDraft = RouteDraft & { mode: GenerationMode }
export type RoleRouteDraft = RouteDraft & {
  role: AgentRole
  mode: GenerationMode
  enabled: boolean
}

const emptyConnection = (): ConnectionDraft => ({
  name: '',
  kind: 'openai-compatible',
  baseUrl: '',
  enabled: true
})

const emptyProfile = (): ProfileDraft => ({
  connectionId: '',
  label: '',
  modelId: '',
  temperature: 0.7,
  maxOutputTokens: 4096,
  contextWindow: 128000,
  capabilities: []
})

const safeMessage = (error: ModelPublicError, fallback: string): string => {
  switch (error.code) {
    case 'MODEL_ENCRYPTION_UNAVAILABLE':
      return 'Windows 安全存储当前不可用，无法保存 API 密钥。'
    case 'MODEL_INVALID_BASE_URL':
      return 'Base URL 必须使用 HTTPS；仅本机开发可使用回环 HTTP。'
    case 'MODEL_AUTH_FAILED':
      return '认证失败，请检查 API 密钥后重试。'
    case 'MODEL_BALANCE_EXHAUSTED':
      return '供应商余额或配额不足，请检查账户后重试。'
    case 'MODEL_RATE_LIMITED':
      return '请求过于频繁，请稍后重试。'
    case 'MODEL_NOT_FOUND':
      return '没有找到该模型，请检查手工模型 ID。'
    case 'MODEL_OFFLINE':
    case 'MODEL_DNS_FAILED':
    case 'MODEL_TIMEOUT':
      return '无法连接模型供应商，请检查网络和 Base URL 后重试。'
    case 'MODEL_CANCELLED':
      return '操作已取消。'
    default:
      return fallback
  }
}

const isSecureBaseUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.hash) return false
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

const uniqueFallbacks = (route: RouteDraft): string[] => [
  ...new Set(route.fallbackProfileIds.filter((id) => id && id !== route.primaryProfileId))
]

let connectionTestSequence = 0

export function useModelSettings(api: ModelApi) {
  const connections = ref<ProviderConnectionSummary[]>([])
  const profiles = ref<ModelProfile[]>([])
  const modelOptions = ref<ProviderModelOption[]>([])
  const loading = ref(true)
  const loadError = ref('')
  const connectionError = ref('')
  const connectionStatus = ref('')
  const profileError = ref('')
  const profileStatus = ref('')
  const bindingsError = ref('')
  const bindingsStatus = ref('')
  const connectionBusy = ref(false)
  const profileBusy = ref(false)
  const bindingsBusy = ref(false)
  const modelsBusy = ref(false)
  const activeTestRequestId = ref<string>()
  const cancellingTest = ref(false)
  const connection = reactive<ConnectionDraft>(emptyConnection())
  const connectionApiKey = ref('')
  const connectionTestModel = ref(DEEPSEEK_PRESET.models[0])
  const profile = reactive<ProfileDraft>(emptyProfile())
  const confirmCrossProvider = ref(false)

  const modeRoutes = reactive<ModeRouteDraft[]>(GENERATION_MODES.map((mode) => ({
    mode,
    primaryProfileId: '',
    fallbackProfileIds: []
  })))
  const roleRoutes = reactive<RoleRouteDraft[]>(AGENT_ROLES.map((role) => ({
    role,
    mode: 'standard',
    enabled: false,
    primaryProfileId: '',
    fallbackProfileIds: []
  })))

  const selectedConnection = computed(() => connections.value.find(({ id }) => id === connection.id))
  const canSaveBindings = computed(() => profiles.value.length > 0 && !bindingsBusy.value)

  const connectionName = (connectionId: string): string =>
    connections.value.find(({ id }) => id === connectionId)?.name ?? '未知连接'

  const profileById = (profileId: string): ModelProfile | undefined =>
    profiles.value.find(({ id }) => id === profileId)

  const profileSupportsRole = (candidate: ModelProfile, role: AgentRole): boolean =>
    requiredCapabilitiesForRole(role).every((capability) => candidate.capabilities.includes(capability))

  const profileSupportsMode = (candidate: ModelProfile): boolean =>
    (['stream-text', 'structured-output'] as ModelCapability[])
      .every((capability) => candidate.capabilities.includes(capability))

  const routeCrossesProvider = (route: RouteDraft): boolean => {
    const primary = profileById(route.primaryProfileId)
    if (primary === undefined) return false
    const primaryKind = connections.value.find(({ id }) => id === primary.connectionId)?.kind
    if (primaryKind === undefined) return false
    return uniqueFallbacks(route).some((fallbackId) => {
      const fallback = profileById(fallbackId)
      if (fallback === undefined) return false
      const fallbackKind = connections.value.find(({ id }) => id === fallback.connectionId)?.kind
      return fallbackKind !== undefined && fallbackKind !== primaryKind
    })
  }

  const crossProviderTargets = computed(() => {
    const labels = new Set<string>()
    const collect = (route: RouteDraft) => {
      const primary = profileById(route.primaryProfileId)
      if (primary === undefined) return
      for (const fallbackId of uniqueFallbacks(route)) {
        const fallback = profileById(fallbackId)
        const primaryKind = connections.value.find(({ id }) => id === primary.connectionId)?.kind
        const fallbackKind = fallback === undefined
          ? undefined
          : connections.value.find(({ id }) => id === fallback.connectionId)?.kind
        if (fallback !== undefined && primaryKind !== undefined && fallbackKind !== primaryKind) {
          labels.add(`${fallback.label}（${connectionName(fallback.connectionId)}）`)
        }
      }
    }
    modeRoutes.forEach(collect)
    roleRoutes.filter(({ enabled }) => enabled).forEach(collect)
    return [...labels]
  })

  watch(() => crossProviderTargets.value.join('|'), () => {
    confirmCrossProvider.value = false
  })

  const copyConnection = (source: ProviderConnectionSummary) => {
    connection.id = source.id
    connection.name = source.name
    connection.kind = source.kind
    connection.baseUrl = source.baseUrl ?? ''
    connection.enabled = source.enabled
    connectionApiKey.value = ''
    modelOptions.value = source.kind === 'openai-compatible' && source.baseUrl === DEEPSEEK_PRESET.baseUrl
      ? DEEPSEEK_PRESET.models.map((id) => ({ id, label: id }))
      : []
  }

  const selectConnection = (connectionId: string) => {
    const selected = connections.value.find(({ id }) => id === connectionId)
    if (selected !== undefined) copyConnection(selected)
  }

  const startNewConnection = () => {
    Object.assign(connection, emptyConnection())
    delete connection.id
    connectionApiKey.value = ''
    connectionError.value = ''
    connectionStatus.value = ''
    modelOptions.value = []
  }

  const applyDeepSeekPreset = () => {
    Object.assign(connection, {
      ...emptyConnection(),
      name: DEEPSEEK_PRESET.name,
      kind: DEEPSEEK_PRESET.kind,
      baseUrl: DEEPSEEK_PRESET.baseUrl
    })
    delete connection.id
    connectionApiKey.value = ''
    connectionTestModel.value = DEEPSEEK_PRESET.models[0]
    modelOptions.value = DEEPSEEK_PRESET.models.map((id) => ({ id, label: id }))
    connectionError.value = ''
    connectionStatus.value = '已应用 DeepSeek 预设；请输入你自己的 API 密钥后保存。'
  }

  const applyBindings = (configuration: ModelBindingConfiguration) => {
    const firstProfileId = profiles.value.find(profileSupportsMode)?.id ?? ''
    for (const route of modeRoutes) {
      const saved = configuration.modeDefaults.find(({ mode }) => mode === route.mode)
      route.primaryProfileId = saved?.primaryProfileId ?? firstProfileId
      route.fallbackProfileIds = [...(saved?.fallbackProfileIds ?? [])]
    }
    for (const route of roleRoutes) {
      const saved = configuration.roleBindings.find(({ role }) => role === route.role)
      const firstCapable = profiles.value.find((candidate) => profileSupportsRole(candidate, route.role))
      route.enabled = saved !== undefined
      route.mode = saved?.mode ?? 'standard'
      route.primaryProfileId = saved?.primaryProfileId ?? firstCapable?.id ?? ''
      route.fallbackProfileIds = [...(saved?.fallbackProfileIds ?? [])]
    }
    confirmCrossProvider.value = false
  }

  const load = async () => {
    loading.value = true
    loadError.value = ''
    try {
      const [connectionResult, profileResult, bindingResult] = await Promise.all([
        api.listConnections(),
        api.listProfiles(),
        api.getBindings()
      ])
      if (!connectionResult.ok || !profileResult.ok || !bindingResult.ok) {
        loadError.value = '模型设置加载失败，请重试。'
        return
      }
      connections.value = connectionResult.data.map((item) => ({ ...item }))
      profiles.value = profileResult.data.map((item) => ({
        ...item,
        capabilities: [...item.capabilities]
      }))
      if (connections.value.length > 0) copyConnection(connections.value[0])
      else startNewConnection()
      if (!profile.connectionId) profile.connectionId = connections.value[0]?.id ?? ''
      applyBindings(bindingResult.data)
    } catch {
      loadError.value = '模型设置加载失败，请重试。'
    } finally {
      loading.value = false
    }
  }

  const saveConnection = async () => {
    if (connectionBusy.value) return
    const name = connection.name.trim()
    const baseUrl = connection.baseUrl.trim()
    const apiKey = connectionApiKey.value.trim()
    if (!name) {
      connectionError.value = '请输入连接名称。'
      return
    }
    if (connection.kind === 'openai-compatible' && !baseUrl) {
      connectionError.value = 'OpenAI-compatible 连接必须填写 Base URL。'
      return
    }
    if (baseUrl && !isSecureBaseUrl(baseUrl)) {
      connectionError.value = 'Base URL 必须使用 HTTPS；仅本机开发可使用回环 HTTP。'
      return
    }
    if (connection.id === undefined && !apiKey) {
      connectionError.value = '新连接需要 API 密钥。'
      return
    }
    connectionBusy.value = true
    connectionError.value = ''
    connectionStatus.value = ''
    try {
      const result = await api.saveConnection({
        ...(connection.id === undefined ? {} : { id: connection.id }),
        name,
        kind: connection.kind,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
        enabled: connection.enabled
      })
      if (!result.ok) {
        connectionError.value = safeMessage(result.error, '连接保存失败，请检查设置后重试。')
        return
      }
      const index = connections.value.findIndex(({ id }) => id === result.data.id)
      if (index < 0) connections.value.push({ ...result.data })
      else connections.value[index] = { ...result.data }
      copyConnection(result.data)
      if (!profile.connectionId) profile.connectionId = result.data.id
      connectionStatus.value = apiKey
        ? '连接已保存，API 密钥输入已清空。'
        : '连接已更新，原 API 密钥保持不变。'
    } catch {
      connectionError.value = '连接保存失败，请重试。'
    } finally {
      connectionApiKey.value = ''
      connectionBusy.value = false
    }
  }

  const listModels = async () => {
    if (modelsBusy.value || connection.id === undefined) {
      if (connection.id === undefined) connectionError.value = '请先保存连接，再获取模型列表。'
      return
    }
    modelsBusy.value = true
    connectionError.value = ''
    try {
      const result = await api.listModels(connection.id)
      if (!result.ok) {
        connectionError.value = safeMessage(result.error, '供应商未提供模型列表，请继续使用手工模型 ID。')
        return
      }
      modelOptions.value = result.data.map((item) => ({ ...item }))
      connectionStatus.value = result.data.length
        ? `已获取 ${result.data.length} 个模型；仍可输入列表外的模型 ID。`
        : '供应商未返回模型；请使用手工模型 ID。'
    } catch {
      connectionError.value = '模型列表获取失败，请继续使用手工模型 ID。'
    } finally {
      modelsBusy.value = false
    }
  }

  const testConnection = async () => {
    if (activeTestRequestId.value !== undefined) return
    if (connection.id === undefined) {
      connectionError.value = '请先保存连接，再测试连接。'
      return
    }
    const modelId = connectionTestModel.value.trim()
    if (!modelId) {
      connectionError.value = '请输入要测试的模型 ID。'
      return
    }
    const requestId = `model-test-${Date.now()}-${++connectionTestSequence}`
    activeTestRequestId.value = requestId
    connectionError.value = ''
    connectionStatus.value = '正在验证认证和模型可用性…'
    try {
      const result = await api.testConnection({
        requestId,
        connectionId: connection.id,
        modelId
      })
      if (activeTestRequestId.value !== requestId) return
      if (!result.ok) {
        connectionError.value = safeMessage(result.error, '连接测试失败，请检查设置后重试。')
        return
      }
      connectionStatus.value = `连接可用，延迟 ${Math.round(result.data.latencyMs)}ms。`
    } catch {
      if (activeTestRequestId.value === requestId) connectionError.value = '连接测试失败，请重试。'
    } finally {
      if (activeTestRequestId.value === requestId) activeTestRequestId.value = undefined
    }
  }

  const cancelConnectionTest = async () => {
    const requestId = activeTestRequestId.value
    if (requestId === undefined || cancellingTest.value) return
    cancellingTest.value = true
    try {
      await api.cancelConnectionTest(requestId)
      if (activeTestRequestId.value === requestId) {
        activeTestRequestId.value = undefined
        connectionError.value = ''
        connectionStatus.value = '连接测试已取消。'
      }
    } catch {
      connectionError.value = '取消请求未完成，请稍后重试。'
    } finally {
      cancellingTest.value = false
    }
  }

  const editProfile = (source: ModelProfile) => {
    Object.assign(profile, {
      ...source,
      capabilities: [...source.capabilities]
    })
    profileError.value = ''
    profileStatus.value = ''
  }

  const startNewProfile = () => {
    Object.assign(profile, {
      ...emptyProfile(),
      connectionId: connections.value[0]?.id ?? ''
    })
    profileError.value = ''
    profileStatus.value = ''
  }

  const saveProfile = async () => {
    if (profileBusy.value) return
    const label = profile.label.trim()
    const modelId = profile.modelId.trim()
    if (!profile.connectionId || !label || !modelId) {
      profileError.value = '请选择连接，并填写档案名称和模型 ID。'
      return
    }
    if (!Number.isFinite(profile.temperature) || profile.temperature < 0 || profile.temperature > 2) {
      profileError.value = '温度必须在 0 到 2 之间。'
      return
    }
    if (!Number.isSafeInteger(profile.maxOutputTokens) || profile.maxOutputTokens <= 0 ||
        !Number.isSafeInteger(profile.contextWindow) || profile.contextWindow <= 0) {
      profileError.value = '最大输出与上下文窗口必须是正整数。'
      return
    }
    profileBusy.value = true
    profileError.value = ''
    profileStatus.value = ''
    try {
      const result = await api.saveProfile({
        ...(profile.id === undefined ? {} : { id: profile.id }),
        connectionId: profile.connectionId,
        label,
        modelId,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        contextWindow: profile.contextWindow,
        capabilities: [...new Set(profile.capabilities)]
      })
      if (!result.ok) {
        profileError.value = safeMessage(result.error, '模型档案保存失败，请检查设置后重试。')
        return
      }
      const index = profiles.value.findIndex(({ id }) => id === result.data.id)
      const saved = { ...result.data, capabilities: [...result.data.capabilities] }
      if (index < 0) profiles.value.push(saved)
      else profiles.value[index] = saved
      editProfile(saved)
      profileStatus.value = '模型档案已保存。'
      if (profiles.value.length === 1) applyBindings({ modeDefaults: [], roleBindings: [] })
    } catch {
      profileError.value = '模型档案保存失败，请重试。'
    } finally {
      profileBusy.value = false
    }
  }

  const validateRoleRoutes = (): boolean => {
    for (const route of roleRoutes.filter(({ enabled }) => enabled)) {
      const primary = profileById(route.primaryProfileId)
      if (primary === undefined || !profileSupportsRole(primary, route.role)) {
        bindingsError.value = `${ROLE_LABELS[route.role]}角色需要${requiredCapabilitiesForRole(route.role).map((item) => CAPABILITY_LABELS[item]).join('、')}能力。`
        return false
      }
      for (const fallbackId of uniqueFallbacks(route)) {
        const fallback = profileById(fallbackId)
        if (fallback === undefined || !profileSupportsRole(fallback, route.role)) {
          bindingsError.value = `${ROLE_LABELS[route.role]}角色的 fallback 能力不足。`
          return false
        }
      }
    }
    return true
  }

  const validateModeRoutes = (): boolean => {
    for (const route of modeRoutes) {
      const primary = profileById(route.primaryProfileId)
      if (primary === undefined || !profileSupportsMode(primary)) {
        bindingsError.value = `${MODE_LABELS[route.mode]}模式需要流式文本、结构化输出能力。`
        return false
      }
      for (const fallbackId of uniqueFallbacks(route)) {
        const fallback = profileById(fallbackId)
        if (fallback === undefined || !profileSupportsMode(fallback)) {
          bindingsError.value = `${MODE_LABELS[route.mode]}模式的 fallback 能力不足。`
          return false
        }
      }
    }
    return true
  }

  const toSavedRoute = (route: RouteDraft): ModelRoute => ({
    primaryProfileId: route.primaryProfileId,
    fallbackProfileIds: uniqueFallbacks(route),
    allowCrossProviderFallback: routeCrossesProvider(route)
  })

  const saveBindings = async () => {
    if (!canSaveBindings.value) return
    bindingsError.value = ''
    bindingsStatus.value = ''
    if (modeRoutes.some(({ primaryProfileId }) => !profileById(primaryProfileId))) {
      bindingsError.value = '请为快速、标准和深度模式分别选择默认模型档案。'
      return
    }
    if (!validateModeRoutes() || !validateRoleRoutes()) return
    if (crossProviderTargets.value.length > 0 && !confirmCrossProvider.value) {
      bindingsError.value = '请先确认跨供应商 fallback 目标和数据路由。'
      return
    }
    const input: SaveModelBindingsInput = {
      modeDefaults: modeRoutes.map((route) => ({ mode: route.mode, ...toSavedRoute(route) })),
      roleBindings: roleRoutes
        .filter(({ enabled }) => enabled)
        .map((route) => ({ role: route.role, mode: route.mode, ...toSavedRoute(route) })),
      confirmCrossProviderRouting: confirmCrossProvider.value
    }
    bindingsBusy.value = true
    try {
      const result = await api.saveBindings(input)
      if (!result.ok) {
        bindingsError.value = safeMessage(result.error, '角色绑定保存失败，请检查配置后重试。')
        return
      }
      applyBindings(result.data)
      bindingsStatus.value = '模式默认与角色覆盖已保存到当前项目。'
    } catch {
      bindingsError.value = '角色绑定保存失败，请重试。'
    } finally {
      bindingsBusy.value = false
    }
  }

  return {
    AGENT_ROLES,
    CAPABILITY_LABELS,
    GENERATION_MODES,
    MODEL_CAPABILITIES,
    MODE_LABELS,
    PROVIDER_LABELS,
    ROLE_LABELS,
    activeTestRequestId,
    applyDeepSeekPreset,
    bindingsBusy,
    bindingsError,
    bindingsStatus,
    canSaveBindings,
    cancelConnectionTest,
    cancellingTest,
    confirmCrossProvider,
    connection,
    connectionApiKey,
    connectionBusy,
    connectionError,
    connectionName,
    connectionStatus,
    connectionTestModel,
    connections,
    crossProviderTargets,
    editProfile,
    listModels,
    load,
    loadError,
    loading,
    modeRoutes,
    modelOptions,
    modelsBusy,
    profile,
    profileBusy,
    profileError,
    profileStatus,
    profileSupportsMode,
    profileSupportsRole,
    profiles,
    roleRoutes,
    saveBindings,
    saveConnection,
    saveProfile,
    selectConnection,
    selectedConnection,
    startNewConnection,
    startNewProfile,
    testConnection
  }
}
