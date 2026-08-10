# 阶段 3 BYOK 密钥库、Model Gateway 与角色绑定实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目阶段 1–8 固定在根工作区 `feat/v1.0` 实施，不新建 worktree；未获用户明确授权时不使用子 Agent 或 GitHub Actions。

**目标：** 交付安全的 BYOK 模型连接、三类 Provider Adapter、供应商无关 Model Gateway、模型档案、项目级角色绑定与可操作的设置页，使后续 Agent 工作流可以通过稳定契约选择并调用模型。

**架构：** 渲染层只接触脱敏的共享类型与固定 IPC；主进程模型域负责控制库元数据、`safeStorage` 密钥文件、URL/重定向策略、Provider Registry、错误归一化、重试、取消和无内容日志。应用级 `control.sqlite3` 保存连接、模型档案和调用元数据，项目库保存模式默认值及角色覆盖；供应商 SDK 只允许出现在 `src/model/`。

**技术栈：** Electron 43、Vue 3、TypeScript 6、Node 24/26 `node:sqlite` Worker、Vercel AI SDK、`@ai-sdk/openai-compatible`、`@ai-sdk/anthropic`、`@ai-sdk/google`、Zod、Node Test Runner、Vitest 与本地 HTTP fake provider。

## 全局约束

- 仅实现阶段 3；不实现小说圣经、真实多 Agent 正文工作流、外部 Skill、云同步、安装包或新的 GitHub Actions 行为。
- API Key 只在主进程模型域短暂解密；renderer、IPC 返回、项目数据库、应用数据库、导出、备份和普通日志不得出现明文。
- `safeStorage.isEncryptionAvailable()` 返回 false 时拒绝持久化，不得降级为明文。
- OpenAI-compatible Base URL 仅允许 HTTPS；用户显式填写的回环地址允许 HTTP；URL 凭据、非 HTTP(S) 协议和不安全重定向全部拒绝。
- 默认禁止跨供应商 fallback；只有保存绑定时显式确认数据路由和费用影响后才可启用，并在设置页显示实际目标供应商。
- 只对 408、409、429 与 5xx、离线/DNS/超时做有限带抖动退避；认证、余额、模型不存在、内容策略、无效结构和用户取消不盲目重试。
- 能力未知时按最小能力处理；不允许把角色绑定到缺少该角色所需能力的档案。
- 所有自动化 Provider 测试使用本机 fake server，不访问真实供应商；真实连接验证由用户在设置页本地输入凭据执行，密钥不得进入对话或版本库。
- 用户已指定真实连接使用 DeepSeek API Key：设置页提供 OpenAI-compatible 的 DeepSeek 预设，Base URL 固定建议为 `https://api.deepseek.com`，当前模型建议为 `deepseek-v4-flash` 或 `deepseek-v4-pro`；仍允许用户手工填写其他兼容服务，且不在源码中保存任何 Key。
- 不新增、启用、重新启用或手动触发 GitHub Actions；完成依据只来自本地命令和人工本地验证。
- 修改任何受维护目录时同步其 `README.md`；完成前运行 `npm.cmd run check:readmes`。

## 修改目标、范围与明确不包含内容

### 修改目标

1. 建立完整的模型共享契约、稳定错误码、固定 IPC 和脱敏结果。
2. 在应用级控制库持久化 Provider 连接、Model Profile 与无内容调用日志，在项目库持久化生成模式默认与角色覆盖。
3. 用独立加密文件保存 API Key，并用数据库中的不可反解 `secretRef`、`hasSecret` 和末四位提示关联。
4. 通过 AI SDK 实现 OpenAI-compatible、Anthropic 和 Gemini 适配器以及统一 Model Gateway。
5. 实现连接测试、手工模型 ID、可选模型列表、能力探测、档案配置、角色绑定、跨供应商确认与未配置模型阻断。
6. 把设置占位页替换为可访问、可测试、窄屏可用的模型设置页。

### 明确不包含

- 不把真实模型接入现有离线 Agent Harness；真实 `ModelExecutor` 属于阶段 5。
- 不保存完整 Prompt、正文、API Key、供应商原始推理或原始响应体。
- 不实现自动跨供应商选择、价格抓取、预算扣费、云端密钥同步或团队共享连接。
- 不自动下载模型列表作为唯一入口；手工模型 ID 始终可用，列表仅为适配器可选能力。DeepSeek 预设只填充官方 Base URL 和当前模型建议，不改变通用 OpenAI-compatible 契约。
- 不修改 `.github/workflows/`，不读取、修改、清理或暂存用户既有 `.superpowers/`。

## 开工记录

- 日期：2026-08-10（Asia/Singapore）。
- 工作区：`D:\Code\codex\openNovel`。
- 分支：`feat/v1.0`。
- 基线 HEAD：`419b4d8`。
- 远端核对：`git fetch --prune origin` 成功；`feat/v1.0` 与 `origin/feat/v1.0` 均为 `419b4d8`，ahead/behind 为 `0/0`。
- 并行工作区：保留 `.worktrees/harness-agent-loop@31ca681` 与 `.worktrees/phase-0-test-foundation@0736181`，本任务不修改、删除或复用。
- 既有修改：`AGENTS.md`、根 `README.md`、`docs/2026-08-10/README.md` 与 `docs/2026-08-10/GitHub Actions默认禁用约束计划.md` 归属独立治理任务；未跟踪 `.superpowers/` 归属用户。阶段 3 保留这些差异并在提交时排除，若必须同步同一 README，仅增加阶段 3 自有段落并单独核对暂存内容。
- 当前阶段状态：阶段 3 从“待开始”进入“进行中”；最近验证为远端同步核对，尚未运行阶段 3 代码测试。
- 当前阻塞：无。真实供应商人工连接需要用户在最终设置页本地输入测试凭据，不阻塞自动化实现。
- 可直接执行的下一步：Task 1 先安装并锁定规定依赖，再为共享模型契约和数据库迁移编写 RED 测试。

