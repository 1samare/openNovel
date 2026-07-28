# Harness Agent 离线闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Every task uses RED-GREEN-REFACTOR, updates each changed directory's README, commits independently, and passes task-scoped spec and quality review.

**Goal:** 构建“创建 Run → Mock 流式执行 → 人工审批或取消 → 原子持久化 → 重启恢复”的首个 Agent Harness 垂直闭环。

**Architecture:** 纯 TypeScript Agent 核心负责状态机、执行和持久化；Electron 主进程组合运行时并提供白名单 IPC；Preload 暴露最小类型化 API；Vue 页面展示 Run、事件、审批和恢复操作。

**Tech Stack:** Electron 43、Vue 3、TypeScript 6、Node.js 22.18 内置测试、electron-vite、JSON 文件存储、GitHub Actions Windows runner。

## Global Constraints

- 不接入真实模型、API Key、任意工具、自定义 Skill、SQLite 或小说业务 CRUD。
- 每个受版本控制且由项目维护的目录必须包含 `README.md`。
- 修改目录内任意文件时，同目录 `README.md` 必须出现在同一变更中。
- README 至少包含目录用途、内容说明、依赖边界、维护规则和变更同步。
- README 检查排除 `.git`、`.worktrees`、`.superpowers`、`node_modules`、`out`、`dist`、`coverage`、缓存和临时目录。
- 所有新行为先写测试并确认按预期失败，再写最小实现。
- 用户内容可本地明文保存，但日志不得记录 prompt、完整输出、堆栈或绝对存储路径。
- 每项任务独立提交，不推送远端。

---

### Task 1: README 目录契约、项目规则与 CI 基础

**Files:**
- Create: `scripts/check-readmes.mjs`, `scripts/README.md`, `tests/readme-contract.test.mjs`
- Create: every missing maintained-directory `README.md`
- Create: `.github/README.md`, `.github/workflows/README.md`, `.github/workflows/quality.yml`
- Modify: `AGENTS.md`, `README.md`, `package.json`, `tests/README.md`, this date directory's documents and README

**Interfaces:**
- Produces: `npm run check:readmes`; local and CI changed-directory enforcement.

- [x] Write behavioral tests for missing README detection and changed-directory synchronization.
- [x] Run focused tests and confirm expected RED failures.
- [x] Implement `scripts/check-readmes.mjs` using tracked, staged, modified and untracked Git files; support `README_CHECK_BASE` and `GITHUB_BASE_REF` for CI.
- [x] Add all required README files and codify the rule in `AGENTS.md`.
- [x] Add Windows CI sequence `npm ci → check:readmes → test → typecheck → build`.
- [x] Run focused tests, `npm run check:readmes`, full tests and typecheck.
- [x] Commit as `chore: enforce directory readme contracts`.

### Task 1 Fix Round 1：README 检查器审查修复

**修改目标：** 修复 README 检查器对嵌套祖先目录、push 基准差异和 README 必需章节的遗漏。

**范围与明确不包含的内容：** 仅修改 README 检查器、其行为测试、Windows 质量工作流和受影响目录 README；不修改应用运行时代码、不增加依赖、不推送远端。

**涉及文件：**
- Modify: `scripts/check-readmes.mjs`, `scripts/README.md`, `tests/readme-contract.test.mjs`, `tests/README.md`
- Modify: `.github/workflows/quality.yml`, `.github/workflows/README.md`
- Modify: `docs/2026-07-28/Harness Agent离线闭环实现计划.md`, `docs/2026-07-28/README.md`

**实施步骤：**
- [x] 先为祖先目录、push 事件前 SHA 和缺少必需章节的 README 添加失败行为测试。
- [x] 运行聚焦测试，记录检查器未覆盖三类场景的 RED 结果。
- [x] 使用每个维护文件的全部祖先目录扩展检查范围，验证 README 的五个精确章节，并支持 `GITHUB_EVENT_BEFORE` 作为 push 基准。
- [x] 在工作流的 README 检查步骤注入 push 的 `github.event.before`，保持 PR 使用 `GITHUB_BASE_REF`。
- [x] 同步更新受影响目录 README 和日期文档。
- [x] 运行聚焦测试、`npm.cmd run check:readmes`、`npm.cmd test` 和 `npm.cmd run typecheck`，回填实际结果。
- [x] 以独立本地提交保存修复。

**验证方式与通过标准：** 祖先目录缺失 README、push 风格干净检出中的未同步 README 和缺少五个必需章节的 README 均使检查器失败；同步修复后通过；聚焦和全量测试、README 检查与类型检查均以退出码 0 完成。

### Task 2: Agent 公共契约、校验与状态机

**Files:**
- Create: `src/shared/agent.ts`, `src/agent/errors.ts`, `src/agent/validation.ts`, `src/agent/state-machine.ts`, `src/agent/README.md`
- Create: `tests/agent-state-machine.test.mjs`
- Modify: `tsconfig.json`, `package.json`, `README.md`, `src/shared/README.md`, `tests/README.md`

