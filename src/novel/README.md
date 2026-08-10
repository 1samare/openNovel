# novel 目录说明

## 目录用途

存放独立小说项目的文件系统、SQLite Worker、仓储和项目生命周期领域代码。

## 内容说明

- `project-paths.ts`：验证绝对项目根目录，管理严格原子 manifest、目录占用、带所有权的进程锁，以及可核验进程存活并回收死亡或未完整写入持有者的陈旧锁 recovery claim。
- `schema.ts`：定义项目 schema v1–v3 与应用级 control schema v1–v2 的顺序迁移；项目 v3 增加生成模式默认与角色绑定，control v2 增加脱敏模型连接、档案和无内容调用日志。
- `database-worker.ts`：在 Node Worker 中唯一持有 `DatabaseSync`，提供串行 RPC、写事务、一致只读事务、健康检查、快照，以及启动前退出与 open/closing/closed/failed 终态安全关闭。
- `project-repository.ts`：封装项目基础记录、审计、生成模式默认/角色绑定和应用级最近项目的参数化 SQLite 访问；最近项目可用性同时要求 manifest 与项目数据库存在。
- `project-service.ts`：以单一生命周期队列独占项目目录/锁/数据库资源，编排可补偿的新建、打开、重命名、`.opennovel.zip` 一致备份/恢复、模型绑定读写、内部迁移快照、关闭和 shutdown。
- `chapter-service.ts`：封装卷章树、稳定排序、乐观 revision 草稿、不可变确认版本、历史恢复、导入事务、统一导出快照与审计写入。

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
- 2026-08-10：新增 project schema v2，建立章节树、不可变版本、草稿和导入导出任务的持久化基础。
- 2026-08-10：新增章节领域服务，覆盖层级、排序、草稿冲突、版本确认/恢复和 300 章离线规模。
- 2026-08-10：增加导入原子事务和 Worker 内一致导出快照，避免多格式导出读取不同正文状态。
- 2026-08-10：将用户手动备份升级为经 manifest、SQLite 与哈希验证的 `.opennovel.zip`，内部迁移前快照继续保留目录语义。
- 2026-08-10：独立复审将草稿 revision 改为事务内 affected-row CAS，并为根/非根 sibling position 增加统一数据库唯一索引。
- 2026-08-10：二次复审区分 CAS affected-row 不匹配与普通事务失败，只有前者映射为草稿保存冲突。
- 2026-08-10：阶段 3 增加 project schema v3 的模式/角色绑定表与 control schema v2 的 Provider、Model Profile 和安全调用日志表。
- 2026-08-10：项目仓储与生命周期服务接入生成模式默认和角色绑定的事务化替换及重启读取。
