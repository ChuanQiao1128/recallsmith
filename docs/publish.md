📋 发布任务完整架构流程文档
阶段一：前端触发（用户点击 → API 调用）
Step 1: 用户点击 Publish 按钮
文件位置: frontend/src/pages/DeckListPage.tsx 代码行: ~901-904

<button
  type="button"
  disabled={publishingId === Number(deck.id)}
  onClick={() => void handlePublish(Number(deck.id))}  // ← 点击触发
>
  {publishingId === Number(deck.id) ? 'Publishing…' : 'Publish'}
</button>
架构要点: 使用 publishingId 状态防止重复点击，UI 立即显示 "Publishing…" 提供反馈。

Step 2: handlePublish 处理函数
文件位置: frontend/src/pages/DeckListPage.tsx 代码行: ~441-470

async function handlePublish(deckId: number) {
  if (!superAdmin) return;

  const ok = window.confirm(
    'Publish will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json\n\nContinue?',
  );
  if (!ok) return;

  try {
    setPublishingId(deckId);  // ← 设置 loading 状态

    const pub = await publishDeck(deckId);  // ← 调用 API 层
    if (!pub.success) {
      alert(pub.error?.message ?? 'Publish failed.');
      return;
    }

    const rb = await rebuildManifest();  // ← 同步重建 manifest
    if (!rb.success) {
      alert(rb.error?.message ?? 'Manifest rebuild failed (publish succeeded).');
    }

    await loadAll(true);  // ← 强制刷新列表
  } catch (err: unknown) {
    alert(err instanceof Error ? err.message : 'Network error.');
  } finally {
    setPublishingId(null);  // ← 清除 loading
  }
}
架构要点:

用户确认对话框明确告知操作影响
错误隔离：Publish 失败直接返回，Manifest 失败单独提示
loadAll(true) 强制刷新确保数据一致性
Step 3: API 层 - publishDeck 函数
文件位置: frontend/src/api/authoring.ts 代码行: ~399-412

export async function publishDeck(
  deckId: number, 
  note?: string
): Promise<ApiResult<{ mode: string; jobId?: string }>> {
  try {
    const resp = await http.post<ApiResult<{ mode: string; jobId?: string }>>(
      '/api/v1/authoring/publish',  // ← 后端 API 端点
      { deckId, note: note ?? '' }
    );
    return resp.data;
  } catch (err) {
    return fail(toApiErrorMessage(err));
  }
}
架构要点: 统一返回 ApiResult<T> 格式，网络错误转换为业务错误对象。

阶段二：后端 Vpc Lambda（HTTP API 处理）
Step 4: API 入口 - HandleAuthoringPublish
文件位置: src_C/Vpc/Authoring/Publish.cs 代码行: ~78-90