## 文件职责图

### 新增文件

- `src/shared/model.ts`：跨 main/preload/renderer 安全共享的模型类型、稳定错误码、结果类型、能力要求与运行时校验。
- `src/model/README.md`：模型域用途、依赖边界、安全规则和变更同步。
- `src/model/model-validation.ts`：连接、Base URL、模型档案和角色绑定的纯校验；实现安全重定向 fetch。
- `src/model/secret-store.ts`：注入式 `safeStorage` cipher、原子加密文件写入、读取、轮换与删除。
- `src/model/model-repository.ts`：控制库连接/档案/调用日志 CRUD，以及项目绑定所需的数据映射。
- `src/model/provider-adapter.ts`：三类适配器共同端口、内部请求/响应和错误边界。
- `src/model/openai-compatible-adapter.ts`：OpenAI-compatible AI SDK 适配器和可选 `/models` 列表。
- `src/model/anthropic-adapter.ts`：Anthropic AI SDK 适配器。
- `src/model/gemini-adapter.ts`：Google Generative AI SDK 适配器。
- `src/model/provider-registry.ts`：按连接 kind 构造适配器，禁止业务层接触供应商 SDK。
- `src/model/model-gateway.ts`：档案解析、能力门禁、流/对象生成、有限重试、取消、错误归一化和调用日志。
- `src/model/model-service.ts`：设置页用例编排、密钥生命周期、连接测试、档案和项目角色绑定。
- `src/main/model-logger.ts`：只允许模型调用元数据字段的安全日志 sink。
- `src/main/model-runtime.ts`：把 ModelService 映射成脱敏 `ModelResult`，维护活动调用取消与 shutdown。
- `src/main/model-ipc.ts`：固定模型 IPC handler、sender 校验和参数校验。
- `src/preload/model-api.ts`：固定的 `window.openNovel.models` bridge 与返回值校验。
- `src/renderer/src/model/README.md`：renderer 模型设置状态边界。
- `src/renderer/src/model/use-model-settings.ts`：设置页状态、表单校验、忙碌锁和错误提示映射。
- `src/renderer/src/views/ModelSettingsView.vue`：连接、档案、生成模式默认、角色覆盖与安全说明界面。
- `tests/model-contract.test.mjs`：共享契约、能力要求与运行时校验。
- `tests/model-secret-store.test.mjs`：加密可用性、原子写、轮换、删除和明文泄漏。
- `tests/model-repository.test.mjs`：控制库迁移、档案与项目绑定持久化。
- `tests/model-provider-adapters.test.mjs`：三类本机 fake provider 契约、流、对象、用量、模型列表和取消。
- `tests/model-gateway.test.mjs`：重试矩阵、错误码、能力门禁、取消和无内容日志。
- `tests/model-ipc.test.mjs`：固定 IPC、sender/参数校验、preload 脱敏和 shutdown。
- `tests/model-security.test.mjs`：数据库、项目备份、导出、日志与序列化结果的密钥全文搜索。
- `tests/ui/model-settings.spec.ts`：设置页加载、保存、测试、档案、绑定、跨供应商确认与可访问性。

### 修改文件

- `package.json`、`package-lock.json`：加入并精确锁定 `ai`、三类 provider 与 `zod`。
- `tsconfig.node.json`：纳入 `src/model/**/*.ts`。
- `src/novel/schema.ts`：控制库 v2 模型表与项目库 v3 角色绑定表。
- `src/novel/project-repository.ts`、`src/novel/project-service.ts`：活动项目的模式默认和角色覆盖读写端口。
- `src/main/index.ts`：启动/注册/关闭模型域并注入 Electron `safeStorage`。
- `src/preload/index.ts`：只暴露 `models` 命名域。
- `src/renderer/src/env.d.ts`：声明脱敏 `ModelApi`。
- `src/renderer/src/router/index.ts`：设置路由改用真实设置页。
- `src/renderer/src/assets/base.css`：模型设置页布局、状态、窄屏与 reduced-motion 样式。
- 受影响目录的 `README.md`、根 `README.md`、本计划与 `DEVELOPMENT_PROGRESS.md`：同步契约、过程、验证和交接。

## 公开接口基线

`src/shared/model.ts` 必须定义并由所有层复用以下稳定形状；供应商 SDK 类型不得出现在这些签名中：

```ts
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini'
export type AgentRole = 'editor' | 'setting' | 'character' | 'plot' | 'writer' | 'reviewer'
export type GenerationMode = 'quick' | 'standard' | 'deep'
export type ModelCapability = 'stream-text' | 'structured-output' | 'tools' | 'usage'

export interface ProviderConnectionSummary {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  enabled: boolean
  hasSecret: boolean
  secretHint?: string
  createdAt: string
  updatedAt: string
}

export interface ModelProfile {
  id: string
  connectionId: string
  label: string
  modelId: string
  temperature: number
  maxOutputTokens: number
  contextWindow: number
  capabilities: ModelCapability[]
}

export interface AgentRoleBinding {
  role: AgentRole
  mode: GenerationMode
  primaryProfileId: string
  fallbackProfileIds: string[]
  allowCrossProviderFallback: boolean
}

export interface ModelGateway {
  testConnection(connectionId: string, modelId: string, signal: AbortSignal): Promise<ConnectionTestResult>
  streamText(request: TextGenerationRequest): AsyncIterable<ModelStreamEvent>
  generateObject<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>>
  estimateTokens(request: TokenEstimateRequest): Promise<TokenEstimate>
}
```

