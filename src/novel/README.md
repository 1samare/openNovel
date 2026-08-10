# novel 目录说明

## 目录用途

存放独立小说项目的文件系统、SQLite Worker、仓储和项目生命周期领域代码。

## 内容说明

- `project-paths.ts`：验证绝对项目根目录，管理严格原子 manifest、目录占用、带所有权的进程锁，以及可核验进程存活并回收死亡或未完整写入持有者的陈旧锁 recovery claim。
- `schema.ts`：定义项目 schema v1 与应用级最近项目 control schema 的顺序迁移。
- `database-worker.ts`：在 Node Worker 中唯一持有 `DatabaseSync`，提供串行 RPC、事务、健康检查、快照，以及启动前退出与 open/closing/closed/failed 终态安全关闭。
- `project-repository.ts`：封装项目基础记录、审计和应用级最近项目的参数化 SQLite 访问；最近项目可用性同时要求 manifest 与项目数据库存在。
- `project-service.ts`：以单一生命周期队列独占项目目录/锁/数据库资源，编排可补偿的新建、打开、重命名、一致备份、恢复、关闭和 shutdown。

## 依赖边界

本目录可依赖 Node.js 文件系统、Worker Threads 与 `node:sqlite`，不得依赖 Electron 对话框、Vue、渲染状态或模型供应商 SDK。

## 维护规则

项目路径必须在主进程授权后进入本目录；写入使用原子边界；锁、迁移和备份行为必须使用真实临时目录或 SQLite 测试覆盖。

## 变更同步

- 2026-08-07：建立阶段 1 小说项目领域目录，首先加入路径、manifest 和项目写锁边界。
- 2026-08-07：新增 SQLite schema v1，并登记自包含 Worker RPC 边界。
- 2026-08-07：新增项目/control 仓储与项目生命周期服务边界。
- 2026-08-07：审查修复增加生命周期串行、失败逆序补偿、control 路径冲突协调、Worker 终态、陈旧锁恢复 claim、canonical 路径包含拒绝和一致迁移快照。
- 2026-08-07：复审修复补齐 Worker ready 前退出、死亡 recovery claim 回收与最近项目数据库缺失检测。
