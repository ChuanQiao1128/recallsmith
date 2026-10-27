using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// 发布任务处理器
/// 执行 5-Step 流水线：抢占 -> 数据准备 -> S3上传 -> 完成
/// </summary>
public class PublishJobProcessor : IPublishJobProcessor, IReplayOutcome
{
  private readonly IJobRepository _jobRepository;
  private readonly IS3DeckUploader _s3Uploader;
  private readonly IContentArtifactsGenerator _contentArtifacts;

  public PublishJobProcessor(
    IJobRepository jobRepository,
    IS3DeckUploader s3Uploader,
    IContentArtifactsGenerator? contentArtifacts = null)
  {
    _jobRepository = jobRepository;
    _s3Uploader = s3Uploader;
    _contentArtifacts = contentArtifacts
      ?? new ContentArtifactsGenerator(s3Uploader, new ContentArtifactsRepository());
  }

  /// <inheritdoc />
  public bool LastCallWasTerminalReplay { get; private set; }

  public async Task ProcessAsync(string jobId, int receiveCount = 1)
  {
    LastCallWasTerminalReplay = false;

    // Step 2: 乐观锁抢占任务（receiveCount = SQS ApproximateReceiveCount）
    var acquired = await _jobRepository.TryAcquireJobAsync(jobId, receiveCount);
    if (!acquired)
    {
      // A redelivery lost the race. If the row is already SUCCESS or simply gone, this is a
      // duplicate delivery of a finished job — acknowledge it. Otherwise the row is PROCESSING
      // and not yet stale, so another container may still hold it: fail the item so SQS keeps it.
      var row = await _jobRepository.GetJobAsync(jobId);
      if (row is null || row.Status is "SUCCESS" or "FAILED")
      {
        Console.WriteLine($"[JobId={jobId}] Job already finished ({row?.Status ?? "absent"}); acknowledging replay");
        // A crash between CompleteJobAsync and the side effects leaves the message on the queue, and this
        // replay is its only second chance (automation-1): both side effects are idempotent (the outbox
        // rows staged with the SUCCESS commit are sent once, the ledger row is keyed on the job).
        if (row is { Status: "SUCCESS" }) await AfterPublishSucceededAsync(row);
        // Not a publish outcome (R18I Q4): the job's gauge, if any, was emitted when it became terminal.
        LastCallWasTerminalReplay = true;
        return;
      }
      throw new JobNotAcquiredException(jobId);
    }

    // 获取任务信息
    var job = await _jobRepository.GetJobAsync(jobId);
    if (job is null)
    {
      throw new BusinessException($"Job {jobId} not found");
    }

    Console.WriteLine($"[JobId={jobId}] Acquired job for deck {job.DeckSlug}");

    if (job.DeckSlug == "aws-saa-fundamentals") await ValidateReleaseJob(jobId);

    // Step 3: 业务数据准备
    var deckData = await LoadDeckDataAsync(job.DeckId);

    if (deckData.Cards.Count == 0)
    {
      throw new BusinessException("Deck has no cards");
    }

    Console.WriteLine($"[JobId={jobId}] Loaded {deckData.Cards.Count} cards");

    // The AI QA publish gate passed a specific set of cards (backend-design-16): never build anything else. A card
    // edited since then may be at a hash nobody reviewed; the author publishes again and the gate re-checks.
    if (!string.IsNullOrEmpty(job.QaSnapshotSha256) &&
        !string.Equals(SnapshotDigest(deckData.Cards), job.QaSnapshotSha256, StringComparison.Ordinal))
    {
      RouteMetrics.EmitGauge(PublishSnapshot.StaleMetric, 1);
      throw new BusinessException($"{PublishSnapshot.StaleErrorCode}: cards changed after the AI QA publish gate passed; publish again");
    }

    // An automation publish checked the deck's settings too (R18C, backend-design-11): a settings edit since then is a
    // human change, which only a human publishes. Read after the deck, so an edit that the build read is always seen.
    if (await DeckSettingsChangedAsync(jobId))
    {
      RouteMetrics.EmitGauge(PublishSnapshot.StaleMetric, 1);
      throw new BusinessException($"{PublishSnapshot.StaleErrorCode}: deck settings changed after the automation checked them; publish again");
    }

    // 💡 契约修复：deck.json 的 version 必须等于本次构建的 buildId（字符串），
    // 与 manifest entry 的 version 保持一致 —— 客户端全量安装校验 deck.json.version === manifest version。
    if (!string.IsNullOrEmpty(job.BuildId))
    {
      deckData.Version = job.BuildId;
    }

    if (job.DeckSlug == "aws-saa-fundamentals") await ValidateReleaseJob(jobId);

    // Step 4: 外部系统调用 (S3)
    var uploadResult = await _s3Uploader.UploadAsync(job.S3Key, deckData);

    Console.WriteLine($"[JobId={jobId}] Uploaded to S3: {job.S3Key} (sha256={uploadResult.Sha256}, bytes={uploadResult.Bytes})");

    if (job.DeckSlug == "aws-saa-fundamentals")
    {
      await using var uploadConn = await Pg.OpenConnectionOrNullAsync();
      if (uploadConn is null) throw new InvalidOperationException("Failed to record reviewed build integrity");
      var recorded = await DbUtil.ExecuteAsync(uploadConn, null,
        "update deck_publishes set content_sha256=$2,content_bytes=$3 where job_id=$1 and status='PROCESSING'",
        [jobId, uploadResult.Sha256, uploadResult.Bytes]);
      if (recorded != 1) throw new BusinessException("RELEASE_GENERATION_CANCELLED: upload did not commit a live build");
    }

    // Step 4.5: 内容分发 v3 附加产物（chunked package / delta patch / DB 元数据）
    // 完全 best-effort：生成器内部吞掉所有异常，绝不影响发布任务
    await _contentArtifacts.GenerateAsync(job, deckData, uploadResult);

    // Step 5: 最终一致性提交
    await _jobRepository.CompleteJobAsync(jobId, deckData.Cards.Count);
    if (job.DeckSlug == "aws-saa-fundamentals" && (await _jobRepository.GetJobAsync(jobId))?.Status != "SUCCESS")
      throw new BusinessException("RELEASE_GENERATION_CANCELLED: no live build was committed");
    await AfterPublishSucceededAsync(job);

    Console.WriteLine($"[JobId={jobId}] Job completed successfully");
  }

