# OpenNovel 开发进度清单

> 本文件是每次开发任务的首要交接入口。开始阶段开发前必须先阅读本文件，再核对实际工作区、分支、HEAD 和 Git 状态；本文件不替代 `docs/YYYY-MM-DD/*计划.md`。

## 使用规则

1. 状态只使用：`待开始`、`进行中`、`阻塞`、`待验证`、`已完成`、`需核实`。
2. 开始阶段任务前，先运行 `git rev-parse --show-toplevel`、`git branch --show-current`、`git rev-parse --short HEAD`、`git worktree list --porcelain` 和 `git status --short`。
3. 创建或读取对应修改计划后，在“活动任务”中登记工作区、分支、HEAD、计划和下一步，再开始修改。
4. 达成可验证检查点、改变范围、切换分支或工作区、暂停、阻塞、完成时立即更新本文件。
5. 完成或暂停时必须留下最近验证、未提交变更归属和一条可直接执行的下一步；不得用“继续开发”等模糊描述。
6. 多 worktree 并行时每个任务单独一行，只更新自己掌握且已经核实的记录；无法确认的事实标为 `需核实`。
7. 清单与 Git 不一致时以 Git 和实际测试结果为准，先修正清单再继续开发。
8. 阶段 1–8 默认只在根工作区 `D:\Code\codex\openNovel` 的 `feat/v1.0` 上实施，不为常规阶段任务新增 worktree。
9. 每阶段开工前先 fetch 并核对本地与 `origin/feat/v1.0`；远端落后、领先或分叉情况必须如实登记和处理。
10. 阶段完成、退出门禁通过、计划与本清单回填后，等待用户明确确认；确认后把该阶段提交推送到 `origin/feat/v1.0`，无需再次请求推送许可。
11. 禁止 force-push 或把阶段成果推送到 `main`，除非用户另有明确指示。

## 项目阶段总览

阶段定义来源：[多 Agent 小说创作助手全阶段开发计划](docs/2026-08-07/多Agent小说创作助手全阶段开发计划.md)。

| 阶段 | 交付主题 | 状态 | 当前工作区/分支 | 最近结果 | 下一入口 |
|---|---|---|---|---|---|
| 设计基线 | 架构、BYOK、多 Agent、Skill 安全与总计划 | 已完成 | `D:\Code\codex\openNovel` / `feat/v1.0` | 设计文档与九阶段总计划已形成，文档测试 10/10 通过 | 阶段 0 |
| 阶段 0 | 基线冻结与测试骨架 | 已完成 | `D:\Code\codex\openNovel` / `feat/v1.0` | 阶段 0 完整成果已进入 `feat/v1.0@0736181`；最终门禁全部通过 | 创建阶段 1 当天计划并核对 `origin/feat/v1.0` |
| 阶段 1 | 独立项目、本地数据库与项目生命周期 | 已完成 | `D:\Code\codex\openNovel` / `feat/v1.0` | 阶段提交已推送至 `origin/feat/v1.0@1a73a03`；复审无 Critical/Important；最终全门禁通过 | 创建阶段 2 当天计划并重新核对远端 |
| 阶段 2 | 章节树、纯文本编辑器、版本与文件交换 | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 1 | 阶段 1 通过并推送后创建阶段 2 计划 |
| 阶段 3 | BYOK 密钥库、Model Gateway 与角色绑定 | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 2 | 阶段 2 通过并推送后创建阶段 3 计划 |
| 阶段 4 | 小说圣经与结构化共创 | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 3 | 阶段 3 通过并推送后创建阶段 4 计划 |
| 阶段 5 | 受控多 Agent 正文与选区 AI | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 4 | 阶段 4 通过并推送后创建阶段 5 计划 |
| 阶段 6 | 长篇上下文、记忆、质量门禁与评测 | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 5 | 阶段 5 通过并推送后创建阶段 6 计划 |
| 阶段 7 | 外部 Skill 隔离导入、审核与应用 | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 6 | 阶段 6 通过并推送后创建阶段 7 计划 |
| 阶段 8 | Windows 安装、恢复与最终交付 | 待开始 | `D:\Code\codex\openNovel` / `feat/v1.0` | 依赖阶段 7 | 阶段 7 通过并推送后创建阶段 8 计划 |

## 工作区登记

