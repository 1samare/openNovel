# tests 目录说明

## 目录用途

存放基于 Node.js 内置测试运行器的可重复质量与架构契约测试。

## 内容说明

- `documentation.test.mjs`：验证根目录文档与已确认的技术方向。
- `electron-foundation.test.mjs`：验证 Electron 安全默认值、命名 Agent/Project Preload 桥接、沙箱兼容的 CommonJS `.cjs` 构建产物配置和连线、活动窗口引用、项目数据库/IPC、异步退出与启动失败恢复提示，以及生产 Mock 流的可中止延迟注入。
- `renderer-shell.test.mjs`：验证工作台路由和渲染入口的安全策略。
- `readme-contract.test.mjs`：验证 README 目录契约检查器的祖先目录、精确必需章节、本地 Git 变更、基准分支和 push 干净检出行为。
- `agent-state-machine.test.mjs`：验证 Agent Run 的生命周期、取消、失败、安全错误规范化、十二种公共事件、普通且可序列化的错误/JSON payload 守卫、严格错误/结果形态、输出/检查点、序列/归属、重复审批、终态保护和 Prompt 校验。
- `agent-repository.test.mjs`：使用真实临时目录验证迁移后公共契约下的 JSON Run 快照原子保存、重载、事件筛选、严格 envelope 诊断，以及不可序列化错误、非 JSON payload 和不连贯事件等无效输入不会替换有效快照。
- `agent-orchestrator.test.mjs`：使用内存仓储和可控离线执行器验证严格事件序列、审批持久化/恢复原子边界、queued 启动恢复、legacy final checkpoint 审批证明修正、监听器快照隔离、陈旧 list 不覆盖权威状态、仓储错误与列表诊断传播、Mock Executor 的分析/final chunk 选择与进行中中止、取消竞态、事件回补及恢复检查点去重。
- `agent-ipc.test.mjs`：验证 Agent IPC 命令参数、仅 hash 可变的完整 production file URL、开发 origin/凭据/销毁 frame sender 守卫、固定且幂等的处理器/disposer、错误脱敏、Preload 事件克隆隔离、结构化日志脱敏、恢复/窗口附着生命周期，以及 runtime 向 Mock Executor 传递受控 delay。
- `agent-harness.test.mjs`：行为化验证渲染层先订阅后加载、加载竞态合并、序列缺口回补/去重/刷新、连续 `run.failed` 的安全详情回读与刷新重试、拒绝规范化、操作级重试、命令锁、陈旧结果隔离、队列恢复与退订，并结合控制器状态和页面契约检查可访问控件、流式 final、失败诊断和 520px 顶栏命中区。
- `electron-smoke.test.mjs`：验证生产 smoke 的 Agent/Project/Chapter/Model/Lifecycle 精确桥接、事件序列连续性、delta 去重、诊断脱敏、CDP target 选择、Windows npm CLI 调用、Electron 启动参数、进程树清理参数与持久化模型产物明文拒绝；不启动真实窗口。
- `project-paths.test.mjs`：使用真实临时目录验证项目根路径、目录占用、严格原子 manifest、活动写锁、需确认的陈旧锁恢复、同时恢复的唯一所有权，以及死亡或未完整写入的 recovery claim 回收。
- `project-database.test.mjs`：使用真实 SQLite 文件和受控 Worker 验证 RPC、project schema v1–v4、带章节/角色绑定数据的 v3→v4 保真迁移、pragma、事务/迁移回滚、事件循环响应、正常关闭，以及 ready 前/后的异常退出均稳定失败。
- `model-contract.test.mjs`：验证阶段 3 固定模型 IPC 参数、角色所需能力、公开结果密钥字段拒绝，以及 project v3/control v2 的真实 SQLite 迁移表。
- `model-secret-store.test.mjs`：使用真实临时目录验证操作系统加密不可用拒绝、密文原子替换/恢复/删除，以及 Provider URL、协议降级和跨 origin 凭据转发边界。
- `model-repository.test.mjs`：使用真实 control/project SQLite 和密钥目录验证连接脱敏、档案/绑定重启持久化、空 Key 保留以及能力与跨供应商显式确认门禁。
- `model-provider-adapters.test.mjs`：用三类原生协议的回环 fake server 验证 AI SDK 连接测试、流式文本、结构化输出、usage/request ID、可选模型列表和安全失败边界。
- `model-gateway.test.mjs`：验证 Profile/连接/密钥解析、能力先验门禁、稳定错误矩阵、有限抖动重试、流开始后不重放、启发式 token 估算和真实 SQLite 白名单日志。
- `model-ipc.test.mjs`：验证模型九命令的精确参数、sender 白名单、请求 ID 锁、连接测试取消、关闭等待、脱敏 preload 校验及 safeStorage 生产组合顺序。
- `model-security.test.mjs`：使用唯一 BYOK sentinel 扫描真实 control/project SQLite、备份 ZIP 及解包内容、章节导出、调用日志、公开 IPC 返回和加密密钥文件，证明无密钥明文泄漏。
- `novel-contract.test.mjs`：验证阶段 4 题材、资料/大纲状态、严格结构化提案、固定 Bible IPC 参数、公开快照守卫与 project schema v4 契约。
- `bible-repository.test.mjs`：使用真实 project SQLite 验证档案/资料乐观冲突、追加式来源版本、显式恢复来源/权威状态、移动大纲历史恢复及故障注入全回滚、人物引用完整性、重启一致、权威上下文和分层大纲排序。
- `proposal-service.test.mjs`：使用真实 project SQLite 验证候选精选、拒绝隔离、重复决定、由权威来源版本推导的可信冲突证据、无关来源拒绝、显式替代、批准版本来源以及失败决定的事务回滚。
- `structured-coauthor.test.mjs`：验证双题材 Prompt 仅含权威资料、三专业角色分别通过领域 schema/持久化链、角色优先路由与已确认 fallback、结构失败最多一次定向修复，以及模型返回后到落库前的取消门禁。
- `bible-ipc.test.mjs`：验证活动项目 Bible Runtime、项目变化即时取消、生成请求锁、关闭开始拒绝新命令/等待既有工作、十个固定 IPC、sender/参数门禁和 preload 畸形结果拒绝。
- `electron-smoke.test.mjs`：除既有生产进程与脱敏契约外，验证 `novelBible` 十方法精确桥接和命名调用表达式。
- `electron-foundation.test.mjs`：验证 sandbox preload 使用 CommonJS 独立工件，并将阶段四契约依赖 Zod 内联而非保留第三方 `require`。
- `ui/model-settings.spec.ts`：挂载真实模型设置页，验证 BYOK 脱敏、DeepSeek 预设、连接/Profile 表单、三模式六角色绑定、能力门禁和跨供应商显式确认。
- `ui/novel-bible.spec.ts`：挂载小说圣经状态与真实世界观/人物/大纲页面，验证跨项目异步隔离、严格 draft、结构化字段保真、失败表单/档案 dirty 草稿保留、关系人物、候选/历史快照预览、恢复确认和四级树操作。
- `project-lifecycle.test.mjs`：使用真实目录、SQLite 和两个 service 验证新建重启、重命名及 control 失败补偿、最近项目完整文件可用性、备份恢复、临时 v4 迁移失败后从一致快照恢复、跨实例写锁、同 service 生命周期串行、失败逆序清理和递归路径拒绝。
- `project-ipc.test.mjs`：验证固定项目命令、sender/参数守卫、系统选择/最近路径授权、陈旧锁确认、preload 最小桥接、错误脱敏、异步退出等待与关闭失败先提示后退出。
- `renderer-flush.test.mjs`：验证退出前保存握手的固定事件、preload 最小桥接、sender/请求归属校验、拒绝、超时、释放和可重试退出门禁。
- `ui/`：使用 Vitest、Vue Test Utils 和 happy-dom 执行 Vue 单文件组件测试，独立于现有 Node Test Runner 测试。

