# tests 目录说明

## 目录用途

存放基于 Node.js 内置测试运行器的可重复质量与架构契约测试。

## 内容说明

- `documentation.test.mjs`：验证根目录文档与已确认的技术方向。
- `electron-foundation.test.mjs`：验证 Electron 安全边界和构建配置。
- `renderer-shell.test.mjs`：验证工作台路由和渲染入口的安全策略。
- `readme-contract.test.mjs`：验证 README 目录契约检查器的祖先目录、精确必需章节、本地 Git 变更、基准分支和 push 干净检出行为。
- `agent-state-machine.test.mjs`：验证 Agent Run 的生命周期、取消、失败、安全错误规范化、重复审批、终态保护和 Prompt 校验。
- `agent-repository.test.mjs`：使用真实临时目录验证 JSON Run 快照的原子保存、重载、事件筛选、严格 envelope 诊断，以及替换失败时保留目标快照。

## 依赖边界

测试可读取项目文件、创建临时 Git 仓库并调用 Node.js 与 Git；不应启动应用窗口、调用网络或依赖真实 AI 服务。

## 维护规则

新增或修改测试时，必须同步更新本 README；新行为遵循 RED-GREEN-REFACTOR，并使用可观察的项目行为断言。

## 变更同步

- 2026-07-28：新增 README 目录契约行为测试。
- 2026-07-28：补充祖先目录、精确标题和 push 基准回归测试。
- 2026-07-28：新增 Agent 公共契约、运行时校验和状态机的行为测试。
- 2026-07-28：补充带合法错误码的 Error 不保留堆栈或扩展字段的回归测试。
- 2026-07-28：新增 JSON Run Repository 的真实文件系统集成测试。
- 2026-07-28：新增顶级 envelope 键严格校验和替换阶段失败保留快照的回归测试。
