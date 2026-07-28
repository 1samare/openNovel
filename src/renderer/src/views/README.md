# views 目录说明

## 目录用途

存放由 Vue Router 直接渲染的工作台页面组件。

## 内容说明

- `ProjectCenterView.vue`：项目中心页面。
- `WorkspacePlaceholderView.vue`：各一级模块的占位页面。
- `AgentHarnessView.vue`：AI 对话的离线 Agent Run 创建、审批、时间线、错误和恢复页面。

## 依赖边界

页面组件可依赖 Vue、路由参数和受控应用接口，不应直接使用 Node.js、Electron 或未授权的持久化能力。

## 维护规则

修改页面功能时，必须同步更新本 README，并增加或调整可观察的渲染契约测试。

## 变更同步

- 2026-07-28：建立页面目录 README 契约。
- 2026-07-28：新增 Harness Agent 专用工作台页面。
