# 2026-07-28 文档说明

## 目录用途

保存 Harness Agent 离线闭环任务的架构设计、实施计划和最终验证记录。

## 内容说明

- `Harness Agent离线闭环架构设计.md`：已批准的运行时边界、数据流与安全策略。
- `Harness Agent离线闭环实现计划.md`：按 TDD 和子 Agent 审查执行的任务清单。
- Task 6 记录：AI 对话 Harness UI、渲染层事件合并和验证结果已回填至实施计划；Fix Round 1 记录异步状态、重试、可访问性和窄屏布局加固，并补齐连续失败事件的安全详情回读与 520px 顶栏命中区。
- Task 7 记录：全量生产验收、沙箱 Preload CommonJS 工件、生产 BrowserWindow 活动引用生命周期，以及可观察且可中止的生产 Mock 流修复计划与真实 Electron 通过标准。
- `Electron生产冒烟自动化计划.md`：自动执行八 API、审批、取消、重启恢复、事件去重、进程树清理和 Windows CI 诊断的实施记录。

## 依赖边界

文档约束优先服从根目录 `AGENTS.md`，实现必须与实际代码和验证结果保持一致。

## 维护规则

本目录任意文档调整时必须同步更新本文件的内容说明或变更同步记录。

## 变更同步

- 2026-07-28：创建 Harness Agent 离线闭环设计与实施计划。
- 2026-07-28：补充安全桥实现对既有 Preload 安全测试的迁移要求。
- 2026-07-28：记录 Task 1 的 README 目录契约、项目规则与 CI 基础。
- 2026-07-28：回填 Task 1 的 RED/GREEN、README 检查、全量测试和类型检查结果。
- 2026-07-28：记录 Task 1 Fix Round 1 对祖先目录、push 基准和 README 必需章节的修复。
- 2026-07-28：回填 Task 1 Fix Round 1 的 RED/GREEN 与全量质量检查结果。
- 2026-07-28：回填 Task 2 的 Agent 公共契约、校验、状态机和全量质量检查结果。
- 2026-07-28：记录 Task 2 Fix Round 1 的安全错误规范化回归修复。
- 2026-07-28：回填 Task 3 的 JSON Run Repository、原子快照和安全恢复诊断实现记录。
- 2026-07-28：登记 Task 3 review 前的 Agent 类型检查覆盖与严格错误修复计划。
- 2026-07-28：回填 Task 3 review 前的 Node 类型检查覆盖与事件守卫收窄结果。
- 2026-07-28：回填 Task 3 review 前类型检查修复的 RED/GREEN 与全量验证结果。
- 2026-07-28：登记 Task 3 Fix Round 1 的快照 envelope 严格校验与替换失败保护计划。
- 2026-07-28：回填 Task 3 Fix Round 1 的严格 envelope 与替换失败保护实现结果。
- 2026-07-28：回填 Task 3 Fix Round 1 的 RED/GREEN 与全量质量验证结果。
- 2026-07-28：登记 Task 2 Fix Round 2，纠正错误码、事件、结果分支和检查点与已批准 Public Contracts 的偏差。
- 2026-07-28：同步 Task 2 Fix Round 2 的公共契约迁移、TDD RED/GREEN 和质量验证记录。
- 2026-07-28：登记 Task 2 Fix Round 2 审查修复，收紧错误、JSON payload 与 Run 序列/归属守卫。
- 2026-07-28：登记 Task 2 Fix Round 2 第二轮审查修复，要求 Agent 错误使用可序列化数据描述符。
- 2026-07-28：回填 Task 4 的 Mock Executor、串行 Agent Orchestrator 与离线闭环验证记录。
- 2026-07-28：登记 Task 4 Fix Round 1 的审批恢复边界、观察隔离与仓储结果契约修复计划。
- 2026-07-28：回填 Task 4 Fix Round 1 的 RED/GREEN、共享 Run 列表契约与全量验证结果。
- 2026-07-28：登记 Task 4 Fix Round 1 复审追加的遗留审批证明修复与测试加固计划。
- 2026-07-28：回填 Task 4 Fix Round 1 复审追加的 legacy 审批证明修复与 54 项全量验证结果。
- 2026-07-28：登记 Task 4 Fix Round 1 剩余 Minor 的 Mock final stream 覆盖计划。
- 2026-07-28：回填 Task 4 Fix Round 1 剩余 Minor 的活动 final Mock stream 覆盖结果。
- 2026-07-28：回填 Task 5 的安全 Agent IPC、Preload 最小桥接、运行时恢复和脱敏日志实现记录。
- 2026-07-28：登记 Task 5 Fix Round 1 的 preload 工件、IPC 生命周期、sender URL/frame 与注册所有权加固计划。
- 2026-07-28：回填 Task 5 Fix Round 1 的 RED/GREEN、preload 工件检查和全量质量验证结果。
- 2026-07-28：登记 Task 5 Fix Round 1 Minor 的 production file hash 路由精确匹配计划。
- 2026-07-28：回填 Task 5 Fix Round 1 Minor 的空 query sender 回归与全量质量验证结果。
- 2026-07-28：回填 Task 6 的 Harness Agent UI、事件回补和完整质量门禁结果。
- 2026-07-28：登记 Task 6 Fix Round 1 的异步状态机、可重试操作、可访问性与响应式复审修复计划。
- 2026-07-28：回填 Task 6 Fix Round 1 的拒绝规范化、命令锁、事件队列恢复和响应式验证结果。
- 2026-07-28：登记 Task 6 Fix Round 1 复审收尾的 `run.failed` 回读、刷新重试与紧凑顶栏样式契约。
- 2026-07-28：登记 Task 7 Validation Fix Round 1，修复真实生产启动中沙箱 Preload 无法执行 ESM `.mjs` 工件的问题。
- 2026-07-28：登记 Task 7 Validation Fix Round 2，修复生产窗口因主进程未保留活动引用而自动退出的问题。
- 2026-07-28：登记 Task 7 Validation Fix Round 3，为真实流式、运行中取消和重启恢复验收增加生产 Mock pacing 注入。
- 2026-07-28：回填 Task 7 的 80 项测试、生产构建、真实 UI 审批/取消和检查点重启恢复验收结果。
- 2026-07-28：登记 Task 7 最终审查修复，关闭 Orchestrator 陈旧 list 回写、取消后步骤事件和 queued 重启停滞问题。
- 2026-07-28：回填 Task 7 最终审查修复的三项 RED、19/19 聚焦 GREEN 与 83/83 全量验证结果。
- 2026-07-28：记录最终规格复审与代码/安全复审均 clean，并完成 Harness Agent 离线闭环交付回填。
- 2026-07-28：创建 Electron 生产冒烟自动化计划并登记实现范围。
- 2026-08-07：登记阶段 0 前置审计发现的 Windows `npm.cmd` 子进程 `EINVAL`、TDD 修复范围和真实 smoke 复验标准。
