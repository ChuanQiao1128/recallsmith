using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Analytics;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R24 A01 anonymous funnel (contract R24-00 §3.1-§3.2): <c>POST /api/v1/public/events</c> through the whole Vpc function
/// (exact route, no auth, bearer ignored, 8 KB cap, per-event validation, per-container budget, 202 accepted/rejected),
/// <c>GET /api/v1/admin/analytics/funnel</c> (cohort weeks, overall, conversion from first_open, by deck) and the
/// 400-day retention delete, its own <c>anon_funnel_retention</c> tick step (R24X F05), and the global daily row cap. Every test runs in its own scratch database with a
/// fixed "today" (2026-03-20 UTC); the clocks and the budget are restored afterwards.
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console and move process-global clocks and budgets.
/// </remarks>
[Collection(PostgresCollection.Name)]
public sealed class AnonFunnelTests : IDisposable
{
  private const string Scratch = "it_a01_funnel";
  private const string EventsPath = "/api/v1/public/events";
  private const string FunnelPath = "/api/v1/admin/analytics/funnel";
  private static readonly DateTime Now = new(2026, 3, 20, 10, 0, 0, DateTimeKind.Utc);

  private readonly PostgresFixture _db;
  private readonly Func<DateTime> _savedFunnelClock = AnonFunnel.UtcNow;
  private readonly Func<DateTime> _savedUsageClock = UsageAnalytics.UtcNow;
  private readonly int _savedRetentionBatch = AnonFunnel.RetentionBatch;
  private readonly TimeSpan _savedRetentionTimeout = AnonFunnel.RetentionStatementTimeout;

  public AnonFunnelTests(PostgresFixture db)
  {
    _db = db;
    AnonFunnel.ResetBudget();
    AnonFunnel.UtcNow = () => Now;
    UsageAnalytics.UtcNow = () => Now;
    UsageAnalytics.ResetBackoff();
  }

  public void Dispose()
  {
    AnonFunnel.ResetBudget();
    AnonFunnel.UtcNow = _savedFunnelClock;
    UsageAnalytics.UtcNow = _savedUsageClock;
    UsageAnalytics.ResetBackoff();
    AnonFunnel.RetentionBatch = _savedRetentionBatch;
    AnonFunnel.RetentionStatementTimeout = _savedRetentionTimeout;
  }

  // ---------------------------------------------------------------- kit

  private Task InScratchAsync(Func<A04Kit.Sql, Task> body, int maxVersion = int.MaxValue) =>
    A05Kit.InScratchAsync(_db, Scratch, body, maxVersion);

  /// <summary>
  /// A gateway event. With <paramref name="sub"/> it carries both an authorizer claims block (what the gateway would add)
  /// and an <c>Authorization</c> bearer, so a test can prove neither reaches the ingest.
  /// </summary>
  private static JsonElement Event(string method, string path, string? body, string? sub = null, IDictionary<string, string>? query = null)
  {
    var requestContext = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["requestId"] = Guid.NewGuid().ToString(),
      ["http"] = new Dictionary<string, object?> { ["method"] = method },
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
      headers["authorization"] = "Bearer a01-not-a-real-token";
    }