## 依赖边界

测试可读取项目文件、创建临时 Git 仓库并调用 Node.js 与 Git；常规 `npm test` 不启动应用窗口、调用网络或依赖真实 AI 服务，真实生产窗口由独立 `npm run test:electron-smoke` 负责。

## 维护规则

新增或修改测试时，必须同步更新本 README；新行为遵循 RED-GREEN-REFACTOR，并使用可观察的项目行为断言。

## 变更同步

- 2026-08-11：阶段 4 首组 RED 定义共享小说圣经契约、严格设定提案、固定 Bible 命令、公开快照和 project schema v4 表集合。
- 2026-08-11：阶段 4 仓储 RED 覆盖主类型锁定、手工资料、追加版本、陈旧写入、恢复、重启、审计和四级大纲排序。
- 2026-08-11：阶段 4 提案 RED 覆盖确定性精选、拒绝隔离、重复决定、目标变化后的显式替代、批准来源追溯和事务回滚。
- 2026-08-11：阶段 4 结构化共创 RED 覆盖双题材 Prompt、权威上下文隔离、角色/Profile 路由、fallback、一次修复和取消。
- 2026-08-11：阶段 4 主进程边界 RED 覆盖活动项目切换、生成请求锁、取消、关闭等待、十命令 IPC 与 preload 安全守卫。
- 2026-08-11：阶段 4 生产验收 RED 将 `novelBible` 十方法精确桥接纳入 Electron smoke 纯逻辑契约。
- 2026-08-11：生产 smoke 定位到 sandbox preload 外部化 Zod 后，补充构建配置契约，要求其在 preload 中内联。
- 2026-08-11：阶段 4 退出审计补充可信冲突 RED，要求服务端从来源版本推导旧值/新值并拒绝跨实体伪造来源。
- 2026-08-11：project schema v4 后将阶段 3 模型契约基线同步到 v4，并把生命周期的瞬时迁移失败夹具推进到临时 v5，继续验证从真实 v4 一致快照恢复。
- 2026-08-11：退出复审新增档案 CAS、陈旧提案零覆盖、恢复来源/移动大纲、人物引用、Runtime 项目 epoch/close、renderer draft/异步/预览以及三角色生产生成链回归；终审再补大纲恢复事务故障注入和无关 mutation 不覆盖档案草稿，完整 Node 现为 226 项、UI 为 41 项。

