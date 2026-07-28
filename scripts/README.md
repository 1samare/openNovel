# scripts 目录说明

## 目录用途

存放不参与应用运行时的本地质量检查脚本。

## 内容说明

- `check-readmes.mjs`：检查维护文件的所有祖先目录是否包含五个必需章节的 `README.md`，并确认直接变更目录同步更新 README；支持 `README_CHECK_BASE`、`GITHUB_BASE_REF` 与 push 事件前 SHA。

## 依赖边界

脚本只依赖 Node.js 内置模块和 Git 命令，不依赖 Electron、Vue 或业务代码。

## 维护规则

新增或修改脚本时，必须同步更新本 README；脚本不得读取或输出本地密钥。

## 变更同步

- 2026-07-28：新增 README 目录契约检查脚本。
- 2026-07-28：补充祖先目录、精确必需章节和 push 基准差异检查。