固定错误码至少包含：`MODEL_NOT_CONFIGURED`、`MODEL_ENCRYPTION_UNAVAILABLE`、`MODEL_SECRET_MISSING`、`MODEL_INVALID_BASE_URL`、`MODEL_CAPABILITY_REQUIRED`、`MODEL_OFFLINE`、`MODEL_DNS_FAILED`、`MODEL_TIMEOUT`、`MODEL_RATE_LIMITED`、`MODEL_AUTH_FAILED`、`MODEL_BALANCE_EXHAUSTED`、`MODEL_NOT_FOUND`、`MODEL_CONTENT_BLOCKED`、`MODEL_INVALID_STRUCTURE`、`MODEL_CANCELLED`、`MODEL_PROVIDER_FAILED`、`MODEL_IPC_NOT_AUTHORIZED`、`MODEL_INVALID_COMMAND`。

---

### Task 1：依赖、共享契约与数据库迁移

**Files:**
- Create: `src/shared/model.ts`
- Create: `tests/model-contract.test.mjs`
- Modify: `src/novel/schema.ts`
- Modify: `tests/project-database.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.node.json`
- Modify: `src/shared/README.md`
- Modify: `src/novel/README.md`
- Modify: root `README.md`
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: `DatabaseMigration`、现有 `DatabaseWorkerClient` 和共享 `ProjectResult` 风格。
- Produces: 上述公开接口、`MODEL_IPC_CHANNELS`、`validateModelCommand()`、控制库 v2 和项目库 v3。

- [x] **Step 1: 安装并锁定规定依赖**

```powershell
npm.cmd install ai @ai-sdk/openai-compatible @ai-sdk/anthropic @ai-sdk/google zod
```

检查 `npm.cmd ls`、许可证、Electron/Node engine 警告和 `package-lock.json`，确认没有第二套同类 provider 抽象。

- [x] **Step 2: 写共享契约与迁移 RED 测试**

```js
assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.listConnections, []), true)
assert.equal(validateModelCommand(MODEL_IPC_CHANNELS.saveConnection, [{ apiKey: 'secret' }]), false)
assert.deepEqual(requiredCapabilitiesForRole('writer'), ['stream-text'])
assert.deepEqual(requiredCapabilitiesForRole('plot'), ['structured-output'])
assert.match(CONTROL_MIGRATIONS.at(-1).sql, /provider_connections/)
assert.match(PROJECT_MIGRATIONS.at(-1).sql, /agent_role_bindings/)
```

- [x] **Step 3: 运行 RED**

```powershell
node --experimental-strip-types --test tests/model-contract.test.mjs tests/project-database.test.mjs
```

预期：因 `src/shared/model.ts` 和 v2/v3 迁移尚不存在而失败。

- [x] **Step 4: 实现最小共享类型、严格运行时校验和迁移**

控制库表只保存 `secret_ref` 与 `secret_hint`，调用日志列只允许 provider/model/latency/token/cost/retry/error/request-id；项目库保存 `generation_mode_defaults` 与 `agent_role_bindings`，不建立跨数据库外键。

- [x] **Step 5: 运行 GREEN 并同步 README**

```powershell
node --experimental-strip-types --test tests/model-contract.test.mjs tests/project-database.test.mjs
npm.cmd run typecheck:node
```

预期：聚焦测试与 Node 类型检查退出 0。

### Task 2：密钥库与 URL/重定向安全策略

**Files:**
- Create: `src/model/README.md`
- Create: `src/model/model-validation.ts`
- Create: `src/model/secret-store.ts`
- Create: `tests/model-secret-store.test.mjs`

**Interfaces:**
- Consumes: `ProviderKind`、`ModelDomainError`、Node `fs/promises`。
- Produces: `EncryptedSecretStore.save/read/remove()`、`validateProviderBaseUrl()`、`createSecureRedirectFetch()`。

- [x] **Step 1: 写密钥与 URL RED 测试**

```js
await assert.rejects(store.save('secret-ref', 'sk-plain'), hasCode('MODEL_ENCRYPTION_UNAVAILABLE'))
assert.equal(validateProviderBaseUrl('https://api.example.com/v1').protocol, 'https:')
assert.equal(validateProviderBaseUrl('http://127.0.0.1:11434/v1').hostname, '127.0.0.1')
assert.throws(() => validateProviderBaseUrl('https://user:pass@example.com'), hasCode('MODEL_INVALID_BASE_URL'))
assert.throws(() => validateProviderBaseUrl('http://api.example.com'), hasCode('MODEL_INVALID_BASE_URL'))
```

测试还要证明写入采用同目录临时文件 + 原子 rename，失败不破坏旧密文，磁盘全文不含 `sk-plain`，不安全 Location 在发出第二跳前被拒绝。

- [x] **Step 2: 运行 RED**

```powershell
node --experimental-strip-types --test tests/model-secret-store.test.mjs
```

预期：模型安全模块不存在而失败。

- [x] **Step 3: 实现注入式 cipher 和安全 fetch**

```ts
export type SecretCipher = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}
```

