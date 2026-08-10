# preload 目录说明

## 目录用途

存放 Electron 预加载脚本和受控的页面桥接代码。

## 内容说明

- `index.ts`：仅在上下文隔离开启时暴露 `window.openNovel.agent` 与 `window.openNovel.projects`。
- `agent-api.ts`：将八个命名 Agent 方法映射到固定 IPC 通道；只向回调交付校验且克隆后的 Agent 事件。
- `project-api.ts`：将九个命名项目方法映射到固定 IPC 通道，并按命令拒绝畸形结果或成功载荷。

## 依赖边界

预加载层不得向页面暴露通用 Electron、Node.js、IPC 或文件系统能力；新增桥接必须使用白名单和共享类型。

## 维护规则

修改预加载代码时，必须同步更新本 README，并同时更新相应的安全契约测试。

## 变更同步

- 2026-07-28：建立预加载目录 README 契约。
- 2026-07-28：新增无通用 Electron/Node/IPC 暴露的最小 Agent 桥接。
- 2026-08-07：新增无任意路径、文件或通用 IPC 能力的九方法项目桥接。
- 2026-08-07：项目桥接按 list/create/open/rename/backup 等命令验证成功数据，不再只校验 `{ ok, data }` 外壳。
