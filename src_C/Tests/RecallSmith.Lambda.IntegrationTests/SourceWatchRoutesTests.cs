using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Shared fixtures of the R18A A05 test classes (SourceWatchRoutesTests, WatchAdminRoutesTests, SourceRecheckTests), on
/// top of <see cref="A04Kit"/>: the source-watch secret set to the fake <c>test-secret</c> and restored in
/// <c>finally</c>, a scratch database migrated to the latest version (the targets route syncs every card source URL
/// of the database and selects due targets globally), signed watcher calls and the literal A00 §10.4–§10.5 bodies.
/// Card text is plainly synthetic; no page is fetched.
/// </summary>
internal static class A05Kit
{
  public const string TargetsPath = "/api/internal/source-watch/targets";
  public const string ReportPath = "/api/internal/source-watch/report";
  public const string SourceWatchSecret = "INTERNAL_SECRET_SOURCE_WATCH";

  // A00 §10.4, verbatim request; the response with the first alternative of each value.
  public const string ContractTargetsRequestJson = """{ "v": 1, "watchRunId": "uuid", "max": 1 }""";
  public const string ContractTargetsResponseJson = """
    { "mode": "dry_run", "effectiveMode": "dry_run", "targets": [ { "targetId": 1, "kind": "feed", "url": "https://…", "feedFormat": "rss",
      "etag": null, "lastModified": null, "contentSha256": null, "normalizer": null, "quotes": [ { "cardId": 1, "quote": "…" } ] } ] }
    """;

  // A00 §10.5, verbatim with the first alternative of each value; TARGET_ID and SHA are filled in per test.
  public const string ContractReportJson = """
    { "v": 1, "watchRunId": "WATCH_RUN_ID", "observations": [ {
        "targetId": TARGET_ID, "url": "https://docs.example.com/a05/contract", "status": "ok",
        "httpStatus": 200, "contentSha256": "SHA", "normalizer": "v1", "etag": "\"abc\"", "lastModified": null,
        "bytes": 12345, "fetchedAt": "2026-10-01T03:04:05.678Z", "latencyMs": 812,
        "errorCode": null,
        "missingQuoteCardIds": [101],
        "feedItems": [ { "url": "https://docs.example.com/a05/item", "title": "Synthetic item", "publishedAt": null } ] } ] }
    """;

  public const string ContractReportResponseJson = """{ "watchRunId": "uuid", "applied": 1, "changed": 0, "queued": 0, "rechecks": 0 }""";

  // A00 §13 source.changed data.
  public const string ContractSourceChangedJson = """
    { "targetId": 1, "url": "https://…", "change": "changed", "citingCards": 1, "missingQuoteCardIds": [], "recheck": { "state": "started", "runIds": [] },
      "queueItemIds": [], "mode": "dry_run", "consoleUrl": "https://console.example.com/automation?tab=watch&targetId=1" }
    """;

  /// <summary>The A04 scope plus the source-watch secret (<c>test-secret</c>), restored in <c>finally</c>.</summary>
  public static async Task WithScopeAsync(Func<A04Kit.Scope, Task> body, string mode = AutomationMode.DryRun)
  {
    var saved = Environment.GetEnvironmentVariable(SourceWatchSecret);
    var savedPrevious = Environment.GetEnvironmentVariable(SourceWatchSecret + "_PREVIOUS");
    try
    {
      await using var scope = new A04Kit.Scope(mode);
      Environment.SetEnvironmentVariable("INTERNAL_SECRET_SOURCE_WATCH", "test-secret");
      Environment.SetEnvironmentVariable("INTERNAL_SECRET_SOURCE_WATCH_PREVIOUS", null);
      await body(scope);
    }
    finally
    {
      Environment.SetEnvironmentVariable(SourceWatchSecret, saved);
      Environment.SetEnvironmentVariable(SourceWatchSecret + "_PREVIOUS", savedPrevious);
    }
  }