`save()` 必须先检查可用性、加密后再写盘；文件名只来自校验后的 UUID/opaque ref。`createSecureRedirectFetch()` 使用 `redirect: 'manual'` 限制跳数并逐跳校验协议，绝不把 Authorization 转发到不同 origin。

- [x] **Step 4: 运行 GREEN**

```powershell
node --experimental-strip-types --test tests/model-secret-store.test.mjs
npm.cmd run typecheck:node
```

预期：聚焦测试和类型检查退出 0。

### Task 3：连接、档案和项目角色绑定持久化

**Files:**
- Create: `src/model/model-repository.ts`
- Create: `src/model/model-service.ts`
- Create: `tests/model-repository.test.mjs`
- Modify: `src/novel/project-repository.ts`
- Modify: `src/novel/project-service.ts`
- Modify: `src/novel/README.md`

**Interfaces:**
- Consumes: 控制库 v2、项目库 v3、`EncryptedSecretStore`。
- Produces: `ModelRepository`、`ModelService.list/save/test` 用例、`ProjectService.list/saveModelBindings()`。

- [x] **Step 1: 写迁移与重启持久化 RED 测试**

```js
await service.saveConnection({ name: '本地兼容服务', kind: 'openai-compatible', baseUrl, apiKey: 'sk-test', enabled: true })
assert.deepEqual(Object.keys((await service.listConnections())[0]).sort(), publicConnectionKeys)
await service.saveProfile(profile)
await project.saveModeDefault({ mode: 'standard', primaryProfileId: profile.id, fallbackProfileIds: [], allowCrossProviderFallback: false })
await project.saveRoleBinding({ role: 'reviewer', mode: 'standard', primaryProfileId: profile.id, fallbackProfileIds: [], allowCrossProviderFallback: false })
```

关闭并重开后断言连接仅显示 `hasSecret/secretHint`、档案和绑定保持一致；连接 API Key 留空时保留旧密钥，显式替换时先安全写新密文再提交元数据。

- [x] **Step 2: 运行 RED**

```powershell
node --experimental-strip-types --test tests/model-repository.test.mjs
```

预期：repository/service 和项目绑定方法缺失而失败。

- [x] **Step 3: 实现串行 CRUD、能力与跨供应商一致性校验**

保存绑定时解析全部 profile → connection kind；存在跨供应商 fallback 时必须同时满足 `allowCrossProviderFallback === true` 与命令级 `confirmCrossProviderRouting === true`。profile 缺少角色能力时返回 `MODEL_CAPABILITY_REQUIRED`。

- [x] **Step 4: 运行 GREEN**

```powershell
node --experimental-strip-types --test tests/model-repository.test.mjs tests/project-lifecycle.test.mjs
npm.cmd run typecheck:node
```

预期：模型持久化、项目生命周期回归和类型检查退出 0。

**实际结果（2026-08-10）：** 新增 control 数据库连接/Profile 仓储、密钥与元数据编排服务，以及项目库模式默认/角色覆盖读写。公开连接不含 `apiKey`/`secretRef`，空 Key 更新保留旧密钥；保存绑定会验证档案能力、连接启用状态，并要求跨供应商 fallback 同时具有配置开关和命令级显式确认。RED 因 `model-repository.ts` 缺失按预期失败；GREEN 首轮暴露生命周期测试仍占用正式 v3 版本号，查明后把故障迁移夹具推进到临时 v4。最终 `tests/model-repository.test.mjs` 与 `tests/project-lifecycle.test.mjs` 共 15/15 通过，`npm.cmd run typecheck:node` 退出 0。

### Task 4：三类 Provider Adapter 与能力探测

**Files:**
- Create: `src/model/provider-adapter.ts`
- Create: `src/model/openai-compatible-adapter.ts`
- Create: `src/model/anthropic-adapter.ts`
- Create: `src/model/gemini-adapter.ts`
- Create: `src/model/provider-registry.ts`
- Create: `tests/model-provider-adapters.test.mjs`
- Modify: `src/shared/model.ts`
- Modify: `src/shared/README.md`
- Modify: `src/model/README.md`
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: AI SDK、三类 provider 包、`createSecureRedirectFetch()`。
- Produces: 统一 `ProviderAdapter`：`testConnection`、`listModels`、`streamText`、`generateObject`。

- [x] **Step 1: 写三类 fake server RED 契约**

```js
for (const fixture of providerFixtures) {
  const result = await fixture.adapter.testConnection({ modelId: fixture.modelId, signal: AbortSignal.timeout(2_000) })
  assert.equal(result.authenticated, true)
  assert.equal(result.modelAvailable, true)
  assert.ok(result.capabilities.includes('stream-text'))
  assert.equal(await collectText(fixture.adapter.streamText(request)), '你好，星海')
}
```

每类 fixture 使用其原生请求/响应形状，覆盖结构化对象、usage、request ID、认证失败、模型不存在、内容策略、429、畸形响应和取消。OpenAI-compatible 额外覆盖 `/models` 可选列表；其余适配器允许返回“不支持列表”而保留手工 ID。

- [x] **Step 2: 运行 RED**

```powershell
node --experimental-strip-types --test tests/model-provider-adapters.test.mjs
```

预期：适配器尚不存在而失败。

- [x] **Step 3: 用 AI SDK 实现适配器与 Registry**

```ts
export interface ProviderAdapter {
  testConnection(input: AdapterConnectionTest): Promise<ConnectionTestResult>
  listModels(signal: AbortSignal): Promise<ProviderModelOption[] | undefined>
  streamText(input: AdapterTextRequest): AsyncIterable<AdapterStreamEvent>
  generateObject<T>(input: AdapterObjectRequest<T>): Promise<AdapterObjectResult<T>>
}
```

