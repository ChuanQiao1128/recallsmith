# 性能优化方案

## 问题分析

### Provisioned Concurrency 配额问题
```
The maximum allowed provisioned concurrency is 0
```

**原因**: AWS 新账户默认并发配额较低，需要申请提升。

**解决方法**:
1. AWS Console > Service Quotas > Lambda
2. 申请提升 `Concurrent executions` 配额
3. 或使用 AWS CLI:
```bash
aws service-quotas request-quota-increase \
  --service-code lambda \
  --quota-code L-B99A9384 \
  --desired-value 100
```

**临时替代方案**: 前端缓存 + 渐进式加载 (已实现)

---

## 前端优化策略 (已实施)

### 1. 客户端缓存 (localStorage)

```typescript
// 缓存策略
- decks 缓存 5 分钟
- manifest 缓存 5 分钟
- 首次加载后，下次瞬间显示
```

**效果**: 二次加载 < 100ms

### 2. 渐进式加载

```
第一次访问:
1. 检查缓存 → 有缓存则立即显示 (0ms)
2. 后台静默刷新 → 更新数据

后续访问:
1. 直接显示缓存数据
2. 可选手动刷新
```

### 3. 后台加载卡片数量

- 先显示 decks 列表
- 后台并行加载每个 deck 的卡片数量
- 不阻塞主页面渲染

---

## 使用优化版本

### 选项 A: 替换现有页面 (推荐)

```bash
# 备份原文件
mv frontend/src/pages/DeckListPage.tsx frontend/src/pages/DeckListPage.backup.tsx

# 使用优化版本
mv frontend/src/pages/DeckListPageOptimized.tsx frontend/src/pages/DeckListPage.tsx
```

### 选项 B: 路由切换

```typescript
// router.tsx
import { DeckListPageOptimized } from './pages/DeckListPageOptimized';

<Route path="/decks" element={<DeckListPageOptimized />} />
```

---

## 预期效果

| 场景 | 优化前 | 优化后 |
|------|-------|-------|
| 首次加载 | 3-6 秒 | 3-6 秒 (无法避免冷启动) |
| 二次加载 | 3-6 秒 | < 100ms (缓存) |
| 切换页面返回 | 3-6 秒 | < 100ms (缓存) |
| 手动刷新 | 3-6 秒 | 2-4 秒 (并行加载) |

---

## 额外优化建议

### 1. 预加载 (Preload)

登录成功后预加载 decks:

```typescript
// AuthCallbackPage.tsx
useEffect(() => {
  // 预加载，不阻塞
  fetchDecks().then(res => {
    if (res.success) {
      localStorage.setItem(CACHE_KEY_DECKS, JSON.stringify({
        data: res.data,
        timestamp: Date.now()
      }));
    }
  });
}, []);
```

### 2. Service Worker 缓存

使用 Workbox 缓存 API 响应:

```javascript
// service-worker.js
workbox.routing.registerRoute(
  '/api/v1/authoring/decks',
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: 'decks-cache',
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxAgeSeconds: 5 * 60, // 5 分钟
      }),
    ],
  })
);
```

### 3. 请求合并

后端已实现 Dashboard API，前端可选择性使用:

```typescript
// 单次请求获取所有数据
const { data } = await fetchDashboard();
// data.decks + data.manifest
```

---

## 监控指标

在 CloudWatch 中关注:

```
Duration (冷启动): > 3000ms → 需要 SnapStart
Duration (热启动): < 500ms → 正常
Restore Duration: < 500ms → SnapStart 生效
```

---

## 总结

| 优化项 | 状态 | 效果 |
|-------|------|------|
| SnapStart | ✅ 已开启 | 减少 50% 冷启动时间 |
| Provisioned Concurrency | ⚠️ 需申请配额 | 完全消除冷启动 |
| 前端缓存 | ✅ 已实现 | 二次加载 < 100ms |
| 渐进式加载 | ✅ 已实现 | 感知速度提升 |
| Dashboard API | ✅ 后端已实现 | 减少 50% 请求数 |

**建议**: 先部署前端缓存优化，再申请 AWS 配额提升。
