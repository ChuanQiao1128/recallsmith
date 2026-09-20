using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.SQS;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Publish
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string? PremiumBucket = Environment.GetEnvironmentVariable("PREMIUM_BUCKET");
  private static readonly string? PublishJobQueueUrl = Environment.GetEnvironmentVariable("PUBLISH_JOB_QUEUE_URL");

  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
  }

  private static readonly string ContentPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
  private static readonly string PremiumPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");
  private static readonly string ManifestKey = $"{ContentPrefix}/manifest.json";

  private static AmazonS3Client? _s3;
  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS()
  {
    if (_sqs is not null) return _sqs;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _sqs = new AmazonSQSClient(RegionEndpoint.GetBySystemName(region));
    return _sqs;
  }

  // Warmup hooks. These deliberately expose the existing lazy factory instead of replacing
  // it: the client must still be creatable on demand so that a skipped or failed warmup
  // leaves the request path working exactly as before.
  internal static AmazonSQSClient SqsForWarmup() => SQS();

  // Warmup reads the same captured value the handler reads, so a missing env var is seen
  // identically in both places.
  internal static string? WarmupQueueUrl => PublishJobQueueUrl;

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    var s3Client = _s3;
    _s3 = null;
    if (s3Client is not null) try { s3Client.Dispose(); } catch { /* best-effort */ }

    var sqsClient = _sqs;
    _sqs = null;
    if (sqsClient is not null) try { sqsClient.Dispose(); } catch { /* best-effort */ }
  }

  private static string MakeBuildId()
  {
    // 20251214T094955Z-a1b2c3d4
    var utc = DateTime.UtcNow;
    var rand = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
    return $"{utc:yyyyMMdd'T'HHmmss'Z'}-{rand}";
  }

  private static string InferTier(long deckType, object? tierValue)
  {
    var t = (Convert.ToString(tierValue, CultureInfo.InvariantCulture) ?? string.Empty).Trim().ToLowerInvariant();
    if (t is "free" or "premium") return t;
    return deckType == 1 ? "free" : "premium";
  }

  /// <summary>
  /// First card whose stored MCQ blob fails the publish rules, or null when every row passes.
  /// Pure (no IO). Rows arrive in order_in_deck order, so the first failure is deterministic.
  /// Order of checks per row (C00 §2.9.4): Canonicalize against the stem, then explanation
  /// non-blank (MCQ_EXPLANATION_REQUIRED), then difficulty 1..3 (MCQ_DIFFICULTY_RANGE).
  /// </summary>
  internal static (string StableUid, string Code)? FirstMcqGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows)
  {
    foreach (var c in cardRows)
    {
      var mcq = Helpers.JsonbElement(c, "mcq");
      if (mcq is null) continue;

      var stableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty;
      var question = Convert.ToString(c["question"], CultureInfo.InvariantCulture);
      var explanation = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture);
      var difficulty = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture);

      try
      {
        McqValidation.Canonicalize(mcq.Value, question);
      }
      catch (McqValidationError mex)
      {
        return (stableUid, mex.Code);
      }

      if (string.IsNullOrWhiteSpace(explanation)) return (stableUid, "MCQ_EXPLANATION_REQUIRED");
      if (!McqValidation.IsMcqDifficulty(difficulty)) return (stableUid, "MCQ_DIFFICULTY_RANGE");
    }

    return null;
  }

  /// <summary>
  /// The cards a publish exports, in export order. Internal so the gate test reads rows with
  /// the exact production text (jsonb comes back as PG text, and that is what the gate parses).
  /// </summary>
  internal const string CardsSql = """
    select
      stable_uid as "stableUid",
      order_in_deck as "orderInDeck",
      difficulty,
      question,
      explanation,
      code_language as "codeLanguage",
      code_snippet as "codeSnippet",
      real_world_usage as "realWorldUsage",
      revision,
      topic,
      mcq
    from cards
    where deck_id = $1 and is_deleted = 0
    order by order_in_deck asc, id asc
    """;

  public static async Task<APIGatewayProxyResponse> HandleAuthoringPublish(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var mode = (req.Query.TryGetValue("mode", out var m) ? m : string.Empty).Trim().ToLowerInvariant() == "preview"
      ? "preview"
      : "publish";

    if (mode == "publish" && string.IsNullOrEmpty(PublishJobQueueUrl)) return res.BadRequest("CONFIG_ERROR", "Missing env PUBLISH_JOB_QUEUE_URL");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var body = doc.RootElement;
      if (!body.TryGetProperty("deckId", out var deckIdEl)) return res.BadRequest("VALIDATION_ERROR", "deckId is required");
      var deckIdInt = Validation.RequireInteger(deckIdEl.ToString(), "deckId");
      var note = body.TryGetProperty("note", out var noteEl) && noteEl.ValueKind != JsonValueKind.Null ? noteEl.ToString().Trim() : null;

      var isSuperAdmin = auth.IsSuperAdmin;
      var adminSub = auth.UserSub;

      var denyDeck = await Helpers.RequireDeckWrite(conn, adminSub, deckIdInt, isSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      const string deckSql = """
        select
          id,
          slug,
          title,
          author,
          description,
          locale,
          deck_type as "deckType",
          version,
          tier,
          total_cards as "totalCards",
          preview_cards as "previewCards",
          is_deleted as "isDeleted",
          updated_at as "updatedAt"
        from decks
        where id = $1
        limit 1
        """;

      var deckRows = await DbUtil.QueryAsync(conn, null, deckSql, [deckIdInt]);
      if (deckRows.Count == 0) return res.NotFound("Deck not found");

      var deck = deckRows[0];
      if (Convert.ToInt32(deck["isDeleted"], CultureInfo.InvariantCulture) == 1)
      {
        return res.BadRequest("DECK_DELETED", "Deck is deleted (cannot publish)");
      }

      var deckSlug = (Convert.ToString(deck["slug"], CultureInfo.InvariantCulture) ?? string.Empty).Trim();
      if (string.IsNullOrEmpty(deckSlug) || deckSlug.Contains('/') || deckSlug.Contains("..", StringComparison.Ordinal))
      {
        throw new ValidationError("deck.slug contains invalid characters", "deckSlug");
      }

      var cardRows = await DbUtil.QueryAsync(conn, null, CardsSql, [deckIdInt]);

      var deckType = Convert.ToInt64(deck["deckType"], CultureInfo.InvariantCulture);
      var tier = InferTier(deckType, deck.TryGetValue("tier", out var tv) ? tv : null);

      if (tier == "premium" && string.IsNullOrEmpty(PremiumBucket))
      {
        return res.BadRequest("CONFIG_ERROR", "Missing env PREMIUM_BUCKET");
      }

      var baseCards = cardRows.Select(c => new
      {
        stableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture),
        orderInDeck = Convert.ToInt32(c["orderInDeck"], CultureInfo.InvariantCulture),
        difficulty = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture),
        question = Convert.ToString(c["question"], CultureInfo.InvariantCulture),
        explanation = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture) ?? string.Empty,
        codeLanguage = c.TryGetValue("codeLanguage", out var cl) ? cl : null,
        codeSnippet = Convert.ToString(c.TryGetValue("codeSnippet", out var cs) ? cs : null, CultureInfo.InvariantCulture) ?? string.Empty,
        realWorldUsage = Convert.ToString(c.TryGetValue("realWorldUsage", out var rw) ? rw : null, CultureInfo.InvariantCulture) ?? string.Empty,
        revision = Convert.ToInt32(c.TryGetValue("revision", out var rv) ? (rv ?? 1) : 1, CultureInfo.InvariantCulture),
        topic = c.TryGetValue("topic", out var tp) ? tp as string : null,
        mcq = Helpers.JsonbElement(c, "mcq"),
      }).ToList();

      var baseDeckJson = new
      {
        slug = deckSlug,
        title = Convert.ToString(deck["title"], CultureInfo.InvariantCulture),
        locale = Convert.ToString(deck.TryGetValue("locale", out var lo) ? lo : null, CultureInfo.InvariantCulture) ?? "en-US",
        deckType = (int)deckType,
        version = Convert.ToString(deck.TryGetValue("version", out var ver) ? ver : null, CultureInfo.InvariantCulture) ?? "1",
        totalCards = ToInt(deck.TryGetValue("totalCards", out var tc) ? tc : null, baseCards.Count),
        cards = baseCards,
      };

      if (mode == "preview")
      {
        return res.Ok(new
        {
          mode = "preview",
          deckId = deckIdInt,
          deckSlug,
          tier,
          cardCount = baseCards.Count,
          export = baseDeckJson,
        });
      }

      // Pre-enqueue gate (publish only — the preview above has already returned). A stored MCQ
      // blob that no longer satisfies the API rules must not reach the Worker, which serialises
      // it verbatim into deck.json / chunks / patches.
      var gate = FirstMcqGateFailure(cardRows);
      if (gate is not null) return res.BadRequest("MCQ_PUBLISH_GATE", $"{gate.Value.StableUid}: {gate.Value.Code}");

      // --- ASYNC PUBLISH LOGIC ---

      Log.Info("[DEBUG] 1. Starting async publish logic.");

      // 💡 核心防御：防重复并发提交（幂等性）。
      // 如果用户在 15 分钟内重复点击（或 F5 刷新后再次点击），直接返回正在处理的 jobId，让前端顺滑接管轮询。
      const string checkDuplicateSql = """
        select job_id as "jobId"
        from deck_publishes 
        where deck_id = $1 
          and status in ('PENDING', 'PROCESSING') 
          and updated_at > now() - interval '15 minutes'
        limit 1
        """;
      var existingRows = await DbUtil.QueryAsync(conn, null, checkDuplicateSql, [deckIdInt]);
      if (existingRows.Count > 0)
      {
        var existingJobId = Convert.ToString(existingRows[0]["jobId"], CultureInfo.InvariantCulture);
        Log.Info($"[DEBUG] 1.5. Found existing active job {existingJobId}. Returning it to resume polling.");
        return res.Ok(new { mode = "async", jobId = existingJobId, note = "Resumed existing job" });
      }

      // 1. Generate Job ID
      var jobId = Guid.NewGuid().ToString();
      // 💡 修复：为 PENDING 任务预先生成一个 buildId 以满足数据库非空约束
      var buildId = MakeBuildId();

      // 💡 修复：预先计算出 s3_key 以满足数据库非空约束
      // 这个路径格式必须和 ManifestRebuild.cs 中的逻辑保持一致
      string s3Key;
      if (tier == "premium")
      {
        if (string.IsNullOrEmpty(PremiumBucket)) throw new InvalidOperationException("Missing env PREMIUM_BUCKET for premium deck");
        s3Key = $"{PremiumPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
      }
      else
      {
        if (string.IsNullOrEmpty(ContentBucket)) throw new InvalidOperationException("Missing env CONTENT_BUCKET for free deck");
        s3Key = $"{ContentPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
      }

      // 2. Insert PENDING job record into the database
      const string insertJobSql = """
        insert into deck_publishes (job_id, build_id, s3_key, deck_id, deck_slug, status, published_by_admin_sub, note)
        values ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
        """;
      Log.Info($"[DEBUG] 2. Inserting PENDING job {jobId} into database...");
      await DbUtil.ExecuteAsync(conn, null, insertJobSql, [jobId, buildId, s3Key, deckIdInt, deckSlug, adminSub, note]);
      Log.Info("[DEBUG] 3. Database insert successful.");


      // 3. Create the SQS message payload
      var messageBody = JsonSerializer.Serialize(new
      {
        jobId,
        deckId = deckIdInt,
        // 💡 最佳实践：把 Worker 需要的所有信息都放进消息体
        adminSub,
        note
      });

      Log.Info($"[DEBUG] 4. Preparing to send message to SQS queue: {PublishJobQueueUrl}");
      // 4. Send the message to the SQS queue
      var sendMessageRequest = new SendMessageRequest
      {
        QueueUrl = PublishJobQueueUrl,
        MessageBody = messageBody
      };

      try 
      {
        await SQS().SendMessageAsync(sendMessageRequest);
        Log.Info("[DEBUG] 5. SQS message sent successfully!");
      }
      catch (Exception ex)
      {
        // 💡 核心防御：双写失败回退
        // 如果 SQS 网络抖动发送失败，立刻将数据库任务状态标为 FAILED，防止产生永远等不到 Worker 的孤儿订单
        Log.Error($"[DEBUG] SQS send failed for {jobId}. Rolling back status to FAILED.", ex);
        await DbUtil.ExecuteAsync(conn, null, "UPDATE deck_publishes SET status = 'FAILED', updated_at = now() WHERE job_id = $1", [jobId]);
        throw;
      }

      return res.Ok(new
      {
        mode = "async",
        jobId
      });
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      Log.Error("[DEBUG] Caught unhandled exception in Publish handler", ex);
      return res.Error500(ex);
    }
  }
  
  private static int ToInt(object? v, int fallback)
  {
    if (v is null) return fallback;
    if (v is int i) return i;
    if (v is long l) return (int)l;
    if (int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n;
    return fallback;
  }
}
