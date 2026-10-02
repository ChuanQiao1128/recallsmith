using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.Vpc.Analytics;

/// <summary>
/// The anonymous install funnel (R24 A01, contract R24-00 §3.1-§3.2). No identifiers at all: no user, device or install
/// id, no IP, no free text; the funnel is computed from cohort counts, never per-person paths.
/// <list type="bullet">
/// <item><c>POST /api/v1/public/events</c>: no auth (the dispatcher never resolves a bearer for it, so a signed-in caller
/// is never linked), 8 KB body cap, <c>{ platform, appVersion, events: [≤ 20] }</c>; invalid events are skipped and
/// counted in <c>rejected</c>; a per-container budget of 120 requests / 60 s answers 429; past the global
/// <see cref="DailyRowCap"/> nothing is stored (R24X F05). The body is never logged.</item>
/// <item><c>GET /api/v1/admin/analytics/funnel?days=90</c> (RequireAdmin): per ISO cohort week (Monday) and overall, the
/// count of each event and its conversion from <c>first_open</c>; per deck, the goal/starter/first-pack counts.</item>
/// <item><see cref="DeleteExpiredAsync"/>: the 400-day retention delete, the tick's own <c>anon_funnel_retention</c>
/// step (R24X F05: independent of the <c>analytics_daily</c> rollup, capped and with its own statement_timeout).</item>
/// </list>
/// Days are the app's local dates (<c>YYYY-MM-DD</c>); the window is checked against the UTC date of <see cref="UtcNow"/>.
/// </summary>
public static class AnonFunnel
{
  public const int MaxBodyBytes = 8192;
  public const int MaxEvents = 20;
  public const int MaxAppVersionChars = 20;

  /// <summary>Events and rows older than this many days are refused at ingest and deleted by the daily step.</summary>
  public const int RetentionDays = 400;

  public const int DefaultDays = 90;
  public const int MaxDays = RetentionDays;

  internal const int MaxRequestsPerWindow = 120;
  internal const long WindowMs = 60_000;

  /// <summary>
  /// The global ceiling (R24X F05): when more than this many rows were received in the last 24 hours (server clock),
  /// a batch is answered 202 with every event rejected and nothing stored, so storage stays bounded whatever the
  /// Lambda concurrency or the gateway throttle.
  /// </summary>
  internal const int DailyRowCap = 20_000;

  /// <summary>The <c>anon_funnel_daily_cap</c> warn line is written at most once per container per this many ms.</summary>
  internal const long DailyCapLineMs = 3_600_000;

  /// <summary>The most rows one retention run deletes; the next tick takes the rest. Internal so a test can shrink it.</summary>
  internal static int RetentionBatch = 10_000;

  /// <summary>The <c>statement_timeout</c> of the retention delete (<c>set local</c>). Internal so a test can shorten it.</summary>
  internal static TimeSpan RetentionStatementTimeout = TimeSpan.FromSeconds(2);

  /// <summary>The nine steps of §3.1, in funnel order (also the order of every answer's keys).</summary>
  public static readonly string[] Events =
  [
    "first_open", "goal_chosen", "starter_started", "starter_completed", "first_pack_opened",
    "returned_day_1", "returned_day_7", "signup_started", "signup_completed",
  ];

  /// <summary>The steps that carry a <c>deckSlug</c>; on any other step a slug is dropped.</summary>
  public static readonly string[] DeckEvents = ["goal_chosen", "starter_started", "starter_completed", "first_pack_opened"];

  /// <summary>The three live decks a learner can choose (mobile <c>GOAL_CHOICES</c>).</summary>
  public static readonly string[] LiveDeckSlugs = ["aws-saa-c03", "claude-ccdv-f", "csharp-basics"];

  public static readonly string[] Platforms = ["ios", "android"];

