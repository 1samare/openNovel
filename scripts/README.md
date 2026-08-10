# scripts 目录说明

## 目录用途

存放不参与应用运行时的本地质量检查脚本。

## 内容说明

- `check-readmes.mjs`：检查维护文件的所有祖先目录是否包含五个必需章节的 `README.md`，并确认直接变更目录同步更新 README；支持 `README_CHECK_BASE`、`GITHUB_BASE_REF` 与 push 事件前 SHA。
- `electron-smoke.mjs`：构建并驱动隔离 `userData` 的生产 Electron，精确核对 Agent/Project/Chapter/Model/Lifecycle 桥接，使用回环 fake provider 验收 safeStorage 连接、每次进程认证、模型列表、Profile 重启持久化、关闭后的密钥/数据库明文扫描、安全未打开状态和 Agent 闭环，并生成失败诊断。
- `electron-smoke-cdp.mjs`：使用 Node 内置 HTTP/WebSocket 实现最小 CDP 页面连接和异步调用。
- `electron-smoke-process.mjs`：使用 Node 执行 npm CLI（Windows 缺少 CLI 路径时使用固定命令解释器回退），并管理生产构建、Electron 进程、随机端口、临时目录和 Windows 进程树清理。
- `electron-smoke-diagnostics.mjs`：验证事件连续性与 delta 去重，并生成不含正文和路径的脱敏诊断。

## 依赖边界

脚本只依赖 Node.js 内置模块、Git 命令和项目本地 Electron 二进制，不依赖 Vue、真实模型或网络服务。

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
