using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Reports;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R28 ANONREPORT (user-perspective review 2026-10-04, U2): <c>POST /api/v1/public/card-reports</c> through the whole Vpc
/// function. Structured fields only (an unknown key or a note is a 400), no auth (a bearer is ignored), a 1 KB body cap,
/// the per-container budget, the per card + reason + UTC day dedupe, the global daily cap and its off switch, live free
/// cards only, the pre-046 503, and the owner's views: the console list (<c>anonymous: true</c>), the status and digest
/// counts and the <c>card.reported</c> webhook. No AI triage. Every test runs in its own scratch database so the global
/// cap counts only its own rows; env, clocks and seams are restored afterwards.
/// </summary>
/// <remarks>In the postgres collection because these tests redirect Console and move process-global clocks and budgets.</remarks>
[Collection(PostgresCollection.Name)]
public sealed class AnonymousCardReportsTests : IDisposable
{
  private const string Scratch = "it_r28_anon_reports";
  private const string RoutePath = "/api/v1/public/card-reports";
  private const string AdminPath = "/api/v1/admin/card-reports";
  private const string UserPath = "/api/v1/user/card-reports";
  private const string AppVersion = "2.0.0";

  private static readonly string[] EnvNames =
  [
    CardReports.EnabledEnv, CardReports.DailyLimitEnv, CardReports.AiTriageEnv, AnonymousCardReports.DailyCapEnv, QaGate.EnabledEnv,
    QaRuns.QueueUrlEnv, QaRuns.DailyCapEnv, QaRuns.EstUsdPerCardEnv, WebhookEvents.QueueUrlEnv,
  ];

  private readonly PostgresFixture _db;
  private readonly Dictionary<string, string?> _savedEnv = EnvNames.ToDictionary(n => n, Environment.GetEnvironmentVariable);
  private readonly Func<SendMessageRequest, Task>? _savedQaSeam = QaRuns.TestSendSeam;
  private readonly Func<SendMessageRequest, Task>? _savedWebhookSeam = WebhookEvents.TestSendSeam;
  private readonly Func<DateTime> _savedClock = AnonymousCardReports.UtcNow;
  private readonly List<SendMessageRequest> _qaSent = [];
  private readonly List<SendMessageRequest> _webhookSent = [];

