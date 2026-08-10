# PR 质量检查测试环境隔离修复计划

> **供 Agent 实施者使用：** 本修复按单一 RED/GREEN 循环执行；不创建额外 worktree，不改写已推送历史，不触碰阶段 2 章节领域实现。

**目标：** 消除 PR 环境变量污染、Node 运行时下限不匹配和 Windows 8.3/长路径别名导致的三类失败，使 `Quality` 工作流的 `npm test` 在 PR 与 push 事件下都能确定性运行。

**架构：** 保留 `scripts/check-readmes.mjs` 的既有基准优先级，只在测试边界显式构造 push 场景环境；同时把开发引擎下限和 Windows CI 固定为 Node `22.13.0`，即 `node:sqlite` 无需实验开关的首个版本；恢复测试以 `realpath` 后的规范路径断言服务已存在的安全路径规范化行为。生产检查器、测试脚本和阶段 2 领域实现均不改变。

**技术栈：** Node.js 22.13+、Node.js Test Runner、`node:sqlite`、Node.js `child_process`、Git、GitHub Actions Windows runner。

## 开工记录

- 已读取进度清单日期：2026-08-10；已完整读取根目录 `DEVELOPMENT_PROGRESS.md`。
- 已读取对应计划：`docs/2026-08-10/阶段2章节编辑版本与文件交换计划.md`；阶段 2 正在进行，本修复作为独立 CI 活动任务登记。
- 工作区：`D:\Code\codex\openNovel`（`git rev-parse --show-toplevel` 返回 `D:/Code/codex/openNovel`）。
- 分支与基线：`feat/v1.0` / `be94336`。
- 远端核对：2026-08-10 执行 `git fetch --prune origin` 成功；本地 `feat/v1.0` 与 `origin/feat/v1.0` 均为 `be94336`，ahead/behind 为 `0/0`。
- 并行工作区：保留历史 `.worktrees/harness-agent-loop@31ca681` 与 `.worktrees/phase-0-test-foundation@0736181`；不读取、不修改、不复用。
- 已有修改：阶段 2 的计划、进度、章节契约/schema/服务及测试正在未提交开发；`tests/README.md` 已由阶段 2 修改；未跟踪 `.superpowers/` 属于用户既有内容。本任务保留这些改动，仅追加自己的记录。
- 当前阶段状态：阶段 2 进行中；PR `Quality` 的 `npm test` 因测试环境隔离缺陷失败；阻塞项为无。
- 最近验证：在本地为测试进程注入 `GITHUB_BASE_REF=main` 后，`tests/readme-contract.test.mjs` 稳定复现 8 项中 1 项失败，错误与 CI 相同：第 201 行预期退出码 `1`、实际为 `0`。
- 可直接执行的下一步：登记本活动任务并执行最小测试环境覆盖，然后在相同 PR 环境模拟下重跑聚焦测试。

## 续接记录

- 续接日期：2026-08-10；已重新完整读取 `DEVELOPMENT_PROGRESS.md`、阶段 2 计划和本计划。
- 工作区/分支/HEAD：`D:\Code\codex\openNovel` / `feat/v1.0` / `e0279e7`。
- 远端核对：重新 fetch 后 `origin/feat/v1.0@e0279e7`，ahead/behind `0/0`；GitHub CLI 已认证并具备 `repo`、`workflow` 权限。
- 并行工作区：历史 `harness-agent-loop` 与 `phase-0-test-foundation` 保持不读取、不修改、不复用。
- 已有修改：阶段 2 正在修改根 README、package/lock、源码与测试；本轮只在这些文件追加 Node 下限相关行，提交时使用精确暂存隔离阶段 2 内容。
- 当前状态：用户已批准把 CI 与开发引擎最低版本提升到 `22.13.0`；远端两条 Quality 的 RED 均为 Node `22.12.0` 无法加载 `node:sqlite`。
- 可直接执行的下一步：先更新本计划与活动任务范围，再修改工作流、引擎下限及同目录 README。

## 修改目标

- 让 `uses the push event before SHA in a clean checkout` 不受宿主 PR 环境变量影响。
- 保持测试对真实 push 基准差异和 README 同步失败码的覆盖。
- 完成与 PR `Quality` 工作流等价的本地质量门禁验证。
- 让 CI 与声明的开发引擎下限都使用 Node `22.13.0`，确保 `node:sqlite` 无需额外 CLI 开关即可加载。
- 让备份恢复测试在 Windows runner 同一目录同时具有 8.3 短路径和长路径表示时，按规范化后的真实路径验证结果。

## 修改范围

### 包含

