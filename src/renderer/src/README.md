# renderer/src 目录说明

## 目录用途

存放 Vue 渲染应用的启动入口、组件、样式、导航和路由。

## 内容说明

- `main.ts`：Vue 应用启动入口。
- `App.vue`：应用根组件。
- `assets/`：全局样式资源。
- `layouts/`、`navigation/`、`router/`、`views/`：工作台界面组织代码。
- `agent/`：Harness Agent 的事件合并、回补、失败详情回读、异步代际、命令锁和操作重试协调逻辑。
- `env.d.ts`：渲染进程类型声明，包括受限的 `window.openNovel.agent` 桥接类型。

## 依赖边界

代码依赖 Vue 和 Vue Router；不得绕过预加载安全边界访问 Electron 或 Node.js。

## 维护规则

修改任一子目录时，必须同步更新对应 README；页面可见功能变化需同步更新相关测试和根目录说明。

## 变更同步

- 2026-07-28：建立 Vue 应用源码目录 README 契约。
- 2026-07-28：声明只读的 Agent 预加载桥接类型；渲染代码继续不导入 Node 或 Electron。
- 2026-07-28：新增 Harness Agent 控制器和 AI 对话专用页面边界。
- 2026-07-28：加固 Harness Agent 的异步状态、可重试操作和可访问渲染契约。
- 2026-07-28：连续失败事件会刷新持久化安全错误详情，紧凑顶栏链接保持 44px 可访问命中区。