所有 provider factory 必须只在 `src/model/` 导入；结构化输出在返回前再经调用方 Zod schema 校验，供应商自报能力不能跳过本地校验。

AI SDK 7 的 `Output.object()` 需要可导出 JSON Schema 的完整标准 schema；Task 1 仅含 `safeParse` 的最小 `RuntimeSchema` 会丢失生成端约束。因此本任务把该共享类型收紧为 Zod schema，但仍不把任何供应商 SDK 类型暴露到共享层。

- [x] **Step 4: 运行 GREEN**

```powershell
node --experimental-strip-types --test tests/model-provider-adapters.test.mjs
npm.cmd run typecheck:node
```

预期：三类适配器契约与 Node 类型检查退出 0，测试仅访问回环 fake server。

**实际结果（2026-08-10）：** 使用已安装 AI SDK 7 的 `generateText`、`streamText` 与 `Output.object()` 实现统一适配端口，并由 Registry 在模型域内部构造 OpenAI-compatible、Anthropic 和 Gemini provider；三类网络调用均经过安全重定向 fetch。OpenAI-compatible 支持可选 `/models`，原生适配器保留手工 ID。共享结构 schema 收紧为 Zod，使供应商原生结构化约束下发后仍做本地二次校验。错误对象只保留类别/status/供应商码/request ID，不带请求或响应正文。RED 因适配器缺失按预期失败；首轮 GREEN 证明 AI SDK 会把 HTTP 200 畸形 JSON 包装为 `APICallError(statusCode=200)`，据此将 2xx 解析失败明确归为 `invalid-response`。最终三组顶层测试及六个 provider 子测试共 9/9 通过，`npm.cmd run typecheck:node` 退出 0。

### Task 5：Model Gateway、稳定错误、有限重试与安全日志

**Files:**
- Create: `src/model/model-gateway.ts`
- Create: `src/main/model-logger.ts`
- Create: `tests/model-gateway.test.mjs`
- Modify: `src/model/model-repository.ts`
- Modify: `src/model/provider-adapter.ts`
- Modify: `src/model/README.md`
- Modify: `src/main/README.md`
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: `ModelRepository`、`EncryptedSecretStore`、`ProviderRegistry`、公开 `ModelGateway`。
- Produces: 可注入时钟/退避/ID 的 `DefaultModelGateway` 和 `SafeModelCallLog`。

- [x] **Step 1: 写路由、重试、取消与日志 RED 测试**

```js
assert.equal((await failing('MODEL_AUTH_FAILED')).attempts, 1)
assert.equal((await failing('MODEL_RATE_LIMITED')).attempts, 3)
await assert.rejects(collectText(gateway.streamText({ ...request, signal: aborted })), hasCode('MODEL_CANCELLED'))
assert.doesNotMatch(JSON.stringify(logs), /prompt text|chapter body|sk-secret|reasoning/i)
```

覆盖 408/409/429/5xx、离线、DNS、超时、认证、余额、模型不存在、内容策略、无效结构、取消；验证抖动上限、最大尝试数、流开始后不重放已输出文本，以及 capability 未知/不足时调用前失败。

- [x] **Step 2: 运行 RED**

```powershell
node --experimental-strip-types --test tests/model-gateway.test.mjs
```

预期：gateway 和模型 logger 缺失而失败。

- [x] **Step 3: 实现统一调用路径**

每次调用先解析 profile/connection/secret，再做能力门禁；只在尚未产生流事件时重试。日志白名单固定为 provider、connection/profile/model、operation、latency、input/output token、estimated cost、retry count、error code 和 provider request ID。

`model_call_logs` 必须继续通过现有 `ModelRepository`/SQLite Worker 串行边界写入，不允许主进程日志器直接持有数据库。Provider Adapter 的网络失败只向 Gateway 暴露经白名单提取的系统错误码，绝不携带 URL、请求正文、响应正文或原始异常链。

- [x] **Step 4: 运行 GREEN**

```powershell
node --experimental-strip-types --test tests/model-gateway.test.mjs
npm.cmd run typecheck:node
```

预期：错误与日志矩阵全绿。

**实际结果（2026-08-10）：** 新增 `DefaultModelGateway`，所有调用在读取密钥前验证 Profile 能力和连接可用性；认证、余额、模型不存在、内容策略、无效结构、取消、408/409/429/5xx、DNS、离线与超时均映射为稳定错误。仅瞬时错误最多尝试三次，退避为 100ms/200ms 指数基线加 0.75–1.25 有界抖动；任何流事件暴露后均不重放。退避中取消会记录 `cancelled`，瞬时故障后成功只写一条最终日志。调用日志先由主进程 logger 重建固定白名单，再经 `ModelRepository`/SQLite Worker 串行持久化，不含 Prompt、正文、Key、推理或响应体。RED 因 Gateway/logger 缺失按预期失败；补充自检 RED 后修正连接测试模型 ID 与退避取消日志。最终六组顶层测试及十五个子测试共 21/21 通过，`npm.cmd run typecheck:node` 退出 0。

### Task 6：主进程 Runtime、固定 IPC 与 Preload 脱敏边界

