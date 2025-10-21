安全
• Admin API Key：所有 /api/admin/_ 需 X-Admin-ApiKey；密钥从配置/环境变量读取，可轮换。
• CORS：只开放 Admin Web 的域名。
• 最小权限：S3 仅允许写 recallsmith/_ 指定前缀；公开访问只读（或通过 CloudFront 策略控制）。
• 输入验证：slug（^[a-z0-9-]{3,64}$）、locale（BCP47）、difficulty（枚举或长度限制）、Markdown 长度限制。
• 软删除：保留审计空间，避免误删；定期清理策略可后续加。

可观测
• 健康检查：/health。
• 结构化日志：Serilog，记录 traceId，请求耗时、路由、状态码、错误栈。
• 关键指标（后续可接 Prometheus）：发布次数、失败率、发布耗时、包大小等。
