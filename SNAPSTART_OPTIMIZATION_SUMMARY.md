# SnapStart 优化总结

## 问题分析

前端主页加载慢，原因是：
1. **冷启动延迟**: VPC Lambda 冷启动需要 3-6 秒
2. **双重请求**: 主页同时调用 `fetchDecks()` 和 `fetchAdminManifest()`，触发两次冷启动
3. **SnapStart 可能未正确配置**

---

## 已完成的优化

### 1. 代码层面 (已完成 ✅)

**SnapStart Hooks 正确配置:**
- `VpcFunction` 构造函数调用 `SnapStartHooks.RegisterOnce()`
- `BeforeSnapshot` / `AfterRestore` 正确重置资源
- `AssemblyInfo.cs` 包含 `[assembly: LambdaSerializer]`

**新增合并 Dashboard API:**
```typescript
// 新端点: GET /api/v1/authoring/dashboard
// 返回: { decks: [...], manifest: {...} }
// 减少一次 HTTP 请求和可能的冷启动
```

### 2. 需要你在 AWS 控制台完成的配置

#### Step 1: 开启 SnapStart

**AWS Console:**
```
Lambda > [vpc-lambda-name] > Configuration > SnapStart > Edit > Enabled
```

**AWS CLI:**
```bash
aws lambda update-function-configuration \
  --function-name your-vpc-lambda-name \
  --snap-start ApplyOn=PublishedVersions
```

#### Step 2: 发布新版本

**关键!** SnapStart 只在 Published Versions 上生效，不在 $LATEST 上生效！

```bash
# 发布新版本
VERSION=$(aws lambda publish-version \
  --function-name your-vpc-lambda-name \
  --query Version --output text)

echo "Published version: $VERSION"
```

#### Step 3: 配置别名

```bash
# 创建/更新 prod 别名指向新版本
aws lambda update-alias \
  --function-name your-vpc-lambda-name \
  --name prod \
  --function-version $VERSION
```

#### Step 4: 配置 Provisioned Concurrency (推荐)

```bash
# 配置预置并发，完全消除冷启动
aws lambda put-provisioned-concurrency-config \
  --function-name your-vpc-lambda-name \
  --qualifier prod \
  --provisioned-concurrent-executions 1
```

#### Step 5: 更新 API Gateway

确保 API Gateway 调用的是 **别名 (prod)** 而不是 **$LATEST**。

---

## 前端优化选项

### 方案 A: 使用新的 Dashboard API (推荐)

```typescript
import { useDashboard } from './hooks/useDashboard';

function DeckListPage() {
  const { data, loading, error, reload } = useDashboard();
  
  // data.decks - 卡组列表
  // data.manifest - manifest 数据
}
```

**优势:**
- 单次 API 调用
- 单次 Lambda 冷启动
- 减少 ~50% 的加载时间

### 方案 B: 保持现有 API，添加客户端缓存

使用 SWR 或 TanStack Query:

```typescript
import useSWR from 'swr';

// 1 分钟内不重复请求，减少冷启动概率
const { data } = useSWR('/api/v1/authoring/decks', fetcher, {
  revalidateOnFocus: false,
  dedupingInterval: 60000,
});
```

---

## 诊断脚本

使用提供的脚本快速检查配置:

```bash
# 检查 SnapStart 配置
cd recallsmith/src_C
./check_snapstart.sh your-vpc-lambda-name
```

---

## 预期效果

| 场景 | 优化前 | 优化后 (SnapStart) | 优化后 (SnapStart + Provisioned) |
|------|--------|-------------------|--------------------------------|
| 冷启动 | 3-6 秒 | 0.5-1 秒 | < 100ms |
| API 调用次数 | 2 次 | 1 次 (Dashboard) | 1 次 |
| 用户体验 | 明显等待 | 轻微延迟 | 即时响应 |

---

## 下一步行动清单

### 必须完成 (冷启动优化)
- [ ] 在 AWS Console 开启 SnapStart
- [ ] 发布 Lambda 新版本
- [ ] 更新别名指向新版本
- [ ] 测试主页加载时间

### 强烈建议 (最佳体验)
- [ ] 配置 Provisioned Concurrency
- [ ] 更新 API Gateway 使用别名
- [ ] 部署新的 Dashboard API 并更新前端

### 可选优化
- [ ] 前端添加 SWR 缓存
- [ ] 登录后预加载 Dashboard 数据
