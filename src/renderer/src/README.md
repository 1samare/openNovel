# renderer/src 目录说明

## 目录用途

存放 Vue 渲染应用的启动入口、组件、样式、导航和路由。

## 内容说明

- `main.ts`：Vue 应用启动入口。
- `App.vue`：应用根组件。
- `assets/`：全局样式资源。
- `layouts/`、`navigation/`、`router/`、`views/`：工作台界面组织代码。
- `env.d.ts`：渲染进程类型声明。

## 依赖边界

代码依赖 Vue 和 Vue Router；不得绕过预加载安全边界访问 Electron 或 Node.js。

## 维护规则

修改任一子目录时，必须同步更新对应 README；页面可见功能变化需同步更新相关测试和根目录说明。

## 变更同步

- 2026-07-28：建立 Vue 应用源码目录 README 契约。
