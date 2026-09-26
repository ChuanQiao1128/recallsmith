using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Analytics;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Content Intelligence snapshot freshness and import cleanup (F11) against a real Postgres.
///
/// The freshness rule is a claim about a live planner: the default 30/90-day views serve the
/// snapshot only while its newest source_generated_at is within 48h, otherwise they fall through
/// to the live query. The import cleanup is a claim about a real transaction: after a run, the
/// windows in the file hold exactly the rows the file carried, and windows absent from the file
/// are untouched. Neither is decidable from the C# that builds the SQL.
///
/// The snapshot table is shared across the serial collection, so every seeded row gets a unique
/// deck_slug and reads filter by it. Import tests may delete other window-30/90 rows, which is
/// harmless here.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ContentIntelligenceFreshnessTests
{
  private readonly PostgresFixture _db;

  public ContentIntelligenceFreshnessTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSlug(string tag) => $"it-f11-{tag}-{Guid.NewGuid():N}";

  private static string NewUid() => $"uid-{Guid.NewGuid():N}";

  /// Seeds one snapshot row with every NOT NULL column, its source_generated_at set to
  /// <paramref name="hoursAgo"/> hours before the database clock.
  private async Task SeedSnapshotAsync(
    NpgsqlConnection conn, int windowDays, string deckSlug, string uid, int revision, int hoursAgo)
  {
    await DbUtil.ExecuteAsync(
      conn,
      null,
      """
      insert into content_intelligence_card_snapshot (
        window_days, deck_slug, card_stable_uid, card_revision, stated_difficulty,
        difficulty_calibration_status, content_quality_status, confidence_level,
        window_start_at, window_end_at, source_generated_at
      )
      values (
        $1, $2, $3, $4, 2,
        'Correctly Calibrated', 'Healthy', 'High',
        now() - make_interval(days => $1), now(), now() - make_interval(hours => $5)
      )
      """,
      [windowDays, deckSlug, uid, revision, hoursAgo]);
  }

  /// One JSON line in the snake_case shape of CardSnapshotRow, with ISO-8601 timestamps.
  private static string SnapshotJsonLine(
    int windowDays, string deckSlug, string uid, int revision, DateTimeOffset sourceGeneratedAt)
  {
    var src = sourceGeneratedAt.ToUniversalTime();
    var iso = src.ToString("O", CultureInfo.InvariantCulture);
    var windowStart = src.AddDays(-windowDays).ToString("O", CultureInfo.InvariantCulture);
    var windowEnd = iso;
    return $$"""
      {"window_days":{{windowDays}},"deck_slug":"{{deckSlug}}","card_stable_uid":"{{uid}}","card_revision":{{revision}},"stated_difficulty":2,"review_count":10,"unique_user_count":5,"difficulty_calibration_status":"Correctly Calibrated","content_quality_status":"Healthy","confidence_level":"High","fix_priority_score":1.5,"window_start_at":"{{windowStart}}","window_end_at":"{{windowEnd}}","source_generated_at":"{{iso}}"}
      """;
  }

  private static JsonElement Event(string sub, IDictionary<string, string> query)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/authoring/content-intelligence",
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = sub,
              ["cognito:groups"] = new[] { "super_admin" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = query,
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<JsonElement> GetAsync(string deckSlug)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["days"] = "30",
      ["deckSlug"] = deckSlug,
    };
    var req = new LambdaRequest(Event($"it-f11-super-{Guid.NewGuid():N}", query));
    var res = new Res(req.TraceId);
    var response = await ContentIntelligence.HandleContentIntelligence(req, res, await Auth.GetAuthContextAsync(req));
    Assert.True(response.StatusCode == 200, $"GET content-intelligence returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private async Task<int> CountBySlugAsync(NpgsqlConnection conn, string deckSlug)
  {
    var scalar = await DbUtil.ExecuteScalarAsync(
      conn, null, "select count(*) from content_intelligence_card_snapshot where deck_slug = $1", [deckSlug]);
    return Convert.ToInt32(scalar, CultureInfo.InvariantCulture);
  }

  private async Task<bool> ExistsAsync(NpgsqlConnection conn, string deckSlug, string uid)
  {
    var rows = await DbUtil.QueryAsync(
      conn,
      null,
      "select 1 from content_intelligence_card_snapshot where deck_slug = $1 and card_stable_uid = $2",
      [deckSlug, uid]);
    return rows.Count > 0;
  }

  // ------------------------------------------------------------------ tests

  [Fact]
  public async Task StaleSnapshot_FallsBackToLive()
  {
    var slug = NewSlug("stale");
    await using var conn = await _db.OpenAsync();
    await SeedSnapshotAsync(conn, 30, slug, NewUid(), 1, hoursAgo: 72);

    var data = await GetAsync(slug);

    Assert.Equal("live", data.GetProperty("source").GetString());
  }

  [Fact]
  public async Task FreshSnapshot_IsServed_WithItsSourceGeneratedAt()
  {
    var slug = NewSlug("fresh");
    var uid = NewUid();
    await using var conn = await _db.OpenAsync();
    await SeedSnapshotAsync(conn, 30, slug, uid, 1, hoursAgo: 1);

    // The exact timestamp the DB stored, so generatedAtMs can be checked precisely.
    var stored = await DbUtil.ExecuteScalarAsync(
      conn, null, "select source_generated_at from content_intelligence_card_snapshot where deck_slug = $1", [slug]);
    var expectedMs = new DateTimeOffset(DateTime.SpecifyKind((DateTime)stored!, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    var data = await GetAsync(slug);

    Assert.Equal("snapshot", data.GetProperty("source").GetString());
    Assert.InRange(data.GetProperty("generatedAtMs").GetInt64(), expectedMs - 1000, expectedMs + 1000);

    var cards = data.GetProperty("cards").EnumerateArray().ToList();
    Assert.Contains(cards, c => c.GetProperty("cardStableUid").GetString() == uid);
  }

  [Theory]
  [InlineData(null, false)]
  [InlineData(47.0, true)]
  [InlineData(48.0, true)]
  [InlineData(49.0, false)]
  public void IsSnapshotFresh_Boundary(double? hoursAgo, bool expected)
  {
    var now = DateTimeOffset.UtcNow;
    DateTimeOffset? src = hoursAgo is null ? null : now.AddHours(-hoursAgo.Value);
    Assert.Equal(expected, ContentIntelligence.IsSnapshotFresh(src, now));
  }

  [Fact]
  public async Task Import_DeletesRowsTheNewRunDidNotWrite()
  {
    var slug = NewSlug("del");
    var k1 = NewUid();
    var k2 = NewUid();
    await using var conn = await _db.OpenAsync();
    await SeedSnapshotAsync(conn, 30, slug, k1, 1, hoursAgo: 10);
    await SeedSnapshotAsync(conn, 30, slug, k2, 1, hoursAgo: 10);

    var line = SnapshotJsonLine(30, slug, k1, 1, DateTimeOffset.UtcNow);
    var result = await ContentIntelligenceSnapshotImport.ImportRowsAsync(conn, new StringReader(line));

    Assert.Equal(1, result.RowCount);
    Assert.True(result.DeletedCount >= 1, $"expected at least one deleted row, got {result.DeletedCount}");
    Assert.True(await ExistsAsync(conn, slug, k1), "K1 was written by the run and must remain");
    Assert.False(await ExistsAsync(conn, slug, k2), "K2 was not in the run and must be deleted");
  }

  [Fact]
  public async Task Import_OnlyTouchesTheWindowsInTheFile()
  {
    var slug90 = NewSlug("w90");
    var uid90 = NewUid();
    var slug30 = NewSlug("w30");
    await using var conn = await _db.OpenAsync();
    await SeedSnapshotAsync(conn, 90, slug90, uid90, 1, hoursAgo: 10);

    var line = SnapshotJsonLine(30, slug30, NewUid(), 1, DateTimeOffset.UtcNow);
    var result = await ContentIntelligenceSnapshotImport.ImportRowsAsync(conn, new StringReader(line));

    Assert.Equal(1, result.RowCount);
    Assert.True(await ExistsAsync(conn, slug90, uid90), "a window-90 row must survive a window-30-only import");
  }

  [Fact]
  public async Task Import_EmptyFile_DeletesNothing()
  {
    var slug = NewSlug("empty");
    await using var conn = await _db.OpenAsync();
    await SeedSnapshotAsync(conn, 30, slug, NewUid(), 1, hoursAgo: 10);

    var result = await ContentIntelligenceSnapshotImport.ImportRowsAsync(conn, new StringReader(""));

    Assert.Equal(0, result.RowCount);
    Assert.Equal(0, result.DeletedCount);
    Assert.Equal(1, await CountBySlugAsync(conn, slug));
  }

  [Fact]
  public async Task EventTimeIndex_Exists()
  {
    var scalar = await _db.ScalarAsync(
      "select count(*) from pg_indexes where tablename = 'user_progress_events' and indexname = 'idx_events_event_time'");
    Assert.Equal(1, Convert.ToInt32(scalar, CultureInfo.InvariantCulture));
  }
}