- 2026-08-10：阶段 3 首组 RED/GREEN 覆盖共享模型契约、角色能力门禁、脱敏结果和 project v3/control v2 实际迁移。
- 2026-08-10：阶段 3 密钥与 URL RED/GREEN 覆盖加密可用性、密文原子性、不安全 Base URL/重定向和跨 origin 授权头移除。
- 2026-08-10：阶段 3 持久化 RED/GREEN 覆盖连接/Profile/项目绑定重启、公开脱敏、能力门禁、跨供应商确认，并把生命周期故障夹具推进到临时 v4 迁移。
- 2026-08-10：阶段 3 Provider Adapter RED 覆盖 OpenAI-compatible、Anthropic 与 Gemini 原生请求/响应、结构化 schema、错误矩阵及取消；测试只监听回环地址。
- 2026-08-10：阶段 3 Gateway RED 覆盖模型解析、调用前能力阻断、全部稳定错误码、瞬时故障重试、流重放边界和无内容调用日志持久化。
- 2026-08-10：阶段 3 主进程/IPC/Preload RED 覆盖固定九命令、非顶层/错误来源拒绝、畸形返回、重复测试锁、取消和关闭资源顺序。
- 2026-08-10：阶段 3 渲染 RED 覆盖模型设置的密钥不回显、连接测试取消、档案校验和角色路由门禁。
- 2026-08-10：阶段 3 新增全路径密钥泄漏测试，覆盖真实持久化、备份/导出、日志、公开桥接结果与密文文件。
- 2026-08-10：阶段 3 生产 smoke 新增 Model 九方法桥接、回环 Provider、safeStorage 密钥、连接测试、模型列表与重启持久化覆盖。
- 2026-08-10：终轮复核新增重启后密钥再解密认证与清理前模型产物明文扫描，并覆盖模式默认路由的能力不足选项禁用。
- 2026-08-10：隔离 README push 基准测试继承的 PR 环境变量，确保 `GITHUB_EVENT_BEFORE` 场景在本地与 GitHub Actions 中一致。
- 2026-08-10：备份恢复生命周期测试使用 `realpath` 规范化 Windows 8.3/长路径别名，保持本地与 GitHub runner 断言一致。
- 2026-08-10：阶段 2 增加共享章节契约、Unicode 正文字数和 project schema v2 的首组 RED 测试。
- 2026-08-10：增加章节树排序、草稿乐观 revision、不可变版本恢复与 300 章规模的领域 RED 测试。
- 2026-08-10：增加 TXT/Markdown 导入预览、事务确认与统一导出快照的 RED 测试。
- 2026-08-10：增加 `.opennovel.zip` 内容白名单、哈希校验和不覆盖目标的真实文件 RED 测试。
- 2026-08-10：增加章节固定 IPC 参数、sender 授权与 preload 响应守卫 RED 测试。
- 2026-08-10：增加主进程系统文件选择、预览防篡改、参考资料确认、统一导出与安全未打开状态的 runtime RED 测试。
- 2026-08-10：增加章节编辑器自动保存、切换刷盘、版本、导入预览确认和三格式导出的渲染层 RED 测试。
- 2026-08-10：增加工作台关闭项目前等待活动编辑器刷盘的渲染层回归测试。
- 2026-08-10：补充 CodeMirror 中文组合输入、选区回调、搜索替换、全屏退出与只读历史预览回归测试。
- 2026-08-10：独立复审补充路由离开与创建备份不得丢失 800ms 窗口内正文的 RED 测试。
- 2026-08-10：独立复审补充真正并发草稿 CAS 只能一个成功，以及根章节 position 数据库唯一性 RED 测试。
- 2026-08-10：独立复审补充 fatal UTF-8、粘贴 Markdown 拆章、真实历史状态和永久删除提示 RED 测试。
- 2026-08-10：独立复审补充 ZIP 高压缩比与缺少必需项目文件必须在解压/恢复前安全拒绝的 RED 测试。
- 2026-08-10：独立复审补充主进程退出前必须等待授权渲染器保存确认，拒绝或超时后可返回继续保存的 RED 测试。
- 2026-08-10：独立复审补充分卷选择、重命名、同级排序、受保护删除和章节跨卷移动的 UI RED 测试。
- 2026-08-10：将 Project、Chapter 与 Lifecycle 精确桥接键和安全未打开结果纳入生产 Electron smoke 契约。
- 2026-08-10：二次复审补充章节加载/版本恢复请求期间输入保留、快速选择代次、明确放弃强制销毁窗口，以及 CAS 与真实事务故障分码的 RED 测试。
- 2026-08-10：复核终稿要求版本恢复响应虽不覆盖新输入，仍须采纳数据库新 revision，证明后续 flush 不产生伪 CAS 冲突。

