# OpenNovel

OpenNovel 是一个面向 Windows 的本地优先小说 AI 辅助写作桌面应用。本仓库当前交付 Electron + Vue 3 + TypeScript 基础架构，不包含业务功能。

## 技术栈

- Electron
- Vue 3
- TypeScript
- electron-vite
- Vue Router
- npm

## 环境要求

- Windows 10 或更高版本
- Node.js 22.12 或更高版本
- npm 10 或更高版本

## 本地运行

```powershell
npm install
npm run dev
```

`npm run dev` 会启动 Vite 开发服务并打开 Electron 桌面窗口。

项目默认使用 npmmirror 下载 Electron Windows 二进制；如需切换来源，可通过 `ELECTRON_MIRROR` 环境变量覆盖。

## 质量检查

```powershell
npm run typecheck
npm test
npm run build
```

生产构建完成后可预览构建结果：

```powershell
npm start
```

## 目录结构

```text
src/
├── main/       Electron 主进程
├── preload/    安全预加载边界
├── renderer/   Vue 渲染进程
└── shared/     跨进程纯类型与常量
tests/          架构与文档结构测试
docs/            按日期归档的设计和修改计划
```

## 当前范围

已经具备：

- Electron 窗口和应用生命周期；
- 隔离的渲染进程和空白预加载边界；
- Vue 应用、Hash Router 和公共工作台布局；
- 项目中心及产品一级模块占位页面；
- TypeScript 类型检查、结构测试和生产构建命令。

尚未实现：

- 小说项目增删改查；
- 本地数据库和文件持久化；
- AI 模型配置、调用和流式输出；
- 正文编辑器、版本管理和导入导出；
- 应用安装包生成。

## 安全边界

渲染进程启用上下文隔离与沙箱，并关闭 Node.js 集成。预加载层当前不向页面暴露任何 Electron、Node.js 或 IPC 能力。

## 修改计划约定

任何代码、配置或文档修改前，先在 `docs/YYYY-MM-DD/` 下创建对应的 `文件名称计划.md`。完整约束见 `AGENTS.md`。
