# Harness Agent 离线闭环架构设计

## 目标

在不接入真实模型、API Key、任意工具或 SQLite 的前提下，建立可运行、可审批、可取消、可持久化并可在应用重启后恢复的 Agent Harness 垂直闭环。

## 架构

```text
Vue Harness 面板
      ↕ 类型化 API / 事件订阅
Preload 最小安全桥
      ↕ 白名单 IPC
Electron Main 组合层
      ├── Agent Orchestrator
      ├── Mock Executor
      └── JsonRunRepository
              ↓
      userData/agent-runs/*.json
```

Agent 核心位于 `src/agent`，不依赖 Electron 或 Vue。共享契约位于 `src/shared`。主进程只负责运行时组合、IPC 和结构化日志；Preload 只暴露白名单 API；渲染进程只消费类型化接口。

## 状态与事件

主流程为 `queued → running → awaiting_approval → running → completed`。运行中的任务在启动恢复时转为 `interrupted`，由用户显式恢复。任意非终态可取消，执行异常进入 `failed`。

每个 Run 使用从 1 开始严格递增的事件序号。事件与快照先原子持久化，成功后才通知订阅者。检查点保存当前阶段和下一流式片段索引，恢复时不重复输出。

## 数据流

1. UI 订阅实时事件并加载已有 Run。
2. 创建命令经 Preload 白名单 IPC 进入主进程。
3. Orchestrator 校验输入，保存 `queued` Run 后异步执行 Mock analysis 阶段。
4. analysis 完成后进入 `awaiting_approval`。
5. 批准后执行 final 阶段并完成；取消通过 `AbortController` 终止输出。
6. UI 发现事件序号缺口时通过 `getEvents` 补取并去重。

## 持久化

每个 Run 保存为 `{ "schemaVersion": 1, "run": ... }`。写入使用同目录临时文件和原子重命名。损坏文件、未知 schema 或非法数据不会被覆盖，`listRuns` 通过不含绝对路径的 issue 返回诊断。

## 安全与错误

- IPC 参数必须运行时校验，只接受本地 `file:` 页面或配置的开发服务器来源。
- Preload 不暴露通用 `ipcRenderer`、Electron event 或文件系统能力。
- 同一 Run 的状态写入串行化，非法转换返回 `INVALID_STATE`。
- 日志只记录 Run ID、状态、事件类型、耗时和错误码，不记录 prompt、完整输出、堆栈或绝对路径。

## UI

`/workspace/chat` 提供 Prompt 输入、Run 列表、状态、事件时间线、流式输出、审批卡片、批准/取消/恢复操作、完成结果及错误诊断。

## 验收

自动测试必须覆盖正常审批、主动取消、执行异常、持久化损坏、IPC 拒绝和 `running → interrupted → resume → completed`。README 契约、类型检查和生产构建必须通过，并完成 Electron 本地启动验收。

持续集成在 Windows 环境按 `npm ci → npm run check:readmes → npm test → npm run typecheck → npm run build` 执行质量门禁。
