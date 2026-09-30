using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Analytics;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R20 V08 usage analytics (contract R20-00 §7): the <c>analytics_daily</c> tick step over seeded reviews across days,
/// users and decks (exact DAU/WAU/MAU, reviews, new users, cards learned, D1/D7 retention, deck rows), the exclusion
/// list, an idempotent rerun, once per UTC day through the tick, the skip before migration 040 and
/// <c>GET /api/v1/admin/analytics/usage</c>. Every test runs in its own scratch database with a fixed "today"
/// (2026-03-20 UTC); the clock and <c>ANALYTICS_EXCLUDED_SUBS</c> are restored afterwards.
/// </summary>
[Collection(PostgresCollection.Name)]
public class UsageAnalyticsTests
{
  private const string Scratch = "it_v08_usage";
  private const string UsagePath = "/api/v1/admin/analytics/usage";
  private static readonly DateOnly Today = new(2026, 3, 20);
  private static readonly DateTime Now = new(2026, 3, 20, 10, 0, 0, DateTimeKind.Utc);

  private static readonly string[] DayKeys =
    ["day", "dau", "wau", "mau", "reviews", "newUsers", "cardsLearned", "d1Retention", "d7Retention"];

  private static readonly string[] DeckKeys = ["deckSlug", "activeUsers30d", "reviews30d", "newLearners30d"];

  private readonly PostgresFixture _db;

  public UsageAnalyticsTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- kit

