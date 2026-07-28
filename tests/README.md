# tests 目录说明

## 目录用途

存放基于 Node.js 内置测试运行器的可重复质量与架构契约测试。

## 内容说明

- `documentation.test.mjs`：验证根目录文档与已确认的技术方向。
- `electron-foundation.test.mjs`：验证 Electron 安全默认值、命名 Preload 桥接及其 `.mjs` 构建产物连线。
- `renderer-shell.test.mjs`：验证工作台路由和渲染入口的安全策略。
- `readme-contract.test.mjs`：验证 README 目录契约检查器的祖先目录、精确必需章节、本地 Git 变更、基准分支和 push 干净检出行为。
- `agent-state-machine.test.mjs`：验证 Agent Run 的生命周期、取消、失败、安全错误规范化、十二种公共事件、普通且可序列化的错误/JSON payload 守卫、严格错误/结果形态、输出/检查点、序列/归属、重复审批、终态保护和 Prompt 校验。
- `agent-repository.test.mjs`：使用真实临时目录验证迁移后公共契约下的 JSON Run 快照原子保存、重载、事件筛选、严格 envelope 诊断，以及不可序列化错误、非 JSON payload 和不连贯事件等无效输入不会替换有效快照。
- `agent-orchestrator.test.mjs`：使用内存仓储和可控离线执行器验证严格事件序列、审批持久化/恢复原子边界、legacy final checkpoint 审批证明修正、监听器快照隔离、仓储错误与列表诊断传播、Mock Executor 的分析/final chunk 选择与进行中中止、取消竞态、事件回补及恢复检查点去重。
- `agent-ipc.test.mjs`：验证 Agent IPC 命令参数、仅 hash 可变的完整 production file URL、开发 origin/凭据/销毁 frame sender 守卫、固定且幂等的处理器/disposer、错误脱敏、Preload 事件克隆隔离、结构化日志脱敏，以及恢复/窗口附着生命周期。

## 依赖边界

测试可读取项目文件、创建临时 Git 仓库并调用 Node.js 与 Git；不应启动应用窗口、调用网络或依赖真实 AI 服务。

## 维护规则

新增或修改测试时，必须同步更新本 README；新行为遵循 RED-GREEN-REFACTOR，并使用可观察的项目行为断言。

## 变更同步

- 2026-07-28：新增 README 目录契约行为测试。
- 2026-07-28：补充祖先目录、精确标题和 push 基准回归测试。
- 2026-07-28：新增 Agent 公共契约、运行时校验和状态机的行为测试。
- 2026-07-28：补充带合法错误码的 Error 不保留堆栈或扩展字段的回归测试。
- 2026-07-28：新增 JSON Run Repository 的真实文件系统集成测试。
- 2026-07-28：新增顶级 envelope 键严格校验和替换阶段失败保留快照的回归测试。
- 2026-07-28：将 Agent 状态机与 Repository 用例迁移到已批准的错误、事件、`data`、输出和检查点公共契约。
- 2026-07-28：补充原生 Error、额外自有键、hostile getter/Proxy、非普通 JSON payload 和 Run 序列/归属的审查回归测试。
- 2026-07-28：补充非枚举/状态型 accessor 错误字段和 Repository 无替换保护的审查回归测试。
- 2026-07-28：新增 Mock Executor 与 Orchestrator 的离线闭环行为测试。
- 2026-07-28：补充 Task 4 审查修复的审批绕过、监听器隔离、仓储结果和执行器/命令路径回归测试。
- 2026-07-28：补充 legacy final checkpoint、持久化 approval.resolved 证明、进行中延迟中止和真正并发重复命令的复审回归测试。
- 2026-07-28：补充活动 final MockExecutor 流的 `finalChunks` 与 `nextChunkIndex` 直接断言。
- 2026-07-28：新增 Electron Agent IPC、最小 Preload 桥接和结构化日志的安全边界测试。
- 2026-07-28：补充 Task 5 Fix Round 1 的 preload 工件、恢复顺序、窗口解绑、sender URL/frame 与 IPC disposer 回归测试。
- 2026-07-28：补充 Task 5 Fix Round 1 Minor 的空 query 与空 query 加 hash production sender 回归测试。