**Files:**
- Create: `src/main/model-runtime.ts`
- Create: `src/main/model-ipc.ts`
- Create: `src/preload/model-api.ts`
- Create: `tests/model-ipc.test.mjs`
- Modify: `src/shared/model.ts`
- Modify: `src/shared/README.md`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/renderer/src/README.md`
- Modify: `src/main/README.md`
- Modify: `src/preload/README.md`
- Modify: `tests/electron-foundation.test.mjs`
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: `ModelService`、现有 `AgentSenderPolicy` 与 sender 校验。
- Produces: `window.openNovel.models` 的 list/save/test/listModels/listProfiles/saveProfile/getBindings/saveBindings 命名方法。

- [x] **Step 1: 写 IPC 与 bridge RED 测试**

```js
assert.deepEqual([...handlers.keys()].sort(), Object.values(MODEL_IPC_CHANNELS).sort())
assert.equal((await unauthorized()).error.code, 'MODEL_IPC_NOT_AUTHORIZED')
assert.deepEqual(Object.keys(createModelApi(ipcRenderer)).sort(), expectedNamedMethods)
assert.doesNotMatch(JSON.stringify(await api.listConnections()), /apiKey|secretRef|sk-test/i)
```

覆盖非顶层 frame、错误 origin、多余参数、畸形 bridge 返回、重复调用锁、取消连接测试和应用关闭等待活动调用。

- [x] **Step 2: 运行 RED**

```powershell
node --experimental-strip-types --test tests/model-ipc.test.mjs
```

预期：runtime/IPC/preload 缺失而失败。

- [x] **Step 3: 实现固定 handler 并接入应用生命周期**

main 在 `app.whenReady()` 后注入 `safeStorage` 与 `userData/model-secrets`；启动失败显示不含路径/密钥的安全提示。shutdown 先取消并等待模型调用，再关闭模型控制库，最后关闭项目数据库。

- [x] **Step 4: 运行 GREEN**

```powershell
node --experimental-strip-types --test tests/model-ipc.test.mjs tests/electron-foundation.test.mjs
npm.cmd run typecheck:node
```

预期：IPC、Electron 安全基线和类型检查退出 0。

**实际结果（2026-08-10）：** 新增模型 runtime、九个固定 IPC handler 和九方法 preload API；共享命令与成功载荷守卫已收紧为精确字段、枚举、数值、唯一 ID 与密钥字段拒绝。runtime 以请求 ID 锁定连接测试，支持幂等取消；shutdown 会拒绝新工作、取消所有连接测试与模型列表网络请求、等待活动结果收敛，再关闭 ModelService/控制库。生产入口在 `whenReady()` 后注入 Electron `safeStorage` 与 `userData/model-secrets`，注册 Model IPC，并保证模型 runtime 先于章节/项目资源关闭；启动提示不含路径或密钥。RED 因 runtime/IPC/preload 缺失按预期失败；自检 RED 又补齐了活动模型列表取消。最终 `tests/model-ipc.test.mjs` 与 Electron 基线共 16/16，`typecheck:node`、`typecheck:web` 均退出 0。误调用不存在的 `typecheck:renderer` 只得到 npm “Missing script”，改用仓库既定 `typecheck:web` 后通过。

### Task 7：模型设置页、档案与角色绑定体验

**Files:**
- Create: `src/renderer/src/model/README.md`
- Create: `src/renderer/src/model/use-model-settings.ts`
- Create: `src/renderer/src/views/ModelSettingsView.vue`
- Create: `tests/ui/model-settings.spec.ts`
- Modify: `src/renderer/src/router/index.ts`
- Modify: `src/renderer/src/router/README.md`
- Modify: `src/renderer/src/assets/base.css`
- Modify: `src/renderer/src/README.md`
- Modify: `src/renderer/src/views/README.md`
- Modify: `src/renderer/src/assets/README.md`
- Modify: `tests/ui/README.md`
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: `window.openNovel.models` 与共享脱敏类型。
- Produces: `/workspace/settings` 的真实设置页面。

- [x] **Step 1: 写 UI RED 测试**

```ts
expect(wrapper.get('h1').text()).toContain('模型与 API 密钥')
expect(wrapper.text()).toContain('同一 Windows 用户下运行的其他程序')
expect(wrapper.find('input[type="password"]').exists()).toBe(true)
expect(wrapper.text()).not.toContain('sk-existing-secret')
```

覆盖加载/重试、连接表单、DeepSeek 预设（`https://api.deepseek.com`、`deepseek-v4-flash`/`deepseek-v4-pro`）、HTTPS/回环 HTTP 提示、密钥留空保留、连接测试取消、手工模型 ID、能力徽标、档案数值范围、三种模式默认、六类角色覆盖、能力不足禁用、跨供应商目标展示与显式确认、未配置模型提示、键盘标签、44px 操作目标和窄屏布局。

- [x] **Step 2: 运行 RED**

```powershell
npm.cmd run test:ui -- tests/ui/model-settings.spec.ts
```

预期：真实设置组件尚不存在而失败。

实际：`npm.cmd run test:ui -- tests/ui/model-settings.spec.ts` 退出 1；Vite 明确因 `ModelSettingsView.vue` 尚不存在而无法解析导入，RED 与预期一致。

- [x] **Step 3: 实现最小完整设置体验**

页面按“连接 → 模型档案 → 角色绑定”顺序渐进呈现；不在 DOM、组件 state 的持久对象或错误文案中回显已保存密钥。保存跨供应商 fallback 前展示每个目标供应商并要求未预选复选框确认。

- [x] **Step 4: 运行 GREEN 与 Web 类型检查**

```powershell
npm.cmd run test:ui -- tests/ui/model-settings.spec.ts
npm.cmd run typecheck:web
```

预期：聚焦 UI 与 Web 类型检查退出 0。

