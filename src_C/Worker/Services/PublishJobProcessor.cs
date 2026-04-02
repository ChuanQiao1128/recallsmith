using System.Globalization;
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

  public PublishJobProcessor(
    IJobRepository jobRepository,
    IS3DeckUploader s3Uploader)
  {
    _jobRepository = jobRepository;
    _s3Uploader = s3Uploader;
  }

  public async Task ProcessAsync(string jobId)
  {
    // Step 2: 乐观锁抢占任务
    var acquired = await _jobRepository.TryAcquireJobAsync(jobId);
    if (!acquired)
    {
      // 任务已被其他 Worker 抢走或已处理，优雅退出
      Console.WriteLine($"[JobId={jobId}] Job already processed or acquired by another worker");
      return;
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

    // Step 4: 外部系统调用 (S3)
    await _s3Uploader.UploadAsync(job.S3Key, deckData);

    Console.WriteLine($"[JobId={jobId}] Uploaded to S3: {job.S3Key}");

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

    // 查询 cards
    const string cardsSql = """
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

    var cardRows = await DbUtil.QueryAsync(conn, null, cardsSql, [deckId]);

    var cards = cardRows.Select(c => new CardExportData
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
    }).ToList();

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
}
