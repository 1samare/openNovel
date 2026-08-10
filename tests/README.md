# tests 目录说明

## 目录用途

存放基于 Node.js 内置测试运行器的可重复质量与架构契约测试。

## 内容说明

- `documentation.test.mjs`：验证根目录文档与已确认的技术方向。
- `electron-foundation.test.mjs`：验证 Electron 安全默认值、命名 Agent/Project Preload 桥接、沙箱兼容的 CommonJS `.cjs` 构建产物配置和连线、活动窗口引用、项目数据库/IPC、异步退出与启动失败恢复提示，以及生产 Mock 流的可中止延迟注入。
- `renderer-shell.test.mjs`：验证工作台路由和渲染入口的安全策略。
- `readme-contract.test.mjs`：验证 README 目录契约检查器的祖先目录、精确必需章节、本地 Git 变更、基准分支和 push 干净检出行为。
- `agent-state-machine.test.mjs`：验证 Agent Run 的生命周期、取消、失败、安全错误规范化、十二种公共事件、普通且可序列化的错误/JSON payload 守卫、严格错误/结果形态、输出/检查点、序列/归属、重复审批、终态保护和 Prompt 校验。
- `agent-repository.test.mjs`：使用真实临时目录验证迁移后公共契约下的 JSON Run 快照原子保存、重载、事件筛选、严格 envelope 诊断，以及不可序列化错误、非 JSON payload 和不连贯事件等无效输入不会替换有效快照。
- `agent-orchestrator.test.mjs`：使用内存仓储和可控离线执行器验证严格事件序列、审批持久化/恢复原子边界、queued 启动恢复、legacy final checkpoint 审批证明修正、监听器快照隔离、陈旧 list 不覆盖权威状态、仓储错误与列表诊断传播、Mock Executor 的分析/final chunk 选择与进行中中止、取消竞态、事件回补及恢复检查点去重。
- `agent-ipc.test.mjs`：验证 Agent IPC 命令参数、仅 hash 可变的完整 production file URL、开发 origin/凭据/销毁 frame sender 守卫、固定且幂等的处理器/disposer、错误脱敏、Preload 事件克隆隔离、结构化日志脱敏、恢复/窗口附着生命周期，以及 runtime 向 Mock Executor 传递受控 delay。
- `agent-harness.test.mjs`：行为化验证渲染层先订阅后加载、加载竞态合并、序列缺口回补/去重/刷新、连续 `run.failed` 的安全详情回读与刷新重试、拒绝规范化、操作级重试、命令锁、陈旧结果隔离、队列恢复与退订，并结合控制器状态和页面契约检查可访问控件、流式 final、失败诊断和 520px 顶栏命中区。
- `electron-smoke.test.mjs`：验证生产 smoke 的事件序列连续性、delta 去重、诊断脱敏、CDP target 选择、Windows npm CLI 调用、Electron 启动参数和进程树清理参数；不启动真实窗口。
- `project-paths.test.mjs`：使用真实临时目录验证项目根路径、目录占用、严格原子 manifest、活动写锁、需确认的陈旧锁恢复、同时恢复的唯一所有权，以及死亡或未完整写入的 recovery claim 回收。
- `project-database.test.mjs`：使用真实 SQLite 文件和受控 Worker 验证 RPC、schema v1、pragma、事务/迁移回滚、事件循环响应、正常关闭，以及 ready 前/后的异常退出均稳定失败。
- `project-lifecycle.test.mjs`：使用真实目录、SQLite 和两个 service 验证新建重启、重命名及 control 失败补偿、最近项目完整文件可用性、备份恢复、迁移失败后从一致快照恢复、跨实例写锁、同 service 生命周期串行、失败逆序清理和递归路径拒绝。
- `project-ipc.test.mjs`：验证固定项目命令、sender/参数守卫、系统选择/最近路径授权、陈旧锁确认、preload 最小桥接、错误脱敏、异步退出等待与关闭失败先提示后退出。
- `ui/`：使用 Vitest、Vue Test Utils 和 happy-dom 执行 Vue 单文件组件测试，独立于现有 Node Test Runner 测试。

