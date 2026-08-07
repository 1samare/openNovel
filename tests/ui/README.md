# tests/ui 目录说明

## 目录用途

存放由 Vitest、Vue Test Utils 和 happy-dom 执行的 Vue 组件测试及其专用夹具和初始化代码。

## 内容说明

- `setup.ts`：注册每个测试结束后的 Vue wrapper 自动卸载。
- `ComponentHarness.vue`：验证 Vue 单文件组件编译和 DOM 挂载的最小测试夹具。
- `component-harness.spec.ts`：验证组件渲染结果和 happy-dom 环境可用。

## 依赖边界

本目录只依赖测试期 Vue、Vitest、Vue Test Utils 和 happy-dom；不得导入 Electron 主进程、真实文件系统、网络服务或模型 Provider。

## 维护规则

测试应断言用户可观察的 DOM 或组件输出，并在新增文件或改变测试入口时同步更新本 README 和父级 `tests/README.md`。

## 变更同步

- 2026-08-07：建立阶段 0 Vue 组件测试目录和最小测试夹具契约。