| 工作区绝对路径 | 分支 | HEAD | 状态 | 已核实事实 | 接手动作 |
|---|---|---|---|---|---|
| `D:\Code\codex\openNovel` | `feat/v1.0` | `1a73a03`（阶段完成；远端记录提交见当前 HEAD） | 已完成 | 阶段提交已普通快进推送；upstream 正确且核对时 0/0；用户既有 `.superpowers/` 排除 | 阶段 2 开工前创建当天计划并 fetch 核对远端 |
| `D:\Code\codex\openNovel\.worktrees\harness-agent-loop` | `feat/harness-agent-loop` | `31ca681` | 需核实 | 已核对到仅有未跟踪 `.superpowers/`；未检测到相对 `main` 的已提交差异 | 使用该 worktree 前先确认任务所有者和是否仍需保留 |
| `D:\Code\codex\openNovel\.worktrees\phase-0-test-foundation` | `codex/phase-0-test-foundation` | `0736181` | 已完成 | 阶段 0 代码与交接已进入 `feat/v1.0`；该历史 worktree 不再作为阶段入口 | 保留记录，未经用户授权不删除、修改或复用 |

## 活动任务

| 任务 | 阶段 | 状态 | 工作区/分支 | 修改计划 | 最近验证 | 下一步 | 更新时间 |
|---|---|---|---|---|---|---|---|
| 开发进度清单与阶段入口约束 | 开发治理 | 已完成 | `D:\Code\codex\openNovel` / `main` | `docs/2026-08-07/开发进度清单与阶段入口约束计划.md` | README 契约通过；文档测试 10/10；Git 空白检查通过 | 阶段 0 开工前先隔离遗留修改，并创建含开工记录的阶段计划 | 2026-08-07 |
| 阶段 0 基线冻结与测试骨架 | 阶段 0 | 已完成 | `D:\Code\codex\openNovel\.worktrees\phase-0-test-foundation` / `codex/phase-0-test-foundation` | `docs/2026-08-07/阶段0基线冻结与测试骨架计划.md` | `npm.cmd ci` 后 Node 90/90 + UI 1/1；typecheck、README、build、smoke、acceptance、空白检查均通过；实现提交 `80e2581` | 创建阶段 1 当天计划，读取本清单并重新核对 Git/worktree 状态 | 2026-08-07 |
| 后续阶段统一分支与确认后推送约束 | 开发治理 | 已完成 | `D:\Code\codex\openNovel` / `feat/v1.0` | `docs/2026-08-07/后续阶段统一分支与确认后推送约束计划.md` | 治理提交 `a548a23` 已推送；upstream 正确且 0 ahead/0 behind；README、Node 90/90、UI 1/1、空白检查通过 | 创建阶段 1 当天计划并按 `feat/v1.0` 单工作区规则开工 | 2026-08-07 |
| 阶段 1 独立项目与本地数据库 | 阶段 1 | 已完成 | `D:\Code\codex\openNovel` / `feat/v1.0@1a73a03`（阶段完成） | `docs/2026-08-07/阶段1独立项目与本地数据库计划.md` | 用户已确认；阶段提交已推送；Node 123/123、UI 8/8、类型、README、build、smoke、acceptance、空白检查均通过；upstream 0/0 | 创建阶段 2 当天计划，读取本清单并重新 fetch 核对远端 | 2026-08-10 |

## 遗留变更与风险

- 根工作区和 `harness-agent-loop` worktree 各有未跟踪 `.superpowers/`；均属于用户既有内容，阶段任务不得读取、修改、清理或暂存。
- `harness-agent-loop` 与 `phase-0-test-foundation` 是历史 worktree；后续阶段不得复用，且未经用户明确授权不得删除或修改。
- `main@f68b4f0` 与 `origin/main@31ca681` 均不包含完整阶段 0 成果；阶段 1–8 不得从 `main` 开工或向 `main` 推送。
- `feat/v1.0` 已建立 `origin/feat/v1.0` upstream；后续阶段只允许在用户确认完成后做普通快进推送。

## 最近交接

### 2026-08-10：阶段 1 完成并推送

