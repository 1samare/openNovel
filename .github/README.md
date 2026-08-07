# .github 目录说明

## 目录用途

存放 GitHub 平台自动化配置。

## 内容说明

- `workflows/`：持续集成工作流定义，包括 README 契约检查、质量门禁、生产 Electron smoke 和失败诊断 artifact。

## 依赖边界

本目录仅定义 GitHub 自动化，不包含应用运行时代码或项目密钥。

## 维护规则

修改自动化配置时，必须同步更新本 README，并确保工作流使用仓库现有 npm 脚本。

## 变更同步

- 2026-07-28：建立 Windows 质量检查工作流目录。
- 2026-07-28：补充 push 事件前 SHA 的 README 契约比较基准。
- 2026-07-28：在 Windows 质量门禁后接入阻断式生产 Electron smoke，并配置 7 天脱敏诊断 artifact。
