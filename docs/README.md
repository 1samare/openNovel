# docs 目录说明

## 目录用途

按执行日期归档架构设计、修改计划和验证结果，为人类开发者与 Harness Agent 提供可追溯的实施依据。

## 内容说明

- 日期目录统一使用 `YYYY-MM-DD`。
- 每项独立修改使用一份以 `计划.md` 结尾的实施计划。
- 架构设计与同一任务的计划、结果放在同一日期目录。

## 依赖边界

本目录只保存项目文档，不承载运行时代码、生成产物或本地密钥。

## 维护规则

新增或修改日期目录中的文档时，必须同步更新该日期目录的 `README.md`；修改本文件时同步更新根目录 `README.md`。

## 变更同步

- 2026-07-28：建立文档目录契约并登记 Harness Agent 离线闭环设计与计划。
- 2026-07-28：完成 README 目录契约、检查脚本和 Windows CI 基础，并记录验证结果。
- 2026-07-28：回填 Harness Agent Task 2 的公共契约、运行时校验、状态机和验证结果。
- 2026-07-28：记录 Task 2 Fix Round 1 的安全错误规范化修复与验证结果。
- 2026-07-28：记录 Task 5 的安全 Agent IPC、Preload 最小桥接、运行时恢复和脱敏日志实现。
- 2026-07-28：登记 Task 5 Fix Round 1 的安全桥生命周期与 sender 边界复审修复计划。
- 2026-07-28：回填 Task 5 Fix Round 1 的生命周期与 sender 边界验证结果。
- 2026-07-28：登记 Task 5 Fix Round 1 Minor 的 file sender URL 规范化修复计划。
- 2026-07-28：回填 Task 5 Fix Round 1 Minor 的 production file hash 路由验证结果。
- 2026-07-28：回填 Task 6 的 Harness Agent 渲染闭环、事件回补与质量验证结果。