- 工作区：`D:\Code\codex\openNovel`
- 分支与远端：`feat/v1.0` / 阶段完成提交 `1a73a03` 已推送到 `origin/feat/v1.0`
- 当前状态：已完成
- 已完成：用户明确确认阶段完成；推送前重新 fetch，证明远端 `2d74049` 是本地 `1a73a03` 的祖先；普通快进推送 `2d74049..1a73a03` 成功，未 force-push、未触碰 `main`；阶段实现、复审、退出审计、提交与远端交付闭环完成。
- 最近验证：最终门禁为 README、严格类型、Node 123/123、UI 8/8、生产构建、Electron smoke、acceptance 和空白检查全部通过；推送后 upstream 为 `origin/feat/v1.0`，本地与远端阶段完成 HEAD 均为 `1a73a03`，ahead/behind 为 0/0。
- 未提交变更：本远端完成记录与对应 README 将随当前交接提交保存；提交后除用户既有未跟踪 `.superpowers/` 外无工作树变更。
- 下一步：阶段 2 开工前完整读取本清单，创建执行当天的阶段 2 计划，确认仍在根工作区 `feat/v1.0`，并重新 fetch 核对远端。
- 阻塞项：无。

### 2026-08-10：阶段 1 续接核对

- 工作区：`D:\Code\codex\openNovel`
- 分支与提交：`feat/v1.0` / 实现提交 `cebfc78`，完成交接提交见当前 Git HEAD
- 当前状态：待验证
- 已完成：重新完整读取进度清单与阶段计划；`git fetch --prune origin` 后本地/远端仍为 0/0；补齐最近项目数据库缺失状态、Worker ready 前退出、死亡或不完整 recovery claim 回收，以及工作区导航/禁用状态回归；只读复审终稿无 Critical/Important；退出标准审计完成。
- 最近验证：`npm.cmd run check:readmes`、`npm.cmd run typecheck`、`npm.cmd test`（Node 123/123 + UI 8/8）、`npm.cmd run build`、`npm.cmd run test:electron-smoke`、`npm.cmd run test:acceptance` 和 `git diff --check` 全部退出 0。
- 未提交变更：本次计划、进度清单与 README 完成回填将随完成交接提交保存；提交后除用户既有未跟踪 `.superpowers/` 外无阶段 1 工作树变更。
- 下一步：等待用户明确确认阶段 1 完成；确认即授权把两个已核验提交普通快进推送到 `origin/feat/v1.0`，随后核对 upstream/ahead/behind 并回填远端结果。
- 阻塞项：无。

### 2026-08-07：阶段 1 开工

- 工作区：`D:\Code\codex\openNovel`
- 分支与基线：`feat/v1.0` / `2d74049`
- 当前状态：进行中
- 已完成：审查项均已补 RED/GREEN：生命周期队列/shutdown 与失败补偿、control 冲突/重命名回滚、Worker 终态、陈旧锁 claim、canonical 路径包含、一致迁移快照公共恢复、验证 Worker finally、启动/关闭失败提示，以及工作台重命名/备份/关闭入口。
- 最近验证：项目/foundation 37/37、完整 UI 7/7、`npm.cmd run typecheck` 通过；最终全仓测试、构建、smoke、acceptance 和暂存后空白检查仍须重跑。
- 未提交变更：阶段文档、shared/novel/main/preload/renderer 项目实现、Node/UI 测试、tsconfig、Vitest alias 与各 README 均归属阶段 1；用户既有 `.superpowers/` 未跟踪且排除。
- 下一步：等待只读复审确认无 Critical/Important 后，执行 Task 6 最终完整门禁。
- 阻塞项：无。

### 2026-08-07：后续阶段统一分支治理完成

- 工作区：`D:\Code\codex\openNovel`
- 分支与基线：`feat/v1.0` / `0736181`
- 当前状态：已完成
- 已完成：从阶段 0 最新成果创建并切换 `feat/v1.0`；治理规则提交 `a548a23` 已推送；本地分支跟踪 `origin/feat/v1.0`，ahead/behind 为 0/0。
- 最近验证：`npm.cmd ci` 成功安装 217 个包；`npm.cmd run check:readmes` 通过；沙箱外 `npm.cmd test` 为 Node 90/90、UI 1/1；`git diff --check` 与阶段 0 祖先检查退出 0；远端 `feat/v1.0` 指向 `a548a23`。沙箱内聚合测试的 Vitest fork worker 曾超时，但 `test:ui` 单独连续通过，且相同聚合命令在沙箱外退出 0，未修改测试配置。
- 未提交变更：完成状态、推送结果和对应 README 的交接回填，全部归属本治理任务；用户原有 `.superpowers/` 继续保持未跟踪且不属于本任务。
- 下一步：开始阶段 1 前创建执行当天的 `docs/YYYY-MM-DD/*计划.md`，确认根工作区仍为 `feat/v1.0`，fetch 并核对 `origin/feat/v1.0` 后登记开工。
- 阻塞项：无。

