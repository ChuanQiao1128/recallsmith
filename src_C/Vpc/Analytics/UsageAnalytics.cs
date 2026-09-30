using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.Vpc.Analytics;

/// <summary>
/// Usage analytics (R20 V08, contract R20-00 §7): the automation tick step <c>analytics_daily</c> that fills
/// <c>analytics_daily</c> and <c>analytics_deck_daily</c> once per UTC day, and <c>GET /api/v1/admin/analytics/usage</c>
/// that reads them. The source is <c>user_progress_events</c> with <c>event_type = 'card_reviewed'</c>; a review's day
/// is the UTC date of its <c>event_time</c>; the subs listed in <see cref="ExcludedSubsEnv"/> count nowhere.
/// Per day D: <c>dau</c>/<c>wau</c>/<c>mau</c> are the distinct users with a review in the 1/7/30 days ending on D;
/// <c>reviews</c> the reviews on D; <c>new_users</c> the users whose first ever review is on D; <c>cards_learned</c> the
/// (user, deck, card) triples first reviewed on D; <c>d1_retention</c>/<c>d7_retention</c> the share (4 decimals) of D's
/// new users with a review exactly 1/7 days later, stored on D, null until that day is complete or when D had no new
/// users. Per (D, deck): active users, reviews and <c>new_learners</c> (users whose first review in the deck is on D).
/// Only complete days are computed; each run recomputes the last <see cref="RecomputeDays"/> of them (idempotent), so a
/// late-synced review is counted and D7 of the oldest day matures. Nothing here logs a sub.
/// </summary>
public static class UsageAnalytics
{
  public const string ExcludedSubsEnv = "ANALYTICS_EXCLUDED_SUBS";

  /// <summary>The complete UTC days each run recomputes: 8, so the oldest one's D7 retention has matured.</summary>
  public const int RecomputeDays = 8;

  public const int DefaultDays = 30;
  public const int MaxDays = 365;

  /// <summary>The window of the per-deck numbers of the usage route, in complete UTC days.</summary>
  public const int DeckWindowDays = 30;

  /// <summary>The clock of the step and the route. Internal so a test can move "today".</summary>
  internal static Func<DateTime> UtcNow = () => DateTime.UtcNow;

  public enum Outcome
  {
    Computed,
    NotDue,
    NotMigrated,
  }

  /// <summary>The trimmed, non-empty, distinct subs of <see cref="ExcludedSubsEnv"/> (comma-separated, default none).</summary>
  public static string[] ExcludedSubs() =>
    (Environment.GetEnvironmentVariable(ExcludedSubsEnv) ?? string.Empty)
      .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
      .Distinct(StringComparer.Ordinal)
      .ToArray();

  private static DateOnly Today() => DateOnly.FromDateTime(UtcNow().ToUniversalTime());

  // ---------------------------------------------------------------------------------------------
  // the tick step
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// The tick step: when no row was computed yet today (UTC), recomputes the last <see cref="RecomputeDays"/> complete
  /// days. Before migration 040 it logs one line and skips; it never throws for a missing table or column.
  /// </summary>
  public static async Task<Outcome> RunIfDueAsync(NpgsqlConnection conn)
  {
    var today = Today();
    try
    {
      var last = await DbUtil.ExecuteScalarAsync(conn, null, "select max(computed_at) from analytics_daily", []);
      if (last is DateTime at && DateOnly.FromDateTime(DateTime.SpecifyKind(at, DateTimeKind.Utc).ToUniversalTime()) >= today)
      {
        return Outcome.NotDue;
      }
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      Log.Event("info", new { tag = "analytics", reason = "analytics_not_migrated", step = "analytics_daily" });
      return Outcome.NotMigrated;
    }
    return await ComputeAsync(conn, today);
  }

