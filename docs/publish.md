📋 生产级异步发布流水线架构文档 (Production-Grade Async Publish Pipeline)

本文档详细描述了 RecallSmith 卡组发布系统的完整请求生命周期。
该系统采用了**前后端分离、API网关鉴权、SQS队列削峰、Lambda Serverless后台处理**的高可用架构。

> **设计哲学**：防御性编程。不相信网络是可靠的，不相信内存是无限的，不相信用户不会狂按 F5。

---

## 🌊 阶段一：前台触发 (Frontend Trigger)

前端的核心职责是：拦截手抖、传递指令、开启轮询、平滑反馈。

### Step 1: UI 防抖与发起请求
**文件位置**: `frontend/src/pages/DeckListPage.tsx` (~450)

当用户点击 Publish：
1. **UI 即时反馈**：利用 `setPublishingId(deckId)` 将按钮变为灰色的 `Publishing...`，防止双击。
2. **发送请求**：调用 `await publishDeck(deckId)` 接口。
3. **强制刷新**：接口一返回成功，立刻调用 `loadAll(true)` 刷新页面数据，进入轮询阶段。

*注意：前端在这里绝对不去调用 `rebuildManifest`，避免与后端的真实进度发生竞态（Race Condition）。*

---

## 🛡️ 阶段二：前台接待层 (HTTP API)

后端 API 只做“极速前置处理”，绝不碰耗时的 I/O 和打包计算。必须在 0.1 秒内响应前端。

### Step 2: 严格鉴权与配置断言
**文件位置**: `src_C/Vpc/Authoring/Publish.cs` (~80)

1. `Auth.RequireAdmin`: 确认令牌有效。
2. `Helpers.RequireDeckWrite`: 核对 `admin_deck_permissions` 数据库表，确保越权访问被拦截。
3. 断言 `PUBLISH_JOB_QUEUE_URL` 环境变量存在，避免配置缺失引发内部报错。

### Step 3: 核心防御 1 - 幂等性拦截 (Idempotency)
**文件位置**: `src_C/Vpc/Authoring/Publish.cs` (~210)

```csharp
const string checkDuplicateSql = """
  select job_id from deck_publishes 
  where deck_id = $1 and status in ('PENDING', 'PROCESSING') 
    and updated_at > now() - interval '15 minutes' limit 1
""";
```
*   **解决的痛点**：用户点完发布，嫌慢按 F5 刷新了网页，然后又点了一次发布。
*   **巧妙应对**：API 不报错也不生成新任务，而是**把数据库里那个已经在跑的 `jobId` 捞出来还给前端**。前端拿到老 ID，无缝接管进度条，完美避免了服务器重复干活。

### Step 4: 订单落库与核心防御 2 - 双写容错 (Dual Write Fallback)
**文件位置**: `src_C/Vpc/Authoring/Publish.cs` (~240)

系统需要在数据库插入 `PENDING` 记录，并向 SQS 发送消息。这是经典的“分布式双写难题”。
```csharp
// 1. 插入 PENDING 记录
await DbUtil.ExecuteAsync(conn, null, insertJobSql, [jobId, ...]);

try {
  // 2. 发送消息到 SQS 传送带
  await SQS().SendMessageAsync(sendMessageRequest);
} catch (Exception) {
  // 3. 容错回退：网络抖动导致发消息失败，立刻把账本里的订单标为 FAILED
  await DbUtil.ExecuteAsync(conn, null, "UPDATE deck_publishes SET status = 'FAILED' WHERE job_id = $1", [jobId]);
  throw;
}
```
***解决的痛点**：如果 SQS 崩了，数据库里会留下永远等不到 Worker 来接单的“孤儿任务”，导致前端页面一直卡死。

---

## ⏳ 阶段三：顾客等餐 (Frontend Polling)

### Step 5: 核心优化 3 - 指数退避轮询 (Exponential Backoff Polling)
**文件位置**: `frontend/src/pages/DeckListPage.tsx` (~480)

一旦前端拿到了 `jobId`，开始查询任务列表 `fetchPublishJobs()`：
*   如果队列里有 `PENDING` 或 `PROCESSING` 的任务，触发退避算法：
    *   **前 2 次**：每 2 秒查一次（应对 Lambda 冷启动快的常态，实现极速反馈）。
    *   **第 3~5 次**：每 5 秒查一次。
    *   **5 次以后**：每 10 秒查一次。