  public AnonymousCardReportsTests(PostgresFixture db)
  {
    _db = db;
    AnonymousCardReports.ResetBudget();
    Environment.SetEnvironmentVariable(CardReports.EnabledEnv, "1");
    Environment.SetEnvironmentVariable(CardReports.DailyLimitEnv, "5");
    Environment.SetEnvironmentVariable(CardReports.AiTriageEnv, "0");
    Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, null);
    Environment.SetEnvironmentVariable(QaGate.EnabledEnv, "0");
    Environment.SetEnvironmentVariable(QaRuns.QueueUrlEnv, AutomationTestKit.FakeQaQueueUrl);
    Environment.SetEnvironmentVariable(QaRuns.DailyCapEnv, "1000000");
    Environment.SetEnvironmentVariable(QaRuns.EstUsdPerCardEnv, "0.05");
    Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
    QaRuns.TestSendSeam = r => { lock (_qaSent) _qaSent.Add(r); return Task.CompletedTask; };
    WebhookEvents.TestSendSeam = r => { lock (_webhookSent) _webhookSent.Add(r); return Task.CompletedTask; };
  }

  public void Dispose()
  {
    foreach (var (name, value) in _savedEnv) Environment.SetEnvironmentVariable(name, value);
    QaRuns.TestSendSeam = _savedQaSeam;
    WebhookEvents.TestSendSeam = _savedWebhookSeam;
    AnonymousCardReports.UtcNow = _savedClock;
    AnonymousCardReports.ResetBudget();
  }

  // ---------------------------------------------------------------- kit

  private Task InScratchAsync(Func<A04Kit.Sql, Task> body, int maxVersion = int.MaxValue) =>
    A05Kit.InScratchAsync(_db, Scratch, body, maxVersion);

  /// <summary>
  /// A gateway event. With <paramref name="sub"/> it carries both an authorizer claims block and an <c>Authorization</c>
  /// bearer, so a test can prove neither reaches the route.
  /// </summary>
  private static JsonElement Event(string method, string path, string? body, string? sub = null, IDictionary<string, string>? extraHeaders = null)
  {
    var requestContext = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["requestId"] = Guid.NewGuid().ToString(),
      ["http"] = new Dictionary<string, object?> { ["method"] = method, ["sourceIp"] = "203.0.113.77" },
    };
    var headers = new Dictionary<string, string>(StringComparer.Ordinal) { ["content-type"] = "application/json" };
    if (sub is not null)
    {
      requestContext["authorizer"] = new Dictionary<string, object?>
      {
        ["jwt"] = new Dictionary<string, object?>
        {
          ["claims"] = new Dictionary<string, object?>(StringComparer.Ordinal)
          {
            ["sub"] = sub,
            ["email"] = sub + "@example.com",
            ["cognito:groups"] = Array.Empty<string>(),
          },
        },
      };
      headers["authorization"] = "Bearer r28-not-a-real-token";
    }
    foreach (var (k, v) in extraHeaders ?? new Dictionary<string, string>()) headers[k] = v;

    return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
    {
      ["rawPath"] = path,
      ["requestContext"] = requestContext,
      ["headers"] = headers,
      ["queryStringParameters"] = new Dictionary<string, string>(),
      ["body"] = body,
      ["isBase64Encoded"] = false,
    });
  }

  private static Task<APIGatewayProxyResponse> PostRawAsync(string? body, string? sub = null, string path = RoutePath,
    IDictionary<string, string>? extraHeaders = null) =>
    new VpcFunction().Handler(Event("POST", path, body, sub, extraHeaders));

  private static Task<APIGatewayProxyResponse> PostAsync(string deckSlug, string stableUid, string reason = "wrong_answer", string? sub = null) =>
    PostRawAsync(Body(deckSlug, stableUid, reason), sub);

  private static string Body(string deckSlug, string stableUid, string reason = "wrong_answer", string appVersion = AppVersion) =>
    JsonSerializer.Serialize(new { deckSlug, stableUid, reason, appVersion });

  private static void AssertReceived(APIGatewayProxyResponse r)
  {
    Assert.True(r.StatusCode == 202, $"expected 202, got {r.StatusCode}: {r.Body}");
    using var doc = JsonDocument.Parse(r.Body);
    Assert.True(doc.RootElement.GetProperty("success").GetBoolean());
    var data = doc.RootElement.GetProperty("data");
    Assert.Equal(["received"], data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.True(data.GetProperty("received").GetBoolean());
  }

  private static async Task<(long DeckId, string Slug)> DeckAsync(A04Kit.Sql sql, string tag, string tier = "free", string availability = "live")
  {
    var slug = $"r28-{tag}-{Guid.NewGuid():N}";
    slug = slug[..Math.Min(slug.Length, 40)];
    var id = await sql.ScalarAsync(
      "insert into decks (slug, title, author, tier, availability, eta, retired_at_ms) values ($1, 'deck r28', 'tests', $2, $3, " +
      "case when $3 = 'coming' then 'soon' end, case when $3 = 'retired' then 1 end) returning id",
      slug, tier, availability);
    return (A04Kit.Long(id), slug);
  }

  private static async Task<(long CardId, string Uid)> CardAsync(A04Kit.Sql sql, long deckId, string tag, string question = "Synthetic anonymous question?",
    int isDeleted = 0)
  {
    var uid = $"r28-{tag}-{Guid.NewGuid():N}";
    uid = uid[..Math.Min(uid.Length, 36)];
    var id = await sql.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, is_deleted) " +
      "values ($1, $2, $3, 'synthetic explanation', 2, (select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1), $4) returning id",
      deckId, uid, question, isDeleted);
    return (A04Kit.Long(id), uid);
  }

  private static async Task<(string Out, string Err)> CaptureAsync(Func<Task> action)
  {
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    var stderr = new StringWriter();
    Console.SetOut(stdout);
    Console.SetError(stderr);
    try
    {
      await action();
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
    }
    return (stdout.ToString(), stderr.ToString());
  }

  private static int Occurrences(string text, string needle)
  {
    var n = 0;
    for (var i = text.IndexOf(needle, StringComparison.Ordinal); i >= 0; i = text.IndexOf(needle, i + needle.Length, StringComparison.Ordinal)) n++;
    return n;
  }

  private static AuthContext Learner(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: [], IsSuperAdmin: false, IsEditor: false, IsAdmin: false);

  // ---------------------------------------------------------------- create

  [Fact]
  public async Task Post_StoresAnAnonymousRow_WithStructuredFieldsOnly()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "create");
      var (cardId, uid) = await CardAsync(sql, deckId, "create", "Q" + new string('q', 250));

      AssertReceived(await PostAsync(slug, uid, "outdated"));

      var row = Assert.Single(await sql.QueryAsync("select * from card_reports"));
      Assert.Null(row["user_sub"]);
      Assert.Null(row["note"]);
      Assert.Equal((deckId, slug, cardId, uid, "outdated", "open", AppVersion),
        (A04Kit.Long(row["deck_id"]), (string)row["deck_slug"]!, A04Kit.Long(row["card_id"]), (string)row["stable_uid"]!, (string)row["reason"]!,
          (string)row["status"]!, (string)row["client_version"]!));
      // The question as it was at report time, capped like a signed-in report's.
      Assert.Equal(200, ((string)row["question"]!).Length);
      Assert.Null(row["resolved_by_sub"]);
    });
  }

  [Fact]
  public async Task Post_IgnoresAnyBearer_LinksNoUser_AndNeverLogsTheBodyOrTheSubOrTheIp()
  {
    await InScratchAsync(async sql =>
    {
      const string sub = "r28-signed-in-sub-4b1d";
      var (deckId, slug) = await DeckAsync(sql, "bearer");
      var (_, uid) = await CardAsync(sql, deckId, "bearer");

      APIGatewayProxyResponse? response = null;
      var (stdout, stderr) = await CaptureAsync(async () => response = await PostAsync(slug, uid, "unclear", sub));
      AssertReceived(response!);

      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports where user_sub is null"));
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports where user_sub is not null"));
      Assert.Equal(0L, await sql.CountAsync("select count(*) from users where user_sub = $1", sub));

      // Positive control: the dispatcher line for this route was captured, and it has no user.
      Assert.True(Log.IsEnabled("info"), "LOG_LEVEL must allow info lines for this test to prove anything");
      var dispatcherLine = stdout.Split('\n').SingleOrDefault(l => l.Contains($"\"path\":\"{RoutePath}\"", StringComparison.Ordinal));
      Assert.NotNull(dispatcherLine);
      Assert.Contains("\"userSub\":null", dispatcherLine, StringComparison.Ordinal);

      var logs = stdout + stderr;
      Assert.DoesNotContain(sub, logs, StringComparison.Ordinal);
      Assert.DoesNotContain(uid, logs, StringComparison.Ordinal);
      Assert.DoesNotContain("203.0.113.77", logs, StringComparison.Ordinal);
      Assert.Contains("\"anonymous\":true", logs, StringComparison.Ordinal);
    });
  }

  [Fact]
  public async Task Post_NeverLogsTheClientTraceId()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "trace");
      var (_, uid) = await CardAsync(sql, deckId, "trace");
      const string sentryTraceRoot = "1-6a1f3d2b-8c7b6a5f4e3d2c1b0a9f8e7d";
      var headers = new Dictionary<string, string> { ["x-dc-trace-id"] = sentryTraceRoot };
      var (stdout, stderr) = await CaptureAsync(async () => AssertReceived(await PostRawAsync(Body(slug, uid), extraHeaders: headers)));

      var metricLine = stdout.Split('\n').SingleOrDefault(l => l.Contains("\"_aws\"", StringComparison.Ordinal) &&
        l.Contains($"\"Route\":\"{RoutePath}\"", StringComparison.Ordinal));
      Assert.NotNull(metricLine);
      Assert.DoesNotContain("upstreamTraceId", metricLine, StringComparison.Ordinal);
      Assert.DoesNotContain("6a1f3d2b", stdout + stderr, StringComparison.Ordinal);
    });
  }

  private static IEnumerable<string> InvalidBodies()
  {
    var longUid = new string('a', 129);
    yield return "not json at all";
    yield return "[1, 2]";
    yield return "\"wrong_answer\"";
    yield return JsonSerializer.Serialize(new { stableUid = "uid", reason = "typo", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "Bad Slug", stableUid = "uid", reason = "typo", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "", reason = "typo", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = longUid, reason = "typo", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = 7, reason = "typo", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "spam", appVersion = AppVersion });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo" });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = "2.0" });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = "2.0.0 (24)" });
    // Free text, identifiers and anything else the route does not know are refused, not dropped.
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = AppVersion, note = "x" });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = AppVersion, note = (string?)null });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = AppVersion, deviceId = "d-1" });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = AppVersion, email = "a@b.c" });
    yield return JsonSerializer.Serialize(new { deckSlug = "deck", stableUid = "uid", reason = "typo", appVersion = AppVersion, clientVersion = "2.0.0" });
  }

  [Fact]
  public async Task Post_InvalidBody_Returns400_AndStoresNothing()
  {
    await InScratchAsync(async sql =>
    {
      // A real card, so a 400 is the body's fault and not a missing card's.
      var (deckId, slug) = await DeckAsync(sql, "invalid");
      var (_, uid) = await CardAsync(sql, deckId, "invalid");
      foreach (var body in InvalidBodies())
      {
        var real = body.Replace("\"deck\"", $"\"{slug}\"", StringComparison.Ordinal).Replace("\"uid\"", $"\"{uid}\"", StringComparison.Ordinal);
        var response = await PostRawAsync(real);
        Assert.True(response.StatusCode == 400, $"{real} -> {response.StatusCode}: {response.Body}");
        AutomationTestKit.AssertError(response, 400, "VALIDATION_ERROR");
      }
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports"));
      // Positive control: the same card with a valid body is stored.
      AssertReceived(await PostAsync(slug, uid));
    });
  }

  [Fact]
  public async Task Post_OversizeBody_Is413_StoresNothing_AndSpendsNoBudget()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "big");
      var (_, uid) = await CardAsync(sql, deckId, "big");
      var padded = JsonSerializer.Serialize(new { deckSlug = slug, stableUid = uid, reason = "typo", appVersion = AppVersion, pad = new string('x', 1100) });
      Assert.True(Encoding.UTF8.GetByteCount(padded) > AnonymousCardReports.MaxBodyBytes);
      // Multi-byte characters count as bytes, not chars.
      var wide = JsonSerializer.Serialize(new { deckSlug = slug, stableUid = uid, reason = "typo", appVersion = AppVersion, pad = new string('é', 520) },
        new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
      Assert.True(wide.Length < AnonymousCardReports.MaxBodyBytes);

      for (var i = 0; i < AnonymousCardReports.MaxRequestsPerWindow + 5; i++)
      {
        AutomationTestKit.AssertError(await PostRawAsync(i % 2 == 0 ? padded : wide), 413, "PAYLOAD_TOO_LARGE");
      }
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports"));
      AssertReceived(await PostAsync(slug, uid));
    });
  }

  [Fact]
  public async Task Post_OnlyACardOfALiveFreeDeck()
  {
    await InScratchAsync(async sql =>
    {
      var (liveId, live) = await DeckAsync(sql, "live");
      var (_, liveUid) = await CardAsync(sql, liveId, "live");
      var (_, deletedUid) = await CardAsync(sql, liveId, "deleted", isDeleted: 1);
      var (premiumId, premium) = await DeckAsync(sql, "premium", tier: "premium");
      var (_, premiumUid) = await CardAsync(sql, premiumId, "premium");
      var (comingId, coming) = await DeckAsync(sql, "coming", availability: "coming");
      var (_, comingUid) = await CardAsync(sql, comingId, "coming");
      var (goneId, gone) = await DeckAsync(sql, "gone");
      var (_, goneUid) = await CardAsync(sql, goneId, "gone");
      await sql.ScalarAsync("update decks set is_deleted = 1 where id = $1", goneId);

      foreach (var (slug, uid) in new[] { (live, "no-such-uid"), ("no-such-deck", liveUid), (live, deletedUid), (premium, premiumUid),
                 (coming, comingUid), (gone, goneUid), (premium, liveUid) })
      {
        AutomationTestKit.AssertError(await PostAsync(slug, uid), 404, "CARD_NOT_FOUND");
      }
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports"));
      AssertReceived(await PostAsync(live, liveUid));
    });
  }

  [Fact]
  public async Task Post_OnlyPost_AndOnlyTheExactPath()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "path");
      var (_, uid) = await CardAsync(sql, deckId, "path");

      Assert.Equal(405, (await new VpcFunction().Handler(Event("GET", RoutePath, null))).StatusCode);
      // A suffix match would let these reach the route; it is exact.
      Assert.Equal(404, (await PostRawAsync(Body(slug, uid), path: "/api/v1/other/api/v1/public/card-reports")).StatusCode);
      Assert.Equal(404, (await PostRawAsync(Body(slug, uid), path: "/api/v1/public/card-reports/1")).StatusCode);
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports"));

      // The stage prefix is stripped before routing, like every other route.
      AssertReceived(await PostRawAsync(Body(slug, uid), path: "/prod/api/v1/public/card-reports"));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports"));
    });
  }

  // ---------------------------------------------------------------- dedupe

  [Fact]
  public async Task Post_Dedupe_OnePerCardReasonAndUtcDay_ARepeatLooksTheSame_AndEmitsNothing()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "dedupe");
      var (_, uid) = await CardAsync(sql, deckId, "dedupe");
      var (_, other) = await CardAsync(sql, deckId, "dedupe-b");
      await sql.ScalarAsync("insert into webhook_subscriptions (name, url, events) values ('it-r28', 'https://example.com/r28-hook', array['card.reported'])");

      var first = await PostAsync(slug, uid, "typo");
      AssertReceived(first);
      Assert.Single(_webhookSent);
      for (var i = 0; i < 3; i++)
      {
        var again = await PostAsync(slug, uid, "typo");
        AssertReceived(again);
        // Byte for byte the same answer apart from the trace id: a caller cannot tell a repeat from a new report.
        Assert.Equal(first.Body.Replace(TraceOf(first), "", StringComparison.Ordinal), again.Body.Replace(TraceOf(again), "", StringComparison.Ordinal));
      }
      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports"));
      Assert.Single(_webhookSent);

      // Another reason, or another card, is a new report.
      AssertReceived(await PostAsync(slug, uid, "outdated"));
      AssertReceived(await PostAsync(slug, other, "typo"));
      Assert.Equal(3L, await sql.CountAsync("select count(*) from card_reports"));

      // Resolving does not reopen the day: the same card and reason stay deduped until the next UTC day.
      await sql.ScalarAsync("update card_reports set status = 'resolved', resolution = 'fixed' where stable_uid = $1 and reason = 'typo'", uid);
      AssertReceived(await PostAsync(slug, uid, "typo"));
      Assert.Equal(3L, await sql.CountAsync("select count(*) from card_reports"));

      // A report from yesterday (UTC) does not hold today's.
      await sql.ScalarAsync("update card_reports set created_at = date_trunc('day', now(), 'UTC') - interval '1 minute'");
      AssertReceived(await PostAsync(slug, uid, "typo"));
      Assert.Equal(4L, await sql.CountAsync("select count(*) from card_reports"));

      // A signed-in report of the same card and reason is not an anonymous duplicate, and the other way round.
      Assert.Equal(200, (await AutomationTestKit.CallAsync(CardReports.HandleUser, "POST", UserPath,
        new { deckSlug = slug, stableUid = other, reason = "unclear" }, Learner("r28-learner"))).StatusCode);
      AssertReceived(await PostAsync(slug, other, "unclear"));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports where user_sub is null and stable_uid = $1 and reason = 'unclear'", other));
    });
  }

  private static string TraceOf(APIGatewayProxyResponse r)
  {
    using var doc = JsonDocument.Parse(r.Body);
    return doc.RootElement.GetProperty("traceId").GetString() ?? "";
  }

  [Fact]
  public async Task Post_ConcurrentRepeats_StoreOneRow()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "race");
      var (_, uid) = await CardAsync(sql, deckId, "race");
      var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => PostAsync(slug, uid, "wrong_answer")));
      Assert.All(responses, AssertReceived);
      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports"));
    });
  }

  [Fact]
  public async Task Migration046_UniqueIndexAndNoteCheck_HoldInTheDatabaseToo()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "db");
      await sql.ScalarAsync("insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason) values (null, $1, $2, 'u-1', 'typo')", deckId, slug);
      var dup = await Assert.ThrowsAsync<PostgresException>(() =>
        sql.ScalarAsync("insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason) values (null, $1, $2, 'u-1', 'typo')", deckId, slug));
      Assert.Equal(("23505", "uq_card_reports_anonymous_day"), (dup.SqlState, dup.ConstraintName));
      var note = await Assert.ThrowsAsync<PostgresException>(() =>
        sql.ScalarAsync("insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, note) values (null, $1, $2, 'u-2', 'typo', 'free text')",
          deckId, slug));
      Assert.Equal(("23514", "ck_card_reports_anonymous"), (note.SqlState, note.ConstraintName));
      // Signed-in rows are untouched by both: two learners, same card and reason, same day, each with a note.
      await sql.ScalarAsync("insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, note) values ('s-1', $1, $2, 'u-1', 'typo', 'n')", deckId, slug);
      await sql.ScalarAsync("insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, note) values ('s-2', $1, $2, 'u-1', 'typo', 'n')", deckId, slug);

      // Idempotent: running the file again changes nothing and does not fail.
      await using var conn = await sql.OpenAsync();
      var file = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "046_card_reports_anonymous.sql"));
      await DbUtil.ExecuteAsync(conn, null, file, []);
      Assert.Equal(3L, await sql.CountAsync("select count(*) from card_reports"));
    });
  }

  // ---------------------------------------------------------------- caps and switches

  [Fact]
  public async Task Post_DailyCap_CountsAnonymousRowsOfTheUtcDay_Then429_RepeatsStillAnswer()
  {
    await InScratchAsync(async sql =>
    {
      Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, "2");
      var (deckId, slug) = await DeckAsync(sql, "cap");
      var uids = new List<string>();
      for (var i = 0; i < 4; i++) uids.Add((await CardAsync(sql, deckId, $"cap-{i}")).Uid);

      // Yesterday's anonymous rows and today's signed-in rows do not count.
      await sql.ScalarAsync(
        "insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, created_at) " +
        "select null, $1, $2, 'old-' || g, 'typo', date_trunc('day', now(), 'UTC') - interval '1 minute' from generate_series(1, 5) g", deckId, slug);
      await sql.ScalarAsync(
        "insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason) select 'learner-' || g, $1, $2, 'signed-' || g, 'typo' " +
        "from generate_series(1, 5) g", deckId, slug);

      AssertReceived(await PostAsync(slug, uids[0]));
      AssertReceived(await PostAsync(slug, uids[1]));

      APIGatewayProxyResponse? capped = null, cappedAgain = null;
      var (_, stderr) = await CaptureAsync(async () =>
      {
        capped = await PostAsync(slug, uids[2]);
        cappedAgain = await PostAsync(slug, uids[3]);
      });
      AutomationTestKit.AssertError(capped!, 429, "REPORT_DAILY_CAP");
      AutomationTestKit.AssertError(cappedAgain!, 429, "REPORT_DAILY_CAP");
      Assert.Equal(1, Occurrences(stderr, "\"card_report_anon_daily_cap\""));
      // A repeat of a stored report is answered as before, at the cap too.
      AssertReceived(await PostAsync(slug, uids[0]));
      Assert.Equal(2L, await sql.CountAsync("select count(*) from card_reports where user_sub is null and created_at >= date_trunc('day', now(), 'UTC')"));

      // Read per call; signed-in reporting is not capped by it.
      Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, "3");
      AssertReceived(await PostAsync(slug, uids[2]));
      Assert.Equal(200, (await AutomationTestKit.CallAsync(CardReports.HandleUser, "POST", UserPath,
        new { deckSlug = slug, stableUid = uids[3], reason = "typo" }, Learner("r28-cap-learner"))).StatusCode);
    });
  }

  [Fact]
  public async Task Post_ConcurrentNewReports_NeverExceedTheCap()
  {
    await InScratchAsync(async sql =>
    {
      Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, "2");
      var (deckId, slug) = await DeckAsync(sql, "cap-race");
      var uids = new List<string>();
      for (var i = 0; i < 6; i++) uids.Add((await CardAsync(sql, deckId, $"cap-race-{i}")).Uid);
      var responses = await Task.WhenAll(uids.Select(u => PostAsync(slug, u)));
      Assert.Equal(2, responses.Count(r => r.StatusCode == 202));
      Assert.Equal(4, responses.Count(r => r.StatusCode == 429));
      Assert.Equal(2L, await sql.CountAsync("select count(*) from card_reports"));
    });
  }

  [Fact]
  public async Task Post_OffSwitches_Return503_AndStoreNothing()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "off");
      var (_, uid) = await CardAsync(sql, deckId, "off");

      Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, "0");
      AutomationTestKit.AssertError(await PostAsync(slug, uid), 503, "CARD_REPORTS_DISABLED");
      Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, null);
      Environment.SetEnvironmentVariable(CardReports.EnabledEnv, "0");
      AutomationTestKit.AssertError(await PostAsync(slug, uid), 503, "CARD_REPORTS_DISABLED");
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports"));

      // Unset means on, with the default cap.
      Environment.SetEnvironmentVariable(CardReports.EnabledEnv, null);
      Assert.Equal(AnonymousCardReports.DefaultDailyCap, AnonymousCardReports.DailyCap());
      Environment.SetEnvironmentVariable(AnonymousCardReports.DailyCapEnv, "lots");
      Assert.Equal(AnonymousCardReports.DefaultDailyCap, AnonymousCardReports.DailyCap());
      AssertReceived(await PostAsync(slug, uid));
    });
  }

  [Fact]
  public async Task Post_Budget_Is30RequestsPer60Seconds_Then429()
  {
    await InScratchAsync(async sql =>
    {
      var now = new DateTime(2026, 10, 4, 1, 0, 0, DateTimeKind.Utc);
      AnonymousCardReports.UtcNow = () => now;
      var (deckId, slug) = await DeckAsync(sql, "budget");
      var (_, uid) = await CardAsync(sql, deckId, "budget");
      for (var i = 0; i < AnonymousCardReports.MaxRequestsPerWindow; i++) AssertReceived(await PostAsync(slug, uid));

      APIGatewayProxyResponse? first = null, second = null;
      var (stdout, stderr) = await CaptureAsync(async () =>
      {
        first = await PostAsync(slug, uid);
        second = await PostAsync(slug, uid);
      });
      foreach (var limited in new[] { first!, second! })
      {
        AutomationTestKit.AssertError(limited, 429, "RATE_LIMITED");
        Assert.Equal("60", limited.Headers["Retry-After"]);
      }
      Assert.Equal(1, Occurrences(stdout + stderr, "\"card_report_anon_budget\""));

      // The window rolls over after 60 s.
      AnonymousCardReports.UtcNow = () => now.AddSeconds(61);
      AssertReceived(await PostAsync(slug, uid));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports"));
    });
  }

  [Fact]
  public async Task Post_BeforeMigration046_Answers503NotReady_AndTheOtherRoutesStillWork()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "pre046");
      var (_, uid) = await CardAsync(sql, deckId, "pre046");
      AutomationTestKit.AssertError(await PostAsync(slug, uid), 503, "NOT_READY");
      Assert.Equal(0L, await sql.CountAsync("select count(*) from card_reports"));

      // The signed-in route and the console list are unchanged before 046 (the list derives `anonymous` from user_sub).
      Assert.Equal(200, (await AutomationTestKit.CallAsync(CardReports.HandleUser, "POST", UserPath,
        new { deckSlug = slug, stableUid = uid, reason = "typo" }, Learner("r28-pre046"))).StatusCode);
      var items = AutomationTestKit.Data(await AutomationTestKit.CallAsync(CardReports.HandleAdminList, "GET", AdminPath, null,
        AutomationTestKit.Ctx("r28-sa", agent: false))).GetProperty("items").EnumerateArray().ToList();
      Assert.False(Assert.Single(items).GetProperty("anonymous").GetBoolean());
    }, maxVersion: 45);
  }

  // ---------------------------------------------------------------- where the owner looks

  [Fact]
  public async Task AnonymousReports_ShowInTheConsoleList_TheStatusAndDigestCounts_AndTheWebhook_WithoutTriage()
  {
    await InScratchAsync(async sql =>
    {
      // Triage on with AI QA on: a signed-in report would start a re-check; an anonymous one must not.
      Environment.SetEnvironmentVariable(CardReports.AiTriageEnv, "1");
      Environment.SetEnvironmentVariable(QaGate.EnabledEnv, "1");
      var (deckId, slug) = await DeckAsync(sql, "owner");
      var (cardId, uid) = await CardAsync(sql, deckId, "owner");
      await sql.ScalarAsync("insert into webhook_subscriptions (name, url, events) values ('it-r28-owner', 'https://example.com/r28-owner', array['card.reported'])");

      AssertReceived(await PostAsync(slug, uid, "wrong_answer"));

      // Console list: the row, marked anonymous, with no note and no reporter.
      var response = await AutomationTestKit.CallAsync(CardReports.HandleAdminList, "GET", AdminPath, null, AutomationTestKit.Ctx("r28-sa", agent: false));
      Assert.DoesNotContain("userSub", response.Body, StringComparison.Ordinal);
      var item = Assert.Single(AutomationTestKit.Data(response).GetProperty("items").EnumerateArray().ToList());
      Assert.True(item.GetProperty("anonymous").GetBoolean());
      Assert.Equal(JsonValueKind.Null, item.GetProperty("note").ValueKind);
      Assert.Equal((deckId, cardId, uid, "wrong_answer", "open", AppVersion), (item.GetProperty("deckId").GetInt64(), item.GetProperty("cardId").GetInt64(),
        item.GetProperty("stableUid").GetString(), item.GetProperty("reason").GetString(), item.GetProperty("status").GetString(),
        item.GetProperty("clientVersion").GetString()));

      // Status tile and digest counts.
      await using var conn = await sql.OpenAsync();
      Assert.Equal(new CardReports.Counts(1, 1), await CardReports.CountsAsync(conn));
      Assert.Equal(1L, await CardReports.CreatedBetweenAsync(conn, DateTime.UtcNow.AddDays(-7), DateTime.UtcNow.AddMinutes(1)));
      var status = AutomationTestKit.Data(await AutomationTestKit.CallAsync(StatusRoutes.HandleStatus, "GET", "/api/v1/admin/automation/status", null,
        AutomationTestKit.Ctx("r28-sa", agent: false))).GetProperty("cardReports");
      Assert.Equal((1L, 1L), (status.GetProperty("open").GetInt64(), status.GetProperty("openedLast7d").GetInt64()));

      // The console resolves it like any other report.
      var reportId = item.GetProperty("reportId").GetInt64();
      Assert.Equal(200, (await AutomationTestKit.CallAsync((q, r, a) => CardReports.HandleResolve(q, r, a, reportId.ToString(CultureInfo.InvariantCulture)),
        "POST", $"{AdminPath}/{reportId}/resolve", new { resolution = "fixed" }, AutomationTestKit.Ctx("r28-sa", agent: false))).StatusCode);

      // The card.reported webhook, same shape as a signed-in report's.
      var message = Assert.Single(_webhookSent.Select(m => JsonDocument.Parse(m.MessageBody).RootElement.Clone())
        .Where(m => m.GetProperty("event").GetString() == "card.reported").ToList());
      using var body = JsonDocument.Parse(message.GetProperty("body").GetString()!);
      var data = body.RootElement.GetProperty("data");
      Assert.Equal(["reportId", "deckSlug", "stableUid", "reason", "createdAt"], data.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(reportId, data.GetProperty("reportId").GetInt64());

      // No AI triage for an unauthenticated caller.
      Assert.Empty(_qaSent);
      Assert.Equal(0L, await sql.CountAsync("select count(*) from ai_qa_runs"));
    });
  }

  [Fact]
  public async Task AnonymousReports_AreNotTouchedByAccountDeletion_AndNotListedAsAnyonesOwn()
  {
    await InScratchAsync(async sql =>
    {
      var (deckId, slug) = await DeckAsync(sql, "mine");
      var (_, uid) = await CardAsync(sql, deckId, "mine");
      AssertReceived(await PostAsync(slug, uid));

      var mine = AutomationTestKit.Data(await AutomationTestKit.CallAsync(CardReports.HandleUser, "GET", UserPath, null, Learner("r28-mine")));
      Assert.Empty(mine.GetProperty("items").EnumerateArray());

      await using var conn = await sql.OpenAsync();
      Assert.Equal(0, await DbUtil.ExecuteAsync(conn, null, "delete from card_reports where user_sub = $1", ["r28-mine"]));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from card_reports where user_sub is null"));
    });
  }
}