  /// <summary>
  /// Side effects of a completed publish: sending the <c>deck.published</c> webhook deliveries (R18 J03,
  /// contract §6.1) that CompleteJobAsync staged in the SUCCESS transaction (the outbox), and the
  /// <c>publish_pipeline</c> ledger event (R18 J08, contract §9.3).
  /// Best-effort on its own connection, after the job row is already SUCCESS: nothing here may fail or
  /// retry a completed job. Idempotent, so a replay of the job's message may run it again.
  /// </summary>
  private static async Task AfterPublishSucceededAsync(JobInfo job)
  {
    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return;

      await WebhookEvents.SendStagedAsync(conn, JobRepository.PublishedEventId(job.JobId));

      // Automation Ledger (R18 J08, contract §9.3): one successful publish = one unit.
      await AutomationLedger.RecordAsync(conn, new AutomationEvent("publish_pipeline", 1, "success",
        DeckId: job.DeckId > 0 ? job.DeckId : null, Ref: job.JobId, DedupeKey: $"publish:{job.JobId}"));
    }
    catch (Exception ex)
    {
      Console.WriteLine($"[JobId={job.JobId}] After-publish side effects failed (ignored): {ex.Message}");
    }
  }

  public async Task FailAsync(string jobId, string errorMessage)
  {
    await _jobRepository.FailJobAsync(jobId, errorMessage);

    try
    {
      await RecordPublishFailureAsync(jobId, errorMessage);
    }
    catch (Exception ex)
    {
      Console.WriteLine($"[JobId={jobId}] Ledger failure event failed (ignored): {ex.Message}");
    }
  }

  /// <summary>
  /// The failure-side <c>publish_pipeline</c> ledger event (R18 J08, contract §9.3): units 0, so it saves
  /// nothing and counts toward the failure rate. Runs only after the FAILED status is persisted.
  /// </summary>
  private async Task RecordPublishFailureAsync(string jobId, string errorMessage)
  {
    var job = await _jobRepository.GetJobAsync(jobId);
    long? deckId = job is { DeckId: > 0 } ? job.DeckId : null;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return;

    var error = errorMessage.Length > 300 ? errorMessage[..300] : errorMessage;
    await AutomationLedger.RecordAsync(conn, new AutomationEvent("publish_pipeline", 0, "failure",
      DeckId: deckId, Ref: jobId, DedupeKey: $"publish-fail:{jobId}", Details: new { error }));
  }

  /// <summary>The <see cref="PublishSnapshot"/> digest of the cards this job is about to build.</summary>
  public static string SnapshotDigest(IEnumerable<CardExportData> cards) =>
    PublishSnapshot.Digest(cards.Select(c => new PublishSnapshotCard(c.StableUid, c.OrderInDeck, c.Difficulty, c.Question, c.Explanation,
      c.CodeLanguage, c.CodeSnippet, c.RealWorldUsage, c.Revision, c.Topic, c.Mcq?.GetRawText(), c.Source?.GetRawText(),
      c.Translations?.GetRawText(), c.FrontHelp?.GetRawText())));

  private static async Task ValidateReleaseJob(string jobId)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");
    try { await ContentReleaseFence.ValidateJob(conn, jobId); }
    catch (InvalidOperationException ex) { throw new BusinessException(ex.Message); }
  }

  public Task RecordAttemptErrorAsync(string jobId, string errorMessage) => _jobRepository.RecordAttemptErrorAsync(jobId, errorMessage);

  /// <summary>
  /// Whether the job carries the deck settings an automation publish checked (<c>deck_publishes.deck_updated_at</c>,
  /// migration 035) and the deck's <c>updated_at</c> is no longer that value. False for every other job, and before 035.
  /// </summary>
  public static async Task<bool> DeckSettingsChangedAsync(string jobId)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");
    try
    {
      var changed = await DbUtil.ExecuteScalarAsync(conn, null,
        """
        select d.updated_at is distinct from p.deck_updated_at
        from deck_publishes p join decks d on d.id = p.deck_id
        where p.job_id = $1 and p.deck_updated_at is not null
        """, [jobId]);
      return changed is true;
    }
    catch (PostgresException pg) when (pg.SqlState == "42703")
    {
      // Pre-035: no job records deck settings.
      return false;
    }
  }

  /// <summary>
  /// 从数据库加载卡组数据
  /// </summary>
  private async Task<DeckExportData> LoadDeckDataAsync(int deckId)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    // 查询 deck 信息
    const string deckSql = """
      SELECT 
        id,
        slug,
        title,
        locale,
        deck_type as "deckType",
        version,
        total_cards as "totalCards"
      FROM decks
      WHERE id = $1
      LIMIT 1
      """;

    var deckRows = await DbUtil.QueryAsync(conn, null, deckSql, [deckId]);
    if (deckRows.Count == 0)
    {
      throw new BusinessException($"Deck {deckId} not found");
    }

    var deck = deckRows[0];
    var deckType = Convert.ToInt32(deck["deckType"], CultureInfo.InvariantCulture);

    var cards = await LoadCardsAsync(conn, deckId);

    return new DeckExportData
    {
      Slug = Convert.ToString(deck["slug"], CultureInfo.InvariantCulture) ?? string.Empty,
      Title = Convert.ToString(deck["title"], CultureInfo.InvariantCulture) ?? string.Empty,
      Locale = Convert.ToString(deck.TryGetValue("locale", out var lo) ? lo : null, CultureInfo.InvariantCulture) ?? "en-US",
      DeckType = deckType,
      Version = Convert.ToString(deck.TryGetValue("version", out var ver) ? ver : null, CultureInfo.InvariantCulture) ?? "1",
      TotalCards = cards.Count,
      Cards = cards
    };
  }

  // Row-image access tolerates every additive content migration without hiding unrelated SQL errors.
  private const string CardsSqlTranslations = """
    select stable_uid as "stableUid", order_in_deck as "orderInDeck", difficulty, question, explanation,
      code_language as "codeLanguage", code_snippet as "codeSnippet", real_world_usage as "realWorldUsage", revision,
      to_jsonb(cards) ->> 'topic' as topic,
      nullif(to_jsonb(cards) -> 'mcq', 'null'::jsonb) as mcq,
      nullif(to_jsonb(cards) -> 'source', 'null'::jsonb) as source,
      nullif(to_jsonb(cards) -> 'translations', 'null'::jsonb) as translations,
      nullif(nullif(to_jsonb(cards) -> 'front_help', 'null'::jsonb), '[]'::jsonb) as "frontHelp"
    from cards where deck_id = $1 and is_deleted = 0 order by order_in_deck asc, id asc
    """;

  public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)
  {
    var cardRows = await DbUtil.QueryAsync(conn, null, CardsSqlTranslations, [deckId]);

    return cardRows.Select(c => new CardExportData
    {
      StableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty,
      OrderInDeck = Convert.ToInt32(c["orderInDeck"], CultureInfo.InvariantCulture),
      Difficulty = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture),
      Question = Convert.ToString(c["question"], CultureInfo.InvariantCulture) ?? string.Empty,
      Explanation = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture) ?? string.Empty,
      CodeLanguage = c.TryGetValue("codeLanguage", out var cl) ? Convert.ToString(cl, CultureInfo.InvariantCulture) : null,
      CodeSnippet = Convert.ToString(c.TryGetValue("codeSnippet", out var cs) ? cs : null, CultureInfo.InvariantCulture) ?? string.Empty,
      RealWorldUsage = Convert.ToString(c.TryGetValue("realWorldUsage", out var rw) ? rw : null, CultureInfo.InvariantCulture) ?? string.Empty,
      Revision = Convert.ToInt32(c.TryGetValue("revision", out var rv) ? (rv ?? 1) : 1, CultureInfo.InvariantCulture),
      Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,
      Mcq = c.TryGetValue("mcq", out var m) && m is string s ? JsonSerializer.Deserialize<JsonElement>(s) : (JsonElement?)null,
      Source = c.TryGetValue("source", out var so) && so is string ss ? JsonSerializer.Deserialize<JsonElement>(ss) : null,
      FrontHelp = c.TryGetValue("frontHelp", out var fh) && fh is string hs ? JsonSerializer.Deserialize<JsonElement>(hs) : null,
      Translations = c.TryGetValue("translations", out var tr) && tr is string ts ? JsonSerializer.Deserialize<JsonElement>(ts) : null,
    }).ToList();
  }
}