  /// <summary>
  /// Recomputes the <see cref="RecomputeDays"/> complete UTC days before <paramref name="today"/> in one transaction:
  /// an upsert of <c>analytics_daily</c> (premium_active untouched; <c>computed_at</c> from <see cref="UtcNow"/>, the clock
  /// the once-per-day check compares with) and a replace of those days' deck rows.
  /// </summary>
  public static async Task<Outcome> ComputeAsync(NpgsqlConnection conn, DateOnly today)
  {
    var from = today.AddDays(-RecomputeDays);
    var to = today.AddDays(-1);
    var excluded = ExcludedSubs();
    await using var tx = await conn.BeginTransactionAsync();
    try
    {
      await DbUtil.ExecuteAsync(conn, tx,
        $"""
        with {EventsCte},
        first_user as (select user_sub, min(day) as first_day from ev group by user_sub),
        first_card as (select user_sub, deck_slug, stable_uid, min(day) as first_day from ev group by user_sub, deck_slug, stable_uid),
        user_days as (select distinct user_sub, day from ev where day >= $1::date - 29),
        days as (select g::date as day from generate_series($1::date, $2::date, interval '1 day') g),
        cohort as (
          select f.first_day as day, count(*) as n,
            count(*) filter (where exists (select 1 from user_days u where u.user_sub = f.user_sub and u.day = f.first_day + 1)) as back1,
            count(*) filter (where exists (select 1 from user_days u where u.user_sub = f.user_sub and u.day = f.first_day + 7)) as back7
          from first_user f where f.first_day between $1::date and $2::date
          group by f.first_day
        )
        insert into analytics_daily (day, dau, wau, mau, reviews, new_users, cards_learned, d1_retention, d7_retention, computed_at)
        select d.day,
          (select count(*) from user_days u where u.day = d.day),
          (select count(distinct u.user_sub) from user_days u where u.day between d.day - 6 and d.day),
          (select count(distinct u.user_sub) from user_days u where u.day between d.day - 29 and d.day),
          (select count(*) from ev where ev.day = d.day),
          coalesce(c.n, 0),
          (select count(*) from first_card f where f.first_day = d.day),
          case when d.day + 1 < $3::date and c.n > 0 then round(c.back1::numeric / c.n, 4) end,
          case when d.day + 7 < $3::date and c.n > 0 then round(c.back7::numeric / c.n, 4) end,
          $5
        from days d
        left join cohort c on c.day = d.day
        on conflict (day) do update set
          dau = excluded.dau, wau = excluded.wau, mau = excluded.mau, reviews = excluded.reviews, new_users = excluded.new_users,
          cards_learned = excluded.cards_learned, d1_retention = excluded.d1_retention, d7_retention = excluded.d7_retention,
          computed_at = excluded.computed_at
        """, [from, to, today, excluded, UtcNow().ToUniversalTime()]);

      // Replaced, not upserted: a deck whose every review is now excluded must lose its row.
      await DbUtil.ExecuteAsync(conn, tx, "delete from analytics_deck_daily where day between $1 and $2", [from, to]);
      await DbUtil.ExecuteAsync(conn, tx,
        $"""
        with {EventsCte},
        first_deck as (select user_sub, deck_slug, min(day) as first_day from ev group by user_sub, deck_slug)
        insert into analytics_deck_daily (day, deck_slug, active_users, reviews, new_learners)
        select ev.day, ev.deck_slug, count(distinct ev.user_sub), count(*),
          (select count(*) from first_deck f where f.deck_slug = ev.deck_slug and f.first_day = ev.day)
        from ev
        where ev.day between $1::date and $2::date
        group by ev.day, ev.deck_slug
        """, [from, to, today, excluded]);
      await tx.CommitAsync();
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      await tx.RollbackAsync();
      Log.Event("info", new { tag = "analytics", reason = "analytics_not_migrated", step = "analytics_daily" });
      return Outcome.NotMigrated;
    }
    Log.Event("info", new { tag = "analytics", outcome = "analytics_daily", from = Day(from), to = Day(to), excludedSubs = excluded.Length });
    return Outcome.Computed;
  }