- 2026-07-28：新增 README 目录契约行为测试。
- 2026-07-28：补充祖先目录、精确标题和 push 基准回归测试。
- 2026-07-28：新增 Agent 公共契约、运行时校验和状态机的行为测试。
- 2026-07-28：补充带合法错误码的 Error 不保留堆栈或扩展字段的回归测试。
- 2026-07-28：新增 JSON Run Repository 的真实文件系统集成测试。
- 2026-07-28：新增顶级 envelope 键严格校验和替换阶段失败保留快照的回归测试。
- 2026-07-28：将 Agent 状态机与 Repository 用例迁移到已批准的错误、事件、`data`、输出和检查点公共契约。
- 2026-07-28：补充原生 Error、额外自有键、hostile getter/Proxy、非普通 JSON payload 和 Run 序列/归属的审查回归测试。
- 2026-07-28：补充非枚举/状态型 accessor 错误字段和 Repository 无替换保护的审查回归测试。
- 2026-07-28：新增 Mock Executor 与 Orchestrator 的离线闭环行为测试。
- 2026-07-28：补充 Task 4 审查修复的审批绕过、监听器隔离、仓储结果和执行器/命令路径回归测试。
- 2026-07-28：补充 legacy final checkpoint、持久化 approval.resolved 证明、进行中延迟中止和真正并发重复命令的复审回归测试。
- 2026-07-28：补充活动 final MockExecutor 流的 `finalChunks` 与 `nextChunkIndex` 直接断言。
- 2026-07-28：新增 Electron Agent IPC、最小 Preload 桥接和结构化日志的安全边界测试。
- 2026-07-28：补充 Task 5 Fix Round 1 的 preload 工件、恢复顺序、窗口解绑、sender URL/frame 与 IPC disposer 回归测试。
- 2026-07-28：补充 Task 5 Fix Round 1 Minor 的空 query 与空 query 加 hash production sender 回归测试。
- 2026-07-28：新增 Harness Agent 渲染控制器和专用 AI 对话页面的行为契约测试。
- 2026-07-28：新增 deferred/rejecting API、并发命令、重叠加载、回补恢复、dispose 与可访问/响应式页面回归覆盖。
- 2026-07-28：为真实生产验收发现的沙箱 Preload ESM 加载失败补充 CommonJS `.cjs` 构建与主进程连线回归测试。
- 2026-07-28：为生产实例短暂创建页面后自动退出补充活动 BrowserWindow 引用与关闭释放回归测试。
- 2026-07-28：补充生产 Mock Executor 可注入延迟、入口可中止 pacing 与运行中状态可观察性回归测试。
- 2026-07-28：补充最终审查的陈旧列表/取消提交竞态和 persisted queued 重启恢复回归测试。
- 2026-07-28：新增 Electron 生产 smoke 的纯逻辑断言、脱敏和进程参数回归测试。
- 2026-08-07：增加 Windows smoke 构建不得直接启动 `npm.cmd` 的回归覆盖。
- 2026-08-07：新增 `ui/` 组件测试目录，并保持 `tests/*.test.mjs` 继续由 Node Test Runner 执行。
- 2026-08-07：为阶段 1 新增项目路径、manifest 与项目锁的真实文件系统 RED 测试。
- 2026-08-07：为阶段 1 新增 SQLite Worker、schema、事务与迁移回滚 RED 测试。
- 2026-08-07：为阶段 1 新增完整项目生命周期、最近项目、备份恢复和双实例写锁 RED 测试。
- 2026-08-07：为阶段 1 新增项目 runtime、IPC、preload 安全桥接和 async shutdown RED 测试。
- 2026-08-07：为阶段 1 自审发现补充生命周期串行、control 落库失败清理、备份/恢复路径包含和迁移备份可读取性回归测试。
- 2026-08-07：补充 Worker 异常退出后 pending 与后续调用都不得悬挂的受控回归测试。
- 2026-08-07：补充两个已确认恢复者争抢同一陈旧锁时只能有一个成功的竞态回归测试。
- 2026-08-07：补充 control 数据库启动失败时必须清理、显示安全提示并退出的生产入口契约。
- 2026-08-07：补充数据库关闭失败时 shutdown gate 必须等待错误提示后再请求退出的回归测试。
- 2026-08-07：用临时 v2 迁移和 SQLite 写锁验证迁移失败后可通过公共恢复入口还原一致快照并成功迁移重开。
- 2026-08-07：补充最近项目更新失败时重命名必须同步回滚项目数据库和 manifest 的故障注入回归测试。
- 2026-08-07：补充 shutdown 等待已接纳生命周期操作并拒绝后续工作的串行资源所有权回归测试。
- 2026-08-07：补充备份完成后 control 元数据写入失败时必须移除最终备份目录的补偿回归测试。
- 2026-08-07：补充 Worker ready 前退出、死亡 recovery claim 回收和最近项目数据库缺失状态回归测试。