- `tests/readme-contract.test.mjs`：为 push 场景显式清空 `README_CHECK_BASE` 与 `GITHUB_BASE_REF`，仅保留测试生成的 `GITHUB_EVENT_BEFORE`。
- `tests/README.md`：记录 README 契约测试的 CI 环境隔离回归。
- `docs/2026-08-10/README.md`：登记本计划。
- `DEVELOPMENT_PROGRESS.md`：登记、更新并交接独立 CI 修复活动任务。
- 本计划：记录实际结果与验证证据。
- `.github/workflows/quality.yml`：把 Actions Node 版本从 `22.12.0` 提升到 `22.13.0`。
- `.github/workflows/README.md`：记录 `node:sqlite` 对 CI 运行时下限的要求。
- `package.json`、`package-lock.json`：把根包 engines 下限从 `>=22.12.0` 修正为 `>=22.13.0`。
- `README.md`：同步本地 Node 环境要求与 CI 修复记录。
- `tests/project-lifecycle.test.mjs`：把恢复根目录和最近项目路径的期望值规范化为恢复完成后的 `realpath`。

### 明确不包含

- 不修改 `scripts/check-readmes.mjs` 的 `README_CHECK_BASE`、`GITHUB_BASE_REF`、`GITHUB_EVENT_BEFORE` 优先级。
- 不修改、重构或暂存阶段 2 章节领域文件。
- 不通过 `--experimental-sqlite` 绕过错误的运行时声明。
- 不把最低版本扩大到 Node 24；本次采用官方确认的最小无开关版本 `22.13.0`。
- 不修改依赖版本、测试脚本或阶段 2 业务行为。
- 不移除生产代码的 `safeDestination`/`realpath` 路径规范化，不把 Windows 路径比较改成简单大小写忽略。

## 涉及文件

- 修改：`tests/readme-contract.test.mjs`
- 修改：`tests/README.md`
- 新增：`docs/2026-08-10/PR质量检查测试环境隔离修复计划.md`
- 修改：`docs/2026-08-10/README.md`
- 修改：`DEVELOPMENT_PROGRESS.md`
- 修改：`.github/workflows/quality.yml`
- 修改：`.github/workflows/README.md`
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`README.md`
- 修改：`tests/project-lifecycle.test.mjs`

## 设计路径比较与采用结论

1. **采用：在目标测试调用处显式清空 PR 基准变量。** 变更最小，测试名称、输入和生产行为一致，也不会影响其他测试依赖宿主环境的方式。
2. 在 `runChecker` 辅助函数中全局删除 GitHub 环境变量：隔离更强，但会改变所有用例的默认环境模型，范围大于本次故障所需。
3. 调整生产检查器使 `GITHUB_EVENT_BEFORE` 优先于 `GITHUB_BASE_REF`：能够让当前测试通过，但会改变 PR 场景的生产语义，属于用产品逻辑掩盖测试污染，不采用。

### Node 运行时路径

1. **采用：CI 与 engines 同步提升到 `22.13.0`。** 这是 Node 官方确认 `node:sqlite` 不再需要 `--experimental-sqlite` 的首个版本，修复真实运行时下限且改动最小。
2. 仅给测试命令增加 `--experimental-sqlite`：可让 Node `22.12.0` 的测试启动，但本地开发/其他命令仍会违反 engines 声明，不采用。
3. 直接提升到 Node 24：与 Electron 内置 Node 版本一致，但会无必要地收紧开发机下限，超出本次 CI 根因，不采用。

### Windows 路径表示

1. **采用：测试使用恢复完成后的 `realpath(restoredRoot)` 作为规范期望值。** 生产服务会规范化已存在祖先目录，返回长路径是既有安全行为；规范期望既覆盖本地普通路径，也覆盖 GitHub runner 的 `RUNNER~1`/`runneradmin` 等价别名。
2. 在断言中仅转小写比较：可处理大小写差异，但不能证明 8.3 短路径与长路径是同一文件系统位置，不采用。
3. 让生产服务保留调用方原始路径：会削弱路径重叠、锁和最近项目去重所依赖的规范化边界，不采用。

## 实施步骤

### Task 1：完成单一 RED/GREEN 修复

- [x] **确认 RED：** 在未修改测试前注入 `GITHUB_BASE_REF=main`，复现 `uses the push event before SHA in a clean checkout` 的 `0 !== 1`。
- [x] **最小 GREEN：** 将目标用例的环境设置为 `{ README_CHECK_BASE: '', GITHUB_BASE_REF: '', GITHUB_EVENT_BEFORE: before }`。
- [x] **聚焦验证：** 在宿主 `GITHUB_BASE_REF=main` 模拟下运行 `node --test tests/readme-contract.test.mjs`，预期 8/8 通过且退出码为 0。
- [x] **文档同步：** 更新 `tests/README.md`、本目录 `README.md`、本计划与开发进度清单。
- [x] **质量门禁：** 运行 `npm run check:readmes`、`npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`。

