# agent 目录说明

## 目录用途

存放与 Electron、Vue 无关的 Agent 运行期核心：错误转换、输入校验、Run 状态转换、离线执行器和 Run 编排。

## 内容说明

- `errors.ts`：六种 Agent 错误码的严格运行时守卫；仅普通数据对象可通过，且必须精确拥有三个可枚举数据描述符 `code`、`message`、`retryable`、没有符号键或 accessor；错误转换从单次安全描述符快照构造新对象。
- `validation.ts`：Prompt、Run 状态、十二种公共事件、结果分支及含输出/检查点 Run 快照的运行时校验；payload 与嵌套对象必须为普通 JSON 对象，Run 事件序号和 `runId` 必须连续且归属一致。
- `state-machine.ts`：Run 的合法状态转换表和不可变状态转换函数。
- `repository.ts`：注入存储根目录的 JSON Run 仓储，严格接受仅含 `schemaVersion` 与 `run` 的 schemaVersion 1 envelope，使用同目录临时文件重命名和无绝对路径的加载诊断；公开失败映射为验证或持久化错误，并以共享 `{ runs, issues }` 形态返回列表诊断。
- `executor.ts`：定义带 Prompt、阶段、检查点索引和 `AbortSignal` 的流式执行器边界。
- `mock-executor.ts`：提供可注入延迟和确定性分析/最终文本块的离线执行器。
- `orchestrator.ts`：按单 Run 串行队列编排创建、流式步骤、审批、取消、失败、事件回补和重启恢复；final 流必须由对应 approval.requested 之后的持久化 approval.resolved 证明授权，恢复会在同一 interrupted 快照中修正缺少证明的 legacy final checkpoint，审批 checkpoint 仅在 approval.requested 同一持久化提交后进入 final。

## 依赖边界

本目录只依赖 `src/shared/agent.ts` 的纯契约；不得导入 Electron、Vue、IPC 或网络模块。`repository.ts` 可以使用 Node 文件系统与路径模块，`orchestrator.ts` 仅使用 Node 的随机 ID 默认值；存储位置、执行器、时钟和 ID 都必须可由构造参数注入。

## 维护规则

修改状态、事件或校验规则时，必须先扩展 `tests/agent-state-machine.test.mjs` 的行为断言，并同步更新本 README 与共享契约说明。
本目录所有 TypeScript 模块都由 `tsconfig.node.json` 的 Node 严格类型检查覆盖。

## 变更同步

- 2026-07-28：新增 Agent 公共契约的运行时校验和状态机实现。
- 2026-07-28：错误转换始终返回新的公共错误对象，避免保留堆栈或扩展字段。
- 2026-07-28：新增 JSON Run Repository，原子保存 schemaVersion 1 快照并对损坏快照返回安全诊断。
- 2026-07-28：将 Agent 模块纳入 Node 类型检查，并收窄事件序号的运行时类型守卫。
- 2026-07-28：拒绝带额外顶级键的 Run envelope，并通过可注入 replace 操作验证替换失败不会破坏目标快照。
- 2026-07-28：迁移至已批准的公共错误、事件、结果、分阶段输出和检查点契约，保留 JSON 快照的原子替换与恢复诊断语义。
- 2026-07-28：收紧审查发现的错误与 JSON payload 守卫，拒绝 Error/异类对象、额外字符串或符号键和非普通 payload，并隔离 hostile getter/Proxy 的错误转换。
- 2026-07-28：要求 Agent 错误的全部必填字段为可枚举数据属性，避免守卫接受无法 JSON 往返的非枚举或 accessor 值。
- 2026-07-28：新增 Mock Executor 与 Agent Orchestrator，以串行持久化事件驱动审批、取消、失败与恢复闭环。
- 2026-07-28：收紧审批/恢复原子边界，隔离订阅者异常与变异，并保留仓储读取错误和 Run 列表诊断。
- 2026-07-28：为 legacy schema-v1 final checkpoint 增加持久化审批证明与恢复修正，并在 final 流入口执行防御性授权检查。
