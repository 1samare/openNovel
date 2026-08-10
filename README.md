# OpenNovel

OpenNovel 是一个面向 Windows 的本地优先小说 AI 辅助写作桌面应用。本仓库已交付 Electron + Vue 3 + TypeScript 基础架构和首个离线 Agent Harness 垂直闭环；`feat/v1.0` 的阶段 1 独立项目、本地数据库与项目生命周期已完成实现、退出门禁、用户确认与远端推送，真实模型调用仍不在当前阶段。

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

- 2026-08-07：阶段 1 从 `feat/v1.0@2d74049` 开工，按领域服务、SQLite Worker、受限项目 IPC 和可访问项目中心路径实施。

- 2026-08-07：阶段 1 已完成项目路径、严格原子 manifest、活动/陈旧项目锁的首个 TDD 检查点。

- 2026-08-07：阶段 1 将小说项目 SQLite 类型检查纳入 Node 门禁，并建立 Worker RPC 与 schema v1。

- 2026-08-07：阶段 1 SQLite Worker 已通过 schema、pragma、事务/迁移回滚、事件循环响应和关闭测试。

- 2026-08-07：阶段 1 已完成项目仓储与生命周期，覆盖重启、重命名、最近项目、备份恢复、预迁移备份和双实例写锁。

- 2026-08-07：阶段 1 已接入九个固定项目 IPC、最小 preload、系统目录/陈旧锁对话框和退出前 SQLite Worker 等待。

- 2026-08-07：阶段 1 UI 测试复用生产 renderer 的 `@renderer` 与 `@shared` alias，以挂载真实项目中心组件。

- 2026-08-07：阶段 1 项目中心已接入本地新建/打开、最近项目、路径失效恢复、仅移除记录、操作锁和可行动错误反馈，项目中心 4/4、完整 UI 5/5 与类型检查通过。

- 2026-08-07：阶段 1 首轮完整门禁通过后进入只读自审修复，当前聚焦生命周期并发/失败清理、Worker 故障闭合与备份路径安全，尚未提交或推送。

- 2026-08-07：阶段 1 后端自审项已通过聚焦回归；继续补齐工作台重命名、创建备份与关闭项目的用户入口。

- 2026-08-07：阶段 1 工作台现可重命名、创建一致备份并安全关闭项目；审查修复后项目/foundation 37/37、UI 7/7、严格类型通过，等待复审与最终门禁。

- 2026-08-10：续接阶段 1 并重新核对 `feat/v1.0` 与远端 0/0；复审加固后的聚焦 Node 40/40、UI 8/8、严格类型和 README 契约通过，等待复审终稿与最终全门禁。

- 2026-08-10：阶段 1 只读复审无 Critical/Important；最终 Node 123/123、UI 8/8、类型、README、生产构建、Electron smoke 与 acceptance 全部通过，进入阶段提交和用户确认。

- 2026-08-10：阶段 1 实现以 `cebfc78` 提交，完成交接记录同步保存；当前仅等待用户确认后普通快进推送 `feat/v1.0`。

- 2026-08-10：用户确认阶段 1 完成；阶段提交已普通快进推送到 `origin/feat/v1.0@1a73a03`，upstream 与 ahead/behind 核对为 0/0。

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

`tsconfig.node.json` 的 Node 类型检查覆盖 Electron 主进程、预加载层、`src/agent/`、`src/novel/` 和共享契约；可使用 `npm run typecheck:node` 单独验证这些模块。

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
- 隔离的渲染进程，以及仅暴露命名 `window.openNovel.agent` 与 `window.openNovel.projects` 方法的预加载边界；
- Vue 应用、Hash Router 和公共工作台布局；
- 本地优先项目中心：新建/打开独立小说项目、最近项目、缺失路径恢复与仅移除记录；产品其余一级模块占位页面；
- 每项目独立目录、严格 manifest、SQLite Worker/schema v1、单写者锁、一致备份/恢复，以及工作台重命名、备份和安全关闭；
- Agent Run 的公共契约、运行时校验和纯状态机；
- 每 Run 一份 schema v1 JSON 的原子持久化、损坏记录隔离、事件补取和 analysis/final 检查点恢复；
- `/workspace/chat` 的 Harness Agent 工作台：可创建 Run、查看有节奏的本地 Mock 流与时间线、审批、运行中取消、重启后恢复、本地损坏记录诊断及连续失败事件的持久化安全详情；
- 沙箱化 CommonJS Preload、固定 Agent IPC 白名单、来源校验和不记录正文的结构化日志；
- TypeScript 类型检查、结构测试和生产构建命令。
- Windows 生产 Electron smoke：真实验证 Preload Agent 八 API、流式审批、运行中取消、重启恢复、事件连续性和本次进程树清理。

尚未实现：

- 章节树、正文内容、版本与文件交换；
- 真实 AI 模型配置、调用、任意工具和自定义 Skill；
- 正文编辑器、版本管理和导入导出；
- 应用安装包生成。

当前 Harness 为单用户、单窗口的 M0 实现，使用确定性 Mock 文本；Prompt、事件和输出以本地明文 JSON 保存在 Electron `userData/agent-runs`，尚未提供加密、清理界面或跨设备同步。

## 安全边界

渲染进程启用上下文隔离与沙箱，并关闭 Node.js 集成。预加载层以沙箱兼容的 CommonJS 工件运行，不暴露通用 Electron、Node.js、IPC 或文件系统能力；它只提供固定的 `window.openNovel.agent`、`window.openNovel.projects` 命令与校验，以及克隆后的安全结果/Agent 事件。主进程仅接受当前顶层应用文件页或精确开发服务器 origin 的请求。

## 修改计划约定

任何代码、配置或文档修改前，先在 `docs/YYYY-MM-DD/` 下创建对应的 `文件名称计划.md`。完整约束见 `AGENTS.md`。

阶段 0–8 的开发、修复或验收开始前，还必须先读取根目录 `DEVELOPMENT_PROGRESS.md`，确认当前阶段、活动工作区、分支、遗留修改和下一步，并在阶段计划中留下开工记录。

## README 目录契约

每个受版本控制且由项目维护的目录都包含 `README.md`。修改目录中的任意文件时，必须在同一变更中更新该目录的 README；提交前运行 `npm run check:readmes` 验证此约定。检查会排除 Git 元数据、工作树、依赖、构建产物、缓存和临时目录。
