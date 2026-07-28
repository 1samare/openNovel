# agent 目录说明

## 目录用途

存放与 Electron、Vue 无关的 Agent 运行期核心：错误转换、输入校验和 Run 状态转换。

## 内容说明

- `errors.ts`：Agent 错误类型的运行时守卫与只保留 `code`、`message` 的新对象错误转换。
- `validation.ts`：Prompt、Run 状态、事件和 Run 快照的运行时校验。
- `state-machine.ts`：Run 的合法状态转换表和不可变状态转换函数。
- `repository.ts`：注入存储根目录的 JSON Run 仓储，使用 schemaVersion 1、同目录临时文件重命名和无绝对路径的加载诊断。

## 依赖边界

本目录只依赖 `src/shared/agent.ts` 的纯契约；不得导入 Electron、Vue、IPC 或网络模块。仅 `repository.ts` 可以使用 Node 文件系统与路径模块，且存储位置必须由构造参数注入。

## 维护规则

修改状态、事件或校验规则时，必须先扩展 `tests/agent-state-machine.test.mjs` 的行为断言，并同步更新本 README 与共享契约说明。

## 变更同步

- 2026-07-28：新增 Agent 公共契约的运行时校验和状态机实现。
- 2026-07-28：错误转换始终返回新的公共错误对象，避免保留堆栈或扩展字段。
- 2026-07-28：新增 JSON Run Repository，原子保存 schemaVersion 1 快照并对损坏快照返回安全诊断。