## 依赖边界

测试可读取项目文件、创建临时 Git 仓库并调用 Node.js 与 Git；常规 `npm test` 不启动应用窗口、调用网络或依赖真实 AI 服务，真实生产窗口由独立 `npm run test:electron-smoke` 负责。

## 维护规则

新增或修改测试时，必须同步更新本 README；新行为遵循 RED-GREEN-REFACTOR，并使用可观察的项目行为断言。

## 变更同步

- 2026-08-10：隔离 README push 基准测试继承的 PR 环境变量，确保 `GITHUB_EVENT_BEFORE` 场景在本地与 GitHub Actions 中一致。
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
- 2026-07-28：新增 Harness Agent 渲染控制器和专用 AI 对话页面的行为契约测试。
- 2026-07-28：新增 deferred/rejecting API、并发命令、重叠加载、回补恢复、dispose 与可访问/响应式页面回归覆盖。
- 2026-07-28：为真实生产验收发现的沙箱 Preload ESM 加载失败补充 CommonJS `.cjs` 构建与主进程连线回归测试。
- 2026-07-28：为生产实例短暂创建页面后自动退出补充活动 BrowserWindow 引用与关闭释放回归测试。
- 2026-07-28：补充生产 Mock Executor 可注入延迟、入口可中止 pacing 与运行中状态可观察性回归测试。
- 2026-07-28：补充最终审查的陈旧列表/取消提交竞态和 persisted queued 重启恢复回归测试。
- 2026-07-28：新增 Electron 生产 smoke 的纯逻辑断言、脱敏和进程参数回归测试。
- 2026-08-07：增加 Windows smoke 构建不得直接启动 `npm.cmd` 的回归覆盖。
- 2026-08-07：新增 `ui/` 组件测试目录，并保持 `tests/*.test.mjs` 继续由 Node Test Runner 执行。
- 2026-08-07：为阶段 1 新增项目路径、manifest 与项目锁的真实文件系统 RED 测试。
- 2026-08-07：为阶段 1 新增 SQLite Worker、schema、事务与迁移回滚 RED 测试。
- 2026-08-07：为阶段 1 新增完整项目生命周期、最近项目、备份恢复和双实例写锁 RED 测试。
- 2026-08-07：为阶段 1 新增项目 runtime、IPC、preload 安全桥接和 async shutdown RED 测试。
- 2026-08-07：为阶段 1 自审发现补充生命周期串行、control 落库失败清理、备份/恢复路径包含和迁移备份可读取性回归测试。
- 2026-08-07：补充 Worker 异常退出后 pending 与后续调用都不得悬挂的受控回归测试。
- 2026-08-07：补充两个已确认恢复者争抢同一陈旧锁时只能有一个成功的竞态回归测试。
- 2026-08-07：补充 control 数据库启动失败时必须清理、显示安全提示并退出的生产入口契约。
- 2026-08-07：补充数据库关闭失败时 shutdown gate 必须等待错误提示后再请求退出的回归测试。
- 2026-08-07：用临时 v2 迁移和 SQLite 写锁验证迁移失败后可通过公共恢复入口还原一致快照并成功迁移重开。
- 2026-08-07：补充最近项目更新失败时重命名必须同步回滚项目数据库和 manifest 的故障注入回归测试。
- 2026-08-07：补充 shutdown 等待已接纳生命周期操作并拒绝后续工作的串行资源所有权回归测试。
- 2026-08-07：补充备份完成后 control 元数据写入失败时必须移除最终备份目录的补偿回归测试。
- 2026-08-07：补充 Worker ready 前退出、死亡 recovery claim 回收和最近项目数据库缺失状态回归测试。
