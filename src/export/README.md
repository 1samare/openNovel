# export 目录说明

## 目录用途

存放阶段 2 本地文本导入、成品导出和项目归档实现。

## 内容说明

- `import-service.ts`：规范 UTF-8 文本，生成 TXT/Markdown/paste 的可确认拆章预览，并以安全文件名原子保存参考资料。
- `export-service.ts`：从单一 `BookExportSnapshot` 生成 TXT、Markdown 与无宏 DOCX 字节，不调用外部程序。
- `project-archive.ts`：创建和校验不含应用级密钥的 `.opennovel.zip` 项目归档，并在解压前限制压缩包大小、条目数、展开体积和压缩比。

## 依赖边界

本目录可依赖 Node 文件系统、`docx` 和 `fflate`；不得依赖 Vue、渲染状态、模型 SDK或外部程序。

## 维护规则

导入预览必须与确认写入一致；全部导出格式消费同一数据库快照；路径、编码、哈希和临时文件行为必须有真实文件测试。

## 变更同步

- 2026-08-10：建立阶段 2 导入预览和 TXT/Markdown 统一快照导出边界。
- 2026-08-10：增加基于 `docx` 的无宏 DOCX 输出，并以解包 XML 验证卷章正文顺序。
- 2026-08-10：增加 `.opennovel.zip` 内容白名单、SHA-256、SQLite quick check、原子临时文件与安全解包边界。
- 2026-08-10：增加参考资料文件名净化、UTF-8 写入和 attachments 内原子落盘。
- 2026-08-10：独立复审让 paste 拆章同时识别 Markdown ATX/Setext 标题，与页面粘贴说明一致。
- 2026-08-10：独立复审增加归档解压资源上限、必需文件检查，并复用单次校验解包结果，防止压缩炸弹和重复解压。