### 2026-08-07：阶段 0 完成

- 工作区：`D:\Code\codex\openNovel\.worktrees\phase-0-test-foundation`
- 分支与实现提交：`codex/phase-0-test-foundation` / `80e2581`
- 当前状态：已完成
- 已完成：从 `f68b4f0` 创建隔离 worktree；增加 Vitest、Vue Test Utils、happy-dom、UI 测试夹具和分层 npm 脚本；实现已提交为 `80e2581 test: establish phase zero test foundation`，且未修改 `src/` 产品代码。
- 最近验证：最终 `npm.cmd ci` 成功安装 217 个包；`npm.cmd run check:readmes`、`npm.cmd run typecheck`、`npm.cmd test`（Node 90/90 + UI 1/1）、`npm.cmd run build`、`npm.cmd run test:electron-smoke`、`npm.cmd run test:acceptance` 和 Git 空白检查全部退出 0。
- 未提交变更：完成状态回填时仅有本交接记录、阶段计划和同目录 README，全部归属阶段 0 完成文档；产品与测试实现已在 `80e2581` 提交。
- 下一步：开始阶段 1 前创建执行当天的 `docs/YYYY-MM-DD/*计划.md`，重新读取本清单，并核对工作区、分支、HEAD、并行 worktree 和 Git 状态。
- 阻塞项：无。

### 2026-08-07：阶段 0 开工与前置审计

- 工作区：`D:\Code\codex\openNovel`
- 分支与基线：`main` / `31ca681`
- 当前状态：进行中
- 已完成：完整读取进度清单和全阶段计划；创建阶段 0 独立实施计划；核对两个 worktree 与既有修改；通过 TDD 修复 Electron smoke 的 Windows npm 子进程缺陷。
- 最近验证：smoke 聚焦 RED 6/7、GREEN 7/7；`npm.cmd run check:readmes` 通过；`npm.cmd test` 90/90；`npm.cmd run typecheck` 通过；`npm.cmd run build` 在沙箱外通过；`npm.cmd run test:electron-smoke` 通过并输出 `Electron production smoke passed`。
- 未提交变更：既有 Electron smoke/CI、设计与进度治理修改；新增阶段 0 计划和本次进度登记。用户已批准先修复、验证和分范围提交这些前置变更。
- 下一步：核对完整差异和暂存范围，提交用户已批准的前置变更；随后从新 HEAD 创建阶段 0 独立 worktree。
- 阻塞项：无。

### 2026-08-07：开发进度治理

- 工作区：`D:\Code\codex\openNovel`
- 分支与基线：`main` / `31ca681`
- 当前状态：开发进度清单与阶段入口约束已完成，尚未提交。
- 已完成：建立阶段总览、工作区登记、活动任务和交接模板；把强制读取、Git 核对、开工记录和离开时写回要求加入 `AGENTS.md`。
- 最近验证：`npm.cmd run check:readmes` 通过；文档测试 10/10 通过；`git diff --check` 和目标文档尾随空白检查通过。
- 未提交变更：本次文档与进度治理修改；另有不属于本任务的 Electron smoke/CI 遗留修改。
- 下一步：开始阶段 0 前先读取本清单并核对 Git，选择干净 worktree 或隔离主工作区遗留修改，然后创建带开工记录的阶段 0 修改计划。
- 阻塞项：无；开始阶段 0 前必须先处理或隔离主工作区遗留修改，避免范围混杂。

## 交接记录模板

复制以下字段新增到“最近交接”，不要覆盖其他工作区记录：

```markdown
### YYYY-MM-DD：任务名称

- 工作区：绝对路径
- 分支与基线：分支 / 短 HEAD
- 当前状态：待开始、进行中、阻塞、待验证、已完成或需核实
- 已完成：可以由文件、提交或测试证明的结果
- 最近验证：命令和结果；未运行时明确写“未运行”及原因
- 未提交变更：路径范围、归属和是否可安全接续
- 下一步：接手者可以直接执行的一项具体动作
- 阻塞项：没有时写“无”
```
