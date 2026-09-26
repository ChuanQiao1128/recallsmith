using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Analytics;

public static class ContentIntelligenceSnapshotImport
{
  private static AmazonS3Client? _s3;

  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  public static void Reset()
  {
    var s3 = _s3;
    _s3 = null;
    if (s3 is null) return;
    try { s3.Dispose(); } catch { /* best-effort */ }
  }

  private static string? NullIfBlank(string? value)
  {
    var s = value?.Trim();
    return string.IsNullOrEmpty(s) ? null : s;
  }

  private static string DefaultBucket()
  {
    return NullIfBlank(Environment.GetEnvironmentVariable("CI_SNAPSHOT_BUCKET")) ??
      NullIfBlank(Environment.GetEnvironmentVariable("ANALYTICS_S3_BUCKET")) ??
      NullIfBlank(Environment.GetEnvironmentVariable("CONTENT_BUCKET")) ??
      "core-vpc";
  }

  private static string DefaultKey()
  {
    return NullIfBlank(Environment.GetEnvironmentVariable("CI_SNAPSHOT_KEY")) ??
      "analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz";
  }

  private static string ResolveBucket(LambdaRequest req)
  {
    return NullIfBlank(req.Query.TryGetValue("bucket", out var raw) ? raw : null) ?? DefaultBucket();
  }

  private static string ResolveKey(LambdaRequest req)
  {
    return NullIfBlank(req.Query.TryGetValue("key", out var raw) ? raw : null) ?? DefaultKey();
  }

  private static async Task<long> CreateImportRunAsync(
    Npgsql.NpgsqlConnection conn,
    string bucket,
    string key,
    string? etag)
  {
    const string sql = """
      insert into content_intelligence_import_runs (
        s3_bucket,
        s3_key,
        s3_etag,
        status
      )
      values ($1, $2, $3, 'RUNNING')
      returning id;
      """;

    var result = await ExecuteScalarAsync(conn, null, sql, [bucket, key, etag]);
    return Convert.ToInt64(result, CultureInfo.InvariantCulture);
  }

  private static async Task CompleteImportRunAsync(
    Npgsql.NpgsqlConnection conn,
    long runId,
    string status,
    int rowCount,
    string? errorMessage)
  {
    const string sql = """
      update content_intelligence_import_runs
      set
        status = $2,
        row_count = $3,
        completed_at = now(),
        error_message = $4
      where id = $1;
      """;

    await ExecuteAsync(conn, null, sql, [runId, status, rowCount, errorMessage]);
  }

