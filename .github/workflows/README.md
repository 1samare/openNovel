# workflows 目录说明

## 目录用途

存放 GitHub Actions 持续集成工作流。

## 内容说明

- `quality.yml`：在 Windows 环境执行依赖安装、README 契约、测试、类型检查、构建和阻断式生产 Electron smoke；smoke 失败时上传 7 天脱敏诊断，PR 使用基础分支，push 使用事件前 SHA 比较 README 同步变更。

## 依赖边界

工作流通过 npm 脚本执行质量检查，不承载部署、发布或密钥管理逻辑。

## 维护规则

新增或修改工作流时，必须同步更新本 README；质量步骤应与本地推荐命令保持一致。

## 变更同步

- 2026-07-28：新增 Windows 质量检查工作流。
- 2026-07-28：为 push 注入事件前 SHA，避免干净检出遗漏 README 同步检查。
- 2026-07-28：增加生产 Electron smoke 步骤和失败诊断 artifact 上传。
