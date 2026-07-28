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

### Task 4: Mock Executor 与 Agent Orchestrator

**Files:**
- Create: `src/agent/executor.ts`, `src/agent/mock-executor.ts`, `src/agent/orchestrator.ts`
- Create: `tests/agent-orchestrator.test.mjs`
- Modify: `src/agent/README.md`, `tests/README.md`

**Interfaces:**
- Consumes: Task 2 contracts/state machine and Task 3 repository.
- Produces: `AgentExecutor` and `AgentOrchestrator` methods `createRun`, `getRun`, `listRuns`, `getEvents`, `approveRun`, `cancelRun`, `resumeRun`, `recoverInterruptedRuns`, `subscribe`.

- [ ] Write tests for strict event sequence, streaming, approval pause, completion, cancellation, execution failure, concurrent commands, persistence-before-notify, event backfill and restart recovery without duplicate chunks.
- [ ] Run focused test and confirm expected RED failure.
- [ ] Implement deterministic analysis/final chunks, injected delay/clock/id, per-Run mutation queues and AbortController cancellation.
- [ ] Run focused tests, full tests, README contract and typecheck.
- [ ] Commit as `feat: orchestrate offline agent runs`.

### Task 5: Electron 安全 IPC、Preload API 与结构化日志

**Files:**
- Create: `src/shared/agent-ipc.ts`, `src/main/agent-runtime.ts`, `src/main/agent-ipc.ts`, `src/main/agent-ipc-security.ts`, `src/main/agent-logger.ts`, `src/preload/agent-api.ts`
- Create: `tests/agent-ipc.test.mjs`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts`, `tests/electron-foundation.test.mjs` and corresponding README files

**Interfaces:**
- Consumes: Task 4 Orchestrator.
- Produces: `window.openNovel.agent` API exactly as defined in the design, including `getEvents` and `subscribeEvents`.

- [ ] Write tests for command validation, sender allowlist, error serialization, channel allowlist and event-object isolation.
- [ ] Replace the obsolete “preload exposes no API” assertion with a behavior contract that permits only the named Agent bridge and still rejects generic Node/Electron exposure.
- [ ] Run focused test and confirm expected RED failure.
- [ ] Register fixed IPC handlers, production repository path, recovery call, event forwarding and redacted metadata logger.
- [ ] Expose only the typed contextBridge API and update renderer global types.
- [ ] Run focused tests, full tests, README contract, typecheck and build.
- [ ] Commit as `feat: expose secure agent ipc bridge`.

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