public static async Task<APIGatewayProxyResponse> HandleAuthoringPublish(
  LambdaRequest req, 
  Res res, 
  AuthContext auth)
{
  var deny = Auth.RequireAdmin(auth, res);
  if (deny is not null) return deny;

  if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");
  
  // 关键配置检查
  if (mode == "publish" && string.IsNullOrEmpty(PublishJobQueueUrl)) 
    return res.BadRequest("CONFIG_ERROR", "Missing env PUBLISH_JOB_QUEUE_URL");
架构要点: 严格的权限控制（RequireAdmin + RequireDeckWrite），配置缺失立即失败。

Step 5: 权限验证 - RequireDeckWrite
文件位置: src_C/Vpc/Authoring/Helpers.cs（内嵌在 Publish.cs 调用中） 使用位置: Publish.cs ~107

var denyDeck = await Helpers.RequireDeckWrite(conn, adminSub, deckIdInt, isSuperAdmin, res);
if (denyDeck is not null) return denyDeck;
验证逻辑: 检查 admin_deck_permissions 表，确保当前用户对该 Deck 有写权限。

Step 6: 数据准备 - 查询 Deck 和 Cards
文件位置: src_C/Vpc/Authoring/Publish.cs 代码行: ~110-161

// 查询 Deck 基础信息
const string deckSql = """
  select id, slug, title, ..., is_deleted as "isDeleted"
  from decks where id = $1 limit 1
  """;

// 查询所有 Cards
const string cardsSql = """
  select stable_uid as "stableUid", order_in_deck as "orderInDeck", ...
  from cards where deck_id = $1 and is_deleted = 0
  order by order_in_deck asc, id asc
  """;
架构要点:

软删除检查 (is_deleted = 0)
SQL 注入防护：使用参数化查询 $1
Step 7: 生成 Job 元数据
文件位置: src_C/Vpc/Authoring/Publish.cs 代码行: ~212-229

// 1. 生成 Job ID (GUID)
var jobId = Guid.NewGuid().ToString();

// 2. 生成 Build ID (时间戳 + 随机数)
var buildId = MakeBuildId();  // 20251214T094955Z-a1b2c3d4

// 3. 预计算 S3 Key
string s3Key;
if (tier == "premium")
  s3Key = $"{PremiumPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
else
  s3Key = $"{ContentPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
架构要点: S3 Key 预计算确保数据库约束满足，路径规范化防止目录遍历攻击。

Step 8: 数据库插入 - PENDING 状态
文件位置: src_C/Vpc/Authoring/Publish.cs 代码行: ~232-237

const string insertJobSql = """
  insert into deck_publishes (
    job_id, build_id, s3_key, deck_id, deck_slug, 
    status, published_by_admin_sub, note
  )
  values ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
  """;

await DbUtil.ExecuteAsync(conn, null, insertJobSql, 
  [jobId, buildId, s3Key, deckIdInt, deckSlug, adminSub, note]);
数据库表结构: deck_publishes 表

job_id: UUID 主键
status: PENDING → PROCESSING → SUCCESS/FAILED
build_id: 关联 S3 路径
attempt_count: 重试计数器
Step 9: 发送 SQS 消息
文件位置: src_C/Vpc/Authoring/Publish.cs 代码行: ~242-258

// 构造消息体
var messageBody = JsonSerializer.Serialize(new {
  jobId,
  deckId = deckIdInt,
  adminSub,
  note
});

// 发送到 SQS
var sendMessageRequest = new SendMessageRequest {
  QueueUrl = PublishJobQueueUrl,
  MessageBody = messageBody
};
await SQS().SendMessageAsync(sendMessageRequest);

// 返回给前端
return res.Ok(new { mode = "async", jobId });
架构要点: 消息体包含 Worker 需要的所有信息，避免 Worker 再次查询数据库。

阶段三：Worker Lambda（异步处理）
Step 10: SQS 触发 Worker
文件位置: src_C/Worker/WorkerFunction.cs 代码行: ~49-58

public async Task FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
{
  foreach (var record in sqsEvent.Records)
  {
    var message = ParseMessage(record.Body);  // 解析消息
    var jobId = message.JobId;
    
    LogWithJobId(jobId, $"Processing message {record.MessageId}");
Lambda 配置:

触发器: SQS Queue
批处理大小: 1（确保逐条处理）
并发: 根据 SQS 消息数自动扩展
Step 11: 解析消息
文件位置: src_C/Worker/WorkerFunction.cs 代码行: ~90-105

private static PublishJobMessage ParseMessage(string body)
{
  try {
    var message = JsonSerializer.Deserialize<PublishJobMessage>(body);
    if (message?.JobId is null)
      throw new ArgumentException("Missing jobId in message body");
    return message;
  }
  catch (JsonException ex) {
    throw new ArgumentException($"Invalid JSON message body: {ex.Message}");
  }
}
Step 12: 乐观锁抢占 - TryAcquireJobAsync
文件位置: src_C/Worker/Services/PublishJobProcessor.cs 代码行: ~25-34

public async Task ProcessAsync(string jobId)
{
  // Step 2: 乐观锁抢占任务
  var acquired = await _jobRepository.TryAcquireJobAsync(jobId);
  if (!acquired)
  {
    Console.WriteLine($"[JobId={jobId}] Job already processed or acquired by another worker");
    return;  // 优雅退出，不抛异常
  }
核心 SQL (JobRepository.cs):

UPDATE deck_publishes 
SET status = 'PROCESSING', updated_at = now(), attempt_count = attempt_count + 1
WHERE job_id = @jobId AND status IN ('PENDING', 'FAILED')
架构要点: Compare-And-Swap 模式，只有更新行数 > 0 才算抢占成功。

Step 13: 加载业务数据
文件位置: src_C/Worker/Services/PublishJobProcessor.cs 代码行: ~74-144

private async Task<DeckExportData> LoadDeckDataAsync(int deckId)
{
  // 查询 deck 信息
  const string deckSql = "...";
  
  // 查询 cards
  const string cardsSql = "...";
  
  return new DeckExportData {
    Slug = ...,
    Cards = cards.Select(...).ToList()
  };
}
Step 14: 上传 S3
文件位置: src_C/Worker/Services/PublishJobProcessor.cs 代码行: ~55-58

// Step 4: 外部系统调用 (S3)
await _s3Uploader.UploadAsync(job.S3Key, deckData);

Console.WriteLine($"[JobId={jobId}] Uploaded to S3: {job.S3Key}");
S3Uploader 实现: 使用 AmazonS3Client.PutObjectAsync 上传 JSON 序列化后的 Deck 数据。

Step 15: 任务完成 - 更新状态
文件位置: src_C/Worker/Services/PublishJobProcessor.cs 代码行: ~60-63

// Step 5: 最终一致性提交
await _jobRepository.CompleteJobAsync(jobId);

Console.WriteLine($"[JobId={jobId}] Job completed successfully");
CompleteJobAsync SQL:

UPDATE deck_publishes 
SET status = 'SUCCESS', updated_at = now() 
WHERE job_id = @jobId
Step 16: 触发 Manifest 重建
文件位置: src_C/Worker/WorkerFunction.cs 代码行: ~64-68

// Step 6: 触发 Manifest 重建
LogWithJobId(jobId, "Triggering manifest rebuild");
await _manifestService.RebuildAsync();
架构要点: Manifest 重建是独立服务，可以被多次调用（幂等）。

Step 17: 错误处理双路线
文件位置: src_C/Worker/WorkerFunction.cs 代码行: ~70-83

catch (BusinessException ex)
{
  // 路线 A: 业务级死胡同（数据错误，无需重试）
  await _processor.FailAsync(jobId, ex.Message);  // 标记 FAILED
  // 正常结束，SQS 删除消息
}
catch (Exception ex)
{
  // 路线 B: 系统级崩溃（网络超时等，需要重试）
  throw;  // SQS 不会删除消息，自动重试
}
阶段四：前端状态同步
Step 18: 轮询 Publish Jobs
文件位置: frontend/src/pages/DeckListPage.tsx 代码行: ~472-480

// 定期刷新 publish jobs
useEffect(() => {
  loadPublishJobs();
  const interval = setInterval(loadPublishJobs, 30000); // 30秒轮询
  return () => clearInterval(interval);
}, []);
Step 19: 查询 Job 列表
文件位置: src_C/Vpc/Authoring/PublishJobs.cs 代码行: ~8-39

public static async Task<APIGatewayProxyResponse> HandleFetchPublishJobs(...)
{
  const string sql = """
    select job_id as "jobId", deck_slug as "deckSlug", status, ...
    from deck_publishes
    order by created_at desc
    limit 100;
    """;
  
  var rows = await DbUtil.QueryAsync(conn, null, sql, []);
  return res.Ok(rows);
}
架构亮点总结
设计点	代码位置	解决的问题
异步队列	Publish.cs:253	长耗时操作不阻塞用户
乐观锁	PublishJobProcessor.cs:28	SQS 重复消费防护
状态机	deck_publishes.status	任务可追溯、可重试
错误分类	WorkerFunction.cs:70-83	业务错误不重试，系统错误自动重试
前端轮询	DeckListPage.tsx:472	简单可靠的状态同步
建议阅读顺序:

先看 DeckListPage.tsx:441 handlePublish（入口）
再看 Publish.cs:78 HandleAuthoringPublish（API 层）
再看 WorkerFunction.cs:49 FunctionHandler（消费层）
最后 PublishJobProcessor.cs:25 ProcessAsync（业务逻辑）