  /// <summary>Runs <paramref name="body"/> with the handlers pointed at a fresh scratch database migrated to <paramref name="maxVersion"/>.</summary>
  public static async Task InScratchAsync(PostgresFixture db, string name, Func<A04Kit.Sql, Task> body, int maxVersion = int.MaxValue)
  {
    var connectionString = new NpgsqlConnectionStringBuilder(await db.CreateScratchDatabaseAsync(name)) { Pooling = false }.ConnectionString;
    await using (var conn = new NpgsqlConnection(connectionString))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion);
    }
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body(new A04Kit.Sql(connectionString));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  public static Task<APIGatewayProxyResponse> TargetsAsync(object body, string secret = A04Kit.FakeSecret, string method = "POST")
  {
    var req = A04Kit.SignedRequest(TargetsPath, body, secret, method);
    return SourceWatchRoutes.HandleTargets(req, new Res(req.TraceId));
  }

  public static Task<APIGatewayProxyResponse> ReportAsync(object body, string secret = A04Kit.FakeSecret, string method = "POST")
  {
    var req = A04Kit.SignedRequest(ReportPath, body, secret, method);
    return SourceWatchRoutes.HandleReport(req, new Res(req.TraceId));
  }

  public static async Task<JsonElement> TargetsDataAsync(int max = 100) =>
    AutomationTestKit.Data(await TargetsAsync(new { v = 1, watchRunId = Guid.NewGuid(), max }));

  public static async Task<JsonElement> ReportDataAsync(params Dictionary<string, object?>[] observations) =>
    AutomationTestKit.Data(await ReportAsync(new { v = 1, watchRunId = Guid.NewGuid(), observations }));

  public static string Sha(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

  /// <summary>One observation with every §10.5 key.</summary>
  public static Dictionary<string, object?> Obs(long targetId, string url, string status, string? sha = null, object[]? feedItems = null,
    long[]? missingQuoteCardIds = null, string? errorCode = null, int? httpStatus = null, string? normalizer = "v1") =>
    new(StringComparer.Ordinal)
    {
      ["targetId"] = targetId,
      ["url"] = url,
      ["status"] = status,
      ["httpStatus"] = httpStatus ?? status switch { "ok" => 200, "not_modified" => 304, "gone" => 404, "failed" => 503, _ => 200 },
      ["contentSha256"] = sha,
      ["normalizer"] = status == "ok" ? normalizer : null,
      ["etag"] = null,
      ["lastModified"] = null,
      ["bytes"] = status == "ok" ? 1024 : null,
      ["fetchedAt"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture),
      ["latencyMs"] = 12,
      ["errorCode"] = errorCode ?? (status == "failed" ? "HTTP_5XX" : null),
      ["missingQuoteCardIds"] = missingQuoteCardIds ?? [],
      ["feedItems"] = feedItems ?? [],
    };

  public static object Item(string url, string? title) => new { url, title, publishedAt = (string?)null };

  public static async Task<long> DeckAsync(A04Kit.Sql sql, string tag) =>
    A04Kit.Long(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, 'deck a05', 'tests') returning id", $"it-a05-{tag}-{Guid.NewGuid():N}"[..40]));

  public static async Task<long> CardAsync(A04Kit.Sql sql, long deckId, string? url, string? quote = "Synthetic quote.", int isDeleted = 0)
  {
    var source = url is null ? null : JsonSerializer.Serialize(new { url, quote });
    return A04Kit.Long(await sql.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, is_deleted, source) " +
      "values ($1, $2, 'Synthetic question about a watched page?', 'Synthetic explanation.', 2, " +
      "(select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1), $3, $4::jsonb) returning id",
      deckId, $"a05-{Guid.NewGuid():N}"[..30], isDeleted, source));
  }

  public static async Task<long> FeedAsync(A04Kit.Sql sql, string url, long? deckId, string format = "rss", string? pattern = null) =>
    A04Kit.Long(await sql.ScalarAsync(
      "insert into source_watch_targets (kind, url, feed_format, deck_id, item_title_pattern, active, check_interval_minutes, created_by) " +
      "values ('feed', $1, $2, $3::bigint, $4::text, true, 360, 'it-a05') returning id", url, format, deckId, pattern));

  public static async Task<long> PageAsync(A04Kit.Sql sql, string url) =>
    A04Kit.Long(await sql.ScalarAsync(
      "insert into source_watch_targets (kind, url, active, check_interval_minutes, created_by) values ('page', $1, true, 10080, 'cards') returning id", url));

  public static async Task<Dictionary<string, object?>> TargetAsync(A04Kit.Sql sql, long id) =>
    (await sql.QueryAsync("select * from source_watch_targets where id = $1", id)).Single();

  public static Task<List<Dictionary<string, object?>>> EventsAsync(A04Kit.Sql sql, long targetId) =>
    sql.QueryAsync("select id, kind, old_sha256, new_sha256, details::text as details, recheck_state, recheck_run_ids, notification_id " +
                   "from source_watch_events where target_id = $1 order by id", targetId);

  public static JsonElement Json(object? text)
  {
    using var doc = JsonDocument.Parse((string)text!);
    return doc.RootElement.Clone();
  }

  public static string[] Keys(JsonElement el) => el.EnumerateObject().Select(p => p.Name).ToArray();
}

/// <summary>
/// The source watch routes (R18A A05, contract A00 §10.4–§10.5) through the handlers, signed exactly as the watcher
/// signs (the fake <c>test-secret</c>), against a scratch database migrated to the latest version. QA, webhook and
/// notifier sends are captured through the test seams; core never fetches a page.
/// </summary>
[Collection(PostgresCollection.Name)]
public class SourceWatchRoutesTests
{
  private const string Scratch = "it_a05_watch";
  private readonly PostgresFixture _db;

  public SourceWatchRoutesTests(PostgresFixture db) => _db = db;

  private Task InScratchAsync(Func<A04Kit.Sql, Task> body) => A05Kit.InScratchAsync(_db, Scratch, body);

  private static string Url(string tag) => $"https://docs.example.com/a05/{tag}/{Guid.NewGuid():N}";

  // ---------------------------------------------------------------- targets: auth and body

  [Fact]
  public async Task Targets_BadSignature_Returns403()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      var response = await A05Kit.TargetsAsync(new { v = 1, watchRunId = Guid.NewGuid(), max = 10 }, secret: "not-the-secret");
      Assert.Equal(403, response.StatusCode);
      Assert.Contains("Internal auth failed", response.Body);
      Assert.Equal(403, (await A05Kit.ReportAsync(new { v = 1, watchRunId = Guid.NewGuid(), observations = Array.Empty<object>() }, secret: "not-the-secret")).StatusCode);