实际：新增脱敏设置控制器、真实 `/workspace/settings` 页面与响应式暖纸色样式；聚焦 UI 6/6、完整 UI 29/29、`npm.cmd run typecheck:web` 与 `npm.cmd run check:readmes` 均退出 0。页面覆盖 DeepSeek 当前预设、短生命周期密码输入、测试取消、手工模型 ID、Profile 范围/能力、三模式六角色、能力不足选项禁用和跨供应商真实目标确认。

### Task 8：泄漏审计、阶段回归、人工连接入口与交接

**Files:**
- Create: `tests/model-security.test.mjs`
- Modify: `src/model/model-validation.ts`
- Modify: `src/model/model-service.ts`
- Modify: `src/model/provider-adapter.ts`
- Modify: `src/model/model-gateway.ts`
- Modify: `src/renderer/src/model/use-model-settings.ts`
- Modify: `src/renderer/src/views/ModelSettingsView.vue`
- Modify: `scripts/electron-smoke.mjs`
- Modify: `scripts/README.md`
- Modify: `tests/model-secret-store.test.mjs`
- Modify: `tests/model-repository.test.mjs`
- Modify: `tests/model-provider-adapters.test.mjs`
- Modify: `tests/model-gateway.test.mjs`
- Modify: `tests/electron-smoke.test.mjs`
- Modify: `tests/ui/model-settings.spec.ts`
- Modify: all touched directory `README.md`
- Modify: root `README.md`
- Modify: `docs/2026-08-10/README.md`
- Modify: this plan
- Modify: `DEVELOPMENT_PROGRESS.md`

**Interfaces:**
- Consumes: 阶段 3 全部公开入口与项目备份/导出能力。
- Produces: 可审计的安全证据、完整本地门禁结果和用户人工验证步骤。

- [x] **Step 1: 写密钥全路径泄漏 RED 测试**

```js
for (const artifact of [controlDbBytes, projectDbBytes, backupBytes, exportBytes, logBytes, ipcBytes]) {
  assert.equal(artifact.includes(Buffer.from('sk-stage3-sentinel')), false)
}
```

测试使用唯一 sentinel，保存连接、创建档案/绑定、运行 fake 调用、备份和导出后扫描应用数据库、项目数据库、备份、导出、日志和 IPC 序列化；密钥文件允许存在密文但不得包含 sentinel。

实际：新增真实临时产物验收测试；首跑即 1/1 通过，证明 Task 1–7 已有防护覆盖完整 sentinel。测试明确把 IPC 扫描限定为公开响应；保存密钥的入站命令按设计必须把用户输入送入受信主进程，不作“不含密钥”的虚假断言。

- [x] **Step 2: 运行 RED/GREEN 与完整自动化门禁**

```powershell
node --experimental-strip-types --test tests/model-security.test.mjs
npm.cmd run check:readmes
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:electron-smoke
npm.cmd run test:acceptance
npm.cmd audit --registry=https://registry.npmjs.org
git diff --check
```

通过标准：README、类型、全部 Node/UI 测试、生产构建、Electron smoke、acceptance、审计和空白检查全部退出 0；不触发 GitHub Actions。

实际：独立复审提出的九项安全、契约和体验问题均先以聚焦 RED 复现，再完成修复；终轮再补重启后密钥解密认证/明文产物扫描和模式默认能力门禁。新增生产 Electron Model smoke，通过回环 OpenAI-compatible Provider 验证九方法 preload/main、safeStorage 密钥、连接测试、模型列表与重启持久化。最终 Node 204/204、UI 31/31、两套类型检查、README、build、production smoke、acceptance、npm 官方审计和 Git 空白检查均退出 0；独立终审无 Critical/Important/Minor，未触发 GitHub Actions。

- [x] **Step 3: 本地人工设置页验证**

在应用内依次验证 OpenAI-compatible、Anthropic、Gemini 连接表单；真实联网验证使用用户指定的 DeepSeek API Key，通过 DeepSeek 预设连接 `https://api.deepseek.com`，优先选择官方当前 `deepseek-v4-flash` 或 `deepseek-v4-pro`。用户只在设置页本地输入 Key，每次只发送最小连接/能力探测请求并记录供应商、模型、能力、延迟和脱敏结果；Anthropic 与 Gemini 使用本机模拟契约，不要求用户另购凭据。没有 DeepSeek 本地凭据时记录“等待用户本地凭据验证”，不得伪造通过。

实际：应用生产预览窗口在本机启动；用户仅在设置页本地输入 DeepSeek API Key，并于 2026-08-10 明确回复“连接成功”。计划与日志不记录 Key、请求正文或其他秘密；Anthropic 与 Gemini 继续以原生协议回环 fake server 作为阶段 3 契约证据。

- [x] **Step 4: 完成审计与阶段交接**

逐条核对阶段 3 七项任务和退出标准；回填本计划实际结果、验证命令、未提交变更归属、阻塞项与下一项具体动作；更新 `DEVELOPMENT_PROGRESS.md` 为“待验证”或“已完成候选”，在用户明确确认前不推送。

复审修复范围：补齐 Anthropic/Gemini 跨域重定向凭据移除与响应体取消、跨供应商双确认、短密钥 hint、Provider request ID 反射脱敏、保守能力探测、原生供应商空 Base URL、按 provider kind 判断跨供应商，以及真实 Electron Model preload/main/safeStorage/fake-provider smoke。每项先补 RED，再实施并重跑聚焦验证。

终轮复核补充范围：生产 smoke 必须在 Electron 重启后再次解密密钥并认证回环 Provider，清理前扫描隔离 `userData` 的密钥与数据库产物不得含测试明文；设置页的模式默认主档案与 fallback 也必须按 `stream-text + structured-output` 禁用能力不足选项。仍按 RED/GREEN 实施。