  private static readonly Regex AppVersionRegex = new(@"^\d+\.\d+\.\d+$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));

  /// <summary>The clock of the day window, the budget and the retention delete. Internal so a test can move "now".</summary>
  internal static Func<DateTime> UtcNow = () => DateTime.UtcNow;

  // A per-container budget guarded by a lock (ClientErrors pattern): static, so it survives warm invocations.
  private static readonly object BudgetLock = new();
  private static long _windowStart;
  private static int _count;
  private static bool _budgetLineWritten;
  private static long? _dailyCapLineAt;

  private static DateOnly Today() => DateOnly.FromDateTime(UtcNow().ToUniversalTime());

  /// <summary>Zeroes the per-container window. For tests only.</summary>
  internal static void ResetBudget()
  {
    lock (BudgetLock)
    {
      _windowStart = 0;
      _count = 0;
      _budgetLineWritten = false;
      _dailyCapLineAt = null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/public/events
  // ---------------------------------------------------------------------------------------------

  private sealed record Row(string Event, string CohortDay, string EventDay, string? DeckSlug);

  /// <summary>
  /// The ingest. Takes no <see cref="AuthContext"/> on purpose: a bearer sent with the call is never read. Logs only the
  /// budget and daily-cap lines, never the body. Every well-formed batch reaches the database (the daily-cap count), so
  /// an empty or all-invalid batch still answers 503 before migration 043 or without PG env.
  /// </summary>
  public static async Task<APIGatewayProxyResponse> HandleEvents(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    var raw = req.RawBody ?? string.Empty;
    if (raw.Length > MaxBodyBytes || Encoding.UTF8.GetByteCount(raw) > MaxBodyBytes)
    {
      return Helpers.ErrorEnvelope(res, 413, "PAYLOAD_TOO_LARGE", "funnel batch exceeds 8192 bytes");
    }

    if (!TakeBudget())
    {
      return res.Raw(429,
        new { success = false, data = (object?)null, error = new { code = "RATE_LIMITED", message = "Too many requests" }, traceId = res.TraceId, version = "v1" },
        new Dictionary<string, string> { ["Retry-After"] = "60" });
    }

    using var doc = Validation.ParseJsonBody(req);
    if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
    var root = doc.RootElement;
    if (root.ValueKind != JsonValueKind.Object) return res.BadRequest("VALIDATION_ERROR", "body must be one JSON object");

    var platform = StringProp(root, "platform");
    if (platform is null || Array.IndexOf(Platforms, platform) < 0)
    {
      return res.BadRequest("VALIDATION_ERROR", "platform must be one of ios, android");
    }
    var appVersion = StringProp(root, "appVersion");
    if (appVersion is null || appVersion.Length > MaxAppVersionChars || !AppVersionRegex.IsMatch(appVersion))
    {
      return res.BadRequest("VALIDATION_ERROR", "appVersion must look like 1.9.0 (at most 20 characters)");
    }
    if (!root.TryGetProperty("events", out var events) || events.ValueKind != JsonValueKind.Array)
    {
      return res.BadRequest("VALIDATION_ERROR", "events must be an array");
    }
    if (events.GetArrayLength() > MaxEvents)
    {
      return res.BadRequest("VALIDATION_ERROR", "events holds at most 20 items");
    }

    var today = Today();
    var rows = new List<Row>();
    var rejected = 0;
    foreach (var e in events.EnumerateArray())
    {
      if (TryReadEvent(e, today, out var row)) rows.Add(row);
      else rejected++;
    }

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      if (await OverDailyCapAsync(conn))
      {
        DailyCapLine();
        rejected += rows.Count;
        rows.Clear();
      }
      if (rows.Count > 0)
      {
        await DbUtil.ExecuteAsync(conn, null,
          """
          insert into anon_funnel_events (event, cohort_day, event_day, deck_slug, platform, app_version)
          select e, c::date, d::date, s, $5, $6
          from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as t(e, c, d, s)
          """,
          [
            rows.Select(r => r.Event).ToArray(),
            rows.Select(r => r.CohortDay).ToArray(),
            rows.Select(r => r.EventDay).ToArray(),
            rows.Select(r => r.DeckSlug).ToArray(),
            platform,
            appVersion,
          ]);
      }
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      return NotReady(res);
    }

    return res.Raw(202, new
    {
      success = true,
      data = new { accepted = rows.Count, rejected },
      error = (object?)null,
      traceId = res.TraceId,
      version = "v1",
    });
  }

  /// <summary>
  /// True when more than <see cref="DailyRowCap"/> rows were received in the last 24 hours. The scan stops at cap + 1
  /// rows (the <c>received_at</c> index), so the check stays cheap however full the table is. Also the readiness probe.
  /// </summary>
  private static async Task<bool> OverDailyCapAsync(NpgsqlConnection conn)
  {
    var n = await DbUtil.ExecuteScalarAsync(conn, null,
      """
      select count(*) from (
        select 1 from anon_funnel_events where received_at >= now() - interval '1 day' limit $1
      ) t
      """, [DailyRowCap + 1]);
    return RunnerRoutes.Long(n) > DailyRowCap;
  }

  /// <summary>One <c>anon_funnel_daily_cap</c> warn line per container per hour at most.</summary>
  private static void DailyCapLine()
  {
    lock (BudgetLock)
    {
      var now = new DateTimeOffset(UtcNow().ToUniversalTime()).ToUnixTimeMilliseconds();
      if (_dailyCapLineAt is { } at && now - at < DailyCapLineMs) return;
      _dailyCapLineAt = now;
    }
    Log.Event("warn", new { tag = "anon_funnel_daily_cap", dailyRowCap = DailyRowCap });
  }

  /// <summary>Counts one request against the per-container window; false once the window is spent.</summary>
  private static bool TakeBudget()
  {
    lock (BudgetLock)
    {
      var now = new DateTimeOffset(UtcNow().ToUniversalTime()).ToUnixTimeMilliseconds();
      if (now - _windowStart >= WindowMs)
      {
        _windowStart = now;
        _count = 0;
        _budgetLineWritten = false;
      }
      if (_count >= MaxRequestsPerWindow)
      {
        // First refusal of the window only, so the refusals cannot flood the log.
        if (!_budgetLineWritten)
        {
          _budgetLineWritten = true;
          Log.Event("warn", new { tag = "anon_funnel_budget", limitedAfter = MaxRequestsPerWindow, windowMs = WindowMs });
        }
        return false;
      }
      _count++;
      return true;
    }
  }

  /// <summary>One event: a known step, two valid days inside the window, and no slug or a live deck's slug.</summary>
  private static bool TryReadEvent(JsonElement e, DateOnly today, out Row row)
  {
    row = null!;
    if (e.ValueKind != JsonValueKind.Object) return false;
    var name = StringProp(e, "event");
    if (name is null || Array.IndexOf(Events, name) < 0) return false;
    if (!TryDay(e, "cohortDay", today, out var cohortDay)) return false;
    if (!TryDay(e, "eventDay", today, out var eventDay)) return false;

    string? deckSlug = null;
    if (e.TryGetProperty("deckSlug", out var slugEl) && slugEl.ValueKind != JsonValueKind.Null)
    {
      if (slugEl.ValueKind != JsonValueKind.String) return false;
      var slug = slugEl.GetString()!;
      if (Array.IndexOf(LiveDeckSlugs, slug) < 0) return false;
      if (Array.IndexOf(DeckEvents, name) >= 0) deckSlug = slug;
    }

    row = new Row(name, cohortDay, eventDay, deckSlug);
    return true;
  }

  /// <summary>A <c>YYYY-MM-DD</c> calendar date within [today − 400, today + 1].</summary>
  private static bool TryDay(JsonElement e, string name, DateOnly today, out string day)
  {
    day = string.Empty;
    var raw = StringProp(e, name);
    if (raw is null || raw.Length != 10) return false;
    if (!DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return false;
    if (d < today.AddDays(-RetentionDays) || d > today.AddDays(1)) return false;
    day = raw;
    return true;
  }

  private static string? StringProp(JsonElement obj, string name) =>
    obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

  // ---------------------------------------------------------------------------------------------
  // retention
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Deletes up to <see cref="RetentionBatch"/> of the rows received more than <see cref="RetentionDays"/> days before
  /// <see cref="UtcNow"/> (the funnel clock), oldest first, under its own <see cref="RetentionStatementTimeout"/>; returns
  /// how many. Run by the tick's own <c>anon_funnel_retention</c> step on every tick, whatever the daily rollup did
  /// (R24X F05). Before migration 043 it logs one line and returns 0. Any other failure is logged
  /// (<c>anon_funnel_retention_failed</c>) and thrown, so the tick records the step as failed; the next tick retries.
  /// </summary>
  public static async Task<long> DeleteExpiredAsync(NpgsqlConnection conn)
  {
    try
    {
      long deleted;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        var timeoutMs = Math.Max(1, (long)RetentionStatementTimeout.TotalMilliseconds).ToString(CultureInfo.InvariantCulture);
        await DbUtil.ExecuteAsync(conn, tx, $"set local statement_timeout = {timeoutMs}", []);
        deleted = await DbUtil.ExecuteAsync(conn, tx,
          """
          delete from anon_funnel_events where id in (
            select id from anon_funnel_events where received_at < $1 order by received_at limit $2
          )
          """,
          [UtcNow().ToUniversalTime().AddDays(-RetentionDays), RetentionBatch]);
        await tx.CommitAsync();
      }
      Log.Event("info", new { tag = "analytics", outcome = "anon_funnel_retention", deleted });
      return deleted;
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      Log.Event("info", new { tag = "analytics", reason = "anon_funnel_not_migrated", step = "anon_funnel_retention" });
      return 0;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "analytics", reason = "anon_funnel_retention_failed", step = "anon_funnel_retention",
        sqlState = (ex as PostgresException)?.SqlState });
      throw;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/analytics/funnel
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleFunnel(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      var days = UsageAnalytics.DaysParam(req, DefaultDays, MaxDays);
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var today = Today();
      var from = today.AddDays(-days);
      var to = today.AddDays(1);
      // Deck-scoped numbers follow the usage route (R20X F02): a caller who is not super_admin sees the decks they may
      // read only (null = every deck). R24X F05: overall and weeks count the rows with no deck plus the readable decks'
      // rows, so byDeck cannot be subtracted from them to learn an unreadable deck's counts.
      var readable = await Helpers.ReadableDeckIdsAsync(conn, auth);
      var weekRows = await DbUtil.QueryAsync(conn, null,
        """
        select to_char(date_trunc('week', cohort_day)::date, 'YYYY-MM-DD') as week, event, count(*) as n
        from anon_funnel_events
        where cohort_day >= $1 and cohort_day <= $2
          and ($3::bigint[] is null or deck_slug is null or deck_slug in (select d.slug from decks d where d.id = any($3::bigint[])))
        group by 1, 2
        """, [from, to, readable?.ToArray()]);
      var deckRows = await DbUtil.QueryAsync(conn, null,
        """
        select deck_slug, event, count(*) as n
        from anon_funnel_events
        where cohort_day >= $1 and cohort_day <= $2 and deck_slug is not null and event = any($3::text[])
          and ($4::bigint[] is null or deck_slug in (select d.slug from decks d where d.id = any($4::bigint[])))
        group by 1, 2
        """, [from, to, DeckEvents, readable?.ToArray()]);

      var weeks = weekRows
        .GroupBy(r => (string)r["week"]!, StringComparer.Ordinal)
        .OrderBy(g => g.Key, StringComparer.Ordinal)
        .Select(g => Step(g.Key, Counts(Events, g)))
        .ToList();
      var overall = Counts(Events, weekRows);

      return res.Ok(new
      {
        days,
        fromCohortDay = Day(from),
        events = Events,
        overall = new { counts = overall, conversion = Conversion(overall) },
        weeks,
        byDeck = deckRows
          .GroupBy(r => (string)r["deck_slug"]!, StringComparer.Ordinal)
          .OrderBy(g => g.Key, StringComparer.Ordinal)
          .Select(g => new { deckSlug = g.Key, counts = Counts(DeckEvents, g) })
          .ToList(),
      });
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      return NotReady(res);
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static object Step(string weekStart, Dictionary<string, long> counts) =>
    new { weekStart, counts, conversion = Conversion(counts) };

  /// <summary>Every key of <paramref name="keys"/>, in order, with the summed <c>n</c> of the matching rows (0 if none).</summary>
  private static Dictionary<string, long> Counts(string[] keys, IEnumerable<Dictionary<string, object?>> rows)
  {
    var counts = keys.ToDictionary(k => k, _ => 0L, StringComparer.Ordinal);
    foreach (var r in rows)
    {
      var ev = (string)r["event"]!;
      if (counts.ContainsKey(ev)) counts[ev] += RunnerRoutes.Long(r["n"]);
    }
    return counts;
  }

  /// <summary>Each step after <c>first_open</c> as a share of <c>first_open</c> (4 decimals); null without a first open.</summary>
  private static Dictionary<string, decimal?> Conversion(Dictionary<string, long> counts)
  {
    var opens = counts["first_open"];
    return Events.Skip(1).ToDictionary(
      e => e,
      e => opens > 0 ? Math.Round((decimal)counts[e] / opens, 4, MidpointRounding.AwayFromZero) : (decimal?)null,
      StringComparer.Ordinal);
  }

  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "NOT_READY", "Run the database migration (043_anon_funnel_events)");

  private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
