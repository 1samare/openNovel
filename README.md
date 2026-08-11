# OpenNovel

OpenNovel 是一个面向 Windows 的本地优先小说 AI 辅助写作桌面应用。本仓库已交付 Electron + Vue 3 + TypeScript 基础架构、离线 Agent Harness、独立项目生命周期、章节编辑与版本交换，以及阶段 3 的 BYOK 密钥库、Model Gateway 与角色绑定；阶段 3 已完成、获用户确认并推送至 `origin/feat/v1.0`，真实 Agent 小说工作流仍不在当前交付范围。

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

- 2026-08-10：阶段 2 从 `feat/v1.0@be94336` 开工，远端 0/0，按共享契约、SQLite schema、章节服务、文件交换、固定 IPC 与 CodeMirror 纵向切片实施。

- 2026-08-10：阶段 2 首个检查点完成：project schema v2、章节/草稿共享契约与 Unicode 正文字数聚焦回归 23/23。

- 2026-08-10：将开发环境与 Windows Quality 的 Node 下限修正为 22.13，确保 `node:sqlite` 无需实验开关即可用于数据库测试。

- 2026-08-10：阶段 2 完成章节树/分卷组织、CodeMirror 纯文本编辑、不可变版本、800ms 安全保存、三格式导出、TXT/Markdown 导入和可校验项目归档；两轮独立复审及最终 Node 153/UI 23/生产验收通过，进入用户确认门禁。

- 2026-08-10：阶段 2 实现已本地提交为 `110ec02`；按阶段治理规则保留 `feat/v1.0`，等待用户确认后普通快进推送。

- 2026-08-10：阶段 2 完成交接已保存为独立本地提交；最新 fetch 证明分支相对 `origin/feat/v1.0@b4ec16f` ahead 2/behind 0 且可普通快进，当前按治理门禁暂停，仅等待用户明确确认。

- 2026-08-10：用户确认阶段 2 完成；实现与交接已普通快进推送到 `origin/feat/v1.0@b835840`，推送后 upstream 与 ahead/behind 核对为 0/0。

- 2026-08-10：阶段 3 从根工作区 `feat/v1.0@419b4d8` 开工；fetch 后远端 0/0，按密钥库、控制库元数据、三类 Provider Adapter、Model Gateway、固定 IPC、模型设置页和项目角色绑定纵向切片实施。

- 2026-08-10：阶段 3 首个检查点完成：锁定 AI SDK 7 与三类 Provider/Zod，新增共享模型契约、project schema v3 和 control schema v2，聚焦 Node 12/12 与 Node 类型检查通过。

- 2026-08-10：阶段 3 密钥安全检查点完成：操作系统加密不可用时拒绝落盘，API Key 使用独立原子密文文件；Provider URL 只允许 HTTPS/显式回环 HTTP，并阻止协议降级与跨 origin 凭据转发。

- 2026-08-10：阶段 3 持久化检查点完成：Provider 连接和 Model Profile 落入 control 数据库、模式默认和角色覆盖落入项目库；公开连接保持脱敏，角色能力与跨供应商 fallback 显式确认均在保存边界阻断。

- 2026-08-10：阶段 3 Provider Adapter 检查点完成：三类 AI SDK 原生协议均由回环 fake server 验证连接、流式文本、Zod 结构化输出、usage/request ID、失败与取消；OpenAI-compatible 提供可选模型列表，手工模型 ID 始终保留。

- 2026-08-10：阶段 3 Model Gateway 检查点完成：Profile 能力与密钥在调用前解析，稳定错误和有限抖动重试覆盖供应商/网络矩阵，流输出后禁止重放；调用日志只经白名单和 SQLite Worker 保存元数据。

- 2026-08-10：阶段 3 主进程接入检查点完成：safeStorage 密钥根、模型 runtime、九个固定 IPC 和九方法 preload 已组合；关闭时取消并等待模型网络调用，随后按模型控制库、章节、项目顺序释放资源。

- 2026-08-10：阶段 3 本地验收完成：模型设置/Profile/三模式六角色路由、密钥全路径审计、生产 Electron 重启解密和两轮独立复审通过；用户在本机设置页确认真实 DeepSeek 连接成功，等待明确完成确认后推送。

- 2026-08-10：阶段 3 实现与本地验收记录提交为 `579d31a`；Actions 治理差异与用户 `.superpowers/` 未进入该提交。

- 2026-08-10：用户明确确认阶段 3 完成，授权已核验提交普通快进推送到 `origin/feat/v1.0`；推送前 fetch 证明 ahead/behind 为 `2/0` 且远端是本地祖先。

- 2026-08-10：阶段 3 最终门禁复跑通过，`419b4d8..ebc2824` 已普通快进推送至 `origin/feat/v1.0`；推送后本地与远端均为 `ebc2824`、ahead/behind 0/0。

