# main 目录说明

## 目录用途

存放 Electron 主进程入口和应用生命周期组合代码。

## 内容说明

- `index.ts`：创建安全窗口；恢复完成后才注册 Agent/Project/Chapter IPC 与创建窗口；组合系统项目目录、备份文件、导入导出文件和陈旧锁对话框；引用 CommonJS preload；退出时先等待活动渲染器保存，再释放章节与项目 SQLite Worker。
- `agent-runtime.ts`：组合 JSON 仓储、可注入 delay 的 Mock Executor 和 Orchestrator；提供可等待的启动顺序，以及仅在授权页面完成加载后附着、销毁或关闭时解绑的事件转发。
- `agent-ipc.ts`：为七个固定 Agent 命令注册授权、参数校验和安全错误序列化包装器；注册幂等并返回所有权安全的 disposer。
- `agent-ipc-security.ts`：只接受当前顶层应用 `file:` document 的 hash 路由；production 将完整序列化 URL 仅去除 hash 后精确比较，因此拒绝普通和空 query；开发服务器 origin 行为保持无凭据精确匹配，并拒绝销毁/异常 frame 与未授权页面。
- `agent-logger.ts`：仅输出 Run ID、状态、事件类型、耗时、错误码和操作名的结构化日志。
- `project-runtime.ts`：把系统目录选择、最近项目授权、陈旧锁确认、错误脱敏和等待失败提示的 async shutdown gate 组合为项目 runtime。
- `project-ipc.ts`：为九个固定项目命令注册 sender/参数守卫，并返回结构化项目结果。
- `chapter-ipc.ts`：为十三个固定章节、版本与文件交换命令注册 sender/参数守卫，并拒绝任意路径参数。
- `chapter-runtime.ts`：按活动项目惰性持有章节 Worker，组合系统文件选择、导入预览防篡改、参考资料补偿、统一快照导出和脱敏错误。
- `renderer-flush.ts`：用固定事件、授权 sender、请求归属和超时限制协调退出前的活动渲染器保存确认。

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
- 2026-08-10：新增章节、版本、导入与导出的固定 IPC 白名单和授权/参数门禁。
- 2026-08-10：新增章节 runtime，以主进程系统对话框授权导入/导出路径并协调活动项目章节服务。
- 2026-08-10：生产入口接入章节 runtime/IPC、`.opennovel.zip` 文件恢复选择和导入/导出系统对话框；关闭项目前先释放章节 Worker。
- 2026-08-10：独立复审将 TXT/Markdown 文件导入改为 fatal UTF-8 解码，非法字节不会被替换后提交。
- 2026-08-10：独立复审新增退出前渲染器保存握手；拒绝或超时时允许返回继续保存，只有明确放弃才跳过未保存内容。
- 2026-08-10：二次复审让“明确放弃并退出”在资源释放后直接销毁窗口，绕过仍会阻止关闭的 renderer `beforeunload` 保存门禁。