  /// <summary>
  /// <c>ev</c>: the counted reviews before <c>$3</c> (today, UTC), with their UTC day, without the subs in <c>$4</c>.
  /// </summary>
  private const string EventsCte = """
    ev as (
      select e.user_sub, e.deck_slug, e.stable_uid, (e.event_time at time zone 'UTC')::date as day
      from user_progress_events e
      where e.event_type = 'card_reviewed' and e.user_sub <> all($4::text[])
        and e.event_time < ($3::date)::timestamp at time zone 'UTC'
    )
    """;

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/analytics/usage
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleUsage(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      var days = DaysParam(req, DefaultDays, MaxDays);
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var today = Today();
      var excluded = ExcludedSubs();
      var dayRows = await DbUtil.QueryAsync(conn, null,
        """
        select to_char(day, 'YYYY-MM-DD') as day, dau, wau, mau, reviews, new_users, cards_learned, d1_retention, d7_retention
        from analytics_daily
        where day >= $1 and day < $2
        order by day
        """, [today.AddDays(-days), today]);
      var lastComputedAt = await DbUtil.ExecuteScalarAsync(conn, null, "select max(computed_at) from analytics_daily", []);
      var deckRows = await DbUtil.QueryAsync(conn, null,
        $"""
        with {EventsCte},
        first_deck as (select user_sub, deck_slug, min(day) as first_day from ev group by user_sub, deck_slug)
        select ev.deck_slug, count(distinct ev.user_sub) as active_users, count(*) as reviews,
          (select count(*) from first_deck f where f.deck_slug = ev.deck_slug and f.first_day >= $1::date) as new_learners
        from ev
        where ev.day >= $1::date and ev.day < $2::date
        group by ev.deck_slug
        order by count(*) desc, ev.deck_slug collate "C"
        """, [today.AddDays(-DeckWindowDays), today, today, excluded]);

      return res.Ok(new
      {
        days = dayRows.Select(r => new
        {
          day = (string)r["day"]!,
          dau = NullableLong(r["dau"]),
          wau = NullableLong(r["wau"]),
          mau = NullableLong(r["mau"]),
          reviews = NullableLong(r["reviews"]),
          newUsers = NullableLong(r["new_users"]),
          cardsLearned = NullableLong(r["cards_learned"]),
          d1Retention = r["d1_retention"] is null ? (decimal?)null : Convert.ToDecimal(r["d1_retention"], CultureInfo.InvariantCulture),
          d7Retention = r["d7_retention"] is null ? (decimal?)null : Convert.ToDecimal(r["d7_retention"], CultureInfo.InvariantCulture),
        }).ToList(),
        decks = deckRows.Select(r => new
        {
          deckSlug = (string)r["deck_slug"]!,
          activeUsers30d = RunnerRoutes.Long(r["active_users"]),
          reviews30d = RunnerRoutes.Long(r["reviews"]),
          newLearners30d = RunnerRoutes.Long(r["new_learners"]),
        }).ToList(),
        excludedSubsCount = excluded.Length,
        lastComputedAt = RunnerRoutes.Timestamp(lastComputedAt),
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

  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "NOT_READY", "Run the database migration (040_usage_analytics)");

  /// <summary>The optional <c>days</c> query parameter: an integer 1..<paramref name="max"/>, else a validation error.</summary>
  internal static int DaysParam(LambdaRequest req, int fallback, int max)
  {
    if (!req.Query.TryGetValue("days", out var raw) || string.IsNullOrEmpty(raw)) return fallback;
    if (!int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var days) || days < 1 || days > max)
    {
      throw new ValidationError($"days must be an integer from 1 to {max.ToString(CultureInfo.InvariantCulture)}", "days");
    }
    return days;
  }

  private static long? NullableLong(object? v) => v is null ? null : RunnerRoutes.Long(v);

  private static string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