### Task 2：对齐 `node:sqlite` 运行时下限

- [x] **确认 RED：** 两条远端 Quality 在 Node `22.12.0` 下均以 `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` 失败，原 README push 基准用例已通过。
- [x] **核对官方边界：** Node 官方版本历史确认 `22.13.0` 起 `node:sqlite` 不再需要 `--experimental-sqlite`。
- [x] **最小 GREEN：** 把 `.github/workflows/quality.yml` 固定版本与根包 engines/锁文件下限同步改为 `22.13.0`。
- [x] **文档同步：** 更新 `.github/workflows/README.md`、根 `README.md`、本计划与开发进度清单。
- [x] **SQLite 聚焦验证：** 使用已安装的 Node 22.18 运行 `project-database.test.mjs` 与 `project-lifecycle.test.mjs`，20/20 通过。
- [x] **提交范围门禁：** 精确暂存本任务 5 个文件，核对暂存差异、README 目录配对和空白检查；阶段 2 原任务同步 `src/renderer/src/project/README.md` 后，全工作区 README 契约重跑退出 0，该阶段 2 文件仍未纳入本修复暂存范围。
- [x] **远端验证：** 精确提交本任务文件、普通推送到 `origin/feat/v1.0`，最终 push 与 pull_request 两条 Quality 全部通过。

### Task 3：规范化 Windows 恢复路径断言

- [x] **确认 RED：** Node 22.13 提交 `ae8713f` 触发的两条 Quality 均只在 `creates a verified backup and restores it into an empty destination` 失败；实际长路径包含 `runneradmin`，原期望保留 8.3 短路径 `RUNNER~1`。
- [x] **核对生产语义：** `safeDestination` 会通过 `realpath` 规范化最近的已存在祖先，恢复返回和 control 最近项目均保存规范路径；长路径返回符合现有设计。
- [x] **最小 GREEN：** 在测试中导入 `realpath`，恢复后计算规范根目录，并用它断言 `restored.root` 与最近项目路径；同步 `tests/README.md`。
- [x] **聚焦与完整验证：** Node 22.18 下重跑生命周期聚焦测试、README、完整测试、类型、构建与空白检查。
- [x] **精确发布与远端验证：** 仅暂存测试与对应 README 的本任务行，提交、普通推送并等待两条 Quality 通过。

## 验证方式与通过标准

- PR 环境模拟：设置 `GITHUB_BASE_REF=main` 后运行 `tests/readme-contract.test.mjs`，8 项全部通过。
- README 契约：`npm run check:readmes` 退出 0。
- 完整测试：`npm test` 退出 0，不再出现 `uses the push event before SHA in a clean checkout` 失败。
- 类型与构建：`npm run typecheck`、`npm run build` 均退出 0。
- Git 质量：`git diff --check` 退出 0；本任务差异仅包含计划列出的文件，阶段 2 既有修改保持原样。
- 运行时边界：`package.json`、`package-lock.json` 和 `quality.yml` 都声明 `22.13.0`，根 README 与 workflow README 一致。
- SQLite 聚焦测试：Node 22.13+ 下 `project-database.test.mjs`、`project-lifecycle.test.mjs` 不再出现 `ERR_UNKNOWN_BUILTIN_MODULE`。
- 远端门禁：同一提交触发的 push 与 pull_request 两条 `Quality` 均成功。

## 实际结果