*   如果任务全部完成：进入休眠模式，每 30 秒维持一次心跳。
*   **解决的痛点**：弃用了死板的 `setInterval`，用最少的网络请求换取了极其丝滑的 UI 反馈。

---

## 👨‍🍳 阶段四：后厨做菜 (Worker Lambda)

由 AWS SQS 自动触发的后端 Worker 集群。这里是脏活累活的中心。

### Step 6: 核心防御 4 - 乐观锁与超时窃取 (Optimistic Lock & Timeout Stealing)
**文件位置**: `src_C/Worker/Repositories/JobRepository.cs`

Worker 被唤醒后，第一件事是去数据库抢单（CAS 模式）：
```sql
UPDATE deck_publishes 
SET status = 'PROCESSING', updated_at = now()
WHERE job_id = $1 
  AND (
    status IN ('PENDING', 'FAILED')
    OR (status = 'PROCESSING' AND updated_at < now() - interval '15 minutes')
  )
```
*   **防重复消费**：SQS 可能会把同一条消息发给两个 Worker。只有最先执行这条 UPDATE（更新行数 > 0）的 Worker 能抢到锁去干活，另一个 Worker 会直接优雅下班。
*   **锁超时窃取（修复僵尸任务）**：如果上一个 Worker 在执行时发生了 OOM 或底层断电（硬中断猝死），状态会永远卡在 `PROCESSING`。SQS 会过几分钟重新派发消息。此时，新 Worker 发现订单过了 15 分钟还没出锅，就会利用 `OR` 语句强行接管这口锅。

### Step 7: 核心防御 5 - 磁盘流式处理防 OOM (Stream to S3)
**文件位置**: `src_C/Worker/S3/S3DeckUploader.cs`

如果一个卡组包含几千张带有富文本代码的卡片，在内存里直接拼接 JSON 会导致 Lambda 瞬间爆内存（OOM）。
```csharp
var tmpPath = Path.Combine("/tmp", $"{Guid.NewGuid()}.json");
await using (var fs = new FileStream(tmpPath, FileMode.Create)) {
  await JsonSerializer.SerializeAsync(fs, data, options);
}
// SDK 会自动以 8MB 分块 Multipart 上传
var putRequest = new PutObjectRequest { FilePath = tmpPath, ... };
```
*   **解决的痛点**：抛弃了内存拼接大字符串的危险做法。利用 Lambda 免费自带的 512MB `/tmp` 磁盘和流式序列化，把内存消耗从几十兆降低到了极其平稳的几 MB。

### Step 8: 核心防御 6 - 解耦防惊群效应 (Anti-Thundering Herd)
**文件位置**: `src_C/Worker/Manifest/ManifestService.cs`

Worker 上传完卡组后，需要更新总索引册 `manifest.json`：
```csharp
var request = new SendMessageRequest {
  QueueUrl = ManifestQueueUrl,
  MessageBody = "{\"action\": \"rebuild_manifest\"}"
};
await SQS().SendMessageAsync(request);
```
*   **解决的痛点**：如果运营人员一次性点了 50 个卡组的发布，50 个 Worker 会同时完工，然后并发去数据库进行 50 次沉重的全表扫描，数据库连接池瞬间被打爆。
*   **巧妙应对**：Worker 完工后只发一个极轻量级的 SQS 消息。通过配置 SQS 的 Batching Window（延迟聚合），哪怕一分钟内收到 50 响门铃，最终也只会触发 **1 次** Builder Lambda 进行目录重建！

### Step 9: 智能错误分类路线
**文件位置**: `src_C/Worker/WorkerFunction.cs` (~70)

*   `catch (BusinessException)`：业务死胡同（比如卡组里一张卡都没有）。将订单标为 `FAILED`，程序**正常结束**，SQS 就会彻底删掉该消息。（**不再重试**）。
*   `catch (Exception)`：系统偶发崩溃（比如断网）。将日志抛出，程序**抛出异常**崩溃。SQS 看到 Lambda 崩溃，就会保留该消息并在随后重新派发。（**自动重试**）。
    *   *(运维注意：确保 SQS 可见性超时 Visibility Timeout 设置为 Lambda Timeout 的 6 倍以上，防止活还没干完就被 SQS 提前判死刑。)*

---

<!-- paths-not-on-disk
     本文档里出现、但磁盘上已经没有的仓库路径，逐条登记在这里（规则见 frontend/tests/docsPaths.test.ts）。
     E03（2026-09-22）把 manifest 重建移进 src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs，删除了下面这个文件；上文句子保持原样。
- src_C/Worker/Manifest/ManifestService.cs
-->
