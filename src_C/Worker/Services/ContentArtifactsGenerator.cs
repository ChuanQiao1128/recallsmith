using System.Text;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// 内容分发 v3：为免费卡组的每次发布生成 chunked package、增量补丁，并记录内容元数据。
/// 所有步骤 best-effort —— migration 011 未执行（42P01/42703）或任何 S3/序列化失败
/// 只记日志并跳过，发布任务照常成功。
/// </summary>
public class ContentArtifactsGenerator : IContentArtifactsGenerator
{
  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
  }

  private static readonly string PremiumPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");

  private readonly IS3DeckUploader _s3Uploader;
  private readonly IContentArtifactsRepository _repository;

  public ContentArtifactsGenerator(IS3DeckUploader s3Uploader, IContentArtifactsRepository repository)
  {
    _s3Uploader = s3Uploader;
    _repository = repository;
  }

  public async Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload)
  {
    try
    {
      await GenerateCoreAsync(job, deckData, deckUpload);
    }
    catch (Exception ex)
    {
      // 兜底：任何未被内层捕获的异常也不能影响发布任务
      Console.WriteLine($"[JobId={job.JobId}] Content artifacts generation skipped (best-effort): {ex.Message}");
    }
  }

  private async Task GenerateCoreAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload)
  {
    var jobId = job.JobId;
    var s3Key = job.S3Key ?? string.Empty;
    var slashIdx = s3Key.IndexOf('/');
    var prefixSegment = slashIdx > 0 ? s3Key[..slashIdx] : string.Empty;

    // 付费卡组：package/patch 会落到公开 bucket 泄露内容，完全跳过
    if (string.Equals(prefixSegment, "premium", StringComparison.Ordinal)
      || string.Equals(prefixSegment, PremiumPrefix, StringComparison.Ordinal))
    {
      Console.WriteLine($"[JobId={jobId}] Premium deck, skipping content artifacts");
      return;
    }

    var relDeckPath = slashIdx > 0 ? s3Key[(slashIdx + 1)..] : string.Empty;
    var expectedRelDeckPath = $"decks/{job.DeckSlug}/builds/{job.BuildId}/deck.json";
    if (string.IsNullOrEmpty(prefixSegment)
      || string.IsNullOrEmpty(job.BuildId)
      || !string.Equals(relDeckPath, expectedRelDeckPath, StringComparison.Ordinal))
    {
      Console.WriteLine($"[JobId={jobId}] Unexpected s3Key layout '{s3Key}', skipping content artifacts");
      return;
    }

    var relBuildDir = $"decks/{job.DeckSlug}/builds/{job.BuildId}";

    // 1) chunked package（package.json + chunks/{seq}.json）
    string? packageRelPath = null;
    try
    {
      packageRelPath = await UploadChunkedPackageAsync(job, deckData, prefixSegment, relBuildDir);
    }
    catch (Exception ex)
    {
      Console.WriteLine($"[JobId={jobId}] Chunked package generation failed (non-fatal): {ex.Message}");
    }

    // 2) 相对上一次 SUCCESS 构建的增量补丁
    PatchArtifact? patch = null;
    try
    {
      patch = await GeneratePatchAsync(job, deckData, deckUpload, prefixSegment);
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Console.WriteLine($"[JobId={jobId}] Patch generation skipped (schema not ready, SqlState={pg.SqlState})");
    }
    catch (Exception ex)
    {
      Console.WriteLine($"[JobId={jobId}] Patch generation failed (non-fatal): {ex.Message}");
    }

    // 3) 记录 deck_publishes 内容元数据（migration 011 未执行时容忍缺列/缺表）
    try
    {
      await _repository.UpdateContentMetadataAsync(jobId, deckUpload.Sha256, deckUpload.Bytes, packageRelPath);
      Console.WriteLine($"[JobId={jobId}] Recorded content metadata (sha256={deckUpload.Sha256}, bytes={deckUpload.Bytes}, packageKey={packageRelPath ?? "null"})");
    }
    catch (PostgresException pg) when (pg.SqlState is "42703" or "42P01")
    {
      Console.WriteLine($"[JobId={jobId}] Content metadata not recorded (migration 011 not applied, SqlState={pg.SqlState})");
    }
    catch (Exception ex)
    {
      Console.WriteLine($"[JobId={jobId}] Content metadata update failed (non-fatal): {ex.Message}");
    }

    // 4) 记录补丁边（migration 011 未执行时容忍缺表）
    if (patch is not null)
    {
      try
      {
        await _repository.InsertBuildPatchAsync(
          job.DeckSlug, patch.FromBuildId, job.BuildId, patch.RelPath, patch.S3Key, patch.Sha256, patch.Bytes);
        Console.WriteLine($"[JobId={jobId}] Recorded patch edge {patch.FromBuildId} -> {job.BuildId}: {patch.RelPath}");
      }
      catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
      {
        Console.WriteLine($"[JobId={jobId}] Patch edge not recorded (migration 011 not applied, SqlState={pg.SqlState})");
      }
      catch (Exception ex)
      {
        Console.WriteLine($"[JobId={jobId}] Patch edge insert failed (non-fatal): {ex.Message}");
      }
    }
  }

  private async Task<string> UploadChunkedPackageAsync(
    JobInfo job,
    DeckExportData deckData,
    string prefixSegment,
    string relBuildDir)
  {
    var chunks = ChunkPlanner.Plan(deckData.Cards);
    var chunkRefs = new List<DeckPackageChunkModel>(chunks.Count);

    for (var seq = 0; seq < chunks.Count; seq++)
    {
      var chunkModel = new DeckChunkModel
      {
        SchemaVersion = 1,
        Slug = deckData.Slug,
        Version = job.BuildId,
        Seq = seq,
        Cards = chunks[seq],
      };

      var chunkJson = ContentJson.Serialize(chunkModel);
      var chunkRelPath = $"{relBuildDir}/chunks/{seq}.json";
      var uploaded = await _s3Uploader.UploadJsonAsync($"{prefixSegment}/{chunkRelPath}", chunkJson, S3DeckUploader.ImmutableCacheControl);

      chunkRefs.Add(new DeckPackageChunkModel
      {
        Seq = seq,
        Path = chunkRelPath,
        Bytes = uploaded.Bytes,
        Sha256 = uploaded.Sha256,
        CardCount = chunks[seq].Count,
      });
    }

    var package = new DeckPackageModel
    {
      SchemaVersion = 1,
      Slug = deckData.Slug,
      Version = job.BuildId,
      Deck = BuildDeckSummary(deckData, job.BuildId),
      TotalCards = deckData.Cards.Count,
      Chunks = chunkRefs,
    };

    var packageRelPath = $"{relBuildDir}/package.json";
    await _s3Uploader.UploadJsonAsync($"{prefixSegment}/{packageRelPath}", ContentJson.Serialize(package), S3DeckUploader.ImmutableCacheControl);

    Console.WriteLine($"[JobId={job.JobId}] Uploaded chunked package ({chunkRefs.Count} chunks): {packageRelPath}");
    return packageRelPath;
  }

  private async Task<PatchArtifact?> GeneratePatchAsync(
    JobInfo job,
    DeckExportData deckData,
    S3UploadResult deckUpload,
    string prefixSegment)
  {
    var jobId = job.JobId;

    var prev = await _repository.GetLatestSuccessBuildAsync(job.DeckSlug);
    if (prev is null || string.IsNullOrEmpty(prev.BuildId) || string.IsNullOrEmpty(prev.S3Key))
    {
      Console.WriteLine($"[JobId={jobId}] No previous SUCCESS build, skipping patch");
      return null;
    }

    if (string.Equals(prev.BuildId, job.BuildId, StringComparison.Ordinal))
    {
      Console.WriteLine($"[JobId={jobId}] Previous build equals current build, skipping patch");
      return null;
    }

    var prevJson = await _s3Uploader.DownloadJsonAsync(prev.S3Key);
    var prevDeck = JsonSerializer.Deserialize<PreviousDeckDocument>(prevJson, ContentJson.Options);
    var prevCards = MapPreviousCards(prevDeck);

    var diff = DeckDiff.Compute(prevCards, deckData.Cards);

    var delta = new DeckDeltaModel
    {
      SchemaVersion = 2,
      Slug = deckData.Slug,
      FromVersion = prev.BuildId,
      ToVersion = job.BuildId,
      GeneratedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      Deck = BuildDeckSummary(deckData, job.BuildId),
      Added = diff.Added,
      Updated = diff.Updated,
      Deleted = diff.Deleted,
    };

    var deltaJson = ContentJson.Serialize(delta);
    var deltaBytes = (long)Encoding.UTF8.GetByteCount(deltaJson);
    if (deltaBytes >= deckUpload.Bytes)
    {
      Console.WriteLine($"[JobId={jobId}] Patch ({deltaBytes} bytes) not smaller than full deck ({deckUpload.Bytes} bytes), skipping patch");
      return null;
    }

    var relPath = $"decks/{job.DeckSlug}/patches/{prev.BuildId}-{job.BuildId}.json";
    var s3Key = $"{prefixSegment}/{relPath}";
    var uploaded = await _s3Uploader.UploadJsonAsync(s3Key, deltaJson, S3DeckUploader.ImmutableCacheControl);

    Console.WriteLine($"[JobId={jobId}] Uploaded patch {prev.BuildId} -> {job.BuildId} (+{diff.Added.Count} ~{diff.Updated.Count} -{diff.Deleted.Count}, {uploaded.Bytes} bytes): {relPath}");

    return new PatchArtifact(prev.BuildId, relPath, s3Key, uploaded.Sha256, uploaded.Bytes);
  }

  private static DeckSummaryModel BuildDeckSummary(DeckExportData deckData, string buildId)
  {
    return new DeckSummaryModel
    {
      Slug = deckData.Slug,
      Title = deckData.Title,
      Locale = deckData.Locale,
      DeckType = deckData.DeckType,
      Version = buildId,
      TotalCards = deckData.Cards.Count,
    };
  }

  private static List<CardExportData> MapPreviousCards(PreviousDeckDocument? prevDeck)
  {
    var cards = new List<CardExportData>();
    if (prevDeck?.Cards is null) return cards;

    foreach (var c in prevDeck.Cards)
    {
      var uid = c?.StableUid?.Trim();
      if (c is null || string.IsNullOrEmpty(uid)) continue;

      // 默认值与 PublishJobProcessor.LoadDeckDataAsync 的导出规则保持一致
      cards.Add(new CardExportData
      {
        StableUid = uid,
        OrderInDeck = c.OrderInDeck ?? 0,
        Difficulty = c.Difficulty ?? 2,
        Question = c.Question ?? string.Empty,
        Explanation = c.Explanation ?? string.Empty,
        CodeLanguage = c.CodeLanguage,
        CodeSnippet = c.CodeSnippet ?? string.Empty,
        RealWorldUsage = c.RealWorldUsage ?? string.Empty,
        Revision = c.Revision ?? 1,
        Topic = c.Topic,
        Mcq = c.Mcq,
      });
    }

    return cards;
  }

  private sealed record PatchArtifact(string FromBuildId, string RelPath, string S3Key, string Sha256, long Bytes);

  /// <summary>
  /// 上一构建 deck.json 的宽容反序列化形状（旧管线可能有 null 字段/多余字段）
  /// </summary>
  private sealed class PreviousDeckDocument
  {
    public List<PreviousCardDocument?>? Cards { get; set; }
  }

  private sealed class PreviousCardDocument
  {
    public string? StableUid { get; set; }
    public int? OrderInDeck { get; set; }
    public int? Difficulty { get; set; }
    public string? Question { get; set; }
    public string? Explanation { get; set; }
    public string? CodeLanguage { get; set; }
    public string? CodeSnippet { get; set; }
    public string? RealWorldUsage { get; set; }
    public int? Revision { get; set; }
    public string? Topic { get; set; }
    public JsonElement? Mcq { get; set; }
  }
}
