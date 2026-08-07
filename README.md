# OpenNovel

OpenNovel 是一个面向 Windows 的本地优先小说 AI 辅助写作桌面应用。本仓库当前交付 Electron + Vue 3 + TypeScript 基础架构和首个离线 Agent Harness 垂直闭环，不包含小说 CRUD 或真实模型调用。

## 目录用途

仓库根目录存放应用入口配置、项目协作约束、全局文档与质量命令。

## 内容说明

- `src/`：Electron 与 Vue 应用源码。
- `tests/`：架构、文档和质量契约测试。
- `scripts/`：本地质量检查脚本。
- `docs/`：按日期归档的设计、计划和验证记录。
- `DEVELOPMENT_PROGRESS.md`：记录阶段进度、活动工作区、分支、验证结果和下次接手动作。
- `.github/`：GitHub Actions 自动化配置。

## 依赖边界

根目录配置定义构建与质量入口；应用运行时代码位于 `src/`，测试与自动化不得承载业务功能或本地密钥。

## 维护规则

修改根目录文件时，必须同步更新本 README，并遵守 `AGENTS.md` 中的计划、范围控制和 README 目录契约。

阶段 1–8 默认只在根工作区的 `feat/v1.0` 开发，不再为常规阶段任务创建 worktree；阶段门禁通过并由用户确认完成后，提交并推送到 `origin/feat/v1.0`。

## 变更同步

- 2026-07-28：建立全仓 README 目录契约和 Windows 质量门禁。

- 2026-07-28：将 `src/agent/` 纳入 Node TypeScript 严格检查，避免 Agent 运行时代码脱离项目类型门禁。

- 2026-07-28：更新 Agent 最小命名桥接及其主进程 sender 安全边界说明。

- 2026-07-28：登记 Harness Agent UI Fix Round 1 的异步状态、重试、可访问性和响应式加固范围。

- 2026-07-28：显式将 Electron Preload 构建为沙箱兼容的 CommonJS `.cjs` 工件，并同步生产窗口连线。

- 2026-08-07：登记多 Agent 小说创作助手架构与从本地项目到 Windows 安装验收的全阶段开发计划；当前代码范围不变。

- 2026-08-07：增加根级开发进度清单，并要求阶段任务开始前先读取清单、核对工作区和分支。

- 2026-08-07：启动阶段 0 基线冻结与测试骨架，先收口生产 Electron smoke 前置缺陷，再建立独立 Vitest Vue 组件测试入口。

- 2026-08-07：阶段 0 已切换到 `codex/phase-0-test-foundation` 独立 worktree，后续测试骨架变更与主工作区隔离。

- 2026-08-07：阶段 0 独立 worktree 的既有 Node、类型、README、生产构建和真实 Electron smoke 基线全部通过。

- 2026-08-07：增加 Vitest、Vue Test Utils 与 happy-dom 组件测试入口，并将 Node、UI、Electron smoke 和 acceptance 脚本分层。

- 2026-08-07：阶段 0 测试骨架以实现提交 `80e2581` 收口，最终锁文件重建与全部退出门禁通过，进度清单已指向阶段 1 计划入口。

- 2026-08-07：根工作区从阶段 0 最新成果创建 `feat/v1.0`，阶段 1–8 统一在该分支开发，并在用户确认阶段完成后推送。

- 2026-08-07：V1 分支治理提交 `a548a23` 已推送到 `origin/feat/v1.0` 并建立 upstream，后续阶段沿用该分支。

## 技术栈

- Electron
- Vue 3
- TypeScript
- electron-vite
- Vue Router
- npm
- Vitest、Vue Test Utils 与 happy-dom（组件测试）

## 环境要求

- Windows 10 或更高版本
- Node.js 22.12 或更高版本
- npm 10 或更高版本

## 本地运行

```powershell
npm install
npm run dev
```

`npm run dev` 会启动 Vite 开发服务并打开 Electron 桌面窗口。

项目默认使用 npmmirror 下载 Electron Windows 二进制；如需切换来源，可通过 `ELECTRON_MIRROR` 环境变量覆盖。

## 质量检查

```powershell
npm run check:readmes
npm run typecheck
npm test
npm run test:unit
npm run test:ui
npm run build
npm run test:electron-smoke
npm run test:acceptance
```

生产构建完成后可预览构建结果：

```powershell
npm start
```

`tsconfig.node.json` 的 Node 类型检查覆盖 Electron 主进程、预加载层、`src/agent/` 和共享契约；可使用 `npm run typecheck:node` 单独验证这些模块。

## 目录结构

```text
src/
├── main/       Electron 主进程
├── preload/    安全预加载边界
├── renderer/   Vue 渲染进程
└── shared/     跨进程纯类型与常量
tests/          架构与文档结构测试
docs/            按日期归档的设计和修改计划
```

## 当前范围

已经具备：

- Electron 窗口和应用生命周期；
- 隔离的渲染进程，以及仅暴露命名 `window.openNovel.agent` 方法的预加载边界；
- Vue 应用、Hash Router 和公共工作台布局；
- 项目中心及产品一级模块占位页面；
- Agent Run 的公共契约、运行时校验和纯状态机；
- 每 Run 一份 schema v1 JSON 的原子持久化、损坏记录隔离、事件补取和 analysis/final 检查点恢复；
- `/workspace/chat` 的 Harness Agent 工作台：可创建 Run、查看有节奏的本地 Mock 流与时间线、审批、运行中取消、重启后恢复、本地损坏记录诊断及连续失败事件的持久化安全详情；
- 沙箱化 CommonJS Preload、固定 Agent IPC 白名单、来源校验和不记录正文的结构化日志；
- TypeScript 类型检查、结构测试和生产构建命令。
- Windows 生产 Electron smoke：真实验证 Preload Agent 八 API、流式审批、运行中取消、重启恢复、事件连续性和本次进程树清理。

尚未实现：

- 小说项目增删改查；
- 小说业务数据库、项目文件和正文持久化；
- 真实 AI 模型配置、调用、任意工具和自定义 Skill；
- 正文编辑器、版本管理和导入导出；
- 应用安装包生成。

当前 Harness 为单用户、单窗口的 M0 实现，使用确定性 Mock 文本；Prompt、事件和输出以本地明文 JSON 保存在 Electron `userData/agent-runs`，尚未提供加密、清理界面或跨设备同步。

## 安全边界

渲染进程启用上下文隔离与沙箱，并关闭 Node.js 集成。预加载层以沙箱兼容的 CommonJS 工件运行，不暴露通用 Electron、Node.js、IPC 或文件系统能力；它只提供固定的 `window.openNovel.agent` 命令与校验、克隆后的 Agent 事件。主进程仅接受当前顶层应用文件页或精确开发服务器 origin 的请求。

## 修改计划约定

任何代码、配置或文档修改前，先在 `docs/YYYY-MM-DD/` 下创建对应的 `文件名称计划.md`。完整约束见 `AGENTS.md`。

阶段 0–8 的开发、修复或验收开始前，还必须先读取根目录 `DEVELOPMENT_PROGRESS.md`，确认当前阶段、活动工作区、分支、遗留修改和下一步，并在阶段计划中留下开工记录。

## README 目录契约

每个受版本控制且由项目维护的目录都包含 `README.md`。修改目录中的任意文件时，必须在同一变更中更新该目录的 README；提交前运行 `npm run check:readmes` 验证此约定。检查会排除 Git 元数据、工作树、依赖、构建产物、缓存和临时目录。
