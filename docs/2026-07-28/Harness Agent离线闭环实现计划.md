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

### Task 2: Agent 公共契约、校验与状态机

**Files:**
- Create: `src/shared/agent.ts`, `src/agent/errors.ts`, `src/agent/validation.ts`, `src/agent/state-machine.ts`, `src/agent/README.md`
- Create: `tests/agent-state-machine.test.mjs`
- Modify: `tsconfig.json`, `package.json`, `README.md`, `src/shared/README.md`, `tests/README.md`

**Interfaces:**
- Produces: `RunStatus`, `AgentError`, `AgentEvent`, `AgentRun`, `AgentResult<T>`, validation guards and legal transition checks.

- [ ] Write tests for valid lifecycle, cancellation, failure, duplicate approval, terminal mutation and prompt validation.
- [ ] Run focused test and confirm expected RED failure because modules do not exist.
- [ ] Implement shared discriminated types, safe error conversion, runtime guards and legal transition map.
- [ ] Enable Node 22 `--experimental-strip-types` and TypeScript `.ts` extension imports.
- [ ] Run focused tests, full tests and typecheck.
- [ ] Commit as `feat: define agent run contracts`.

### Task 3: JSON Run Repository 与恢复检查点

**Files:**
- Create: `src/agent/repository.ts`, `tests/agent-repository.test.mjs`
- Modify: `src/agent/README.md`, `tests/README.md`

**Interfaces:**
- Consumes: Task 2 `AgentRun` contracts and validation.
- Produces: `RunRepository` and `JsonRunRepository` with `save`, `get`, `list`, `getEvents`.

- [ ] Write tests for first save, replacement, reload, event filtering, corrupt JSON, unknown schema, invalid Run and failed write preservation.
- [ ] Run focused test and confirm expected RED failure.
- [ ] Implement schema version 1, atomic temp-write/rename and sanitized `RunLoadIssue` results.
- [ ] Run focused tests, full tests, README contract and typecheck.
- [ ] Commit as `feat: persist agent runs atomically`.

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

## 验证结果

### Task 1：README 目录契约、项目规则与 CI 基础

- RED：`node --test tests/readme-contract.test.mjs` 在检查器不存在时按预期以 `MODULE_NOT_FOUND` 失败，4 个行为用例均未通过。
- GREEN：实现检查器后，同一聚焦命令通过 4/4；用例覆盖已跟踪目录缺失 README、已修改目录未同步 README、暂存与未跟踪目录变更，以及 `README_CHECK_BASE`、`GITHUB_BASE_REF` 基准分支差异。
- `npm.cmd run check:readmes`：通过。
- `npm.cmd test`：12/12 通过。
- `npm.cmd run typecheck`：Node 与 Web 类型检查通过。
- PowerShell 执行策略禁止 `npm.ps1`，因此验证使用等效的 `npm.cmd`；项目脚本与 CI 命令未作替换。
