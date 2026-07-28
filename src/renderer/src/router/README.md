# router 目录说明

## 目录用途

存放 Vue Router 的路由注册和导航映射。

## 内容说明

- `index.ts`：配置 Hash Router 和工作台页面路由。

## 依赖边界

路由层依赖 Vue Router 与页面组件，不应承担业务逻辑、持久化或 Electron IPC。

## 维护规则

修改路由时，必须同步更新本 README，并同步验证导航定义和页面访问路径。

## 变更同步

- 2026-07-28：建立路由目录 README 契约。
