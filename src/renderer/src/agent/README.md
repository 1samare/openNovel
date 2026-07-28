# renderer/src/agent 目录说明

## 目录用途

存放 Harness Agent 工作台的渲染层状态协调逻辑。

## 内容说明

- `use-agent-harness.ts`：订阅受控 Agent API、合并 Run 快照和事件、回补序列缺口，并提供创建、审批、取消和恢复命令。

## 依赖边界

此目录仅依赖 Vue 响应式能力与 `@shared` 的 Agent 公共类型；不得导入 Electron、Node.js 或绕过 `window.openNovel.agent` 的预加载边界。

## 维护规则

事件必须按 Run 和序列去重、排序；加载必须先订阅后列出；新增状态转换或命令时同步更新行为测试与本 README。

## 变更同步

- 2026-07-28：新增 Harness Agent 控制器，覆盖订阅、回补、状态门控和错误恢复。
