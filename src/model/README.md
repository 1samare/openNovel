# model 目录说明

## 目录用途

存放主进程使用的供应商无关模型接入、密钥持久化、Provider Adapter、Model Gateway、档案与调用审计能力。

## 内容说明

- `model-validation.ts`：校验 Provider Base URL，并以手动重定向逐跳阻止协议降级、取消重定向响应体，以及 Authorization/Cookie/Proxy/x-api-key/x-goog-api-key 凭据跨 origin 转发。
- `model-repository.ts`：串行访问 control 数据库中的脱敏 Provider 连接和 Model Profile，内部保留 `secretRef`，对外只返回安全摘要。
- `model-service.ts`：编排连接密钥、档案与项目绑定持久化，并在保存前执行能力、启用状态和跨供应商显式确认校验。
- `model-gateway.ts`：调用前解析 Profile/连接/密钥和能力，统一映射稳定错误、有限抖动重试、流重放边界、启发式 token 估算与白名单调用日志，并在公开边界拒绝包含密钥的 Provider request ID。
- `provider-adapter.ts`：定义统一适配端口，并集中处理 AI SDK 流、结构化输出、usage/request ID 和不含响应正文的安全错误边界；连接探测只报告实际观察到的 usage 能力。
- `openai-compatible-adapter.ts`：创建 OpenAI-compatible AI SDK provider，并提供可选 `/models` 列表。
- `anthropic-adapter.ts`：创建 Anthropic Messages AI SDK provider，保留手工模型 ID 入口。
- `gemini-adapter.ts`：创建 Google Generative AI SDK provider，保留手工模型 ID 入口。
- `provider-registry.ts`：只在模型域内部按连接类型构建适配器，拒绝禁用连接和缺失密钥。
- `secret-store.ts`：通过注入的 Electron `safeStorage` cipher 把 API Key 原子写为独立密文文件，读取接口只供模型域内部使用。

后续阶段 3 主进程与界面组合文件在各自目录 README 中登记。

## 依赖边界

本目录可依赖 Node.js、AI SDK、Zod 和主进程注入的安全能力；不得依赖 Vue、renderer 状态或把供应商 SDK 类型泄漏到 `src/shared/`、`src/agent/`、`src/novel/` 与 preload。

## 维护规则

API Key 只可在本目录短暂出现，任何数据库、IPC、日志、错误或导出对象均不得含明文；网络请求必须经过 URL 与重定向安全策略，测试默认只访问回环 fake server。

## 变更同步

- 2026-08-10：建立阶段 3 模型域目录，先加入操作系统加密密钥文件和 Provider URL/重定向安全边界。
- 2026-08-10：增加连接/Profile 控制库仓储与模型服务；公开连接保持脱敏，项目绑定保存时验证角色能力和跨供应商确认。
- 2026-08-10：增加三类 AI SDK Provider Adapter、Registry、原生结构化输出与安全适配错误；OpenAI-compatible 支持可选模型列表。
- 2026-08-10：增加统一 Model Gateway、稳定错误矩阵、最多三次瞬时故障重试、流事件后禁止重放，以及 Repository 串行调用日志。
- 2026-08-10：独立复审补强跨 origin 敏感头与响应体处理、跨供应商关闭门禁、短密钥提示、Provider request ID 脱敏和连接探测能力真实性。
