# Electron 生产冒烟自动化计划

## 修改目标

新增可重复执行的 `npm run test:electron-smoke`，以真实生产构建启动隔离 `userData` 的 Electron，自动验收 Preload Agent 八个 API、流式创建/审批/完成、运行中取消、关闭重启恢复、事件连续性、片段去重和本次进程树清理；随后将该 smoke 接入现有 Windows CI，并在失败时保存脱敏诊断。

## 修改范围与明确不包含的内容

包含：

- 原生 Node 22 CDP 客户端和 Electron 进程生命周期辅助代码；
- smoke 场景编排、结构化断言、超时和脱敏诊断；
- npm 脚本、Windows CI 阻断步骤和 7 天失败 artifact；
- 对应测试、README 和本日期文档同步。

不包含：

- Agent 公共 API、IPC 契约、Mock 文本、状态机或运行时业务逻辑修改；
- M2 真实 Provider、凭据存储；
- M3 Skill、工具白名单、计划执行或 worktree；
- M4 小说项目文件写入垂直切片；
- 远端推送、主分支合并或安装包生成。

## 涉及的文件

- Create: `scripts/electron-smoke.mjs`
- Create: `scripts/electron-smoke-cdp.mjs`
- Create: `scripts/electron-smoke-process.mjs`
- Create: `scripts/electron-smoke-diagnostics.mjs`
- Create: `tests/electron-smoke.test.mjs`
- Create: this plan document
- Modify: `package.json`, `.github/workflows/quality.yml`
- Modify: 根目录、`scripts/`、`tests/`、`.github/`、`.github/workflows/`、`docs/` 相关 README

## 实施步骤

1. 记录当前 `main` 分支、工作区和质量基线；不创建新分支、不推送远端。
2. 先为事件连续性、delta 去重、API 形状、诊断脱敏和进程参数写纯逻辑测试，确认 RED。
3. 实现最小 CDP 客户端、生产构建/启动封装、页面调用、三段 Run 场景和精确进程树清理，逐轮达到 GREEN。
4. 接入 `test:electron-smoke`；CI 在现有 build 后执行，失败时上传脱敏诊断 artifact，保留 7 天。
5. 同步所有受影响目录 README、根 README 和日期文档，运行全量质量门禁与真实生产 smoke。
6. 在本计划补充实际文件、验证命令、测试数量、失败诊断行为和未完成事项。

## 验证方式与通过标准

本地 Windows 验证命令：

```powershell
npm.cmd run check:readmes
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:electron-smoke
```

通过标准：

- 生产 smoke 构建、启动和三段场景退出码为 0；
- 八个 API 均存在且被实际调用；
- 审批、取消、`interrupted → resume` 路径符合预期；
- 每个 Run 的持久化事件序号严格连续，delta 片段无重复；
- 只清理本次启动记录的进程树和临时 `userData`；
- CI smoke 失败阻断工作流，并生成不包含 prompt、正文、快照原文、堆栈或绝对路径的诊断 artifact。

## 2026-08-07 阶段 0 前置修复

- 实际基线：`npm.cmd run test:electron-smoke` 在 `build` 阶段失败，错误为 `spawn EINVAL`，尚未启动 Electron。
- 根因证据：当前 Windows Node 22.18.0 直接 `spawn('npm.cmd', ['--version'])` 同样抛出 `EINVAL`；使用 `cmd.exe /d /s /c "npm.cmd --version"` 返回退出码 0。
- 修复范围：先在 `tests/electron-smoke.test.mjs` 增加 Windows npm CLI 调用回归测试，再让 smoke 优先使用 `process.execPath + process.env.npm_execpath` 执行 npm CLI；缺少 npm CLI 路径时才使用固定 Windows 命令解释器回退。
- 安全边界：命令只接收仓库内部固定脚本名，不拼接用户输入；不使用 `shell: true`；现有 Electron 进程跟踪、超时、清理和脱敏诊断契约保持不变。
- 通过标准：聚焦测试先因缺少新行为而 RED，最小实现后 GREEN；随后真实 `npm.cmd run test:electron-smoke` 完整通过，再回填本计划“实际结果与验证结果”。

## 实际结果与验证结果

- 已新增原生 CDP 客户端、生产 Electron 进程管理、事件/诊断辅助和完整 smoke 编排；Windows CI 已增加阻断式 smoke 与失败诊断 artifact。
- 2026-08-07 RED：`node --experimental-strip-types --test tests/electron-smoke.test.mjs` 共 7 项，6 项通过；新增 Windows npm 调用测试因返回 `undefined` 按预期失败。
- 2026-08-07 GREEN：实现 `buildNpmScriptInvocation` 后同一聚焦测试 7/7 通过；调用优先为 `process.execPath + process.env.npm_execpath`，避免直接启动 `.cmd`。
- `npm.cmd run check:readmes`：通过，输出 `README directory contract passed.`。
- `npm.cmd test`：通过，90/90。
- `npm.cmd run typecheck`：通过。
- `npm.cmd run build`：在沙箱外通过；产出 main、CommonJS preload 和 renderer 三部分。沙箱内已有 `out/` 不可写导致的 `EPERM` 属执行权限差异，不是代码失败。
- `npm.cmd run test:electron-smoke`：通过，输出 `Electron production smoke passed`；构建、八 API、审批、取消、重启恢复、事件连续性、delta 去重和进程树清理均完成。
- GitHub Actions 未在本地伪造执行；工作流文件已接入相同 npm 脚本，远端运行结果由后续 push/PR 验证。