- `tests/readme-contract.test.mjs` 的 push 基准用例现在显式清空 `README_CHECK_BASE` 和 `GITHUB_BASE_REF`，再注入测试仓库生成的 `GITHUB_EVENT_BEFORE`。
- Task 1 未修改生产检查器或工作流；Task 2 只调整工作流 Node 版本，阶段 2 章节领域改动始终保持原归属。
- 本地实现已提交为 `e0279e7 test: isolate README push baseline in PR CI`，提交严格包含 `tests/readme-contract.test.mjs` 与本任务对应的 `tests/README.md` 单行记录；阶段 2 其他改动未暂存。
- 重新完成 GitHub Web 登录并验证 API 身份后，`e0279e7` 已从 `be94336` 普通快进推送到 `origin/feat/v1.0`；推送后本地与远端 ahead/behind 为 `0/0`。
- 推送触发的 push 与 pull_request 两条 `Quality` 均已完成但失败；原目标用例 `uses the push event before SHA in a clean checkout` 已通过。新失败发生在 `project-database.test.mjs` 与 `project-lifecycle.test.mjs` 加载阶段：CI 的 Node `22.12.0` 报 `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`。
- Node 官方版本历史确认 `node:sqlite` 从 `22.13.0` 起不再需要 `--experimental-sqlite`；用户已批准该最小运行时修复，工作流、根包 engines/锁文件和对应 README 已对齐到 `22.13.0`。
- 使用本机 Node `v22.18.0` 运行两个原失败 SQLite 测试，20/20 通过且未出现 `ERR_UNKNOWN_BUILTIN_MODULE`。
- 全工作区 `npm.cmd run check:readmes` 首次只报告阶段 2 的 `src/renderer/src/project/use-workspace-project.ts` 缺少同目录 README 同步；阶段 2 原任务随后同步该 README，本任务未扩大暂存范围。
- Node 22.13 对齐已提交为 `ae8713f ci: require Node 22.13 for sqlite` 并普通推送；两条 Quality（run `31353772683`、`31353775840`）已能加载 `node:sqlite`，但共同暴露 Windows runner 的恢复路径断言把 `runneradmin` 长路径与 `RUNNER~1` 短路径误判为不同目录。
- 恢复测试现在在目录创建完成后用 `realpath(restoredRoot)` 得到规范期望，并同时验证返回摘要和最近项目记录；生产路径处理未修改。
- Windows 路径修复已提交为 `b4ec16f test: canonicalize restored Windows paths` 并从 `ae8713f` 普通快进推送；本地与 `origin/feat/v1.0` 最终 ahead/behind 为 `0/0`。
- 最终 push run `31354059192`（job `93350238483`）与 pull_request run `31354060855`（job `93350243814`）均为 `Quality: pass`，耗时分别为 1 分 37 秒和 2 分钟。

## 验证结果

- RED：宿主 `GITHUB_BASE_REF=main` 下，修改前聚焦测试为 7/8，目标用例报 `0 !== 1`。
- GREEN：相同环境模拟下，`node --test tests/readme-contract.test.mjs` 为 8/8、退出 0。
- `npm.cmd run check:readmes`：退出 0，输出 `README directory contract passed.`。
- `npm.cmd run typecheck`：退出 0。
- `npm.cmd test`：退出 0；Node 136/136、UI 8/8。
- `npm.cmd run build`：沙箱内首次因无法删除既有 `out/main/index.js` 报 `EPERM`；在受限环境外重跑同一命令退出 0，main/preload/renderer 均构建成功。
- `git diff --check`：退出 0；仅有 Git 的 LF/CRLF 转换提示，无空白错误。
- 提交前暂存审计：2 个文件，6 行新增、1 行删除；聚焦 PR 环境测试 8/8、README 契约退出 0。
- 推送状态：成功；`be94336..e0279e7` 已进入 `origin/feat/v1.0`，远端同步为 0/0。
- 远端复验：两条新 Quality 均失败，但 README push 基准测试已通过；残留失败根因是工作流 Node `22.12.0` 早于 `node:sqlite` 无开关可用的 `22.13.0`。
- Node 22.18 SQLite 聚焦复验：`node --experimental-strip-types --test tests/project-database.test.mjs tests/project-lifecycle.test.mjs` 退出 0，20/20 通过。
- 全工作区 README 复验：首次退出 1，只报告阶段 2 未提交文件 `src/renderer/src/project/use-workspace-project.ts` 的同目录 README 未同步；阶段 2 原任务同步对应 README 后重跑退出 0，输出 `README directory contract passed.`。
- Node 22.18 完整测试：`npm.cmd test` 退出 0；Node 144/144、UI 16/16。
- Node 22.18 类型检查：`npm.cmd run typecheck` 退出 0。
- Node 22.18 生产构建：沙箱内首次因无法清理既有 `out/main/index.js` 报 `EPERM`；在受限环境外重跑同一命令退出 0，main、preload、renderer 全部构建成功。
- 暂存审计：严格包含 `.github/workflows` 的工作流/README 与根目录的 `package.json`、`package-lock.json`、`README.md`，合计 5 个文件、8 行新增、5 行删除；`git diff --cached --check` 退出 0，两个修改目录均同步暂存 README。
- Windows 路径聚焦测试：Node 22.18 下 `tests/project-lifecycle.test.mjs` 退出 0，13/13 通过。
- Windows 路径完整门禁：Node 22.18 下 `npm.cmd test` 为 Node 144/144、UI 16/16；README 契约、类型检查和受限环境外生产构建均退出 0。
- Windows 路径暂存审计：只包含 `tests/project-lifecycle.test.mjs` 的 `realpath` 断言和 `tests/README.md` 单行记录，2 个文件、5 行新增、3 行删除；阶段 2 在相同文件中的附件、迁移和其他 README 记录保持未暂存。
- 最终远端复验：push 与 pull_request 两条 `Quality` 均通过；`gh pr checks 1` 返回两个 `pass`，分支 upstream 为 0/0。