    return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
    {
      ["rawPath"] = path,
      ["requestContext"] = requestContext,
      ["headers"] = headers,
      ["queryStringParameters"] = query ?? new Dictionary<string, string>(),
      ["body"] = body,
      ["isBase64Encoded"] = false,
    });
  }

  private static Task<APIGatewayProxyResponse> PostAsync(string? body, string? sub = null, string path = EventsPath) =>
    new VpcFunction().Handler(Event("POST", path, body, sub));

  private static Dictionary<string, object?> Ev(string ev, string cohortDay = "2026-03-16", string? eventDay = null, string? deckSlug = null)
  {
    var e = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["event"] = ev,
      ["cohortDay"] = cohortDay,
      ["eventDay"] = eventDay ?? cohortDay,
    };
    if (deckSlug is not null) e["deckSlug"] = deckSlug;
    return e;
  }

  private static string Batch(params object[] events) =>
    JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9.0", events });

  private static JsonElement Body(APIGatewayProxyResponse r) => JsonDocument.Parse(r.Body).RootElement.Clone();

  private static (long Accepted, long Rejected) Counts(APIGatewayProxyResponse r)
  {
    Assert.True(r.StatusCode == 202, $"expected 202, got {r.StatusCode}: {r.Body}");
    var body = Body(r);
    Assert.True(body.GetProperty("success").GetBoolean());
    var data = body.GetProperty("data");
    return (data.GetProperty("accepted").GetInt64(), data.GetProperty("rejected").GetInt64());
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

  private static async Task InsertAsync(A04Kit.Sql sql, string ev, string cohortDay, string? deck = null, DateTime? receivedAt = null) =>
    await sql.ScalarAsync(
      "insert into anon_funnel_events (event, cohort_day, event_day, deck_slug, platform, app_version, received_at) " +
      "values ($1, $2::date, $2::date, $3, 'ios', '1.9.0', $4)",
      ev, cohortDay, deck, receivedAt ?? Now);

  // ---------------------------------------------------------------- ingest

  [Fact]
  public async Task Ingest_AcceptsValidEvents_SkipsAndCountsInvalidOnes()
  {
    await InScratchAsync(async sql =>
    {
      var response = await PostAsync(Batch(
        Ev("first_open"),
        Ev("goal_chosen", deckSlug: "aws-saa-c03"),
        Ev("starter_started", deckSlug: "claude-ccdv-f"),
        Ev("returned_day_1", eventDay: "2026-03-17"),
        Ev("signup_completed", cohortDay: "2026-03-21", eventDay: "2026-03-21"), // today + 1: still valid
        Ev("app_crashed"),                                                         // unknown event
        Ev("goal_chosen", deckSlug: "not-a-live-deck"),                            // unknown deck
        Ev("first_open", cohortDay: "2025-02-12"),                                 // today - 401
        Ev("first_open", cohortDay: "2026-03-22"),                                 // today + 2
        Ev("first_open", cohortDay: "2026-02-30"),                                 // not a date
        Ev("first_open", cohortDay: "16-03-2026"),                                 // wrong shape
        new { @event = "first_open", cohortDay = 20260316, eventDay = "2026-03-16" }, // wrong type
        "first_open"));                                                            // not an object

      Assert.Equal((5L, 8L), Counts(response));
      var rows = await sql.QueryAsync(
        "select event || ' ' || to_char(cohort_day, 'YYYY-MM-DD') || ' ' || to_char(event_day, 'YYYY-MM-DD') || ' ' || coalesce(deck_slug, '-') " +
        "|| ' ' || platform || ' ' || app_version as r from anon_funnel_events order by id");
      Assert.Equal(
        [
          "first_open 2026-03-16 2026-03-16 - ios 1.9.0",
          "goal_chosen 2026-03-16 2026-03-16 aws-saa-c03 ios 1.9.0",
          "starter_started 2026-03-16 2026-03-16 claude-ccdv-f ios 1.9.0",
          "returned_day_1 2026-03-16 2026-03-17 - ios 1.9.0",
          "signup_completed 2026-03-21 2026-03-21 - ios 1.9.0",
        ],
        rows.Select(r => (string)r["r"]!).ToArray());
    });
  }

  [Fact]
  public async Task Ingest_DayWindow_IsTodayMinus400ToTodayPlus1()
  {
    await InScratchAsync(async sql =>
    {
      var response = await PostAsync(Batch(
        Ev("first_open", cohortDay: "2025-02-13"),                         // today - 400
        Ev("first_open", cohortDay: "2025-02-12"),                         // today - 401
        Ev("first_open", cohortDay: "2026-03-16", eventDay: "2026-03-22"), // eventDay today + 2
        Ev("first_open", cohortDay: "2026-03-16", eventDay: "2025-02-12"))); // eventDay today - 401
      Assert.Equal((1L, 3L), Counts(response));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events where cohort_day = '2025-02-13'"));
    });
  }

  [Fact]
  public async Task Ingest_BatchFields_And_Shape_AreValidatedAsAWhole()
  {
    await InScratchAsync(async sql =>
    {
      AutomationTestKit.AssertError(await PostAsync("{not json"), 400, "BAD_REQUEST");
      AutomationTestKit.AssertError(await PostAsync("[]"), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(JsonSerializer.Serialize(new { platform = "web", appVersion = "1.9.0", events = new[] { Ev("first_open") } })), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(JsonSerializer.Serialize(new { appVersion = "1.9.0", events = new[] { Ev("first_open") } })), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9", events = new[] { Ev("first_open") } })), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9.0-beta", events = new[] { Ev("first_open") } })), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(JsonSerializer.Serialize(new { platform = "ios", appVersion = "1234567890.1234567890.1", events = new[] { Ev("first_open") } })), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9.0", events = "first_open" })), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await PostAsync(Batch(Enumerable.Range(0, 21).Select(_ => (object)Ev("first_open")).ToArray())), 400, "VALIDATION_ERROR");
      Assert.Equal(0L, await sql.CountAsync("select count(*) from anon_funnel_events"));

      // android is a valid platform; exactly 20 events is the cap, not past it.
      var android = await PostAsync(JsonSerializer.Serialize(new { platform = "android", appVersion = "1.10.0", events = Enumerable.Range(0, 20).Select(_ => Ev("first_open")).ToArray() }));
      Assert.Equal((20L, 0L), Counts(android));
    });
  }

  [Fact]
  public async Task Ingest_OversizeBody_Is413_AndNothingIsStored()
  {
    await InScratchAsync(async sql =>
    {
      var padded = JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9.0", events = new[] { Ev("first_open") }, pad = new string('x', 8200) });
      Assert.True(Encoding.UTF8.GetByteCount(padded) > AnonFunnel.MaxBodyBytes);
      AutomationTestKit.AssertError(await PostAsync(padded), 413, "PAYLOAD_TOO_LARGE");

      // Multi-byte characters count as bytes, not chars.
      var wide = JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9.0", events = new[] { Ev("first_open") }, pad = new string('é', 4500) },
        new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
      Assert.True(wide.Length < AnonFunnel.MaxBodyBytes);
      AutomationTestKit.AssertError(await PostAsync(wide), 413, "PAYLOAD_TOO_LARGE");
      Assert.Equal(0L, await sql.CountAsync("select count(*) from anon_funnel_events"));
    });
  }

  [Fact]
  public async Task Ingest_OnlyPost_AndOnlyTheExactPath()
  {
    await InScratchAsync(async sql =>
    {
      var get = await new VpcFunction().Handler(Event("GET", EventsPath, null));
      Assert.Equal(405, get.StatusCode);

      // A suffix match would let these reach the ingest; the route is exact.
      Assert.Equal(404, (await PostAsync(Batch(Ev("first_open")), path: "/api/v1/other/api/v1/public/events")).StatusCode);
      Assert.Equal(404, (await PostAsync(Batch(Ev("first_open")), path: "/api/v1/public/events/x")).StatusCode);

      // The stage prefix is stripped before routing, like every other route.
      Assert.Equal((1L, 0L), Counts(await PostAsync(Batch(Ev("first_open")), path: "/prod/api/v1/public/events")));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events"));
    });
  }

  [Fact]
  public async Task Ingest_Budget_Is120RequestsPer60Seconds_Then429()
  {
    await InScratchAsync(async sql =>
    {
      var body = Batch(Ev("first_open"));
      for (var i = 0; i < AnonFunnel.MaxRequestsPerWindow; i++)
      {
        Assert.Equal(202, (await PostAsync(body)).StatusCode);
      }

      // Two refusals in the window: both 429 with Retry-After: 60, and exactly one anon_funnel_budget warn line.
      APIGatewayProxyResponse? first = null, second = null;
      var (stdout, stderr) = await CaptureAsync(async () =>
      {
        first = await PostAsync(body);
        second = await PostAsync(body);
      });
      foreach (var limited in new[] { first!, second! })
      {
        AutomationTestKit.AssertError(limited, 429, "RATE_LIMITED");
        Assert.Equal("60", limited.Headers["Retry-After"]);
      }
      Assert.Equal(1, Occurrences(stdout + stderr, "\"anon_funnel_budget\""));
      Assert.Equal(120L, await sql.CountAsync("select count(*) from anon_funnel_events"));

      // The window rolls over after 60 s.
      AnonFunnel.UtcNow = () => Now.AddSeconds(61);
      Assert.Equal(202, (await PostAsync(body)).StatusCode);
      Assert.Equal(121L, await sql.CountAsync("select count(*) from anon_funnel_events"));
    });
  }

  [Fact]
  public async Task Ingest_OversizeBodies_DoNotSpendTheBudget()
  {
    await InScratchAsync(async sql =>
    {
      var padded = JsonSerializer.Serialize(new { platform = "ios", appVersion = "1.9.0", events = new[] { Ev("first_open") }, pad = new string('x', 8200) });
      for (var i = 0; i < AnonFunnel.MaxRequestsPerWindow + 5; i++)
      {
        AutomationTestKit.AssertError(await PostAsync(padded), 413, "PAYLOAD_TOO_LARGE");
      }
      Assert.Equal((1L, 0L), Counts(await PostAsync(Batch(Ev("first_open")))));
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events"));
    });
  }

  private static int Occurrences(string text, string needle)
  {
    var n = 0;
    for (var i = text.IndexOf(needle, StringComparison.Ordinal); i >= 0; i = text.IndexOf(needle, i + needle.Length, StringComparison.Ordinal)) n++;
    return n;
  }

  /// <summary>Seeds <paramref name="n"/> rows received now (the server clock the daily cap reads).</summary>
  private static Task SeedReceivedNowAsync(A04Kit.Sql sql, int n) =>
    sql.ScalarAsync(
      "insert into anon_funnel_events (event, cohort_day, event_day, platform, app_version) " +
      "select 'first_open', '2026-03-16'::date, '2026-03-16'::date, 'ios', '1.9.0' from generate_series(1, $1)", n);

  [Fact]
  public async Task Ingest_DailyCap_Over20000RowsInADay_AcceptsNothing_AndWarnsOncePerHour()
  {
    await InScratchAsync(async sql =>
    {
      // At the cap (not over it) a batch is still stored.
      await SeedReceivedNowAsync(sql, AnonFunnel.DailyRowCap);
      Assert.Equal((1L, 0L), Counts(await PostAsync(Batch(Ev("first_open")))));
      Assert.Equal(AnonFunnel.DailyRowCap + 1L, await sql.CountAsync("select count(*) from anon_funnel_events"));

      // Over it: 202 with every event counted as rejected, nothing stored, one warn line for two requests.
      (long, long) firstCounts = default, secondCounts = default;
      var (stdout, stderr) = await CaptureAsync(async () =>
      {
        firstCounts = Counts(await PostAsync(Batch(Ev("first_open"), Ev("goal_chosen", deckSlug: "aws-saa-c03"), Ev("app_crashed"))));
        secondCounts = Counts(await PostAsync(Batch(Ev("first_open"))));
      });
      Assert.Equal((0L, 3L), firstCounts);
      Assert.Equal((0L, 1L), secondCounts);
      Assert.Equal(AnonFunnel.DailyRowCap + 1L, await sql.CountAsync("select count(*) from anon_funnel_events"));
      Assert.Equal(1, Occurrences(stderr, "\"anon_funnel_daily_cap\""));
      Assert.Contains("\"level\":\"warn\"", stderr, StringComparison.Ordinal);

      // Within the hour: no new line; an hour later: one more.
      AnonFunnel.UtcNow = () => Now.AddMinutes(59);
      var (_, quiet) = await CaptureAsync(async () => Counts(await PostAsync(Batch(Ev("first_open")))));
      Assert.Equal(0, Occurrences(quiet, "anon_funnel_daily_cap"));
      AnonFunnel.UtcNow = () => Now.AddMinutes(61);
      var (_, again) = await CaptureAsync(async () => Assert.Equal((0L, 1L), Counts(await PostAsync(Batch(Ev("first_open"))))));
      Assert.Equal(1, Occurrences(again, "\"anon_funnel_daily_cap\""));
      Assert.Equal(AnonFunnel.DailyRowCap + 1L, await sql.CountAsync("select count(*) from anon_funnel_events"));

      // Rows received more than a day ago do not count against the cap.
      await sql.ScalarAsync("update anon_funnel_events set received_at = now() - interval '25 hours'");
      Assert.Equal((1L, 0L), Counts(await PostAsync(Batch(Ev("first_open")))));
    });
  }

  [Fact]
  public async Task Ingest_NoPgEnv_Is503ConfigError_EvenWhenNoEventIsValid()
  {
    await InScratchAsync(async _ =>
    {
      var saved = Environment.GetEnvironmentVariable("PGHOST");
      try
      {
        Environment.SetEnvironmentVariable("PGHOST", null);
        Pg.Reset();
        AutomationTestKit.AssertError(await PostAsync(Batch(Ev("first_open"))), 503, "CONFIG_ERROR");
        AutomationTestKit.AssertError(await PostAsync(Batch()), 503, "CONFIG_ERROR");
        AutomationTestKit.AssertError(await PostAsync(Batch(Ev("app_crashed"))), 503, "CONFIG_ERROR");
      }
      finally
      {
        Environment.SetEnvironmentVariable("PGHOST", saved);
        Pg.Reset();
      }
    });
  }

  [Fact]
  public async Task Ingest_IgnoresAnyBearer_CreatesNoUserRow_AndNeverLogsTheBodyOrTheSub()
  {
    await InScratchAsync(async sql =>
    {
      const string sub = "a01-signed-in-sub-7f3c";
      APIGatewayProxyResponse? response = null;
      var (stdout, stderr) = await CaptureAsync(async () =>
        response = await PostAsync(Batch(Ev("signup_completed", deckSlug: "csharp-basics"), Ev("app_crashed")), sub));

      Assert.Equal((1L, 1L), Counts(response!));
      // A live slug on a step that carries no deck is accepted but stored as null.
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events where event = 'signup_completed' and deck_slug is null"));
      // Smoke check only: nothing on this path writes users; the log assertions below are the real proof.
      Assert.Equal(0L, await sql.CountAsync("select count(*) from users where user_sub = $1", sub));

      // Positive control: the capture worked and holds the dispatcher line for this route, with no user.
      Assert.True(Log.IsEnabled("info"), "LOG_LEVEL must allow info lines for this test to prove anything");
      var dispatcherLine = stdout.Split('\n').SingleOrDefault(l => l.Contains("\"path\":\"/api/v1/public/events\"", StringComparison.Ordinal));
      Assert.NotNull(dispatcherLine);
      Assert.Contains("\"userSub\":null", dispatcherLine, StringComparison.Ordinal);
      Assert.Contains("\"isAdmin\":false", dispatcherLine, StringComparison.Ordinal);

      var logs = stdout + stderr;
      Assert.DoesNotContain(sub, logs, StringComparison.Ordinal);
      Assert.DoesNotContain("signup_completed", logs, StringComparison.Ordinal);
      Assert.DoesNotContain("app_crashed", logs, StringComparison.Ordinal);
      Assert.DoesNotContain("2026-03-16", logs, StringComparison.Ordinal);
    });
  }

  [Fact]
  public async Task Ingest_BeforeMigration043_Answers503_AndTheStepStillRuns()
  {
    await InScratchAsync(async sql =>
    {
      AutomationTestKit.AssertError(await PostAsync(Batch(Ev("first_open"))), 503, "NOT_READY");
      // A readiness probe with no valid event still reaches the table.
      AutomationTestKit.AssertError(await PostAsync(Batch()), 503, "NOT_READY");
      AutomationTestKit.AssertError(await PostAsync(Batch(Ev("app_crashed"), Ev("first_open", cohortDay: "2026-03-22"))), 503, "NOT_READY");
      AutomationTestKit.AssertError(await FunnelAsync(Admin()), 503, "NOT_READY");

      await using var conn = await sql.OpenAsync();
      Assert.Equal(0L, await AnonFunnel.DeleteExpiredAsync(conn));
      Assert.Equal(UsageAnalytics.Outcome.Computed, await UsageAnalytics.RunIfDueAsync(conn));
    }, maxVersion: 42);
  }

  // ---------------------------------------------------------------- retention

  [Fact]
  public async Task Retention_DeletesRowsReceivedMoreThan400DaysAgo_ByTheFunnelClock()
  {
    await InScratchAsync(async sql =>
    {
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-401));
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-400).AddMinutes(-1));
      await InsertAsync(sql, "first_open", "2025-02-14", receivedAt: Now.AddDays(-400).AddMinutes(1));
      await InsertAsync(sql, "goal_chosen", "2026-03-16", "aws-saa-c03");

      // The delete reads AnonFunnel.UtcNow, not the usage analytics clock.
      UsageAnalytics.UtcNow = () => Now.AddDays(-30);
      await using var conn = await sql.OpenAsync();
      Assert.Equal(2L, await AnonFunnel.DeleteExpiredAsync(conn));
      Assert.Equal(2L, await sql.CountAsync("select count(*) from anon_funnel_events"));
      Assert.Equal(0L, await sql.CountAsync("select count(*) from anon_funnel_events where received_at < $1", Now.AddDays(-400)));
    });
  }

  [Fact]
  public async Task Retention_DeletesInCappedBatches()
  {
    await InScratchAsync(async sql =>
    {
      for (var i = 0; i < 3; i++) await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-401 - i));
      AnonFunnel.RetentionBatch = 2;
      await using var conn = await sql.OpenAsync();
      Assert.Equal(2L, await AnonFunnel.DeleteExpiredAsync(conn));
      Assert.Equal(1L, await AnonFunnel.DeleteExpiredAsync(conn));
      Assert.Equal(0L, await AnonFunnel.DeleteExpiredAsync(conn));
    });
  }

  [Fact]
  public async Task Retention_RunsInsideTheAutomationTick()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-401));
      await InsertAsync(sql, "first_open", "2026-03-16");

      var tick = AutomationTestKit.Data(await A04Kit.TickAsync());
      Assert.Empty(tick.GetProperty("failedSteps").EnumerateArray());
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events"));

      // Its own step, so it runs on every tick, not only on the tick that computes the daily rollup.
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-500));
      Assert.Empty(AutomationTestKit.Data(await A04Kit.TickAsync()).GetProperty("failedSteps").EnumerateArray());
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events"));
    });
  }

  private static string[] FailedSteps(APIGatewayProxyResponse tick) =>
    AutomationTestKit.Data(tick).GetProperty("failedSteps").EnumerateArray().Select(e => e.GetString()!).ToArray();

  [Fact]
  public async Task Retention_StillRuns_WhenTheDailyRollupFails()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-401));
      // Every rollup insert now violates a check: the analytics step throws (not a missing table).
      await sql.ScalarAsync("alter table analytics_daily add constraint it_f05_rollup_fails check (dau < 0)");

      var failed = FailedSteps(await A04Kit.TickAsync());
      Assert.Contains("analytics_daily", failed);
      Assert.DoesNotContain("anon_funnel_retention", failed);
      Assert.Equal(0L, await sql.CountAsync("select count(*) from anon_funnel_events"));

      // A later tick the same day: the rollup backs off, the retention still runs.
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-402));
      Assert.Empty(FailedSteps(await A04Kit.TickAsync()));
      Assert.Equal(0L, await sql.CountAsync("select count(*) from anon_funnel_events"));
    });
  }

  [Fact]
  public async Task Retention_Failure_HitsItsStatementTimeout_IsRecordedAsItsOwnFailedStep_AndTheRollupStillComputes()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      await InsertAsync(sql, "first_open", "2025-02-01", receivedAt: Now.AddDays(-401));
      await sql.ScalarAsync(
        """
        create function it_f05_slow_delete() returns trigger language plpgsql as $$ begin perform pg_sleep(2); return old; end $$;
        create trigger it_f05_slow_delete before delete on anon_funnel_events for each row execute function it_f05_slow_delete();
        """);
      AnonFunnel.RetentionStatementTimeout = TimeSpan.FromMilliseconds(100);

      APIGatewayProxyResponse? tick = null;
      var (_, stderr) = await CaptureAsync(async () => tick = await A04Kit.TickAsync());
      Assert.Equal(["anon_funnel_retention"], FailedSteps(tick!));
      Assert.Contains("\"anon_funnel_retention_failed\"", stderr, StringComparison.Ordinal);
      Assert.Contains("\"sqlState\":\"57014\"", stderr, StringComparison.Ordinal);
      Assert.Equal(1L, await sql.CountAsync("select count(*) from anon_funnel_events"));
      Assert.Equal(UsageAnalytics.RecomputeDays, await sql.CountAsync("select count(*) from analytics_daily"));
    });
  }

  // ---------------------------------------------------------------- GET /api/v1/admin/analytics/funnel

  private static AuthContext Admin() => AutomationTestKit.Ctx("it-a01-admin", agent: false);

  private static AuthContext Learner() => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: "it-a01-learner", Username: null, Groups: [], IsSuperAdmin: false, IsEditor: false, IsAdmin: false);

  private static Task<APIGatewayProxyResponse> FunnelAsync(AuthContext auth, string? days = null, string method = "GET") =>
    AutomationTestKit.CallAsync(AnonFunnel.HandleFunnel, method, FunnelPath, null, auth,
      days is null ? null : new Dictionary<string, string> { ["days"] = days });

  private static long C(JsonElement counts, string ev) => counts.GetProperty(ev).GetInt64();

  private static decimal? R(JsonElement conversion, string ev) =>
    conversion.GetProperty(ev).ValueKind == JsonValueKind.Null ? null : conversion.GetProperty(ev).GetDecimal();

  /// <summary>
  /// Week of Mon 2026-03-09: 4 first opens, 2 goals (x2 aws), 1 starter started (aws), 1 day-1 return.
  /// Week of Mon 2026-03-16: 2 first opens, 1 goal (claude), 1 starter started + completed + first pack (claude), 1 signup started.
  /// Plus a 2025-11 cohort (outside 90 days) and a cohort whose week has goals but no first open.
  /// </summary>
  private static async Task SeedFunnelAsync(A04Kit.Sql sql)
  {
    foreach (var d in new[] { "2026-03-09", "2026-03-10", "2026-03-15", "2026-03-15" }) await InsertAsync(sql, "first_open", d);
    await InsertAsync(sql, "goal_chosen", "2026-03-09", "aws-saa-c03");
    await InsertAsync(sql, "goal_chosen", "2026-03-15", "aws-saa-c03");
    await InsertAsync(sql, "starter_started", "2026-03-15", "aws-saa-c03");
    await InsertAsync(sql, "returned_day_1", "2026-03-10");

    await InsertAsync(sql, "first_open", "2026-03-16");
    await InsertAsync(sql, "first_open", "2026-03-20");
    await InsertAsync(sql, "goal_chosen", "2026-03-16", "claude-ccdv-f");
    await InsertAsync(sql, "starter_started", "2026-03-16", "claude-ccdv-f");
    await InsertAsync(sql, "starter_completed", "2026-03-16", "claude-ccdv-f");
    await InsertAsync(sql, "first_pack_opened", "2026-03-16", "claude-ccdv-f");
    await InsertAsync(sql, "signup_started", "2026-03-20");

    await InsertAsync(sql, "first_open", "2025-11-03");
    await InsertAsync(sql, "goal_chosen", "2025-11-03", "csharp-basics");
    await InsertAsync(sql, "goal_chosen", "2026-02-02", "csharp-basics");
  }

  [Fact]
  public async Task Funnel_AggregatesPerCohortWeek_Overall_AndByDeck()
  {
    await InScratchAsync(async sql =>
    {
      await SeedFunnelAsync(sql);
      var data = AutomationTestKit.Data(await FunnelAsync(Admin()));

      Assert.Equal(90, data.GetProperty("days").GetInt32());
      Assert.Equal("2025-12-20", data.GetProperty("fromCohortDay").GetString());
      Assert.Equal(
        ["first_open", "goal_chosen", "starter_started", "starter_completed", "first_pack_opened", "returned_day_1", "returned_day_7", "signup_started", "signup_completed"],
        data.GetProperty("events").EnumerateArray().Select(e => e.GetString()!).ToArray());

      var overall = data.GetProperty("overall");
      var oc = overall.GetProperty("counts");
      Assert.Equal((6L, 4L, 2L, 1L, 1L, 1L, 0L, 1L, 0L),
        (C(oc, "first_open"), C(oc, "goal_chosen"), C(oc, "starter_started"), C(oc, "starter_completed"), C(oc, "first_pack_opened"),
         C(oc, "returned_day_1"), C(oc, "returned_day_7"), C(oc, "signup_started"), C(oc, "signup_completed")));
      var ov = overall.GetProperty("conversion");
      Assert.Equal(0.6667m, R(ov, "goal_chosen"));
      Assert.Equal(0.3333m, R(ov, "starter_started"));
      Assert.Equal(0.1667m, R(ov, "first_pack_opened"));
      Assert.Equal(0m, R(ov, "signup_completed"));
      Assert.False(ov.TryGetProperty("first_open", out _));

      var weeks = data.GetProperty("weeks").EnumerateArray().ToArray();
      Assert.Equal(["2026-02-02", "2026-03-09", "2026-03-16"], weeks.Select(w => w.GetProperty("weekStart").GetString()!).ToArray());

      // A week with steps but no first open: counts kept, conversion null (never a division by zero).
      Assert.Equal(0L, C(weeks[0].GetProperty("counts"), "first_open"));
      Assert.Equal(1L, C(weeks[0].GetProperty("counts"), "goal_chosen"));
      Assert.Null(R(weeks[0].GetProperty("conversion"), "goal_chosen"));

      var w1 = weeks[1];
      Assert.Equal((4L, 2L, 1L, 1L), (C(w1.GetProperty("counts"), "first_open"), C(w1.GetProperty("counts"), "goal_chosen"),
        C(w1.GetProperty("counts"), "starter_started"), C(w1.GetProperty("counts"), "returned_day_1")));
      Assert.Equal(0.5m, R(w1.GetProperty("conversion"), "goal_chosen"));
      Assert.Equal(0.25m, R(w1.GetProperty("conversion"), "returned_day_1"));
      Assert.Equal(0m, R(w1.GetProperty("conversion"), "starter_completed"));

      var w2 = weeks[2];
      Assert.Equal((2L, 1L, 1L, 1L), (C(w2.GetProperty("counts"), "first_open"), C(w2.GetProperty("counts"), "starter_completed"),
        C(w2.GetProperty("counts"), "first_pack_opened"), C(w2.GetProperty("counts"), "signup_started")));
      Assert.Equal(0.5m, R(w2.GetProperty("conversion"), "first_pack_opened"));

      var decks = data.GetProperty("byDeck").EnumerateArray().ToArray();
      Assert.Equal(["aws-saa-c03", "claude-ccdv-f", "csharp-basics"], decks.Select(d => d.GetProperty("deckSlug").GetString()!).ToArray());
      var aws = decks[0].GetProperty("counts");
      Assert.Equal((2L, 1L, 0L, 0L), (C(aws, "goal_chosen"), C(aws, "starter_started"), C(aws, "starter_completed"), C(aws, "first_pack_opened")));
      var claude = decks[1].GetProperty("counts");
      Assert.Equal((1L, 1L, 1L, 1L), (C(claude, "goal_chosen"), C(claude, "starter_started"), C(claude, "starter_completed"), C(claude, "first_pack_opened")));
      var csharp = decks[2].GetProperty("counts");
      Assert.Equal(1L, C(csharp, "goal_chosen"));
      Assert.Equal(4, decks[0].GetProperty("counts").EnumerateObject().Count());
    });
  }

  private static AuthContext Editor(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: ["editor"], IsSuperAdmin: false, IsEditor: true, IsAdmin: true);

  private static async Task<long> DeckAsync(A04Kit.Sql sql, string slug) =>
    Convert.ToInt64(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, $1, 'tests') returning id", slug),
      System.Globalization.CultureInfo.InvariantCulture);

  [Fact]
  public async Task Funnel_EditorWithOneReadableDeck_SeesThatDeckOnly_InByDeck_Overall_AndWeeks()
  {
    await InScratchAsync(async sql =>
    {
      await SeedFunnelAsync(sql);
      var aws = await DeckAsync(sql, "aws-saa-c03");
      var claude = await DeckAsync(sql, "claude-ccdv-f");
      await sql.ScalarAsync("insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)", "it-a01-editor", aws);
      await sql.ScalarAsync("insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 0, 0)", "it-a01-editor", claude);

      var data = AutomationTestKit.Data(await FunnelAsync(Editor("it-a01-editor")));
      Assert.Equal(["aws-saa-c03"], data.GetProperty("byDeck").EnumerateArray().Select(d => d.GetProperty("deckSlug").GetString()!).ToArray());

      // Overall and weeks drop the rows of decks the caller cannot read, so byDeck cannot be subtracted from them;
      // rows with no deck are kept.
      var oc = data.GetProperty("overall").GetProperty("counts");
      Assert.Equal((6L, 2L, 1L, 0L, 0L, 1L, 1L),
        (C(oc, "first_open"), C(oc, "goal_chosen"), C(oc, "starter_started"), C(oc, "starter_completed"), C(oc, "first_pack_opened"),
         C(oc, "returned_day_1"), C(oc, "signup_started")));
      var weeks = data.GetProperty("weeks").EnumerateArray().ToArray();
      Assert.Equal(["2026-03-09", "2026-03-16"], weeks.Select(w => w.GetProperty("weekStart").GetString()!).ToArray());
      Assert.Equal(0L, C(weeks[1].GetProperty("counts"), "goal_chosen"));
      Assert.Equal(0L, C(weeks[1].GetProperty("counts"), "first_pack_opened"));
      Assert.Equal(2L, C(weeks[1].GetProperty("counts"), "first_open"));

      // An editor with no grant at all: no deck, and no deck-carrying step in overall.
      var none = AutomationTestKit.Data(await FunnelAsync(Editor("it-a01-editor-none")));
      Assert.Empty(none.GetProperty("byDeck").EnumerateArray());
      var nc = none.GetProperty("overall").GetProperty("counts");
      Assert.Equal((6L, 0L, 0L, 0L, 0L), (C(nc, "first_open"), C(nc, "goal_chosen"), C(nc, "starter_started"), C(nc, "starter_completed"), C(nc, "first_pack_opened")));

      // A super_admin still sees every deck.
      Assert.Equal(3, AutomationTestKit.Data(await FunnelAsync(Admin())).GetProperty("byDeck").GetArrayLength());
    });
  }

  [Fact]
  public async Task Funnel_DaysParam_WidensTheWindow_AndIsValidated()
  {
    await InScratchAsync(async sql =>
    {
      await SeedFunnelAsync(sql);
      var wide = AutomationTestKit.Data(await FunnelAsync(Admin(), days: "200"));
      Assert.Equal(7L, C(wide.GetProperty("overall").GetProperty("counts"), "first_open"));
      Assert.Equal("2025-11-03", wide.GetProperty("weeks")[0].GetProperty("weekStart").GetString());

      AutomationTestKit.AssertError(await FunnelAsync(Admin(), days: "0"), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await FunnelAsync(Admin(), days: "401"), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await FunnelAsync(Admin(), days: "abc"), 400, "VALIDATION_ERROR");
    });
  }

  [Fact]
  public async Task Funnel_EmptyTable_AnswersZeros()
  {
    await InScratchAsync(async _ =>
    {
      var data = AutomationTestKit.Data(await FunnelAsync(Admin()));
      Assert.Empty(data.GetProperty("weeks").EnumerateArray());
      Assert.Empty(data.GetProperty("byDeck").EnumerateArray());
      Assert.Equal(0L, C(data.GetProperty("overall").GetProperty("counts"), "first_open"));
      Assert.Null(R(data.GetProperty("overall").GetProperty("conversion"), "goal_chosen"));
    });
  }

  [Fact]
  public async Task Funnel_RequiresAdmin_AndGet()
  {
    await InScratchAsync(async _ =>
    {
      Assert.Equal(403, (await FunnelAsync(Learner())).StatusCode);
      Assert.Equal(405, (await FunnelAsync(Admin(), method: "POST")).StatusCode);
    });
  }

  [Fact]
  public async Task Funnel_IsRoutedExactly_ThroughTheVpcFunction()
  {
    await InScratchAsync(async _ =>
    {
      // No claims: the admin gate answers, which proves the route reached the handler.
      var anonymous = await new VpcFunction().Handler(Event("GET", FunnelPath, null));
      Assert.Equal(403, anonymous.StatusCode);
      var suffixed = await new VpcFunction().Handler(Event("GET", "/api/v1/x" + FunnelPath, null));
      Assert.Equal(404, suffixed.StatusCode);
    });
  }

  [Fact]
  public void RouteMetrics_LabelsBothRoutes()
  {
    Assert.Equal(EventsPath, RouteMetrics.RouteFor(EventsPath));
    Assert.Equal(EventsPath, RouteMetrics.RouteFor("/api/v1/public/events/"));
    Assert.Equal(FunnelPath, RouteMetrics.RouteFor(FunnelPath));
    Assert.Equal(RouteMetrics.UnmatchedRoute, RouteMetrics.RouteFor("/api/v1/x/api/v1/public/events"));
    Assert.Contains(EventsPath, RouteMetrics.KnownRoutes);
    Assert.Contains(FunnelPath, RouteMetrics.KnownRoutes);
  }
}
