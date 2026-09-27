using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// POST /api/v1/admin/automation/backfill (R18 J08, contract §9.5) against a real Postgres: the default dry
/// run writes nothing, a real run turns SUCCESS publishes and same-minute card bursts into
/// <c>source = 'backfill'</c> ledger rows under their dedupe keys, a second real run inserts nothing, and the
/// route is super_admin only. Each test seeds a fresh deck and asserts by its own dedupe keys.
/// </summary>
[Collection(PostgresCollection.Name)]
public class LedgerBackfillTests
{
  private readonly PostgresFixture _db;
  public LedgerBackfillTests(PostgresFixture db) => _db = db;

  private const string BackfillPath = "/api/v1/admin/automation/backfill";

  // ---------------------------------------------------------------- helpers

  private static JsonElement Event(string sub, string[] groups, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = BackfillPath,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = sub,
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static Task<APIGatewayProxyResponse> BackfillAsync(string? body, string[]? groups = null, string? sub = null) =>
    new RecallSmith.Lambda.VpcFunction().Handler(Event(sub ?? $"it-j08-bf-{Guid.NewGuid():N}", groups ?? ["super_admin"], body));

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static long Count(JsonElement data, string group, string automation) =>
    data.GetProperty(group).GetProperty(automation).GetInt64();

  private sealed record Seed(long DeckId, string PublishKey, string BurstKey, DateTimeOffset Minute);

  /// <summary>
  /// A fresh deck with one SUCCESS publish and a burst of <paramref name="burst"/> cards created in one minute
  /// (plus one card in the next minute, which never joins the burst).
  /// </summary>
  private async Task<Seed> SeedAsync(int burst = 6)
  {
    var slug = $"it-j08-bf-{Guid.NewGuid():N}";
    var deckRows = await _db.QueryAsync("insert into decks (slug, title, author) values ($1,$2,$3) returning id", slug, "deck j08 bf", "tests");
    var deckId = Convert.ToInt64(deckRows[0]["id"], CultureInfo.InvariantCulture);

    var buildId = $"b-j08-bf-{Guid.NewGuid():N}";
    await _db.ScalarAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, status, created_at) values ($1,$2,$3,$4,'SUCCESS',$5)",
      deckId, slug, buildId, $"content/{buildId}/deck.json", new DateTime(2005, 6, 7, 9, 0, 0, DateTimeKind.Utc));
    // A failed publish is never a candidate.
    await _db.ScalarAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, status) values ($1,$2,$3,$4,'FAILED')",
      deckId, slug, buildId + "-failed", $"content/{buildId}-failed/deck.json");

    var minute = new DateTimeOffset(2005, 6, 7, 8, 9, 0, TimeSpan.Zero);
    for (var i = 0; i < burst; i++)
    {
      await _db.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, order_in_deck, created_at) values ($1,$2,$3,$4,$5)",
        deckId, $"bf-{i}", $"q{i}", i + 1, minute.AddSeconds(i * 7).UtcDateTime);
    }
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, created_at) values ($1,$2,$3,$4,$5)",
      deckId, "bf-late", "late", burst + 1, minute.AddMinutes(1).UtcDateTime);

    var epochMinute = minute.ToUnixTimeSeconds() / 60;
    return new Seed(deckId, $"backfill:deck_publishes:{buildId}", $"backfill:cards:{deckId}:{epochMinute}", minute);
  }

  private Task<List<Dictionary<string, object?>>> RowsAsync(string dedupeKey) =>
    _db.QueryAsync(
      "select automation, occurred_at, units, outcome, deck_id, ref, source, details::text as details from automation_events where dedupe_key = $1",
      dedupeKey);

  private async Task<long> TotalEventsAsync() =>
    Convert.ToInt64(await _db.ScalarAsync("select count(*) from automation_events"), CultureInfo.InvariantCulture);

  // ---------------------------------------------------------------- tests

  [Fact]
  public async Task Backfill_DefaultIsDryRunAndWritesNothing()
  {
    var seed = await SeedAsync();
    var before = await TotalEventsAsync();

    foreach (var body in new[] { null, "", "{}", "{\"dryRun\":true}" })
    {
      var resp = await BackfillAsync(body);
      Assert.True(resp.StatusCode == 200, $"{body ?? "<none>"}: {resp.Body}");
      var data = Data(resp);
      Assert.Equal(new[] { "dryRun", "inserted", "skipped" }, data.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.True(data.GetProperty("dryRun").GetBoolean());
      Assert.True(Count(data, "inserted", "publish_pipeline") >= 1);
      Assert.True(Count(data, "inserted", "bulk_import") >= 1);
      Assert.True(Count(data, "skipped", "publish_pipeline") >= 0);
      Assert.True(Count(data, "skipped", "bulk_import") >= 0);
    }

    Assert.Equal(before, await TotalEventsAsync());
    Assert.Empty(await RowsAsync(seed.PublishKey));
    Assert.Empty(await RowsAsync(seed.BurstKey));

    // A non-boolean dryRun is refused.
    foreach (var bad in new[] { "{\"dryRun\":\"false\"}", "{\"dryRun\":0}", "{\"dryRun\":null}", "[]" })
    {
      var resp = await BackfillAsync(bad);
      Assert.True(resp.StatusCode == 400, $"{bad}: {resp.Body}");
    }
    Assert.Equal(before, await TotalEventsAsync());
  }

  [Fact]
  public async Task Backfill_InsertsPublishesAndImportBursts()
  {
    var seed = await SeedAsync();
    var small = await SeedAsync(burst: 4);

    var dry = Data(await BackfillAsync("{}"));
    var resp = await BackfillAsync("{\"dryRun\":false}");
    Assert.True(resp.StatusCode == 200, resp.Body);
    var data = Data(resp);
    Assert.False(data.GetProperty("dryRun").GetBoolean());
    // The real run inserts exactly what the dry run announced.
    Assert.Equal(Count(dry, "inserted", "publish_pipeline"), Count(data, "inserted", "publish_pipeline"));
    Assert.Equal(Count(dry, "inserted", "bulk_import"), Count(data, "inserted", "bulk_import"));
    Assert.Equal(Count(dry, "skipped", "publish_pipeline"), Count(data, "skipped", "publish_pipeline"));

    var publish = Assert.Single(await RowsAsync(seed.PublishKey));
    Assert.Equal("publish_pipeline", (string)publish["automation"]!);
    Assert.Equal("backfill", (string)publish["source"]!);
    Assert.Equal("success", (string)publish["outcome"]!);
    Assert.Equal(1, Convert.ToInt32(publish["units"], CultureInfo.InvariantCulture));
    Assert.Equal(seed.DeckId, Convert.ToInt64(publish["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(seed.PublishKey["backfill:deck_publishes:".Length..], (string)publish["ref"]!);
    Assert.Equal(new DateTime(2005, 6, 7, 9, 0, 0, DateTimeKind.Utc), ((DateTime)publish["occurred_at"]!).ToUniversalTime());

    var burst = Assert.Single(await RowsAsync(seed.BurstKey));
    Assert.Equal("bulk_import", (string)burst["automation"]!);
    Assert.Equal("backfill", (string)burst["source"]!);
    Assert.Equal(6, Convert.ToInt32(burst["units"], CultureInfo.InvariantCulture));
    Assert.Equal(seed.DeckId, Convert.ToInt64(burst["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(seed.Minute.UtcDateTime, ((DateTime)burst["occurred_at"]!).ToUniversalTime());
    using (var details = JsonDocument.Parse((string)burst["details"]!))
    {
      Assert.Equal("cards created in the same minute >= 5", details.RootElement.GetProperty("heuristic").GetString());
    }

    // Four cards in a minute is not a burst; the publish of that deck still counts.
    Assert.Empty(await RowsAsync(small.BurstKey));
    Assert.Single(await RowsAsync(small.PublishKey));

    // An audit row records the counts.
    var audit = await _db.QueryAsync(
      "select after_state::text as after from admin_audit where action = 'automation.backfill' and target = 'automation_events' order by id desc limit 1");
    using var after = JsonDocument.Parse((string)Assert.Single(audit)["after"]!);
    Assert.False(after.RootElement.GetProperty("dryRun").GetBoolean());
    Assert.Equal(Count(data, "inserted", "bulk_import"), after.RootElement.GetProperty("inserted").GetProperty("bulk_import").GetInt64());
  }

  [Fact]
  public async Task Backfill_IsIdempotent()
  {
    var seed = await SeedAsync();

    var first = await BackfillAsync("{\"dryRun\":false}");
    Assert.True(first.StatusCode == 200, first.Body);
    var firstData = Data(first);
    Assert.True(Count(firstData, "inserted", "publish_pipeline") >= 1);
    Assert.True(Count(firstData, "inserted", "bulk_import") >= 1);
    var total = await TotalEventsAsync();

    var second = Data(await BackfillAsync("{\"dryRun\":false}"));
    Assert.Equal(0, Count(second, "inserted", "publish_pipeline"));
    Assert.Equal(0, Count(second, "inserted", "bulk_import"));
    Assert.True(Count(second, "skipped", "publish_pipeline") >= 1);
    Assert.True(Count(second, "skipped", "bulk_import") >= 1);
    Assert.Equal(total, await TotalEventsAsync());

    var dry = Data(await BackfillAsync(null));
    Assert.Equal(0, Count(dry, "inserted", "publish_pipeline"));
    Assert.Equal(0, Count(dry, "inserted", "bulk_import"));

    Assert.Single(await RowsAsync(seed.PublishKey));
    Assert.Single(await RowsAsync(seed.BurstKey));
  }

  [Fact]
  public async Task Backfill_RequiresSuperAdmin()
  {
    var seed = await SeedAsync();
    var before = await TotalEventsAsync();

    foreach (var groups in new[] { new[] { "editor" }, Array.Empty<string>(), new[] { "premium" } })
    {
      var resp = await BackfillAsync("{\"dryRun\":false}", groups);
      Assert.True(resp.StatusCode == 403, $"[{string.Join(",", groups)}]: {resp.Body}");
    }

    Assert.Equal(before, await TotalEventsAsync());
    Assert.Empty(await RowsAsync(seed.PublishKey));
  }
}
