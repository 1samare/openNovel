# scripts 目录说明

## 目录用途

存放不参与应用运行时的本地质量检查脚本。

## 内容说明

- `check-readmes.mjs`：检查维护文件的所有祖先目录是否包含五个必需章节的 `README.md`，并确认直接变更目录同步更新 README；支持 `README_CHECK_BASE`、`GITHUB_BASE_REF` 与 push 事件前 SHA。
- `electron-smoke.mjs`：构建并驱动隔离 `userData` 的生产 Electron，精确核对 Agent/Project/Chapter/Model/Bible/Lifecycle 桥接，使用回环 fake provider 让设定、人物、剧情三角色均走 generate → proposal → approve，验收双题材小说圣经/前三章/重启一致、safeStorage 与明文扫描、安全未打开状态和 Agent 闭环，并生成失败诊断。
- `electron-smoke-seed.mjs`：仅由生产 smoke 通过带 TypeScript strip 的独立 Node 进程调用，在独占临时 `userData` 中用真实 `ProjectService` 创建都市校园与科幻未来两个空项目；不向生产入口增加测试路径。
- `electron-smoke-cdp.mjs`：使用 Node 内置 HTTP/WebSocket 实现最小 CDP 页面连接和异步调用。
- `electron-smoke-process.mjs`：使用 Node 执行 npm CLI（Windows 缺少 CLI 路径时使用固定命令解释器回退），并管理生产构建、Electron 进程、随机端口、临时目录和 Windows 进程树清理。
- `electron-smoke-diagnostics.mjs`：验证事件连续性与 delta 去重，并生成不含正文和路径的脱敏诊断。

## 依赖边界

脚本只依赖 Node.js 内置模块、Git 命令、项目领域模块和本地 Electron 二进制，不依赖 Vue、真实模型或外部网络服务。双题材 smoke 的预置只建立 v4 空项目；世界观、人物、大纲、提案、版本与恢复必须全部通过生产窗口公开 bridge 完成。

## 维护规则

新增或修改脚本时，必须同步更新本 README；脚本不得读取或输出本地密钥。

## 变更同步

- 2026-07-28：新增 README 目录契约检查脚本。
- 2026-07-28：补充祖先目录、精确必需章节和 push 基准差异检查。
- 2026-07-28：新增原生 CDP 生产 Electron 冒烟、事件断言、进程树清理和脱敏诊断脚本。
- 2026-08-07：修复 Windows 直接启动 `npm.cmd` 的 `EINVAL`，改用可跟踪的 Node npm CLI 调用并保留固定回退。
- 2026-08-10：阶段 2 smoke 扩展到 Project、Chapter 与退出保存 Lifecycle 精确命名桥接，并验证无项目时章节调用安全失败。
- 2026-08-10：阶段 3 smoke 扩展到九方法 Model 桥接，并通过回环 OpenAI-compatible provider 验证生产 safeStorage、调用和重启持久化路径。
- 2026-08-10：终轮复核要求重启后的 Electron 再次解密密钥并认证；清理隔离 userData 前扫描 model-secrets 与 control SQLite/WAL/SHM，不得出现测试密钥明文。
- 2026-08-11：阶段 4 新增真实 `ProjectService` 双项目预置脚本，为生产 Bible bridge 的双题材端到端验收提供无对话框入口。
- 2026-08-11：阶段 4 production smoke 经固定 bridge 覆盖双题材作品档案、世界/人物/前三章、版本恢复、结构化替代确认、拒绝隔离与应用重启；诊断同时记录页面目标和实际 API 键。
- 2026-08-11：退出复审将主要人物与三个章节规划改为真实 character/plot 结构化生成和逐条批准，证明三专业角色均通过生产桥接、模型路由、提案仓储与审批链。