      Assert.Equal(405, (await A05Kit.TargetsAsync(new { v = 1, watchRunId = Guid.NewGuid(), max = 10 }, method: "GET")).StatusCode);
      Assert.Equal(405, (await A05Kit.ReportAsync(new { v = 1, watchRunId = Guid.NewGuid(), observations = Array.Empty<object>() }, method: "GET")).StatusCode);
    });
  }

  [Fact]
  public async Task Targets_RouteSecretUnset_Returns403()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      // INTERNAL_SHARED_SECRET is "test-secret" in the scope; the watcher routes never fall back to it.
      Environment.SetEnvironmentVariable(A05Kit.SourceWatchSecret, null);
      Assert.Equal("test-secret", Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET"));
      var response = await A05Kit.TargetsAsync(new { v = 1, watchRunId = Guid.NewGuid(), max = 10 });
      Assert.Equal(403, response.StatusCode);
      Assert.Contains("Missing INTERNAL_SECRET_SOURCE_WATCH", response.Body);
      var report = await A05Kit.ReportAsync(new { v = 1, watchRunId = Guid.NewGuid(), observations = Array.Empty<object>() });
      Assert.Equal(403, report.StatusCode);
      Assert.Contains("Missing INTERNAL_SECRET_SOURCE_WATCH", report.Body);
    });
  }

  [Fact]
  public async Task Targets_InvalidBody_Returns400ValidationError()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      object[] bodies =
      [
        new { v = 2, watchRunId = Guid.NewGuid(), max = 10 },
        new { watchRunId = Guid.NewGuid(), max = 10 },
        new { v = 1, watchRunId = "not-a-uuid", max = 10 },
        new { v = 1, max = 10 },
        new { v = 1, watchRunId = Guid.NewGuid(), max = 0 },
        new { v = 1, watchRunId = Guid.NewGuid(), max = 101 },
        new { v = 1, watchRunId = Guid.NewGuid() },
        "[1,2]",
      ];
      foreach (var body in bodies) AutomationTestKit.AssertError(await A05Kit.TargetsAsync(body), 400, "VALIDATION_ERROR");
      Assert.Equal(400, (await A05Kit.TargetsAsync("{not json")).StatusCode);
    });
  }

  // ---------------------------------------------------------------- targets: sync and lease

  [Fact]
  public async Task Targets_ModeOff_ReturnsNoTargets()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "off");
        await A05Kit.CardAsync(sql, deckId, Url("off"));
        await A05Kit.FeedAsync(sql, Url("off-feed"), deckId);

        var data = await A05Kit.TargetsDataAsync();
        Assert.Equal(["mode", "effectiveMode", "targets"], A05Kit.Keys(data));
        Assert.Equal(("off", "off"), (data.GetProperty("mode").GetString(), data.GetProperty("effectiveMode").GetString()));
        Assert.Empty(data.GetProperty("targets").EnumerateArray());
        Assert.Equal(0, await sql.CountAsync("select count(*) from source_watch_targets where kind = 'page'"));
        Assert.Equal(0, await sql.CountAsync("select count(*) from source_watch_targets where leased_until is not null"));

        // The report is a no-op in off too.
        var feedId = A04Kit.Long(await sql.ScalarAsync("select id from source_watch_targets where created_by = 'it-a05'"));
        var report = await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, "https://docs.example.com/x", "ok", A05Kit.Sha("off")));
        Assert.Equal(0, report.GetProperty("applied").GetInt32());
        Assert.Equal(0, await sql.CountAsync("select count(*) from source_watch_events"));
        Assert.Equal(0, await sql.CountAsync("select count(*) from automation_events where automation = 'source_watch'"));
      });
    }, AutomationMode.Off);
  }

  [Fact]
  public async Task Targets_SyncsPageTargetsFromLiveCards()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "sync");
        var live = Url("live");
        var deleted = Url("deleted");
        var plain = $"http://docs.example.com/a05/plain/{Guid.NewGuid():N}";
        var tooLong = "https://docs.example.com/" + new string('a', 2048);
        await A05Kit.CardAsync(sql, deckId, live);
        await A05Kit.CardAsync(sql, deckId, live, "Another synthetic quote.");
        await A05Kit.CardAsync(sql, deckId, deleted, isDeleted: 1);
        await A05Kit.CardAsync(sql, deckId, plain);
        await A05Kit.CardAsync(sql, deckId, tooLong);
        await A05Kit.CardAsync(sql, deckId, null);

        var data = await A05Kit.TargetsDataAsync();

        var pages = await sql.QueryAsync("select url, active, check_interval_minutes, created_by, feed_format from source_watch_targets where kind = 'page'");
        var page = Assert.Single(pages);
        Assert.Equal(live, page["url"]);
        Assert.Equal((true, 10080, "cards"), ((bool)page["active"]!, Convert.ToInt32(page["check_interval_minutes"], CultureInfo.InvariantCulture), (string)page["created_by"]!));
        Assert.Null(page["feed_format"]);

        var target = Assert.Single(data.GetProperty("targets").EnumerateArray());
        using var contract = JsonDocument.Parse(A05Kit.ContractTargetsResponseJson);
        Assert.Equal(A05Kit.Keys(contract.RootElement), A05Kit.Keys(data));
        Assert.Equal(A05Kit.Keys(contract.RootElement.GetProperty("targets")[0]), A05Kit.Keys(target));
        Assert.Equal(("page", live), (target.GetProperty("kind").GetString(), target.GetProperty("url").GetString()));
        Assert.Equal(JsonValueKind.Null, target.GetProperty("feedFormat").ValueKind);
        Assert.Equal(2, target.GetProperty("quotes").GetArrayLength());

        // A second call inserts nothing new (on conflict do nothing).
        await sql.QueryAsync("update source_watch_targets set leased_until = null");
        await A05Kit.TargetsDataAsync();
        Assert.Equal(1, await sql.CountAsync("select count(*) from source_watch_targets where kind = 'page'"));
      });
    });
  }

  [Fact]
  public async Task Targets_LeasesDueTargets_WithQuotes()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "lease");
        var pageUrl = Url("page");
        var first = await A05Kit.CardAsync(sql, deckId, pageUrl, "First synthetic quote.");
        var second = await A05Kit.CardAsync(sql, deckId, pageUrl, "Second synthetic quote.");
        await A05Kit.CardAsync(sql, deckId, pageUrl, null);
        var feedUrl = Url("feed");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId, "atom");
        var recent = await A05Kit.FeedAsync(sql, Url("recent"), deckId);
        await sql.QueryAsync("update source_watch_targets set last_checked_at = now() - interval '5 minutes' where id = $1", recent);
        var inactive = await A05Kit.FeedAsync(sql, Url("inactive"), deckId);
        await sql.QueryAsync("update source_watch_targets set active = false where id = $1", inactive);
        var broken = await A05Kit.FeedAsync(sql, Url("broken"), deckId);
        await sql.QueryAsync("update source_watch_targets set consecutive_failures = 10 where id = $1", broken);
        // A page no live card cites any more is never due.
        var orphan = await A05Kit.PageAsync(sql, Url("orphan"));

        var data = await A05Kit.TargetsDataAsync();
        var targets = data.GetProperty("targets").EnumerateArray().ToList();
        Assert.Equal(2, targets.Count);
        var page = targets.Single(t => t.GetProperty("kind").GetString() == "page");
        var feed = targets.Single(t => t.GetProperty("kind").GetString() == "feed");
        Assert.Equal(feedId, feed.GetProperty("targetId").GetInt64());
        Assert.Equal("atom", feed.GetProperty("feedFormat").GetString());
        Assert.Empty(feed.GetProperty("quotes").EnumerateArray());
        Assert.Equal(pageUrl, page.GetProperty("url").GetString());
        var quotes = page.GetProperty("quotes").EnumerateArray().ToList();
        Assert.Equal([first, second], quotes.Select(q => q.GetProperty("cardId").GetInt64()).ToArray());
        Assert.Equal("First synthetic quote.", quotes[0].GetProperty("quote").GetString());
        Assert.DoesNotContain(targets, t => t.GetProperty("targetId").GetInt64() == orphan);

        var lease = (await sql.QueryAsync(
          "select leased_until > now() + interval '14 minutes' and leased_until <= now() + interval '15 minutes' as ok from source_watch_targets where id = $1",
          feedId)).Single();
        Assert.Equal(true, lease["ok"]);

        // Leased: a second call within 15 minutes returns neither.
        Assert.Empty((await A05Kit.TargetsDataAsync()).GetProperty("targets").EnumerateArray());

        // An expired lease makes them due again, and max is honoured.
        await sql.QueryAsync("update source_watch_targets set leased_until = now() - interval '1 minute'");
        Assert.Single((await A05Kit.TargetsDataAsync(max: 1)).GetProperty("targets").EnumerateArray());
      });
    });
  }

  // ---------------------------------------------------------------- report

  [Fact]
  public async Task Report_ContractBody_IsAccepted()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "contract");
        var feedId = await A05Kit.FeedAsync(sql, "https://docs.example.com/a05/contract", deckId);
        var watchRunId = Guid.NewGuid();
        var body = A05Kit.ContractReportJson.Replace("WATCH_RUN_ID", watchRunId.ToString("D"), StringComparison.Ordinal)
          .Replace("TARGET_ID", feedId.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
          .Replace("\"SHA\"", $"\"{A05Kit.Sha("contract")}\"", StringComparison.Ordinal);

        var data = AutomationTestKit.Data(await A05Kit.ReportAsync(body));

        using var contract = JsonDocument.Parse(A05Kit.ContractReportResponseJson);
        Assert.Equal(A05Kit.Keys(contract.RootElement), A05Kit.Keys(data));
        Assert.Equal(watchRunId, data.GetProperty("watchRunId").GetGuid());
        Assert.Equal(1, data.GetProperty("applied").GetInt32());
        var target = await A05Kit.TargetAsync(sql, feedId);
        Assert.Equal(("baseline", A05Kit.Sha("contract"), "v1", "\"abc\"", 200),
          ((string)target["last_status"]!, (string)target["content_sha256"]!, (string)target["normalizer"]!, (string)target["etag"]!,
            Convert.ToInt32(target["last_http_status"], CultureInfo.InvariantCulture)));
        Assert.Equal(new DateTime(2026, 10, 1, 3, 4, 5, 678, DateTimeKind.Utc), ((DateTime)target["last_checked_at"]!).ToUniversalTime());
        Assert.Null(target["leased_until"]);
      });
    });
  }

  [Fact]
  public async Task Report_FirstObservation_IsBaseline_AndQueuesNothing()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "baseline");
        var feedUrl = Url("feed");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId);
        var pageUrl = Url("page");
        await A05Kit.CardAsync(sql, deckId, pageUrl);
        var pageId = await A05Kit.PageAsync(sql, pageUrl);
        object[] items = [A05Kit.Item(Url("i1"), "Item one"), A05Kit.Item(Url("i2"), "Item two"), A05Kit.Item(Url("i3"), "Item three")];

        var data = await A05Kit.ReportDataAsync(
          A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("feed-1"), feedItems: items),
          A05Kit.Obs(pageId, pageUrl, "ok", A05Kit.Sha("page-1")));

        Assert.Equal((2, 0, 0, 0), (data.GetProperty("applied").GetInt32(), data.GetProperty("changed").GetInt32(),
          data.GetProperty("queued").GetInt32(), data.GetProperty("rechecks").GetInt32()));
        Assert.Equal("baseline", (await A05Kit.TargetAsync(sql, feedId))["last_status"]);
        Assert.Equal("baseline", (await A05Kit.TargetAsync(sql, pageId))["last_status"]);
        Assert.Equal(["baseline"], (await A05Kit.EventsAsync(sql, feedId)).Select(e => (string)e["kind"]!).ToArray());
        Assert.Equal(["baseline"], (await A05Kit.EventsAsync(sql, pageId)).Select(e => (string)e["kind"]!).ToArray());
        Assert.Equal(3, await sql.CountAsync("select count(*) from source_watch_feed_items where target_id = $1 and queue_item_id is null", feedId));
        Assert.Equal(0, await sql.CountAsync("select count(*) from authoring_queue_items"));
        Assert.Empty(scope.QaSent);

        // A stored hash of another normaliser re-baselines instead of reporting a change.
        await sql.QueryAsync("update source_watch_targets set normalizer = 'v0' where id = $1", pageId);
        var again = await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, pageUrl, "ok", A05Kit.Sha("page-2")));
        Assert.Equal(0, again.GetProperty("changed").GetInt32());
        Assert.Equal(("baseline", A05Kit.Sha("page-2")), ((string)(await A05Kit.TargetAsync(sql, pageId))["last_status"]!,
          (string)(await A05Kit.TargetAsync(sql, pageId))["content_sha256"]!));
        Assert.Equal(0, await sql.CountAsync("select count(*) from authoring_queue_items"));
      });
    });
  }

  [Fact]
  public async Task Report_FeedChange_QueuesOnlyNewMatchingItems()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "feed");
        // The seeded AWS pattern of migration 034 (A00 §7 part 11).
        var pattern = (string)(await sql.ScalarAsync(
          "select item_title_pattern from source_watch_targets where url = 'https://aws.amazon.com/about-aws/whats-new/recent/feed/'"))!;
        var feedUrl = Url("aws");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId, "rss", pattern);
        var old = Url("s3");
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("f1"), feedItems: [A05Kit.Item(old, "Amazon S3 now supports X")]));

        var lambda = Url("lambda");
        var bedrock = Url("bedrock");
        var data = await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("f2"), feedItems:
        [
          A05Kit.Item(old, "Amazon S3 now supports X"),
          A05Kit.Item(lambda, "AWS Lambda adds Y"),
          A05Kit.Item(bedrock, "Amazon Bedrock adds Z"),
          A05Kit.Item($"http://docs.example.com/a05/plain/{Guid.NewGuid():N}", "AWS Lambda over plain http"),
          A05Kit.Item("https://docs.example.com/" + new string('b', 2048), "AWS Lambda with a long url"),
        ]));

        Assert.Equal((1, 1), (data.GetProperty("changed").GetInt32(), data.GetProperty("queued").GetInt32()));
        var target = await A05Kit.TargetAsync(sql, feedId);
        Assert.Equal("changed", target["last_status"]);
        Assert.NotNull(target["last_changed_at"]);
        var events = await A05Kit.EventsAsync(sql, feedId);
        Assert.Equal(["baseline", "feed_items"], events.Select(e => (string)e["kind"]!).ToArray());

        var item = (await sql.QueryAsync("select * from authoring_queue_items")).Single();
        var key = A05Kit.Sha(lambda);
        Assert.Equal(("feed_item", lambda, deckId, "AWS Lambda adds Y", $"feed_item:{feedId}:{key}", "watcher"),
          ((string)item["kind"]!, (string)item["url"]!, A04Kit.Long(item["deck_id"]), (string)item["title"]!, (string)item["dedupe_key"]!, (string)item["created_by"]!));
        Assert.Null(item["section_hint"]);
        Assert.Equal((feedId, A04Kit.Long(events[1]["id"])), (A04Kit.Long(item["source_target_id"]), A04Kit.Long(item["source_event_id"])));
        var feedRows = await sql.QueryAsync("select item_key, matched, queue_item_id from source_watch_feed_items where target_id = $1", feedId);
        Assert.Equal(3, feedRows.Count);
        Assert.Equal(A04Kit.Long(item["id"]), A04Kit.Long(feedRows.Single(r => (string)r["item_key"]! == key)["queue_item_id"]));
        Assert.Equal(false, feedRows.Single(r => (string)r["item_key"]! == A05Kit.Sha(bedrock))["matched"]);
        Assert.Equal([A04Kit.Long(item["id"])], A05Kit.Json(events[1]["details"]).GetProperty("queueItemIds").EnumerateArray().Select(i => i.GetInt64()).ToArray());

        // The same report again queues nothing; an unchanged feed still processes a new item (without an event).
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("f2"), feedItems: [A05Kit.Item(lambda, "AWS Lambda adds Y")]));
        Assert.Equal(1, await sql.CountAsync("select count(*) from authoring_queue_items"));
        var ec2 = Url("ec2");
        var unchanged = await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("f2"), feedItems: [A05Kit.Item(ec2, "Amazon EC2 C8g instances")]));
        Assert.Equal((0, 1), (unchanged.GetProperty("changed").GetInt32(), unchanged.GetProperty("queued").GetInt32()));
        Assert.Equal("unchanged", (await A05Kit.TargetAsync(sql, feedId))["last_status"]);
        Assert.Null((await sql.QueryAsync("select source_event_id from authoring_queue_items where url = $1", ec2)).Single()["source_event_id"]);
        Assert.Equal(2, (await A05Kit.EventsAsync(sql, feedId)).Count);
      });
    });
  }

  [Fact]
  public async Task Report_HtmlHeadingsFeed_QueuesAnchorItemsWithSectionHint()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "headings");
        var pageUrl = Url("release-notes");
        var feedId = await A05Kit.FeedAsync(sql, pageUrl, deckId, "html-headings");
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, pageUrl, "ok", A05Kit.Sha("h1"), feedItems: [A05Kit.Item($"{pageUrl}#september-2026", "September 2026")]));

        var data = await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, pageUrl, "ok", A05Kit.Sha("h2"), feedItems:
        [
          A05Kit.Item($"{pageUrl}#september-2026", "September 2026"),
          A05Kit.Item($"{pageUrl}#october-2026", "October 2026"),
        ]));

        Assert.Equal(1, data.GetProperty("queued").GetInt32());
        var item = (await sql.QueryAsync("select * from authoring_queue_items")).Single();
        Assert.Equal(($"{pageUrl}#october-2026", "October 2026", "October 2026", $"feed_item:{feedId}:{A05Kit.Sha($"{pageUrl}#october-2026")}"),
          ((string)item["url"]!, (string)item["title"]!, (string)item["section_hint"]!, (string)item["dedupe_key"]!));
      });
    });
  }

  /// <summary>A page cited by two decks (two cards in deck A, one in deck B), already baselined.</summary>
  private static async Task<(long PageId, string Url, long DeckA, long DeckB, long[] CardsA, long CardB)> CitedPageAsync(A04Kit.Sql sql, string tag)
  {
    var deckA = await A05Kit.DeckAsync(sql, $"{tag}-a");
    var deckB = await A05Kit.DeckAsync(sql, $"{tag}-b");
    var url = Url(tag);
    var a1 = await A05Kit.CardAsync(sql, deckA, url, "Synthetic quote a1.");
    var a2 = await A05Kit.CardAsync(sql, deckA, url, "Synthetic quote a2.");
    var b1 = await A05Kit.CardAsync(sql, deckB, url, "Synthetic quote b1.");
    var target = (await A05Kit.TargetsDataAsync()).GetProperty("targets").EnumerateArray().Single(t => t.GetProperty("url").GetString() == url);
    var pageId = target.GetProperty("targetId").GetInt64();
    await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "ok", A05Kit.Sha($"{tag}-v1")));
    return (pageId, url, deckA, deckB, [a1, a2], b1);
  }

  [Fact]
  public async Task Report_PageChanged_StartsRecheckAndQueuesItem()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      await InScratchAsync(async sql =>
      {
        var page = await CitedPageAsync(sql, "changed");
        var before = await sql.QueryAsync("select id, question, updated_at, is_deleted from cards order by id");
        var newSha = A05Kit.Sha("changed-v2");

        var data = await A05Kit.ReportDataAsync(A05Kit.Obs(page.PageId, page.Url, "ok", newSha, missingQuoteCardIds: [page.CardsA[0]]));

        Assert.Equal((1, 1, 2, 2), (data.GetProperty("applied").GetInt32(), data.GetProperty("changed").GetInt32(),
          data.GetProperty("queued").GetInt32(), data.GetProperty("rechecks").GetInt32()));

        // One automation-profile re-check per deck over exactly the citing cards (scope cards).
        Assert.Equal(2, scope.QaSent.Count);
        foreach (var sent in scope.QaSent)
        {
          Assert.Contains($"\"promptVersion\":\"{RecallSmith.Lambda.Vpc.Qa.QaRuns.AutomationPromptVersion}\",\"profile\":\"automation\",\"deck\"", sent.MessageBody);
        }
        var runs = await sql.QueryAsync("select id, deck_id, scope, requested_by_sub, card_count from ai_qa_runs order by deck_id");
        Assert.Equal([(page.DeckA, "cards", "automation", 2), (page.DeckB, "cards", "automation", 1)],
          runs.Select(r => (A04Kit.Long(r["deck_id"]), (string)r["scope"]!, (string)r["requested_by_sub"]!, Convert.ToInt32(r["card_count"], CultureInfo.InvariantCulture))).ToArray());
        var messageA = JsonDocument.Parse(scope.QaSent.Single(m => m.MessageBody.Contains($"\"id\":{page.DeckA},", StringComparison.Ordinal)).MessageBody).RootElement;
        Assert.Equal(page.CardsA, messageA.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("cardId").GetInt64()).Order().ToArray());

        var ev = (await A05Kit.EventsAsync(sql, page.PageId)).Last();
        Assert.Equal(("changed", A05Kit.Sha("changed-v1"), newSha, "started"), ((string)ev["kind"]!, (string)ev["old_sha256"]!, (string)ev["new_sha256"]!, (string)ev["recheck_state"]!));
        Assert.Equal(runs.Select(r => (Guid)r["id"]!).Order().ToArray(), ((Guid[])ev["recheck_run_ids"]!).Order().ToArray());
        var details = A05Kit.Json(ev["details"]);
        Assert.Equal(3, details.GetProperty("citingCards").GetInt32());
        Assert.Equal(2, details.GetProperty("byDeck").GetProperty(page.DeckA.ToString(CultureInfo.InvariantCulture)).GetInt32());
        Assert.Equal(1, details.GetProperty("byDeck").GetProperty(page.DeckB.ToString(CultureInfo.InvariantCulture)).GetInt32());
        Assert.Equal([page.CardsA[0]], details.GetProperty("missingQuoteCardIds").EnumerateArray().Select(i => i.GetInt64()).ToArray());
        Assert.Empty(details.GetProperty("recheckPendingDeckIds").EnumerateArray());

        var items = await sql.QueryAsync("select * from authoring_queue_items order by deck_id");
        Assert.Equal(2, items.Count);
        Assert.Equal(items.Select(i => A04Kit.Long(i["id"])).Order().ToArray(),
          details.GetProperty("queueItemIds").EnumerateArray().Select(i => i.GetInt64()).Order().ToArray());
        Assert.All(items, i => Assert.Equal(("source_changed", page.Url, "Source changed", "watcher", A04Kit.Long(ev["id"])),
          ((string)i["kind"]!, (string)i["url"]!, (string)i["title"]!, (string)i["created_by"]!, A04Kit.Long(i["source_event_id"]))));
        Assert.Equal($"source_changed:{page.PageId}:{newSha}:{page.DeckA}", items[0]["dedupe_key"]);
        Assert.Equal(("missing quotes: 1", "missing quotes: 0"), ((string)items[0]["note"]!, (string)items[1]["note"]!));

        // Decision 2: the existing cards are untouched.
        var after = await sql.QueryAsync("select id, question, updated_at, is_deleted from cards order by id");
        Assert.Equal(before.Select(r => (A04Kit.Long(r["id"]), r["question"], r["updated_at"], r["is_deleted"])),
          after.Select(r => (A04Kit.Long(r["id"]), r["question"], r["updated_at"], r["is_deleted"])));
      });
    });
  }

  [Fact]
  public async Task Report_PageGone_RaisesSourceGoneOnce()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      await InScratchAsync(async sql =>
      {
        var page = await CitedPageAsync(sql, "gone");

        var data = await A05Kit.ReportDataAsync(A05Kit.Obs(page.PageId, page.Url, "gone"));
        await A05Kit.ReportDataAsync(A05Kit.Obs(page.PageId, page.Url, "gone"));

        Assert.Equal(2, data.GetProperty("queued").GetInt32());
        Assert.Equal("gone", (await A05Kit.TargetAsync(sql, page.PageId))["last_status"]);
        var gone = (await A05Kit.EventsAsync(sql, page.PageId)).Where(e => (string)e["kind"]! == "gone").ToList();
        var ev = Assert.Single(gone);
        Assert.Null(ev["new_sha256"]);
        Assert.Equal(2, await sql.CountAsync("select count(*) from authoring_queue_items where dedupe_key like $1", $"source_changed:{page.PageId}:gone:%"));

        var eventId = A04Kit.Long(ev["id"]);
        var notes = await sql.QueryAsync("select kind, subkind, dedupe_key from automation_notifications where subkind = 'source_gone'");
        var note = Assert.Single(notes);
        Assert.Equal($"exception:source_gone:{page.PageId}:{eventId}", note["dedupe_key"]);
        Assert.Single(A04Kit.Messages(scope, "Cited source gone"));

        // The url answering again ends the episode: the next gone is a new event.
        await A05Kit.ReportDataAsync(A05Kit.Obs(page.PageId, page.Url, "not_modified"));
        await A05Kit.ReportDataAsync(A05Kit.Obs(page.PageId, page.Url, "gone"));
        Assert.Equal(2, (await A05Kit.EventsAsync(sql, page.PageId)).Count(e => (string)e["kind"]! == "gone"));
      });
    });
  }

  [Fact]
  public async Task Report_ThirdFailure_RaisesWatchFailing()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "failing");
        var feedUrl = Url("failing");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId);

        for (var i = 0; i < 4; i++) await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "failed", errorCode: "TIMEOUT", httpStatus: null));

        var target = await A05Kit.TargetAsync(sql, feedId);
        Assert.Equal(("failed", 4), ((string)target["last_status"]!, Convert.ToInt32(target["consecutive_failures"], CultureInfo.InvariantCulture)));
        var ev = Assert.Single(await A05Kit.EventsAsync(sql, feedId));
        Assert.Equal("failing", ev["kind"]);
        var note = (await sql.QueryAsync("select notification_id, dedupe_key from automation_notifications where subkind = 'watch_failing'")).Single();
        Assert.Equal($"exception:watch_failing:{feedId}:{A04Kit.Long(ev["id"])}", note["dedupe_key"]);
        Assert.Equal(note["notification_id"], ev["notification_id"]);
        Assert.Single(A04Kit.Messages(scope, "Source watch failing"));
      });
    });
  }

  [Fact]
  public async Task Report_SuccessAfterFailing_RecordsRecovered()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "recovered");
        var feedUrl = Url("recovered");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId);
        for (var i = 0; i < 3; i++) await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "failed"));

        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "not_modified"));
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "not_modified"));

        var target = await A05Kit.TargetAsync(sql, feedId);
        Assert.Equal(("not_modified", 0), ((string)target["last_status"]!, Convert.ToInt32(target["consecutive_failures"], CultureInfo.InvariantCulture)));
        Assert.Equal(["failing", "recovered"], (await A05Kit.EventsAsync(sql, feedId)).Select(e => (string)e["kind"]!).ToArray());

        // Fewer than three failures is not an episode: nothing is recorded on success.
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "failed"));
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "robots_disallowed"));
        Assert.Equal(2, (await A05Kit.EventsAsync(sql, feedId)).Count);
        Assert.Equal("robots_disallowed", (await A05Kit.TargetAsync(sql, feedId))["last_status"]);
      });
    });
  }

  [Fact]
  public async Task Report_UnknownTarget_IsIgnored()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "unknown");
        var feedUrl = Url("known");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId);

        var data = await A05Kit.ReportDataAsync(
          A05Kit.Obs(987654321, Url("unknown"), "ok", A05Kit.Sha("u")),
          A05Kit.Obs(feedId, feedUrl, "unsupported"));

        Assert.Equal(1, data.GetProperty("applied").GetInt32());
        Assert.Equal("unsupported", (await A05Kit.TargetAsync(sql, feedId))["last_status"]);
        Assert.Equal(["unsupported"], (await A05Kit.EventsAsync(sql, feedId)).Select(e => (string)e["kind"]!).ToArray());
        Assert.Equal(0, await sql.CountAsync("select count(*) from source_watch_events where target_id = 987654321"));

        var only = await A05Kit.ReportDataAsync(A05Kit.Obs(987654321, Url("unknown"), "failed"));
        Assert.Equal(0, only.GetProperty("applied").GetInt32());

        // unsupported is recorded once per episode.
        await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "unsupported"));
        Assert.Single(await A05Kit.EventsAsync(sql, feedId));
      });
    });
  }

  [Fact]
  public async Task Report_InvalidBody_Returns400ValidationError()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      Dictionary<string, object?> With(string key, object? value)
      {
        var o = A05Kit.Obs(1, "https://docs.example.com/a05/x", "ok", A05Kit.Sha("x"));
        o[key] = value;
        return o;
      }
      Dictionary<string, object?> Without(string key)
      {
        var o = A05Kit.Obs(1, "https://docs.example.com/a05/x", "ok", A05Kit.Sha("x"));
        o.Remove(key);
        return o;
      }
      object Report(params object[] observations) => new { v = 1, watchRunId = Guid.NewGuid(), observations };

      object[] bodies =
      [
        new { v = 2, watchRunId = Guid.NewGuid(), observations = Array.Empty<object>() },
        new { v = 1, watchRunId = "nope", observations = Array.Empty<object>() },
        new { v = 1, watchRunId = Guid.NewGuid() },
        new { v = 1, watchRunId = Guid.NewGuid(), observations = Enumerable.Range(1, 101).Select(i => A05Kit.Obs(i, "https://docs.example.com/a05/x", "not_modified")).ToArray() },
        Report(With("contentSha256", null)),
        Report(With("contentSha256", A05Kit.Sha("x").ToUpperInvariant())),
        Report(With("contentSha256", "abc")),
        Report(With("status", "changed")),
        Report(With("errorCode", "SOMETHING")),
        Report(With("targetId", "1")),
        Report(With("bytes", -1)),
        Report(With("latencyMs", -5)),
        Report(With("fetchedAt", "yesterday")),
        Report(Without("fetchedAt")),
        Report(Without("url")),
        Report(With("missingQuoteCardIds", new[] { "a" })),
        Report(With("feedItems", Enumerable.Range(0, 201).Select(i => A05Kit.Item($"https://docs.example.com/{i}", "t")).ToArray())),
        Report(With("feedItems", new[] { new { title = "no url" } })),
        Report("not an object"),
        "[]",
      ];
      foreach (var body in bodies) AutomationTestKit.AssertError(await A05Kit.ReportAsync(body), 400, "VALIDATION_ERROR");
    });
  }

  [Fact]
  public async Task Report_RecordsSourceWatchLedgerRow()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "ledger");
        var urls = new[] { Url("l1"), Url("l2"), Url("l3") };
        var ids = new List<long>();
        foreach (var u in urls) ids.Add(await A05Kit.FeedAsync(sql, u, deckId));

        var watchRunId = Guid.NewGuid();
        object body = new
        {
          v = 1,
          watchRunId,
          observations = new[]
          {
            A05Kit.Obs(ids[2], urls[2], "failed"),
            A05Kit.Obs(ids[0], urls[0], "ok", A05Kit.Sha("l")),
            A05Kit.Obs(ids[1], urls[1], "not_modified"),
          },
        };
        AutomationTestKit.Data(await A05Kit.ReportAsync(body));
        AutomationTestKit.Data(await A05Kit.ReportAsync(body));

        var digest = A05Kit.Sha(string.Join(",", ids.Order().Select(i => i.ToString(CultureInfo.InvariantCulture))))[..16];
        var row = (await sql.QueryAsync("select * from automation_events where automation = 'source_watch'")).Single();
        // R18B automation-9: a baseline and a 304 are routine checks, not detections: 0 units, 2 checks in the details.
        Assert.Equal(($"watch:{watchRunId:D}:{digest}", 0, "partial", "live"),
          ((string)row["dedupe_key"]!, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture), (string)row["outcome"]!, (string)row["source"]!));
        var details = A05Kit.Json(await sql.ScalarAsync("select details::text from automation_events where automation = 'source_watch'"));
        Assert.Equal((0, 0, 1, 0, 2), (details.GetProperty("changed").GetInt32(), details.GetProperty("gone").GetInt32(),
          details.GetProperty("failed").GetInt32(), details.GetProperty("feedItemsQueued").GetInt32(), details.GetProperty("checks").GetInt32()));

        await A05Kit.ReportDataAsync(A05Kit.Obs(ids[0], urls[0], "failed"), A05Kit.Obs(ids[1], urls[1], "failed"));
        await A05Kit.ReportDataAsync(A05Kit.Obs(ids[0], urls[0], "ok", A05Kit.Sha("l")));
        var outcomes = (await sql.QueryAsync("select outcome, units from automation_events where automation = 'source_watch' order by id"))
          .Select(r => ((string)r["outcome"]!, Convert.ToInt32(r["units"], CultureInfo.InvariantCulture))).ToArray();
        Assert.Equal([("partial", 0), ("failure", 0), ("success", 0)], outcomes);
      });
    });
  }

  [Fact]
  public async Task Report_LedgerCreditsDetectionsOnly()
  {
    // R18B automation-9: only a changed or gone cited page and a queued feed item replace work a person did.
    await A05Kit.WithScopeAsync(async _ =>
    {
      await InScratchAsync(async sql =>
      {
        async Task<(int Units, int Checks)> LedgerAsync(Guid watchRunId)
        {
          var row = (await sql.QueryAsync("select units, details::text as details from automation_events where automation = 'source_watch' and ref = $1",
            watchRunId.ToString("D"))).Single();
          return (Convert.ToInt32(row["units"], CultureInfo.InvariantCulture), A05Kit.Json(row["details"]).GetProperty("checks").GetInt32());
        }
        async Task<Guid> ReportAsync(params Dictionary<string, object?>[] observations)
        {
          var id = Guid.NewGuid();
          AutomationTestKit.Data(await A05Kit.ReportAsync(new { v = 1, watchRunId = id, observations }));
          return id;
        }

        var changed = await CitedPageAsync(sql, "credit-changed");
        var gone = await CitedPageAsync(sql, "credit-gone");
        var quiet = await CitedPageAsync(sql, "credit-quiet");

        // Routine checks of unchanged pages: nothing credited.
        var routine = await ReportAsync(A05Kit.Obs(quiet.PageId, quiet.Url, "ok", A05Kit.Sha("credit-quiet-v1")),
          A05Kit.Obs(changed.PageId, changed.Url, "not_modified"));
        Assert.Equal((0, 2), await LedgerAsync(routine));

        // One page changed, one gone, one unchanged: two detections.
        var detected = await ReportAsync(A05Kit.Obs(changed.PageId, changed.Url, "ok", A05Kit.Sha("credit-changed-v2")),
          A05Kit.Obs(gone.PageId, gone.Url, "gone"), A05Kit.Obs(quiet.PageId, quiet.Url, "not_modified"));
        Assert.Equal((2, 2), await LedgerAsync(detected));

        // Still gone next time: not a new detection.
        var stillGone = await ReportAsync(A05Kit.Obs(gone.PageId, gone.Url, "gone"));
        Assert.Equal((0, 0), await LedgerAsync(stillGone));

        // A feed: its baseline credits nothing, each queued item is one detection.
        var deckId = await A05Kit.DeckAsync(sql, "credit-feed");
        var feedUrl = Url("credit-feed");
        var feedId = await A05Kit.FeedAsync(sql, feedUrl, deckId);
        var oldItem = Url("cf-old");
        var baseline = await ReportAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("cf1"), feedItems: [A05Kit.Item(oldItem, "Old item")]));
        Assert.Equal((0, 1), await LedgerAsync(baseline));
        var items = await ReportAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("cf2"), feedItems:
          [A05Kit.Item(oldItem, "Old item"), A05Kit.Item(Url("cf-a"), "New item A"), A05Kit.Item(Url("cf-b"), "New item B")]));
        Assert.Equal((2, 1), await LedgerAsync(items));
      });
    });
  }

  [Fact]
  public async Task Report_PageChanged_EmitsSourceChangedWebhook()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      scope.Set(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
      await InScratchAsync(async sql =>
      {
        await sql.QueryAsync("insert into webhook_subscriptions (name, url, events, is_active) values ('it-a05', $1, $2, true)",
          $"https://hooks.example.com/a05/{Guid.NewGuid():N}", new[] { "source.changed" });
        var page = await CitedPageAsync(sql, "hook");

        await A05Kit.ReportDataAsync(A05Kit.Obs(page.PageId, page.Url, "ok", A05Kit.Sha("hook-v2"), missingQuoteCardIds: [page.CardB]));

        var body = A05Kit.Json(await sql.ScalarAsync("select body from webhook_deliveries where event = 'source.changed'"));
        Assert.Equal("source.changed", body.GetProperty("event").GetString());
        var data = body.GetProperty("data");
        using var contract = JsonDocument.Parse(A05Kit.ContractSourceChangedJson);
        Assert.Equal(A05Kit.Keys(contract.RootElement), A05Kit.Keys(data));
        Assert.Equal(A05Kit.Keys(contract.RootElement.GetProperty("recheck")), A05Kit.Keys(data.GetProperty("recheck")));
        Assert.Equal((page.PageId, page.Url, "changed", 3, "dry_run"), (data.GetProperty("targetId").GetInt64(), data.GetProperty("url").GetString(),
          data.GetProperty("change").GetString(), data.GetProperty("citingCards").GetInt32(), data.GetProperty("mode").GetString()));
        Assert.Equal([page.CardB], data.GetProperty("missingQuoteCardIds").EnumerateArray().Select(i => i.GetInt64()).ToArray());
        Assert.Equal("started", data.GetProperty("recheck").GetProperty("state").GetString());
        Assert.Equal(2, data.GetProperty("recheck").GetProperty("runIds").GetArrayLength());
        Assert.Equal(2, data.GetProperty("queueItemIds").GetArrayLength());
        Assert.Equal($"https://console.example.com/automation?tab=watch&targetId={page.PageId}", data.GetProperty("consoleUrl").GetString());
        Assert.Single(scope.WebhookSent);
      });
    });
  }

  [Fact]
  public async Task SourceWatchRoutes_MissingTables_Return503ServerNotReadyAutomation()
  {
    await A05Kit.WithScopeAsync(async _ =>
    {
      await A05Kit.InScratchAsync(_db, "it_a05_notready", async sql =>
      {
        var deckId = await A05Kit.DeckAsync(sql, "notready");
        await A05Kit.CardAsync(sql, deckId, Url("notready"));
        AutomationTestKit.AssertError(await A05Kit.TargetsAsync(new { v = 1, watchRunId = Guid.NewGuid(), max = 10 }), 503, "SERVER_NOT_READY_AUTOMATION");
        AutomationTestKit.AssertError(await A05Kit.ReportAsync(new { v = 1, watchRunId = Guid.NewGuid(), observations = new[] { A05Kit.Obs(1, Url("x"), "not_modified") } }),
          503, "SERVER_NOT_READY_AUTOMATION");
      }, maxVersion: 33);
    });
  }
}