  private static async Task UpsertSnapshotRowAsync(
    Npgsql.NpgsqlConnection conn,
    Npgsql.NpgsqlTransaction tx,
    CardSnapshotRow row)
  {
    const string sql = """
      insert into content_intelligence_card_snapshot (
        window_days,
        deck_slug,
        card_stable_uid,
        card_revision,
        stated_difficulty,
        review_count,
        unique_user_count,
        observed_difficulty_raw,
        expected_difficulty,
        difficulty_gap,
        difficulty_gap_z,
        easy_rate,
        good_rate,
        hard_rate,
        again_rate,
        struggle_rate,
        failure_rate,
        repeat_failure_rate,
        median_dwell_time_ms,
        expected_dwell_time_ms,
        dwell_time_ratio,
        high_level_user_failure_rate,
        post_card_dropout_rate,
        review_count_to_mastery,
        difficulty_calibration_status,
        content_quality_status,
        confidence_level,
        fix_priority_score,
        window_start_at,
        window_end_at,
        source_generated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31
      )
      on conflict (
        window_days,
        deck_slug,
        card_stable_uid,
        card_revision
      )
      do update set
        stated_difficulty = excluded.stated_difficulty,
        review_count = excluded.review_count,
        unique_user_count = excluded.unique_user_count,
        observed_difficulty_raw = excluded.observed_difficulty_raw,
        expected_difficulty = excluded.expected_difficulty,
        difficulty_gap = excluded.difficulty_gap,
        difficulty_gap_z = excluded.difficulty_gap_z,
        easy_rate = excluded.easy_rate,
        good_rate = excluded.good_rate,
        hard_rate = excluded.hard_rate,
        again_rate = excluded.again_rate,
        struggle_rate = excluded.struggle_rate,
        failure_rate = excluded.failure_rate,
        repeat_failure_rate = excluded.repeat_failure_rate,
        median_dwell_time_ms = excluded.median_dwell_time_ms,
        expected_dwell_time_ms = excluded.expected_dwell_time_ms,
        dwell_time_ratio = excluded.dwell_time_ratio,
        high_level_user_failure_rate = excluded.high_level_user_failure_rate,
        post_card_dropout_rate = excluded.post_card_dropout_rate,
        review_count_to_mastery = excluded.review_count_to_mastery,
        difficulty_calibration_status = excluded.difficulty_calibration_status,
        content_quality_status = excluded.content_quality_status,
        confidence_level = excluded.confidence_level,
        fix_priority_score = excluded.fix_priority_score,
        window_start_at = excluded.window_start_at,
        window_end_at = excluded.window_end_at,
        source_generated_at = excluded.source_generated_at,
        imported_at = now()
      where excluded.source_generated_at >= content_intelligence_card_snapshot.source_generated_at;
      """;

    await ExecuteAsync(
      conn,
      tx,
      sql,
      [
        row.WindowDays,
        row.DeckSlug,
        row.CardStableUid,
        row.CardRevision,
        row.StatedDifficulty,
        row.ReviewCount,
        row.UniqueUserCount,
        row.ObservedDifficultyRaw,
        row.ExpectedDifficulty,
        row.DifficultyGap,
        row.DifficultyGapZ,
        row.EasyRate,
        row.GoodRate,
        row.HardRate,
        row.AgainRate,
        row.StruggleRate,
        row.FailureRate,
        row.RepeatFailureRate,
        row.MedianDwellTimeMs,
        row.ExpectedDwellTimeMs,
        row.DwellTimeRatio,
        row.HighLevelUserFailureRate,
        row.PostCardDropoutRate,
        row.ReviewCountToMastery,
        row.DifficultyCalibrationStatus,
        row.ContentQualityStatus,
        row.ConfidenceLevel,
        row.FixPriorityScore,
        ToPgTimestamp(row.WindowStartAt),
        ToPgTimestamp(row.WindowEndAt),
        ToPgTimestamp(row.SourceGeneratedAt),
      ]);
  }

  private static DateTime ToPgTimestamp(DateTimeOffset value)
  {
    return value.UtcDateTime;
  }

  internal sealed record SnapshotImportResult(int RowCount, int DeletedCount);

  /// <summary>
  /// Streams JSON lines from <paramref name="reader"/> into the snapshot table inside one transaction,
  /// then deletes the rows of the imported windows that this run did not write (a card that dropped out
  /// of a newer snapshot must leave the table). An empty file writes and deletes nothing.
  /// Any exception rolls the transaction back and rethrows.
  /// </summary>
  internal static async Task<SnapshotImportResult> ImportRowsAsync(Npgsql.NpgsqlConnection conn, TextReader reader)
  {
    var options = new JsonSerializerOptions
    {
      PropertyNameCaseInsensitive = true,
      Converters = { new FlexibleDateTimeOffsetConverter() },
    };

    await using var tx = await conn.BeginTransactionAsync();
    try
    {
      var rowCount = 0;
      var windows = new HashSet<int>();
      var keyWindows = new List<int>();
      var keyDecks = new List<string>();
      var keyUids = new List<string>();
      var keyRevisions = new List<int>();

      string? line;
      while ((line = await reader.ReadLineAsync()) is not null)
      {
        if (string.IsNullOrWhiteSpace(line)) continue;

        var row = JsonSerializer.Deserialize<CardSnapshotRow>(line, options);
        if (row is null) continue;

        await UpsertSnapshotRowAsync(conn, tx, row);
        rowCount++;
        windows.Add(row.WindowDays);
        keyWindows.Add(row.WindowDays);
        keyDecks.Add(row.DeckSlug);
        keyUids.Add(row.CardStableUid);
        keyRevisions.Add(row.CardRevision);
      }

      var deletedCount = 0;
      if (rowCount > 0)
      {
        const string deleteSql = """
          delete from content_intelligence_card_snapshot s
          where s.window_days = any($1::int[])
            and not exists (
              select 1 from unnest($2::int[], $3::text[], $4::text[], $5::int[]) as k(window_days, deck_slug, card_stable_uid, card_revision)
              where k.window_days = s.window_days and k.deck_slug = s.deck_slug
                and k.card_stable_uid = s.card_stable_uid and k.card_revision = s.card_revision)
          """;

        deletedCount = await ExecuteAsync(
          conn,
          tx,
          deleteSql,
          [
            windows.ToArray(),
            keyWindows.ToArray(),
            keyDecks.ToArray(),
            keyUids.ToArray(),
            keyRevisions.ToArray(),
          ]);
      }

      await tx.CommitAsync();
      return new SnapshotImportResult(rowCount, deletedCount);
    }
    catch
    {
      try { await tx.RollbackAsync(); } catch { /* ignore */ }
      throw;
    }
  }