**Interfaces:**
- Produces: `RunStatus`, `AgentError`, `AgentEvent`, `AgentRun`, `AgentResult<T>`, validation guards and legal transition checks.

- [x] Write tests for valid lifecycle, cancellation, failure, duplicate approval, terminal mutation and prompt validation.
- [x] Run focused test and confirm expected RED failure because modules do not exist.
- [x] Implement shared discriminated types, safe error conversion, runtime guards and legal transition map.
- [x] Enable Node 22 `--experimental-strip-types` and TypeScript `.ts` extension imports.
- [x] Run focused tests, full tests and typecheck.
- [x] Commit as `feat: define agent run contracts`.

### Task 2 Fix Round 1：安全错误规范化

**修改目标：** 修复合法 Agent 错误码的 `Error` 被原样返回而可能保留堆栈和扩展字段的问题。

**修改范围与明确不包含的内容：** 仅修改 Agent 错误转换、其回归测试和对应 README/验证记录；不修改状态机、运行时编排、IPC 或持久化。

**涉及的文件：**
- Modify: `src/agent/errors.ts`, `tests/agent-state-machine.test.mjs`, `src/agent/README.md`, `tests/README.md`
- Modify: this implementation plan, `docs/README.md`, `docs/2026-07-28/README.md`

**实施步骤：**
- [x] 为带合法 Agent code、stack 和扩展字段的 `Error` 写入失败回归测试。
- [x] 确认聚焦测试因原对象引用未被规范化而失败。
- [x] 将已验证错误转换为只含 `code` 与 `message` 的新对象。
- [x] 同步更新受影响目录 README 和验证记录。
- [x] 运行聚焦测试、README 契约、全量测试和类型检查。
- [x] 以独立本地提交保存修复。

**验证方式与通过标准：** 规范化结果与原始 Error 不是同一实例，且不含 `stack`、扩展字段；聚焦测试、README 检查、全量测试和类型检查均以退出码 0 通过。

### Task 2 Fix Round 2：恢复已批准的公共契约

**修改目标：** 修复 Task 2 实现与用户已批准 Public Contracts 的结构性偏差，避免错误的事件、错误码和结果形态继续扩散到 Orchestrator、IPC 与 UI。

**修改范围与明确不包含的内容：** 将共享契约严格恢复为 `AgentError` 六种错误码及 `retryable`、带 `runId/sequence/type/timestamp/payload` 的十二种事件、`AgentResult<T>` 的 `data` 分支，并为 `AgentRun` 补齐输出和 `{ phase, nextChunkIndex }` 检查点；同步迁移状态机、校验、Repository 及既有测试。此轮不实现 Executor、Orchestrator、Electron IPC 或 UI。

**涉及的文件：**
- Modify: `src/shared/agent.ts`, `src/agent/errors.ts`, `src/agent/validation.ts`, `src/agent/state-machine.ts`, `src/agent/repository.ts`
- Modify: `tests/agent-state-machine.test.mjs`, `tests/agent-repository.test.mjs`
- Modify: `src/shared/README.md`, `src/agent/README.md`, `tests/README.md`
- Modify: this implementation plan, `docs/2026-07-28/README.md`

**实施步骤：**
- [x] 先加入精确契约和快照形态回归测试，并确认现有实现失败。
- [x] 恢复批准的错误码、`retryable`、事件名称/公共字段和 `AgentResult.data`。
- [x] 定义包含分阶段输出与恢复检查点的 `AgentRun`，更新运行时守卫和状态转换。
- [x] 将 Repository 与既有测试迁移到新契约，不改变原子持久化行为。
- [x] 同步更新受影响目录 README，运行聚焦测试、全量测试、README 契约和类型检查。
- [x] 以独立本地提交保存修复，并重新执行规格与代码质量审查。

**验证方式与通过标准：** 类型和运行时测试精确覆盖用户给出的 Public Contracts；非法旧事件名、旧错误码、缺少 `retryable`、`value` 成功分支和缺少检查点的快照均被拒绝；Repository 既有耐久性用例无回归，全部质量门禁退出码为 0。

### Task 2 Fix Round 2 Review Fix：收紧 Agent 契约守卫

**修改目标：** 处理 Task 2 Fix Round 2 审查发现的运行时守卫绕过问题：拒绝伪装为公共错误的原生/异类对象，确保错误转换面对 hostile getter 或 Proxy 时只返回安全的新对象；限制事件 payload 与嵌套 JSON 值为普通 JSON 对象；补齐 Run 序列和事件归属的直接回归覆盖。

**修改范围与明确不包含的内容：** 仅修改 `errors.ts`、`validation.ts`、现有 Agent/Repository 行为测试及其同目录 README；保留已批准公共类型、状态机、schemaVersion 1 envelope、原子临时写入/重命名与安全加载诊断。不实现 Executor、Orchestrator、Electron IPC 或 UI。

**涉及的文件：**
- Modify: `src/agent/errors.ts`, `src/agent/validation.ts`
- Modify: `tests/agent-state-machine.test.mjs`, `tests/agent-repository.test.mjs`
- Modify: `src/agent/README.md`, `tests/README.md`
- Modify: this implementation plan, `docs/2026-07-28/README.md`, `.superpowers/sdd/Harness Agent离线闭环实现计划/task-2-fix-round-2-report.md`

