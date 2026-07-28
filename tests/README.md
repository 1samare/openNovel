# tests 目录说明

## 目录用途

存放基于 Node.js 内置测试运行器的可重复质量与架构契约测试。

## 内容说明

- `documentation.test.mjs`：验证根目录文档与已确认的技术方向。
- `electron-foundation.test.mjs`：验证 Electron 安全边界和构建配置。
- `renderer-shell.test.mjs`：验证工作台路由和渲染入口的安全策略。
- `readme-contract.test.mjs`：验证 README 目录契约检查器的 Git 变更行为。

## 依赖边界

测试可读取项目文件、创建临时 Git 仓库并调用 Node.js 与 Git；不应启动应用窗口、调用网络或依赖真实 AI 服务。

## 维护规则

新增或修改测试时，必须同步更新本 README；新行为遵循 RED-GREEN-REFACTOR，并使用可观察的项目行为断言。

## 变更同步

- 2026-07-28：新增 README 目录契约行为测试。