  private static async Task<SnapshotImportResult> ImportSnapshotAsync(
    Npgsql.NpgsqlConnection conn,
    string bucket,
    string key)
  {
    using var response = await S3().GetObjectAsync(new GetObjectRequest
    {
      BucketName = bucket,
      Key = key,
    });

    Stream contentStream = response.ResponseStream;
    if (key.EndsWith(".gz", StringComparison.OrdinalIgnoreCase))
    {
      contentStream = new GZipStream(response.ResponseStream, CompressionMode.Decompress);
    }

    using var stream = contentStream;
    using var reader = new StreamReader(stream);
    return await ImportRowsAsync(conn, reader);
  }

  public static async Task<APIGatewayProxyResponse> HandleImportSnapshot(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (req.Method != "POST") return res.MethodNotAllowed();

    var bucket = ResolveBucket(req);
    var key = ResolveKey(req);

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
    }

    long runId = 0;
    try
    {
      string? etag = null;
      try
      {
        var meta = await S3().GetObjectMetadataAsync(new GetObjectMetadataRequest
        {
          BucketName = bucket,
          Key = key,
        });
        etag = meta.ETag;
      }
      catch
      {
        // Best-effort metadata fetch. Import can still proceed.
      }

      runId = await CreateImportRunAsync(conn, bucket, key, etag);
      var result = await ImportSnapshotAsync(conn, bucket, key);
      await CompleteImportRunAsync(conn, runId, "SUCCEEDED", result.RowCount, null);

      return res.Ok(new
      {
        ok = true,
        bucket,
        key,
        rowCount = result.RowCount,
        deletedCount = result.DeletedCount,
        runId,
      });
    }
    catch (Exception ex)
    {
      if (runId > 0)
      {
        try { await CompleteImportRunAsync(conn, runId, "FAILED", 0, ex.Message); } catch { /* ignore */ }
      }

      Log.Error("Content intelligence snapshot import failed:", ex);
      return res.BadRequest(
        "IMPORT_FAILED",
        $"Import failed for s3://{bucket}/{key}: {ex.GetType().Name}: {ex.Message}");
    }
  }

  private sealed record CardSnapshotRow
  {
    [JsonPropertyName("window_days")]
    public int WindowDays { get; init; }

    [JsonPropertyName("window_start_at")]
    public DateTimeOffset WindowStartAt { get; init; }

    [JsonPropertyName("window_end_at")]
    public DateTimeOffset WindowEndAt { get; init; }

    [JsonPropertyName("deck_slug")]
    public string DeckSlug { get; init; } = string.Empty;

    [JsonPropertyName("card_stable_uid")]
    public string CardStableUid { get; init; } = string.Empty;

    [JsonPropertyName("card_revision")]
    public int CardRevision { get; init; }

    [JsonPropertyName("stated_difficulty")]
    public int StatedDifficulty { get; init; }

    [JsonPropertyName("review_count")]
    public int ReviewCount { get; init; }

    [JsonPropertyName("unique_user_count")]
    public int UniqueUserCount { get; init; }

    [JsonPropertyName("observed_difficulty_raw")]
    public decimal? ObservedDifficultyRaw { get; init; }

    [JsonPropertyName("expected_difficulty")]
    public decimal? ExpectedDifficulty { get; init; }

    [JsonPropertyName("difficulty_gap")]
    public decimal? DifficultyGap { get; init; }

    [JsonPropertyName("difficulty_gap_z")]
    public decimal? DifficultyGapZ { get; init; }

    [JsonPropertyName("easy_rate")]
    public decimal? EasyRate { get; init; }

    [JsonPropertyName("good_rate")]
    public decimal? GoodRate { get; init; }

    [JsonPropertyName("hard_rate")]
    public decimal? HardRate { get; init; }

    [JsonPropertyName("again_rate")]
    public decimal? AgainRate { get; init; }

    [JsonPropertyName("struggle_rate")]
    public decimal? StruggleRate { get; init; }

    [JsonPropertyName("failure_rate")]
    public decimal? FailureRate { get; init; }

    [JsonPropertyName("repeat_failure_rate")]
    public decimal? RepeatFailureRate { get; init; }

    [JsonPropertyName("median_dwell_time_ms")]
    public decimal? MedianDwellTimeMs { get; init; }

    [JsonPropertyName("expected_dwell_time_ms")]
    public decimal? ExpectedDwellTimeMs { get; init; }

    [JsonPropertyName("dwell_time_ratio")]
    public decimal? DwellTimeRatio { get; init; }

    [JsonPropertyName("high_level_user_failure_rate")]
    public decimal? HighLevelUserFailureRate { get; init; }

    [JsonPropertyName("post_card_dropout_rate")]
    public decimal? PostCardDropoutRate { get; init; }

    [JsonPropertyName("review_count_to_mastery")]
    public decimal? ReviewCountToMastery { get; init; }

    [JsonPropertyName("difficulty_calibration_status")]
    public string DifficultyCalibrationStatus { get; init; } = string.Empty;

    [JsonPropertyName("content_quality_status")]
    public string ContentQualityStatus { get; init; } = string.Empty;

    [JsonPropertyName("confidence_level")]
    public string ConfidenceLevel { get; init; } = string.Empty;

    [JsonPropertyName("fix_priority_score")]
    public decimal FixPriorityScore { get; init; }

    [JsonPropertyName("source_generated_at")]
    public DateTimeOffset SourceGeneratedAt { get; init; }
  }

  private sealed class FlexibleDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
  {
    private static readonly string[] Formats =
    [
      "O",
      "yyyy-MM-dd HH:mm:ss.FFFFFFF zzz",
      "yyyy-MM-dd HH:mm:ss.FFFFFFFK",
      "yyyy-MM-dd HH:mm:ss zzz",
      "yyyy-MM-dd HH:mm:ssK",
      "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK",
      "yyyy-MM-dd'T'HH:mm:ssK",
      "yyyy-MM-dd HH:mm:ss.FFFFFFF",
      "yyyy-MM-dd HH:mm:ss",
      "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF",
      "yyyy-MM-dd'T'HH:mm:ss",
    ];

    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
      if (reader.TokenType == JsonTokenType.String)
      {
        var raw = reader.GetString();
        if (string.IsNullOrWhiteSpace(raw))
        {
          throw new JsonException("Expected non-empty datetime string.");
        }

        if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
        {
          return dto;
        }

        if (DateTimeOffset.TryParseExact(raw, Formats, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out dto))
        {
          return dto;
        }

        // Snowflake can emit offsets like +0000; normalize to +00:00 for stricter parsers.
        if (raw.Length > 5 &&
            (raw[^5] == '+' || raw[^5] == '-') &&
            char.IsDigit(raw[^4]) &&
            char.IsDigit(raw[^3]) &&
            char.IsDigit(raw[^2]) &&
            char.IsDigit(raw[^1]))
        {
          var normalized = raw[..^2] + ":" + raw[^2..];
          if (DateTimeOffset.TryParse(normalized, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out dto))
          {
            return dto;
          }
        }

        throw new JsonException($"Unsupported datetime value: {raw}");
      }

      if (reader.TokenType == JsonTokenType.Number)
      {
        if (reader.TryGetInt64(out var asLong))
        {
          // Heuristic: Snowflake exports may be epoch seconds, ms, or us depending on query shaping.
          if (asLong > 100_000_000_000_000)
          {
            return DateTimeOffset.FromUnixTimeMilliseconds(asLong / 1000);
          }
          if (asLong > 100_000_000_000)
          {
            return DateTimeOffset.FromUnixTimeMilliseconds(asLong);
          }
          return DateTimeOffset.FromUnixTimeSeconds(asLong);
        }

        if (reader.TryGetDouble(out var asDouble))
        {
          var millis = Convert.ToInt64(asDouble, CultureInfo.InvariantCulture);
          return millis > 100_000_000_000
            ? DateTimeOffset.FromUnixTimeMilliseconds(millis)
            : DateTimeOffset.FromUnixTimeSeconds(millis);
        }
      }

      throw new JsonException($"Unsupported token {reader.TokenType} for DateTimeOffset.");
    }

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
    {
      writer.WriteStringValue(value.ToString("O", CultureInfo.InvariantCulture));
    }
  }
}
