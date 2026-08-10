# views 目录说明

## 目录用途

存放由 Vue Router 直接渲染的工作台页面组件。

## 内容说明

- `ProjectCenterView.vue`：本地优先项目中心，提供新建、打开、最近项目恢复与仅移除记录入口。
- `WorkspacePlaceholderView.vue`：各一级模块的占位页面。
- `AgentHarnessView.vue`：AI 对话的离线 Agent Run 创建、审批、时间线、错误和恢复页面，包含 Prompt 错误恢复、状态播报、流式 final 与失败 Run 诊断。

## 依赖边界

页面组件可依赖 Vue、路由参数和受控应用接口，不应直接使用 Node.js、Electron 或未授权的持久化能力。

## 维护规则

修改页面功能时，必须同步更新本 README，并增加或调整可观察的渲染契约测试。

## 变更同步

- 2026-07-28：建立页面目录 README 契约。
- 2026-07-28：新增 Harness Agent 专用工作台页面。
- 2026-07-28：补充 Prompt 可访问错误状态、流式 final、失败诊断和紧凑时间线呈现。
- 2026-08-07：项目中心接入受限项目 API，并补齐加载、空状态、异常路径恢复、操作锁和可行动错误反馈。