  /// <summary>Runs <paramref name="body"/> in a scratch database with the clock at <see cref="Now"/> and the exclusion list set.</summary>
  private async Task InScratchAsync(Func<A04Kit.Sql, Task> body, string? excluded = null, int maxVersion = int.MaxValue)
  {
    var savedClock = UsageAnalytics.UtcNow;
    var savedExcluded = Environment.GetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv);
    try
    {
      UsageAnalytics.UtcNow = () => Now;
      Environment.SetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv, excluded);
      await A05Kit.InScratchAsync(_db, Scratch, body, maxVersion);
    }
    finally
    {
      UsageAnalytics.UtcNow = savedClock;
      Environment.SetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv, savedExcluded);
    }
  }

  private static async Task ReviewAsync(A04Kit.Sql sql, string sub, string deck, string card, string at, string eventType = "card_reviewed")
  {
    await sql.ScalarAsync("insert into users (user_sub) values ($1) on conflict do nothing", sub);
    await sql.ScalarAsync(
      "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, rating, event_time, event_type) values ($1, $2, $3, $4, 3, $5, $6)",
      Guid.NewGuid(), sub, deck, card, DateTime.Parse(at, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
      eventType);
  }

  /// <summary>
  /// Users A..D and the excluded E over decks x and y (see the notes' worked example):
  /// A reviews x/c1 on 03-05 (before the window), x/c1 + x/c2 on 03-12 and x/c1 on 03-13; B starts on 03-12 (x/c1), then
  /// y/c9 on 03-13 and x/c1 on 03-19; C starts at 03-12 23:30Z (x/c1) and returns on 03-19 (x/c3); D reviews y/c9 twice
  /// at 03-13 00:00Z and once today (not a complete day); E reviews on 03-12 and 03-13; B has a non-review event on 03-14.
  /// </summary>
  private static async Task SeedAsync(A04Kit.Sql sql)
  {
    await ReviewAsync(sql, "v08-a", "x", "c1", "2026-03-05T08:00:00Z");
    await ReviewAsync(sql, "v08-a", "x", "c1", "2026-03-12T08:00:00Z");
    await ReviewAsync(sql, "v08-a", "x", "c2", "2026-03-12T09:00:00Z");
    await ReviewAsync(sql, "v08-a", "x", "c1", "2026-03-13T08:00:00Z");
    await ReviewAsync(sql, "v08-b", "x", "c1", "2026-03-12T10:00:00Z");
    await ReviewAsync(sql, "v08-b", "y", "c9", "2026-03-13T10:00:00Z");
    await ReviewAsync(sql, "v08-b", "x", "c1", "2026-03-14T10:00:00Z", eventType: "card_opened");
    await ReviewAsync(sql, "v08-b", "x", "c1", "2026-03-19T10:00:00Z");
    await ReviewAsync(sql, "v08-c", "x", "c1", "2026-03-12T23:30:00Z");
    await ReviewAsync(sql, "v08-c", "x", "c3", "2026-03-19T11:00:00Z");
    await ReviewAsync(sql, "v08-d", "y", "c9", "2026-03-13T00:00:00Z");
    await ReviewAsync(sql, "v08-d", "y", "c9", "2026-03-13T00:10:00Z");
    await ReviewAsync(sql, "v08-d", "y", "c9", "2026-03-20T01:00:00Z");
    await ReviewAsync(sql, "v08-e", "x", "c1", "2026-03-12T12:00:00Z");
    await ReviewAsync(sql, "v08-e", "y", "c5", "2026-03-13T12:00:00Z");
  }

  private sealed record DayRow(string Day, long Dau, long Wau, long Mau, long Reviews, long NewUsers, long CardsLearned, decimal? D1, decimal? D7);

  private static async Task<List<DayRow>> DaysAsync(A04Kit.Sql sql) =>
    (await sql.QueryAsync(
      "select to_char(day, 'YYYY-MM-DD') as day, dau, wau, mau, reviews, new_users, cards_learned, d1_retention, d7_retention from analytics_daily order by day"))
    .Select(r => new DayRow((string)r["day"]!, A04Kit.Long(r["dau"]), A04Kit.Long(r["wau"]), A04Kit.Long(r["mau"]), A04Kit.Long(r["reviews"]),
      A04Kit.Long(r["new_users"]), A04Kit.Long(r["cards_learned"]), r["d1_retention"] as decimal?, r["d7_retention"] as decimal?))
    .ToList();

  private static async Task<List<string>> DeckRowsAsync(A04Kit.Sql sql) =>
    (await sql.QueryAsync(
      "select to_char(day, 'YYYY-MM-DD') || ' ' || deck_slug || ' ' || active_users || ' ' || reviews || ' ' || new_learners as r " +
      "from analytics_deck_daily order by day, deck_slug"))
    .Select(r => (string)r["r"]!).ToList();

  /// <summary>The expected rows with E excluded (the notes' worked example).</summary>
  private static readonly DayRow[] Expected =
  [
    new("2026-03-12", 3, 3, 3, 4, 2, 3, 0.5m, 1m),
    new("2026-03-13", 3, 4, 4, 4, 1, 2, 0m, null),
    new("2026-03-14", 0, 4, 4, 0, 0, 0, null, null),
    new("2026-03-15", 0, 4, 4, 0, 0, 0, null, null),
    new("2026-03-16", 0, 4, 4, 0, 0, 0, null, null),
    new("2026-03-17", 0, 4, 4, 0, 0, 0, null, null),
    new("2026-03-18", 0, 4, 4, 0, 0, 0, null, null),
    new("2026-03-19", 2, 4, 4, 2, 0, 1, null, null),
  ];

  private static readonly string[] ExpectedDecks =
  [
    "2026-03-12 x 3 4 2",
    "2026-03-13 x 1 1 0",
    "2026-03-13 y 2 3 2",
    "2026-03-19 x 2 2 0",
  ];

  private static AuthContext Admin(string sub) => AutomationTestKit.Ctx(sub, agent: false);

  private static AuthContext Editor(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: ["editor"], IsSuperAdmin: false, IsEditor: true, IsAdmin: true);

  private static AuthContext Learner(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: [], IsSuperAdmin: false, IsEditor: false, IsAdmin: false);

  private static Task<APIGatewayProxyResponse> UsageAsync(AuthContext auth, string? days = null) =>
    AutomationTestKit.CallAsync(UsageAnalytics.HandleUsage, "GET", UsagePath, null, auth,
      days is null ? null : new Dictionary<string, string> { ["days"] = days });

  private static async Task<UsageAnalytics.Outcome> ComputeAsync(A04Kit.Sql sql)
  {
    await using var conn = await sql.OpenAsync();
    return await UsageAnalytics.ComputeAsync(conn, Today);
  }

  // ---------------------------------------------------------------- the step

  [Fact]
  public async Task Analytics_Compute_ExactDailyMetrics_WithExclusion()
  {
    await InScratchAsync(async sql =>
    {
      await SeedAsync(sql);
      Assert.Equal(UsageAnalytics.Outcome.Computed, await ComputeAsync(sql));

      Assert.Equal(Expected, await DaysAsync(sql));
      Assert.Equal(ExpectedDecks, await DeckRowsAsync(sql));
      // Every row carries the computation time of the clock.
      Assert.Equal(8L, await sql.CountAsync("select count(*) from analytics_daily where computed_at = $1", Now));
    }, excluded: " v08-e , ,v08-e");
  }

  [Fact]
  public async Task Analytics_Compute_WithoutExclusion_CountsEveryUser()
  {
    await InScratchAsync(async sql =>
    {
      await SeedAsync(sql);
      await ComputeAsync(sql);

      var days = await DaysAsync(sql);
      // E adds one active and new user on 03-12, a D1 return (E is back on 03-13) and a card on each day.
      Assert.Equal(new DayRow("2026-03-12", 4, 4, 4, 5, 3, 4, 0.6667m, 0.6667m), days[0]);
      Assert.Equal(new DayRow("2026-03-13", 4, 5, 5, 5, 1, 3, 0m, null), days[1]);
      Assert.Contains("2026-03-12 x 4 5 3", await DeckRowsAsync(sql));
      Assert.Contains("2026-03-13 y 3 4 3", await DeckRowsAsync(sql));
    });
  }

  [Fact]
  public async Task Analytics_Compute_Rerun_IsIdempotent_KeepsPremiumActive_DropsStaleDeckRows()
  {
    await InScratchAsync(async sql =>
    {
      await SeedAsync(sql);
      await sql.ScalarAsync("insert into analytics_daily (day, dau, mau, reviews, premium_active) values ('2026-03-15', 99, 99, 99, 7)");
      await sql.ScalarAsync("insert into analytics_deck_daily (day, deck_slug, active_users, reviews) values ('2026-03-16', 'gone', 5, 5)");
      // Outside the window: never touched.
      await sql.ScalarAsync("insert into analytics_daily (day, dau, mau, reviews) values ('2026-03-01', 42, 42, 42)");

      await ComputeAsync(sql);
      var first = await DaysAsync(sql);
      await ComputeAsync(sql);

      Assert.Equal(first, await DaysAsync(sql));
      Assert.Equal(Expected, first.Where(d => d.Day != "2026-03-01"));
      Assert.Equal(ExpectedDecks, await DeckRowsAsync(sql));
      Assert.Equal(7L, await sql.CountAsync("select premium_active from analytics_daily where day = '2026-03-15'"));
      Assert.Equal(42L, await sql.CountAsync("select dau from analytics_daily where day = '2026-03-01'"));
      Assert.Null(await sql.ScalarAsync("select computed_at from analytics_daily where day = '2026-03-01'"));
    }, excluded: "v08-e");
  }

  [Fact]
  public async Task Analytics_Retention_MaturesOnlyAfterTheCohortDay()
  {
    await InScratchAsync(async sql =>
    {
      // One new user on 03-18 who is back on 03-19: D1 of 03-18 is 1 (03-19 is complete), D7 not yet.
      await ReviewAsync(sql, "v08-late", "x", "c1", "2026-03-18T10:00:00Z");
      await ReviewAsync(sql, "v08-late", "x", "c1", "2026-03-19T10:00:00Z");
      // A new user on 03-19 comes back today, which is not complete: D1 of 03-19 stays null.
      await ReviewAsync(sql, "v08-today", "x", "c1", "2026-03-19T10:00:00Z");
      await ReviewAsync(sql, "v08-today", "x", "c1", "2026-03-20T09:00:00Z");
      await ComputeAsync(sql);

      var days = await DaysAsync(sql);
      Assert.Equal((1m, (decimal?)null), (days.Single(d => d.Day == "2026-03-18").D1!.Value, days.Single(d => d.Day == "2026-03-18").D7));
      Assert.Equal((1L, (decimal?)null), (days.Single(d => d.Day == "2026-03-19").NewUsers, days.Single(d => d.Day == "2026-03-19").D1));
    });
  }

  [Fact]
  public async Task Analytics_Tick_RunsOncePerUtcDay()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      await SeedAsync(sql);

      var first = AutomationTestKit.Data(await A04Kit.TickAsync());
      Assert.Empty(first.GetProperty("failedSteps").EnumerateArray());
      Assert.Equal(8L, await sql.CountAsync("select count(*) from analytics_daily where computed_at = $1", Now));

      // A later tick the same UTC day recomputes nothing, even after a new review arrived.
      UsageAnalytics.UtcNow = () => Now.AddHours(13).AddMinutes(59);
      await ReviewAsync(sql, "v08-f", "x", "c1", "2026-03-19T20:00:00Z");
      AutomationTestKit.Data(await A04Kit.TickAsync());
      Assert.Equal(0L, await sql.CountAsync("select count(*) from analytics_daily where computed_at <> $1", Now));
      Assert.Equal(2L, await sql.CountAsync("select dau from analytics_daily where day = '2026-03-19'"));

      // The next UTC day recomputes the 8 days before it, with the late review.
      var tomorrow = new DateTime(2026, 3, 21, 0, 5, 0, DateTimeKind.Utc);
      UsageAnalytics.UtcNow = () => tomorrow;
      AutomationTestKit.Data(await A04Kit.TickAsync());
      Assert.Equal(8L, await sql.CountAsync("select count(*) from analytics_daily where computed_at = $1", tomorrow));
      Assert.Equal(3L, await sql.CountAsync("select dau from analytics_daily where day = '2026-03-19'"));
      Assert.Equal("2026-03-13", await sql.ScalarAsync("select to_char(min(day), 'YYYY-MM-DD') from analytics_daily where computed_at = $1", tomorrow));
      Assert.Equal("2026-03-20", await sql.ScalarAsync("select to_char(max(day), 'YYYY-MM-DD') from analytics_daily"));
    }, excluded: "v08-e");
  }

  [Fact]
  public async Task Analytics_BeforeMigration040_StepSkips_RouteAnswers503()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      await SeedAsync(sql);
      await using (var conn = await sql.OpenAsync())
      {
        Assert.Equal(UsageAnalytics.Outcome.NotMigrated, await UsageAnalytics.RunIfDueAsync(conn));
        Assert.Equal(UsageAnalytics.Outcome.NotMigrated, await UsageAnalytics.ComputeAsync(conn, Today));
      }

      // The tick survives it: no failed step, nothing written.
      var tick = AutomationTestKit.Data(await A04Kit.TickAsync());
      Assert.Empty(tick.GetProperty("failedSteps").EnumerateArray());
      Assert.Equal(0L, await sql.CountAsync("select count(*) from analytics_daily"));

      AutomationTestKit.AssertError(await UsageAsync(Admin("it-v08-admin")), 503, "NOT_READY");
    }, maxVersion: 39);
  }

  // ---------------------------------------------------------------- GET /api/v1/admin/analytics/usage

  [Fact]
  public async Task Usage_Route_ReturnsDaysDecksAndExclusionCount()
  {
    await InScratchAsync(async sql =>
    {
      await SeedAsync(sql);
      await ComputeAsync(sql);

      var data = AutomationTestKit.Data(await UsageAsync(Editor("it-v08-editor")));
      Assert.Equal(["days", "decks", "excludedSubsCount", "lastComputedAt"], A04Kit.Keys(data));
      Assert.Equal(1, data.GetProperty("excludedSubsCount").GetInt32());
      Assert.Equal("2026-03-20T10:00:00.000Z", data.GetProperty("lastComputedAt").GetString());

      var days = data.GetProperty("days").EnumerateArray().ToList();
      Assert.All(days, d => Assert.Equal(DayKeys, A04Kit.Keys(d)));
      Assert.Equal(Expected.Select(e => e.Day), days.Select(d => d.GetProperty("day").GetString()));
      var first = days[0];
      Assert.Equal((3, 3, 3, 4, 2, 3), (first.GetProperty("dau").GetInt32(), first.GetProperty("wau").GetInt32(), first.GetProperty("mau").GetInt32(),
        first.GetProperty("reviews").GetInt32(), first.GetProperty("newUsers").GetInt32(), first.GetProperty("cardsLearned").GetInt32()));
      Assert.Equal((0.5m, 1m), (first.GetProperty("d1Retention").GetDecimal(), first.GetProperty("d7Retention").GetDecimal()));
      Assert.Equal(JsonValueKind.Null, days[1].GetProperty("d7Retention").ValueKind);

      // Last 30 complete days, E excluded: x has A (from 03-05), B and C; y has B and D (D's review today does not count).
      var decks = data.GetProperty("decks").EnumerateArray().ToList();
      Assert.All(decks, d => Assert.Equal(DeckKeys, A04Kit.Keys(d)));
      Assert.Equal(["x 3 8 3", "y 2 3 2"], decks.Select(d =>
        $"{d.GetProperty("deckSlug").GetString()} {d.GetProperty("activeUsers30d").GetInt64()} {d.GetProperty("reviews30d").GetInt64()} {d.GetProperty("newLearners30d").GetInt64()}"));

      // days=2: the last two complete days only.
      var two = AutomationTestKit.Data(await UsageAsync(Admin("it-v08-admin"), "2")).GetProperty("days").EnumerateArray()
        .Select(d => d.GetProperty("day").GetString()).ToList();
      Assert.Equal(["2026-03-18", "2026-03-19"], two);
    }, excluded: "v08-e");
  }

  [Fact]
  public async Task Usage_Route_BeforeAnyRun_IsEmpty()
  {
    await InScratchAsync(async sql =>
    {
      var data = AutomationTestKit.Data(await UsageAsync(Admin("it-v08-admin")));
      Assert.Empty(data.GetProperty("days").EnumerateArray());
      Assert.Empty(data.GetProperty("decks").EnumerateArray());
      Assert.Equal(0, data.GetProperty("excludedSubsCount").GetInt32());
      Assert.Equal(JsonValueKind.Null, data.GetProperty("lastComputedAt").ValueKind);
    });
  }

  [Theory]
  [InlineData("0")]
  [InlineData("366")]
  [InlineData("abc")]
  [InlineData("-1")]
  [InlineData("7.5")]
  public async Task Usage_Route_BadDays_Returns400(string days)
  {
    await InScratchAsync(async _ => AutomationTestKit.AssertError(await UsageAsync(Admin("it-v08-admin"), days), 400, "VALIDATION_ERROR"));
  }

  [Fact]
  public async Task Usage_Route_RequiresAdmin_AndGet()
  {
    Assert.Equal(403, (await UsageAsync(Learner("it-v08-learner"))).StatusCode);
    var post = await AutomationTestKit.CallAsync(UsageAnalytics.HandleUsage, "POST", UsagePath, new { }, Admin("it-v08-admin"));
    Assert.Equal(405, post.StatusCode);
  }

  [Fact]
  public void Analytics_ExcludedSubs_ParsesCommaList()
  {
    var saved = Environment.GetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv);
    try
    {
      Environment.SetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv, " a,b ,, a ,c");
      Assert.Equal(["a", "b", "c"], UsageAnalytics.ExcludedSubs());
      Environment.SetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv, "");
      Assert.Empty(UsageAnalytics.ExcludedSubs());
      Environment.SetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv, null);
      Assert.Empty(UsageAnalytics.ExcludedSubs());
    }
    finally
    {
      Environment.SetEnvironmentVariable(UsageAnalytics.ExcludedSubsEnv, saved);
    }
  }

  [Fact]
  public void Analytics_ProdEnvFile_DefaultsExclusionToEmpty()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "env", "prod.env.json"))) dir = dir.Parent;
    Assert.NotNull(dir);
    using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "env", "prod.env.json")));
    Assert.Equal(string.Empty, doc.RootElement.GetProperty(UsageAnalytics.ExcludedSubsEnv).GetString());
  }
}