**实施步骤：**
- [x] 先为原生 Error、非枚举/符号额外键、hostile getter/Proxy、非普通 payload、Run 序列/归属和无替换快照拒绝写入失败测试，并记录 RED。
- [x] 将 Agent 错误和 JSON 对象守卫收紧为普通数据对象与完整自有键集合；确保 `toAgentError` 不传播 getter/Proxy 异常。
- [x] 迁移事件/Run 校验与 Repository 回归用例，保持无效输入不会覆盖既有快照。
- [x] 更新受影响 README 和报告，运行聚焦/全量测试、README 契约、类型检查及 `git diff --check`。
- [x] 以独立本地提交保存为 `fix: harden agent contract guards`，不推送。

**验证方式与通过标准：** 原生 Error、数组、Date、非普通对象、带任何额外字符串或符号键的错误对象及 hostile getter/Proxy 都不能通过公共守卫或破坏错误转换；事件 payload 仅接受 JSON 对象树；Run 拒绝首序号非 1、缺口、重复/乱序和 runId 不匹配；Repository 对无效快照拒绝保存且不替换有效文件；所有质量门禁以退出码 0 完成。

### Task 2 Fix Round 2 Review Fix 2：要求可序列化的 Agent 错误描述符

**修改目标：** 处理守卫仍会接受非枚举或 accessor 形式必填错误字段的审查发现，确保通过 `isAgentError` 的错误能以 JSON 可重载形态保存；`toAgentError` 对状态型、非抛出 accessor 也始终产出新的有效三字段公共错误。

**修改范围与明确不包含的内容：** 仅收紧 Agent 错误描述符守卫并补充其真实 Repository 保存保护与序列/归属表格用例；保留现有错误码、公共类型、JSON envelope、原子持久化、状态机、Executor/Orchestrator/IPC/UI 边界。

**涉及的文件：**
- Modify: `src/agent/errors.ts`
- Modify: `tests/agent-state-machine.test.mjs`, `tests/agent-repository.test.mjs`
- Modify: `src/agent/README.md`, `tests/README.md`
- Modify: this implementation plan, `docs/2026-07-28/README.md`, `.superpowers/sdd/Harness Agent离线闭环实现计划/task-2-fix-round-2-report.md`

**实施步骤：**
- [x] 先为非枚举必填 `message`、状态型 accessor `message`、规范化安全输出和无替换 Repository 拒绝写入添加 RED 用例；在现有 Repository invalidRuns 表加入不连贯 sequence/runId 用例。
- [x] 使用 `Object.getOwnPropertyDescriptors` 只接受精确的三个可枚举数据描述符，并让转换函数在单次安全描述符快照基础上生成新对象。
- [x] 更新 README、计划/报告，运行聚焦/全量测试、README 契约、类型检查和 `git diff --check`。
- [x] 以独立本地提交保存为 `fix: require serializable agent errors`，不推送。

**验证方式与通过标准：** 非枚举必填字段和任意 accessor 均被 `isAgentError` 拒绝；规范化结果始终为只含可枚举 `code`、`message`、`retryable` 的新对象；Repository 对任何此类 Run 返回验证错误且目标快照字节和可重载结果不变；不连贯 sequence/runId 用例同样不能替换快照；全部质量门禁退出码为 0。

### Task 3: JSON Run Repository 与恢复检查点

**Files:**
- Create: `src/agent/repository.ts`, `tests/agent-repository.test.mjs`
- Modify: `src/agent/README.md`, `tests/README.md`

**Interfaces:**
- Consumes: Task 2 `AgentRun` contracts and validation.
- Produces: `RunRepository` and `JsonRunRepository` with `save`, `get`, `list`, `getEvents`.

- [x] Write tests for first save, replacement, reload, event filtering, corrupt JSON, unknown schema, invalid Run and failed write preservation.
- [x] Run focused test and confirm expected RED failure.
- [x] Implement schema version 1, atomic temp-write/rename and sanitized `RunLoadIssue` results.
- [x] Run focused tests, full tests, README contract and typecheck.
- [x] Commit as `feat: persist agent runs atomically`.

**Actual results:** Added `RunRepository` and injected-root `JsonRunRepository`. Each saved file is exactly `{ "schemaVersion": 1, "run": ... }`; saves use a same-directory temporary file followed by rename. Invalid snapshots are never overwritten, and list diagnostics use fixed messages plus encoded filename identifiers so they cannot expose absolute paths. The seven real temporary-file tests also cover an encoded absolute-looking corrupt filename.

