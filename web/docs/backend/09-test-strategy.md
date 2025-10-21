单元测试
• slug 校验、stable_uid 幂等逻辑、发布冲突（同版本 409）。
• difficulty 枚举/范围验证；输入空值的异常路径。

集成测试
• 使用 SQLite In-Memory 跑应用服务：创建 deck → upsert 卡片 → 发布 → 检查 dist 目录产物/内容与 catalog.json。
• 用 LocalObjectStorage 替身替代 S3。

端到端（E2E）
• 启动 Admin API，本地 dist 发布，模拟移动端“拉取 catalog、下载某版本、打开 SQLite 验证 schema”。