## 验证方式与通过标准

1. 三类 adapter 的本机模拟契约覆盖流、结构化输出、用量、取消、限流、认证、模型不存在、内容策略与畸形响应，全部通过。
2. `safeStorage` 不可用时拒绝保存；可用时文件、数据库、IPC、日志、导出和备份均搜索不到测试 Key 明文。
3. URL 策略拒绝嵌入凭据、非 HTTP(S)、公网 HTTP 和不安全重定向；回环 HTTP 可显式保存。
4. 连接测试、手工模型 ID、可选模型列表、能力档案、三种模式默认和六角色覆盖重启后保持一致。
5. capability 未知按最小能力处理；不满足角色要求的档案不能绑定。
6. 跨供应商 fallback 默认关闭，只有未预选的明确确认后可保存；UI 展示全部目标供应商。
7. 稳定错误码、有限重试和取消矩阵通过；流产生内容后不自动重放。
8. 未配置模型时模型设置和未来 AI 入口返回 `MODEL_NOT_CONFIGURED`，不调用 provider。
9. `npm.cmd run check:readmes`、`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run build`、`npm.cmd run test:electron-smoke`、`npm.cmd run test:acceptance`、`npm.cmd audit --registry=https://registry.npmjs.org` 与 `git diff --check` 全部退出 0。
10. 真实供应商验证必须由用户在应用内本地输入 DeepSeek 凭据后执行；未执行时阶段不得声称该项通过。Anthropic 与 Gemini 的阶段 3 证据来自原生协议 fake server 契约。

## 实际结果

- Task 1 已锁定 `ai@7.0.58`、`@ai-sdk/openai-compatible@3.0.28`、`@ai-sdk/anthropic@4.0.36`、`@ai-sdk/google@4.0.39` 与 `zod@4.4.3`；新增共享模型契约、九个固定 IPC、脱敏结果守卫、project schema v3 与 control schema v2。
- Task 1 RED 证明共享模型模块缺失且 project 仍为 schema v2；GREEN 后模型契约与数据库聚焦测试 12/12 通过，`npm.cmd run typecheck:node` 退出 0。
- RED 聚合初次未退出的根因是测试先删除仍由 Worker 打开的 SQLite 临时目录；确认 Node `t.after()` 按注册顺序执行后，将同一测试清理改为先关闭两个 Worker 再删除目录，稳定 RED/GREEN 均在一秒内退出。
- Task 2 新增注入式 OS cipher 密钥库与逐跳安全 fetch；RED 为两个模块缺失，GREEN 后真实临时目录/URL 测试 5/5 与 `typecheck:node` 通过。密钥替换失败保留旧密文，HTTPS 跳转到 HTTP 在第二次请求前终止，HTTPS 跨 origin 会移除 Authorization/Cookie。
- Task 3–7 已交付连接/Profile/项目绑定持久化、三类 Provider Adapter、供应商无关 Gateway、稳定错误/重试/取消矩阵、白名单日志、主进程 Runtime、固定九命令 IPC/Preload 和真实模型设置页；DeepSeek 预设、手工模型 ID、能力档案及三模式六角色路由均可操作。
- Task 8 的全路径 sentinel 测试扫描真实 control/project SQLite、密文、备份、导出、日志和公开 IPC，最终 1/1 通过。复审 RED/GREEN 补强了 Anthropic/Gemini 敏感头、重定向响应体取消、跨供应商双门禁、短密钥提示、Provider request ID 脱敏、保守能力探测、原生 Provider 默认端点和按供应商类型判断路由。
- 生产 Electron smoke 使用隔离 `userData` 和回环 fake provider 验证 Model 九方法桥接、Electron `safeStorage`、连接探测、模型列表、Profile 保存及重启持久化；真实 DeepSeek 联网验证仍等待用户在应用设置页本地输入凭据，不把 fake provider 结果冒充真实供应商通过。
- 真实供应商验收已由用户在本机设置页完成并明确确认 DeepSeek“连接成功”；未读取、输出或持久化用户 Key 到计划、进度、日志或 Git。
- 既有 GitHub Actions 默认禁用治理差异与 `.superpowers/` 保持原归属，本阶段不暂存或覆盖。

## 最近验证结果

- `git fetch --prune origin`：成功。
- `git rev-list --left-right --count feat/v1.0...origin/feat/v1.0`：`0/0`。
- `npm.cmd run check:readmes`：通过。
- `npm.cmd run typecheck:node`、`npm.cmd run typecheck:web`：均退出 0。
- `npm.cmd test`：Node 204/204、UI 31/31 通过。
- `npm.cmd run build`：生产 main/preload/renderer 构建退出 0。
- `npm.cmd run test:electron-smoke`、`npm.cmd run test:acceptance`：均输出 `Electron production smoke passed`。
- `npm.cmd audit --registry=https://registry.npmjs.org --audit-level=high`：`found 0 vulnerabilities`。
- `git diff --check` 与 `git diff --cached --check`：退出 0，仅显示 Git 的 LF/CRLF 转换提醒。
- 独立终审：两轮审查发现均经 RED/GREEN 修复；最终复核无 Critical、Important 或 Minor。
- 当前阻塞：无；真实 DeepSeek 连接已由用户本机确认成功。
- 下一步：完成阶段 3 本地提交，等待用户明确确认阶段开发完成；确认后普通快进推送 `feat/v1.0` 并核对 upstream。
