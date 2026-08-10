# src 目录说明

## 目录用途

存放 OpenNovel 的 Electron 主进程、预加载边界、Vue 渲染进程和跨进程共享代码。

## 内容说明

- `main/`：Electron 主进程，包括按恢复顺序启动的 Agent 运行时、安全 IPC、窗口事件生命周期与脱敏日志。
- `preload/`：受限的预加载安全边界，仅桥接命名 Agent、Project、Chapter 与退出保存 Lifecycle API。
- `renderer/`：渲染进程入口与 Vue 应用。
- `shared/`：跨进程共享的纯类型和常量。
- `novel/`：独立小说项目的路径、manifest、SQLite Worker、仓储和生命周期领域边界。

## 依赖边界

主进程可依赖 Electron；预加载层仅暴露受控能力；渲染进程不得直接使用 Node.js；共享层不依赖 Electron 或 Vue。

## 维护规则

修改子目录中的代码时，必须同步更新对应子目录 README；跨进程接口必须在 `shared/` 中定义。

## 变更同步

- 2026-08-10：新增 `export/`，承载阶段 2 本地导入、成品导出与项目归档边界。
- 2026-08-10：阶段 2 完成章节领域、固定 IPC、CodeMirror 编辑、版本、文件交换和退出保存纵向接线。

- 2026-07-28：建立源码目录 README 契约。
- 2026-07-28：补充 Agent 主进程 IPC/运行时与最小预加载桥接的目录职责。
- 2026-07-28：补充 Agent IPC 恢复时序、窗口转发生命周期与构建 preload 工件职责。
- 2026-07-28：补充 Agent production file sender 的完整 URL hash 路由匹配边界。
- 2026-08-07：建立阶段 1 小说项目领域目录，并加入安全路径、原子 manifest 与项目写锁边界。
