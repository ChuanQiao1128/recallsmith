using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// 发布任务处理器
/// 执行 5-Step 流水线：抢占 -> 数据准备 -> S3上传 -> 完成
/// </summary>
public class PublishJobProcessor : IPublishJobProcessor
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

  public async Task ProcessAsync(string jobId, int receiveCount = 1)
  {
    // Step 2: 乐观锁抢占任务（receiveCount = SQS ApproximateReceiveCount）
    var acquired = await _jobRepository.TryAcquireJobAsync(jobId, receiveCount);
    if (!acquired)
    {
      // A redelivery lost the race. If the row is already SUCCESS or simply gone, this is a
      // duplicate delivery of a finished job — acknowledge it. Otherwise the row is PROCESSING
      // and not yet stale, so another container may still hold it: fail the item so SQS keeps it.
      var row = await _jobRepository.GetJobAsync(jobId);
      if (row is null || row.Status == "SUCCESS")
      {
        Console.WriteLine($"[JobId={jobId}] Job already completed or unknown; acknowledging replay");
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

    // Step 3: 业务数据准备
    var deckData = await LoadDeckDataAsync(job.DeckId);

    if (deckData.Cards.Count == 0)
    {
      throw new BusinessException("Deck has no cards");
    }

    Console.WriteLine($"[JobId={jobId}] Loaded {deckData.Cards.Count} cards");

    // 💡 契约修复：deck.json 的 version 必须等于本次构建的 buildId（字符串），
    // 与 manifest entry 的 version 保持一致 —— 客户端全量安装校验 deck.json.version === manifest version。
    if (!string.IsNullOrEmpty(job.BuildId))
    {
      deckData.Version = job.BuildId;
    }

    // Step 4: 外部系统调用 (S3)
    var uploadResult = await _s3Uploader.UploadAsync(job.S3Key, deckData);

    Console.WriteLine($"[JobId={jobId}] Uploaded to S3: {job.S3Key} (sha256={uploadResult.Sha256}, bytes={uploadResult.Bytes})");

    // Step 4.5: 内容分发 v3 附加产物（chunked package / delta patch / DB 元数据）
    // 完全 best-effort：生成器内部吞掉所有异常，绝不影响发布任务
    await _contentArtifacts.GenerateAsync(job, deckData, uploadResult);

    // Step 5: 最终一致性提交
    await _jobRepository.CompleteJobAsync(jobId);

    Console.WriteLine($"[JobId={jobId}] Job completed successfully");
  }

  public async Task FailAsync(string jobId, string errorMessage)
  {
    await _jobRepository.FailJobAsync(jobId, errorMessage);
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
      TotalCards = Convert.ToInt32(deck.TryGetValue("totalCards", out var tc) ? tc : cards.Count, CultureInfo.InvariantCulture),
      Cards = cards
    };
  }

  private const string CardsSql = """
    SELECT
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
    FROM cards
    WHERE deck_id = $1 AND is_deleted = 0
    ORDER BY order_in_deck ASC, id ASC
    """;

  private const string CardsSqlTopicOnly = """
    SELECT
      stable_uid as "stableUid",
      order_in_deck as "orderInDeck",
      difficulty,
      question,
      explanation,
      code_language as "codeLanguage",
      code_snippet as "codeSnippet",
      real_world_usage as "realWorldUsage",
      revision,
      topic
    FROM cards
    WHERE deck_id = $1 AND is_deleted = 0
    ORDER BY order_in_deck ASC, id ASC
    """;

  private const string CardsSqlLegacy = """
    SELECT
      stable_uid as "stableUid",
      order_in_deck as "orderInDeck",
      difficulty,
      question,
      explanation,
      code_language as "codeLanguage",
      code_snippet as "codeSnippet",
      real_world_usage as "realWorldUsage",
      revision
    FROM cards
    WHERE deck_id = $1 AND is_deleted = 0
    ORDER BY order_in_deck ASC, id ASC
    """;

  /// <summary>
  /// Cards of one deck in export order, tolerant of a database that has not yet run 018/019:
  /// the 11-column select runs first; a 42703 (undefined_column) retries the 018-only shape,
  /// a second 42703 the pre-018 shape. Each retry is a fresh statement on the same connection
  /// (no transaction, so the failed statement leaves it usable — the ManifestRebuild precedent).
  /// A column the schema lacks maps to null, never to "" (byte identity of existing decks).
  /// </summary>
  public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)
  {
    List<Dictionary<string, object?>> cardRows;
    try
    {
      cardRows = await DbUtil.QueryAsync(conn, null, CardsSql, [deckId]);
    }
    catch (PostgresException pg) when (pg.SqlState == "42703")
    {
      try
      {
        cardRows = await DbUtil.QueryAsync(conn, null, CardsSqlTopicOnly, [deckId]);
      }
      catch (PostgresException pg2) when (pg2.SqlState == "42703")
      {
        cardRows = await DbUtil.QueryAsync(conn, null, CardsSqlLegacy, [deckId]);
      }
    }

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
    }).ToList();
  }
}