- 2026-08-10：阶段 3 最终完成记录由当前 HEAD 承载并普通快进推送；本地与 `origin/feat/v1.0` 最终一致，ahead/behind 0/0。

- 2026-08-11：阶段 4 从根工作区 `feat/v1.0@b88f8a3` 开工；fetch 后远端 0/0，按小说圣经 schema v4、追加式来源版本、结构化提案、固定 IPC 与世界观/人物/大纲页面实施。

- 2026-08-11：阶段 4 生产验收将 Zod 内联到 sandbox CommonJS preload，避免第三方 `require` 使全部固定 bridge 在真实窗口中失效。

- 2026-08-11：阶段 4 Task 1–10 本地交接完成；两轮复审问题均已修复，终审无剩余 Critical/Important，完整本地门禁通过，等待用户确认后普通快进推送。

## 技术栈

- Electron
- Vue 3
- TypeScript
- electron-vite
- Vue Router
- Vercel AI SDK、OpenAI-compatible/Anthropic/Google Provider 与 Zod
- npm
- Vitest、Vue Test Utils 与 happy-dom（组件测试）

## 环境要求

- Windows 10 或更高版本
- Node.js 22.13 或更高版本
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
- 隔离的渲染进程，以及仅暴露命名 Agent、Project、Chapter、Model 与退出保存 Lifecycle 方法的预加载边界；
- Vue 应用、Hash Router 和公共工作台布局；
- 本地优先项目中心：新建/打开独立小说项目、最近项目、缺失路径恢复与仅移除记录；产品其余一级模块占位页面；
- 每项目独立目录、严格 manifest、SQLite Worker/schema v3、单写者锁、可校验 `.opennovel.zip` 备份/恢复，以及工作台重命名、备份和安全关闭；
- 可维护分卷/章节层级的章节树、CodeMirror 6 编辑器、800ms 自动保存、切章/备份/退出刷盘、不可变确认版本与历史恢复；
- UTF-8 TXT/Markdown/paste 导入预览与事务确认，以及来自同一数据库快照的 TXT、Markdown、无宏 DOCX 导出；
- Agent Run 的公共契约、运行时校验和纯状态机；
- 每 Run 一份 schema v1 JSON 的原子持久化、损坏记录隔离、事件补取和 analysis/final 检查点恢复；
- `/workspace/chat` 的 Harness Agent 工作台：可创建 Run、查看有节奏的本地 Mock 流与时间线、审批、运行中取消、重启后恢复、本地损坏记录诊断及连续失败事件的持久化安全详情；
- 沙箱化 CommonJS Preload、固定 Agent IPC 白名单、来源校验和不记录正文的结构化日志；
- 基于 Electron `safeStorage` 的 BYOK 密钥库、OpenAI-compatible/Anthropic/Gemini Adapter、供应商无关 Model Gateway、模型档案、三模式六角色路由和脱敏调用日志；
- `/workspace/settings` 模型设置页：DeepSeek 预设、手工模型 ID、连接测试/取消、能力声明、fallback 与跨供应商显式确认；
- TypeScript 类型检查、结构测试和生产构建命令。
- Windows 生产 Electron smoke：精确验证 Agent 8、Project 9、Chapter 13、Model 9、Lifecycle 2 个命名 API，以及模型密钥重启解密、回环 Provider、流式审批、运行中取消、重启恢复、事件连续性和本次进程树清理。

尚未实现：

- 把 Model Gateway 接入真实多 Agent 小说创作工作流、任意工具和自定义 Skill；
- 应用安装包生成。

当前 Harness 为单用户、单窗口的 M0 实现，使用确定性 Mock 文本；Prompt、事件和输出以本地明文 JSON 保存在 Electron `userData/agent-runs`，尚未提供加密、清理界面或跨设备同步。

## 安全边界

渲染进程启用上下文隔离与沙箱，并关闭 Node.js 集成。预加载层以沙箱兼容的 CommonJS 工件运行，不暴露通用 Electron、Node.js、IPC、文件系统或 API Key 读取能力；它只提供固定的 `window.openNovel.agent`、`projects`、`chapters`、`models` 与 `lifecycle` 命名方法、严格结果校验和克隆后的安全数据。主进程仅接受当前顶层应用文件页或精确开发服务器 origin 的请求。

## 修改计划约定

任何代码、配置或文档修改前，先在 `docs/YYYY-MM-DD/` 下创建对应的 `文件名称计划.md`。完整约束见 `AGENTS.md`。

阶段 0–8 的开发、修复或验收开始前，还必须先读取根目录 `DEVELOPMENT_PROGRESS.md`，确认当前阶段、活动工作区、分支、遗留修改和下一步，并在阶段计划中留下开工记录。

## README 目录契约

每个受版本控制且由项目维护的目录都包含 `README.md`。修改目录中的任意文件时，必须在同一变更中更新该目录的 README；提交前运行 `npm run check:readmes` 验证此约定。检查会排除 Git 元数据、工作树、依赖、构建产物、缓存和临时目录。
