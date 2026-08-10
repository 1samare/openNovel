# main 目录说明

## 目录用途

存放 Electron 主进程入口和应用生命周期组合代码。

## 内容说明

- `index.ts`：创建安全窗口；恢复完成后才注册 Agent/Project IPC 与创建窗口；组合系统项目目录/陈旧锁对话框；引用 CommonJS preload；持有窗口；为 Mock 流注入可中止节奏；启动或关闭数据库失败时显示安全提示，退出时等待项目 SQLite Worker 后再释放。
- `agent-runtime.ts`：组合 JSON 仓储、可注入 delay 的 Mock Executor 和 Orchestrator；提供可等待的启动顺序，以及仅在授权页面完成加载后附着、销毁或关闭时解绑的事件转发。
- `agent-ipc.ts`：为七个固定 Agent 命令注册授权、参数校验和安全错误序列化包装器；注册幂等并返回所有权安全的 disposer。
- `agent-ipc-security.ts`：只接受当前顶层应用 `file:` document 的 hash 路由；production 将完整序列化 URL 仅去除 hash 后精确比较，因此拒绝普通和空 query；开发服务器 origin 行为保持无凭据精确匹配，并拒绝销毁/异常 frame 与未授权页面。
- `agent-logger.ts`：仅输出 Run ID、状态、事件类型、耗时、错误码和操作名的结构化日志。
- `project-runtime.ts`：把系统目录选择、最近项目授权、陈旧锁确认、错误脱敏和等待失败提示的 async shutdown gate 组合为项目 runtime。
- `project-ipc.ts`：为九个固定项目命令注册 sender/参数守卫，并返回结构化项目结果。

## 依赖边界

本目录可以依赖 Electron 和 Node.js，但不应直接依赖 Vue 组件或渲染层状态。

## 维护规则

修改主进程代码时，必须同步更新本 README，并保持渲染进程隔离、禁用 Node 注入和受限窗口打开策略。

## 变更同步

- 2026-07-28：建立主进程目录 README 契约。
- 2026-07-28：新增受 sender 白名单保护的 Agent IPC、运行时恢复、授权事件转发和脱敏结构化日志。
- 2026-07-28：加固 preload 工件连线、恢复/窗口生命周期、sender URL/frame 守卫及 IPC 注册 disposer。
- 2026-07-28：收紧 production file sender 为仅 hash 可变的完整 URL 匹配，拒绝空查询分隔符。
- 2026-07-28：将生产 Preload 连线切换为 CommonJS `.cjs` 工件，修复沙箱窗口无法执行 ESM `.mjs` 的真实启动缺陷。
- 2026-07-28：持有活动 BrowserWindow 强引用并在关闭时删除，避免生产实例创建页面后自动退出。
- 2026-07-28：支持 runtime 注入 Executor delay，并由生产入口提供 AbortSignal 可立即释放的 500ms 片段节奏。
- 2026-08-07：接入项目 control 数据库、九个固定项目 IPC、原生目录/陈旧锁对话框和退出前 Worker 安全关闭。
- 2026-08-07：启动 control 数据库失败时清理并提示安全退出；shutdown 失败时等待错误提示后再继续退出。
