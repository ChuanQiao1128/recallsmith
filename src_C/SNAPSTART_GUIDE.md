# SnapStart 配置与优化指南

## 问题现象
前端主页加载慢，可能是 VPC Lambda 冷启动导致。

## SnapStart 检查清单

### 1. AWS Console 检查 SnapStart 是否开启

```
AWS Console > Lambda > [你的 VPC Lambda 函数] > Configuration > SnapStart
```

**期望状态:**
- SnapStart: **Enabled**
- Apply on: **Published versions**

**如果未开启，手动开启步骤:**
1. 进入 Lambda 函数 Configuration 页面
2. 点击左侧 "SnapStart"
3. 点击 "Edit"
4. 选择 "Enable"
5. 点击 "Save"

**或者使用 AWS CLI:**
```bash
aws lambda update-function-configuration \
  --function-name your-vpc-lambda-name \
  --snap-start ApplyOn=PublishedVersions
```

### 2. 发布新版本 (重要!)

SnapStart 只在**已发布的版本** (Published Versions) 上生效，不在 $LATEST 上生效！

```bash
# 1. 发布新版本
aws lambda publish-version --function-name your-vpc-lambda-name

# 2. 将别名指向新版本 (例如 prod)
aws lambda update-alias \
  --function-name your-vpc-lambda-name \
  --name prod \
  --function-version [新版本号]
```

### 3. 检查 Provisioned Concurrency (预置并发)

如果只开启 SnapStart 但调用量低，仍可能有冷启动。建议配置预置并发：

```
AWS Console > Lambda > [函数] > Configuration > Concurrency
```

添加 Provisioned Concurrency:
- 数量: 1-2 (根据流量调整)
- 关联到别名 (如 prod)

**AWS CLI:**
```bash
aws lambda put-provisioned-concurrency-config \
  --function-name your-vpc-lambda-name \
  --qualifier prod \
  --provisioned-concurrent-executions 1
```

---

## 代码层面的 SnapStart 优化

### 已完成的优化 ✅

1. **构造函数中注册 Hooks**
```csharp
public VpcFunction()
{
    SnapStartHooks.RegisterOnce();
}
```

2. **BeforeSnapshot / AfterRestore Hooks**
```csharp
internal static class SnapStartHooks
{
    public static void RegisterOnce()
    {
        SnapshotRestore.RegisterBeforeSnapshot(BeforeSnapshot);
        SnapshotRestore.RegisterAfterRestore(AfterRestore);
    }
    
    private static void ResetResources()
    {
        // 重置网络连接，避免快照中包含无效连接
        try { Pg.Reset(); } catch { }
        // ... 其他重置
    }
}
```

3. **避免在静态构造函数中初始化网络资源**

### 潜在问题排查 🔍

**问题: SnapStart 开启后仍然慢？**

可能原因:
1. 调用的是 $LATEST 而不是 Published Version
2. 数据库连接在请求处理时才建立（而非初始化阶段）
3. 静态字段延迟加载

**检查 CloudWatch Logs 中的 Init Duration:**
```
REPORT Init Duration: 5000 ms    <- 这是冷启动时间
```

开启 SnapStart 后，应该看到:
```
REPORT Restore Duration: 200 ms  <- 从快照恢复
```

---

## 前端优化建议 (减少 API 调用)

当前主页同时发起两个请求:
1. `GET /api/v1/authoring/decks`
2. `GET /api/v1/admin/manifest`

### 优化方案 1: 合并 API 端点

创建一个新的端点 `/api/v1/authoring/dashboard` 同时返回 decks 和 manifest:

```csharp
// 新增端点
if (p.EndsWith("/api/v1/authoring/dashboard", StringComparison.OrdinalIgnoreCase) 
    && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
{
    return await Vpc.Authoring.Dashboard.HandleDashboard(req, res, auth);
}
```

### 优化方案 2: 添加客户端缓存

在 frontend 中添加 SWR 或 React Query 缓存:

```typescript
// 使用 stale-while-revalidate 策略
const { data: decks } = useSWR('/api/v1/authoring/decks', fetcher, {
  revalidateOnFocus: false,
  dedupingInterval: 60000, // 1分钟内不重复请求
});
```

### 优化方案 3: 预加载 (Preload)

登录成功后就开始预加载 decks 数据:

```typescript
// 在 AuthCallbackPage 或登录成功后
useEffect(() => {
  // 预加载，不阻塞 UI
  queryClient.prefetchQuery(['decks'], fetchDecks);
}, []);
```

---

## 快速诊断命令

```bash
# 检查 Lambda 配置
aws lambda get-function-configuration --function-name your-vpc-lambda-name

# 查看 SnapStart 状态
aws lambda get-function --function-name your-vpc-lambda-name | jq '.SnapStart'

# 检查最近调用日志
aws logs tail /aws/lambda/your-vpc-lambda-name --since 10m
```

---

## 预期效果

| 场景 | 未开启 SnapStart | 开启 SnapStart | 开启 + Provisioned Concurrency |
|------|-----------------|----------------|------------------------------|
| 冷启动 | 3-6 秒 | 0.5-1 秒 | < 100ms |
| 热启动 | 50-200ms | 50-200ms | 50-200ms |

---

## 下一步行动

1. [ ] 在 AWS Console 中开启 SnapStart
2. [ ] 发布 Lambda 新版本
3. [ ] 更新 API Gateway 或函数 URL 指向 Published Version
4. [ ] 配置 Provisioned Concurrency (推荐)
5. [ ] 测试主页加载时间
