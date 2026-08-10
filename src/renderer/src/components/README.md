# components 目录说明

## 目录用途

存放可复用的 Vue 界面组件。

## 内容说明

- `ChapterTextEditor.vue`：基于 CodeMirror 6 的正文编辑器，提供撤销、重做、搜索替换和全屏写作。

## 依赖边界

组件可依赖 Vue 与浏览器安全库，不得直接访问 Electron 主进程、Node.js、文件系统或数据库。

## 维护规则

交互控件必须支持键盘、可见焦点和动态 ARIA；编辑器变化需同步渲染层测试和本 README。

## 变更同步

- 2026-08-10：新增章节正文 CodeMirror 组件边界。