**Verification results:** RED: `node --experimental-strip-types --test tests/agent-repository.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for the missing repository module. GREEN: the focused command passed 7/7, including the later encoded-path diagnostic regression. `npm.cmd run check:readmes` passed, `npm.cmd test` passed 30/30, and `npm.cmd run typecheck` passed. A supplementary direct TypeScript check reaches the pre-existing Task 2 error `src/agent/validation.ts(24,5): TS18046`; it is outside this task's configured typecheck inputs and was not changed.

**Concern resolution before review plan:** Extend the Node project typecheck to include every `src/agent` module, reproduce the resulting strict diagnostics through `npm.cmd run typecheck:node`, and make the smallest Task 2/3 type-safe fixes. Re-run the focused repository test, README contract, full test suite and full typecheck, then record the RED/GREEN evidence in the Task 3 report before a separate local commit.

**Concern resolution before review results:** `tsconfig.node.json` now includes `src/agent/**/*.ts`, making the configured Node typecheck use the existing Node type context for repository imports. RED exposed `validation.ts(24,5): TS18046`; the event guard now verifies `typeof value.sequence === 'number'` before integer comparison. GREEN: `npm.cmd run typecheck:node`, the focused repository suite (7/7), README contract, full suite (30/30) and full typecheck all passed. The separate local commit is recorded in the Task 3 report.

**Fix Round 1 plan:** Add regression coverage proving that envelopes with top-level keys other than `schemaVersion` and `run` are invalid, and that a deterministic replacement-phase failure preserves a repository-managed target byte-for-byte. Keep real temporary storage for all persistence behavior; inject only the replace operation needed to make the failure cross-platform deterministic. Update the Agent/test README files and this date directory record, then run the focused repository suite, README contract, full tests and full typecheck before a separate local commit.

**Fix Round 1 results:** `parseSnapshot` now requires exactly the two envelope keys and reports all other shapes as `INVALID_RUN`. `JsonRunRepository` accepts an optional replace operation, defaulting to Node rename; tests use it only to force the replacement step to fail after a real managed snapshot and temporary file exist. RED had two focused failures (accepted extra key and successful replacement despite injected failure); GREEN passed 8/8. `npm.cmd run check:readmes` passed, `npm.cmd test` passed 31/31 and `npm.cmd run typecheck` passed. The separate local commit is recorded in the Task 3 report.

### Task 4: Mock Executor 与 Agent Orchestrator

**Files:**
- Create: `src/agent/executor.ts`, `src/agent/mock-executor.ts`, `src/agent/orchestrator.ts`
- Create: `tests/agent-orchestrator.test.mjs`
- Modify: `src/agent/README.md`, `tests/README.md`

**Interfaces:**
- Consumes: Task 2 contracts/state machine and Task 3 repository.
- Produces: `AgentExecutor` and `AgentOrchestrator` methods `createRun`, `getRun`, `listRuns`, `getEvents`, `approveRun`, `cancelRun`, `resumeRun`, `recoverInterruptedRuns`, `subscribe`.

- [x] Write tests for strict event sequence, streaming, approval pause, completion, cancellation, execution failure, concurrent commands, persistence-before-notify, event backfill and restart recovery without duplicate chunks.
- [x] Run focused test and confirm expected RED failure.
- [x] Implement deterministic analysis/final chunks, injected delay/clock/id, per-Run mutation queues and AbortController cancellation.
- [x] Run focused tests, full tests, README contract and typecheck.
- [x] Commit as `feat: orchestrate offline agent runs`.

### Task 4 Fix Round 1：Orchestrator 恢复与观察隔离

**修改目标：** 关闭 Task 4 审查发现的审批绕过、订阅者污染、仓储错误吞没和离线执行器/并发路径缺口，确保审批、恢复和公开结果契约在持久化失败与重启后仍保持一致。

**修改范围与明确不包含的内容：** 只调整 Agent 的审批原子边界、事件通知隔离、Run 列表公共结果、仓储错误传播及对应离线行为测试；不实现 Electron IPC、Preload、UI、真实模型、网络或 Task 5+ 能力。

**涉及的文件：**
- Modify: `src/shared/agent.ts`, `src/shared/README.md`
- Modify: `src/agent/repository.ts`, `src/agent/orchestrator.ts`, `src/agent/README.md`
- Modify: `tests/agent-orchestrator.test.mjs`, `tests/README.md`
- Modify: this implementation plan and `docs/2026-07-28/README.md`
- Modify: `.superpowers/sdd/Harness Agent离线闭环实现计划/task-4-report.md`

**实施步骤：**
1. 先补审批持久化失败/重启、监听器隔离、仓储错误与列表诊断保留、Mock Executor 和并发取消路径的聚焦失败用例。
2. 将 analysis `step.completed` 的检查点保留在 analysis，直到 `awaiting_approval` 与 `approval.requested` 同一持久化快照成功提交；恢复从 analysis 末尾重新请求审批而不进入 final。
3. 为每个订阅者提供独立事件快照，隔离其异常和变异；补充公开 `RunListResult`，让读取/命令/恢复传播仓储错误并保留 issues。
4. 以最小改动补齐 Mock Executor、排队快照、重复命令和取消竞态的行为保护，同步所有受影响目录 README 与任务报告。
5. 为遗留 schema-v1 的 final checkpoint 增加持久化 approval.resolved 证明：恢复时安全修正缺少证明的 interrupted 快照为 analysis 末尾，且最终阶段在运行前作防御性证明校验。
6. 以种子遗留快照、延迟中止的 Mock Executor、完整事件公共字段及真正并发的重复命令用例确认回归，再回填复审结果。

**验证方式与通过标准：** 聚焦测试先以现有实现的行为差异失败；实现后聚焦用例覆盖所有审查项并通过。随后 `npm.cmd test`、`npm.cmd run check:readmes`、`npm.cmd run typecheck` 和 `git diff --check` 均成功，且提交仅包含本轮 Task 4 文件。

### Task 5: Electron 安全 IPC、Preload API 与结构化日志

**Files:**
- Create: `src/shared/agent-ipc.ts`, `src/main/agent-runtime.ts`, `src/main/agent-ipc.ts`, `src/main/agent-ipc-security.ts`, `src/main/agent-logger.ts`, `src/preload/agent-api.ts`
- Create: `tests/agent-ipc.test.mjs`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `tests/electron-foundation.test.mjs` and corresponding README files

**Interfaces:**
- Consumes: Task 4 Orchestrator.
- Produces: `window.openNovel.agent` API exactly as defined in the design, including `getEvents` and `subscribeEvents`.

- [x] Write tests for command validation, sender allowlist, error serialization, channel allowlist and event-object isolation.
- [x] Replace the obsolete “preload exposes no API” assertion with a behavior contract that permits only the named Agent bridge and still rejects generic Node/Electron exposure.
- [x] Run focused test and confirm expected RED failure.
- [x] Register fixed IPC handlers, production repository path, recovery call, event forwarding and redacted metadata logger.
- [x] Expose only the typed contextBridge API and update renderer global types.
- [x] Run focused tests, full tests, README contract, typecheck and build.
- [x] Commit as `feat: expose secure agent ipc bridge`.

### Task 6: Harness UI 闭环

**Files:**
- Create: `src/renderer/src/agent/use-agent-harness.ts`, `src/renderer/src/agent/README.md`, `src/renderer/src/views/AgentHarnessView.vue`
- Modify: router, navigation description, global styles, renderer tests and every corresponding README

**Interfaces:**
- Consumes: `window.openNovel.agent` from Task 5.
- Produces: `/workspace/chat` Harness UI with prompt, list, timeline, approval, cancellation, recovery, results and diagnostics.

- [ ] Write renderer contract tests for the dedicated route, accessible controls, state-gated actions and sequence-gap backfill behavior.
- [ ] Run focused tests and confirm expected RED failure.
- [ ] Implement subscription-before-load, event deduplication, backfill, Run refresh and error presentation.
- [ ] Implement responsive UI and disabled states without adding a state or UI library.
- [ ] Run focused tests, full tests, README contract, typecheck and build.
- [ ] Commit as `feat: add agent harness workspace`.

### Task 7: 全量验收、文档回填与最终审查

**Files:**
- Modify: `README.md`, this plan, `docs/README.md`, `docs/2026-07-28/README.md` and any README corresponding to validation fixes

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: verified M0 delivery and evidence-backed final documentation.

- [ ] Run `npm.cmd run check:readmes`, `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build`.
- [ ] Start Electron, verify create/stream/approve, cancel, close/restart and resume paths, then terminate only the spawned process tree.
- [ ] Update README capabilities/limitations and append actual files, deviations and validation results to this plan.
- [ ] Run the full quality gate again after documentation changes.
- [ ] Commit as `docs: record harness agent verification`.
- [ ] Dispatch final whole-branch review and resolve all Critical/Important findings before finishing the branch.

## 实际结果

### Task 1：README 目录契约、项目规则与 CI 基础

- 新增 `npm run check:readmes`，检查已跟踪、暂存、未暂存、未跟踪及基准分支差异中的维护目录；CI 可通过 `README_CHECK_BASE` 或 `GITHUB_BASE_REF` 提供基准。
- 为所有现有维护目录补充 README，并在 `AGENTS.md`、根 README、日期文档中记录同步规则。
- 新增 Windows GitHub Actions 质量门禁，顺序为 `npm ci → npm run check:readmes → npm test → npm run typecheck → npm run build`。

### Task 1 Fix Round 1：README 检查器审查修复

- 维护目录从已跟踪文件的直接父目录扩展为全部祖先目录，并验证每份 README 的五个精确二级标题。
- Windows 工作流将 `github.event.before` 注入 `GITHUB_EVENT_BEFORE`；PR 继续使用 GitHub 提供的 `GITHUB_BASE_REF`。
- 新增祖先目录、缺失/非精确章节和 push 风格干净检出的回归测试。

## 验证结果

### Task 1：README 目录契约、项目规则与 CI 基础

- RED：`node --test tests/readme-contract.test.mjs` 在检查器不存在时按预期以 `MODULE_NOT_FOUND` 失败，4 个行为用例均未通过。
- GREEN：实现检查器后，同一聚焦命令通过 4/4；用例覆盖已跟踪目录缺失 README、已修改目录未同步 README、暂存与未跟踪目录变更，以及 `README_CHECK_BASE`、`GITHUB_BASE_REF` 基准分支差异。
- `npm.cmd run check:readmes`：通过。
- `npm.cmd test`：12/12 通过。
- `npm.cmd run typecheck`：Node 与 Web 类型检查通过。

- PowerShell 执行策略禁止 `npm.ps1`，因此验证使用等效的 `npm.cmd`；项目脚本与 CI 命令未作替换。

### Task 1 Fix Round 1：README 检查器审查修复

- RED：新增祖先目录、缺失章节和 push 事件前 SHA 用例后，`node --test tests/readme-contract.test.mjs` 以 7 个用例中的 3 个失败结束；三个失败均为检查器返回 `0 !== 1`，直接对应审查发现。
- RED（精确标题）：新增带附加文本的标题用例后，同一命令以 8 个用例中的 1 个失败结束，确认原实现只是前缀匹配。
- GREEN：收紧实现后，`node --test tests/readme-contract.test.mjs` 通过 8/8。
- `npm.cmd run check:readmes`：通过。
- `npm.cmd test`：16/16 通过。
- `npm.cmd run typecheck`：Node 与 Web 类型检查通过。

### Task 2：Agent 公共契约、校验与状态机

- 新增纯共享契约 `RunStatus`、`AgentError`、`AgentEvent`、`AgentRun` 与 `AgentResult<T>`，Agent 核心保持与 Electron、Vue 无关。
- 新增 Prompt、状态、事件和 Run 快照的运行时守卫；非空 Prompt 才被接受，Run 事件序号必须从 1 连续递增。
- 新增不可变状态机，覆盖审批生命周期、任意非终态取消、执行失败、恢复后的重复审批拒绝和终态保护；非法转换统一返回 `INVALID_STATE`。
- RED：`node --experimental-strip-types --test tests/agent-state-machine.test.mjs` 在模块尚未创建时按预期以 `ERR_MODULE_NOT_FOUND` 失败，缺失模块为 `src/agent/errors.ts`。
- GREEN：同一聚焦命令在实现后通过 6/6；覆盖生命周期、取消、失败、安全错误转换、重复审批、终态保护和 Prompt 校验。
- `npm.cmd run check:readmes`：通过；`npm.cmd test`：22/22 通过；`npm.cmd run typecheck`：Node 与 Web 类型检查通过。

### Task 2 Fix Round 1：安全错误规范化

- RED：`node --experimental-strip-types --test tests/agent-state-machine.test.mjs` 以 7 个用例中的 1 个失败结束；带合法 `INVALID_STATE` code 的 Error 与转换结果引用相同，错误为 `Expected "actual" not to be reference-equal to "expected"`。
- GREEN：转换函数改为新建 `{ code, message }` 后，同一聚焦命令通过 7/7，回归断言确认不含 `stack` 和 `extra` 字段。
- `npm.cmd run check:readmes`：通过；`npm.cmd test`：23/23 通过；`npm.cmd run typecheck`：Node 与 Web 类型检查通过。

### Task 2 Fix Round 2：恢复已批准的公共契约

- RED：先将状态机和仓储测试迁移到十二种事件、六种错误码、`retryable`、`data`、输出和检查点形态。`node --experimental-strip-types --test tests/agent-state-machine.test.mjs tests/agent-repository.test.mjs` 以退出码 1 失败：状态机测试因缺少 `isAgentResult` 导出无法加载；仓储测试将新快照拒绝为 `INVALID_RUN`，并继续返回旧 `value` 分支和旧错误码。
- 实际实现：公共类型现限定六种错误码和 `retryable`，事件统一为五个公共字段及十二种命名；`AgentRun` 以 `{ analysis, final }` 输出和 `{ phase, nextChunkIndex }` 检查点持久化；`AgentResult<T>` 成功分支改为 `data`。运行时守卫拒绝旧事件、旧错误码、缺失 `retryable`、`value` 分支、缺失或无效输出/检查点；状态机与 JSON Repository 已迁移。Repository 保持 schemaVersion 1 envelope、临时写入/重命名、替换失败保护及原有安全诊断，公开失败分别映射为 `VALIDATION_ERROR` 或 `PERSISTENCE_FAILED`。
- 复审修正：规格/质量复审发现 `AgentRun` 守卫仍可接受遗留 `result` 额外字段，且替换用例仍在构造该字段。新增断言后，聚焦测试按预期以 `true !== false` 失败；守卫现仅接受批准的 Run 字段（及可选 `error`），替换用例改为 `output.final`，同一聚焦命令随后通过 17/17。当前环境没有可派发的独立审查代理，因此此项为本地逐项规格与差异复审。
- 验证：最终 `node --experimental-strip-types --test tests/agent-state-machine.test.mjs tests/agent-repository.test.mjs` 通过 17/17；`npm.cmd run check:readmes` 通过；`npm.cmd test` 通过 33/33；`npm.cmd run typecheck` 的 Node 与 Web 检查均通过；`git diff --check` 未报告空白错误。

### Task 2 Fix Round 2 Review Fix：收紧 Agent 契约守卫

- RED：在不改生产代码前新增原生 Error 伪装、枚举/非枚举/符号额外键、hostile getter/Proxy、数组/Date/异类 payload、Run 序列/归属及 Repository 保留快照用例。`node --experimental-strip-types --test tests/agent-state-machine.test.mjs tests/agent-repository.test.mjs` 以退出码 1 结束：Repository 将伪装 Error 或数组 payload 保存为成功；`isAgentError` 接受原生 Error；`toAgentError` 传播 getter 异常；`isAgentEvent` 接受非普通 payload。
- 实际实现：`isAgentError` 要求普通数据对象且用 `Reflect.ownKeys` 精确比较三个字符串键，拒绝 Error、数组、异类对象、非枚举/符号/枚举额外键。`toAgentError` 在所有反射和属性读取外提供安全回退，因此 hostile getter/Proxy 只得到新的标准 `EXECUTION_FAILED` 错误。事件 payload 与嵌套对象使用普通 JSON 对象守卫；Run 序列、重复/乱序与事件 `runId` 归属的直接回归测试已覆盖。真实 Repository 用例确认伪装 Error 和数组 payload 都在写入前被拒绝，且现有快照字节不变。
- GREEN：同一聚焦命令通过 21/21。
- 验证：`npm.cmd test` 通过 37/37；`npm.cmd run check:readmes` 通过；`npm.cmd run typecheck` 的 Node 与 Web 检查均通过；`git diff --check` 未报告空白错误。

### Task 2 Fix Round 2 Review Fix 2：要求可序列化的 Agent 错误描述符

- RED：在不改生产代码前，为非枚举 `message` 和状态型 `message` accessor 添加行为用例，并把两类错误和 sequence/runId 不连贯 Run 加入 Repository 的真实快照保留表。`node --experimental-strip-types --test tests/agent-state-machine.test.mjs tests/agent-repository.test.mjs` 以退出码 1 结束：状态型 accessor 被 `isAgentError` 接受，Repository 成功写入本应无效的 Run。
- 实际实现：`isAgentError` 通过一次 `Object.getOwnPropertyDescriptors` 快照及完整自有键检查，只接受 `code`、`message`、`retryable` 三个可枚举数据描述符；非枚举字段和任意 accessor 都被拒绝。`toAgentError` 直接从同一描述符快照构造合格错误，或最多一次读取非合格字段的 getter，因此状态型 accessor 得到新建、有效且稳定的三字段结果。Repository 在写入前拒绝这些错误对象和不连贯 sequence/runId，原快照字节及重载结果均保持不变。
- GREEN：同一聚焦命令通过 22/22；`npm.cmd test` 通过 38/38；`npm.cmd run check:readmes` 通过；`npm.cmd run typecheck` 的 Node 与 Web 检查均通过；`git diff --check` 未报告空白错误。

### Task 4：Mock Executor 与 Agent Orchestrator

- RED：先添加 `tests/agent-orchestrator.test.mjs` 的离线闭环行为用例。`node --experimental-strip-types --test tests/agent-orchestrator.test.mjs` 按预期以 `ERR_MODULE_NOT_FOUND` 失败，缺失模块为 `src/agent/mock-executor.ts`。
- 实际实现：新增 `AgentExecutor` 流式边界和确定性 `MockExecutor`，其文本块与延迟均可注入，并在每次生成前后检查 `AbortSignal`。`AgentOrchestrator` 注入仓储、执行器、时钟与 ID；创建先原子持久化 queued/created 快照并异步驱动。每个事件变更按“追加事件 → 持久化快照 → 更新内存 → 通知订阅者”完成；每个 Run 使用独立串行队列，取消先中止活跃控制器再排队提交取消。审批驱动 final 阶段，执行错误映射为 `EXECUTION_FAILED`，未知 ID 映射为 `RUN_NOT_FOUND`，恢复将持久化 running Run 变为 interrupted，显式恢复从 `{ phase, nextChunkIndex }` 继续而不重复文本块。
- GREEN：聚焦用例通过 6/6，覆盖严格事件序列、分析/最终流、审批暂停与完成、取消、执行器失败、并发审批/取消、持久化先于通知、事件回补，以及重启恢复去重。
- 验证：`npm.cmd test` 通过 44/44；`npm.cmd run check:readmes` 通过；`npm.cmd run typecheck` 的 Node 与 Web 检查均通过；`git diff --check` 未报告空白错误（仅有 Git 的 LF/CRLF 转换提示）。

### Task 4 Fix Round 1：Orchestrator 恢复与观察隔离

- RED：新增聚焦用例后，`node --experimental-strip-types --test tests/agent-orchestrator.test.mjs` 以退出码 1 结束。审批持久化失败时已保存快照错误地为 `{ phase: 'final', nextChunkIndex: 0 }`；抛出订阅者异常直接拒绝 `createRun`；损坏快照的 `VALIDATION_ERROR` 被错误转换为 `RUN_NOT_FOUND`。这些失败分别直接对应 Critical 和三项 Important 审查发现。
- 实际实现：analysis `step.completed` 现在保留 analysis 检查点，只有 `awaiting_approval`、`approval.requested` 和 final 检查点在同一快照成功持久化后才公开；恢复从 analysis 末尾重新请求审批，final 只能在 approval.resolved 后执行。每位订阅者收到独立 `structuredClone` 快照，监听器异常被隔离；`RunLoadIssue` 与 `RunListResult` 提升为共享公共契约，`listRuns`/`recoverInterruptedRuns` 返回 `{ runs, issues }`，读取和命令方法原样传播仓储 AgentResult 错误。补齐 Mock Executor、排队快照、重复审批/取消和延迟 chunk 取消的行为用例。
- GREEN：聚焦编排器套件通过 12/12；覆盖审批失败后重启、监听器变异/异常/退订、损坏与读取失败传播、issues 保留、非 running 恢复、确定性 Mock 流、队列先持久化及取消竞态。
- 验证：`npm.cmd test` 通过 50/50；`npm.cmd run check:readmes` 通过；`npm.cmd run typecheck` 的 Node 与 Web 检查均通过；`git diff --check` 未报告空白错误（仅有 Git 的 LF/CRLF 转换提示）。
- 复审追加计划：处理遗留 schema-v1 的 running/final checkpoint 在未持久化 approval.resolved 时可被恢复后直接执行 final 的缺口。先用种子快照复现，修复时从 analysis delta 事件导出检查点并持久化修正；同时补强进行中延迟的 Mock 中止、关键生命周期事件公共字段和并发重复命令测试。
- 复审追加 RED：`node --experimental-strip-types --test tests/agent-orchestrator.test.mjs` 以退出码 1 结束。种子 legacy snapshot 恢复后仍为 `{ phase: 'final', nextChunkIndex: 0 }`，直接复现缺失 approval.resolved 证明时的 final 绕过；测试同时补齐进行中延迟中止、关键事件的 runId/sequence/payload 与真实并发重复命令覆盖。
- 复审追加实际实现：编排器从最后一条 approval.requested 后查找 approval.resolved；恢复 running snapshot 时，在添加 run.interrupted 的同一持久化 mutation 中将缺少证明的 final checkpoint 修正为 analysis delta 数量导出的 analysis checkpoint。`resumeRun` 与 `streamPhase` 都拒绝无证明的 final，形成恢复与执行入口两层防线；显式 approval.resolved 仍照常授权 final。
- 复审追加 GREEN：聚焦编排器套件通过 16/16，包括 seeded legacy repair 后重新等待审批、直接 final 防线、进行中 delay 中止和并发重复命令。
- 复审追加验证：`npm.cmd test` 通过 54/54；`npm.cmd run check:readmes` 通过；`npm.cmd run typecheck` 的 Node 与 Web 检查均通过；`git diff --check` 未报告空白错误（仅有 Git 的 LF/CRLF 转换提示）。
- 复审 Minor 计划：直接消费 MockExecutor 的 active final stream，断言 `finalChunks` 与 `nextChunkIndex` 的选择结果；保持现有进行中 abort 覆盖，不改动生产实现。
- 复审 Minor 结果：在同一受控延迟 executor 用例中，analysis 从索引 1 输出 `analysis-2`，活动 final 从索引 1 输出 `final-2`，而另一个 final 流在 delay 期间中止且不输出。该测试仅扩展覆盖，现有实现无需修改。
- 复审 Minor 验证：聚焦编排器套件通过 16/16；`npm.cmd test` 通过 54/54；`npm.cmd run check:readmes` 与 `npm.cmd run typecheck` 通过；`git diff --check` 无空白错误（仅 Git LF/CRLF 提示）。

### Task 5：Electron 安全 IPC、Preload API 与结构化日志

- RED：在创建 Task 5 生产模块前，`node --experimental-strip-types --test tests/agent-ipc.test.mjs tests/electron-foundation.test.mjs` 以退出码 1 结束。新 IPC 测试因缺少 `src/shared/agent-ipc.ts` 报 `ERR_MODULE_NOT_FOUND`，preload 架构契约因未暴露 `openNovel.agent` 失败。
- 实际实现：新增固定七个命令和一个事件通道、逐命令参数守卫、顶层当前 `file:` 页面/精确开发服务器 origin 的 sender 白名单。IPC 处理器拒绝未授权 sender，将异常和不安全错误规范化为固定 `AgentResult`，不返回路径或堆栈。主进程以 `app.getPath('userData')/agent-runs` 组合 JSON Repository、Mock Executor 和 Orchestrator，执行启动恢复并只向授权存活页面发送克隆事件。预加载仅暴露 `window.openNovel.agent` 的八个命名方法，事件回调仅接收校验且克隆的 `AgentEvent`；日志严格只保留安全操作元数据。
- GREEN：聚焦 IPC 和 Electron 基础套件通过 10/10；全量 `npm.cmd test` 通过 60/60；`npm.cmd run check:readmes`、Node/Web `npm.cmd run typecheck`、`npm.cmd run build` 和 `git diff --check` 全部以退出码 0 完成。未启动 GUI，未推送远端。
