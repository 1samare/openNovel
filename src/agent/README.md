# agent 目录说明

## 目录用途

存放与 Electron、Vue 无关的 Agent 运行期核心：错误转换、输入校验和 Run 状态转换。

## 内容说明

- `errors.ts`：六种 Agent 错误码的严格运行时守卫与只保留 `code`、`message`、`retryable` 的新对象错误转换。
- `validation.ts`：Prompt、Run 状态、十二种公共事件、结果分支及含输出/检查点 Run 快照的运行时校验。
- `state-machine.ts`：Run 的合法状态转换表和不可变状态转换函数。
- `repository.ts`：注入存储根目录的 JSON Run 仓储，严格接受仅含 `schemaVersion` 与 `run` 的 schemaVersion 1 envelope，使用同目录临时文件重命名和无绝对路径的加载诊断；公开失败映射为验证或持久化错误，replace 操作可注入以验证失败保护。

## 依赖边界

本目录只依赖 `src/shared/agent.ts` 的纯契约；不得导入 Electron、Vue、IPC 或网络模块。仅 `repository.ts` 可以使用 Node 文件系统与路径模块，且存储位置必须由构造参数注入。

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
