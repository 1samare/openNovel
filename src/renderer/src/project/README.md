# 项目中心状态层

## 目录用途

本目录承载渲染进程项目中心的状态管理与项目 API 协调逻辑。

## 内容说明

- `use-project-center.ts`：管理最近项目、新建、打开、重新定位、恢复备份和仅移除记录等交互状态。
- `use-workspace-project.ts`：保存当前渲染会话的活动项目摘要，并协调工作台重命名，以及等待编辑器刷盘后的安全备份和关闭操作。

## 依赖边界

- 仅依赖 Vue 响应式 API 与 `src/shared/project.ts` 定义的公开项目契约。
- 所有项目操作必须经由 `window.openNovel.projects`，不得直接依赖 Electron、Node.js、文件系统、SQLite 或通用 IPC。

## 维护规则

- 所有异步操作必须提供忙碌、成功或可行动错误反馈，并阻止重复提交。
- 错误提示需要保留用户输入，并明确下一步动作。
- 状态行为变更时必须同步更新 `tests/ui/project-center.spec.ts`。
- 工作台项目操作变更时必须同步更新 `tests/ui/workspace-project-actions.spec.ts`。

## 变更同步

- 新增或调整本目录文件时，同步更新本 README、上级 `src/renderer/src/README.md` 与阶段计划。
- 2026-08-07：新增当前项目会话状态与工作台重命名、备份、关闭 controller。
- 2026-08-10：项目关闭前执行可注入的编辑器刷盘门禁，保存失败时保留活动项目并反馈错误。
- 2026-08-10：独立复审将同一刷盘门禁覆盖到手动备份，避免 800ms 防抖窗口内正文缺失于归档。
