using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.Vpc.Ledger;

/// <summary>
/// Automation Ledger admin API (R18 J08, contract §9.4–§9.5): the period summary, the raw event list,
/// the baselines, the super_admin baseline editor and the super_admin backfill from history.
/// Minutes are computed here at query time from the current baselines (§9.1), never stored, so editing a
/// baseline recomputes history. A database without migration 028 answers 503 SERVER_NOT_READY_LEDGER.
/// </summary>
public static class LedgerRoutes
{
  public const int DefaultRangeDays = 90;
  public const int MaxRangeDays = 366;
  public const int DefaultLimit = 50;
  public const int MaxLimit = 100;
  public const decimal MaxBaselineMinutes = 999999.99m;
  public const int MaxNoteLength = 500;

  public static readonly IReadOnlyList<string> Granularities = ["day", "week", "month"];
  public static readonly IReadOnlyList<string> BaselineSources = ["measured", "default"];

  private const string MissingPg = "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)";
  private const string BackfillHeuristic = "cards created in the same minute >= 5";

  // ------------------------------------------------------------------ GET /ledger

  public static async Task<APIGatewayProxyResponse> HandleLedger(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, MissingPg);

    DateOnly? fromParam = null;
    DateOnly? toParam = null;
    if (Param(req, "from") is { } fromRaw)
    {
      if (!TryParseDay(fromRaw, out var d)) return Invalid(res, "from must be a date yyyy-MM-dd");
      fromParam = d;
    }
    if (Param(req, "to") is { } toRaw)
    {
      if (!TryParseDay(toRaw, out var d)) return Invalid(res, "to must be a date yyyy-MM-dd");
      toParam = d;
    }

    var granularity = Param(req, "granularity") ?? "week";
    if (!Granularities.Contains(granularity, StringComparer.Ordinal)) return Invalid(res, "granularity must be one of day, week, month");

    DateOnly from;
    DateOnly to;
    try
    {
      (from, to) = (fromParam, toParam) switch
      {
        ({ } f, { } t) => (f, t),
        ({ } f, null) => (f, f.AddDays(DefaultRangeDays - 1)),
        (null, { } t) => (t.AddDays(-(DefaultRangeDays - 1)), t),
        _ => (DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-(DefaultRangeDays - 1)), DateOnly.FromDateTime(DateTime.UtcNow)),
      };
    }
    catch (ArgumentOutOfRangeException)
    {
      return Invalid(res, "from/to are out of range");
    }

    if (from > to) return Invalid(res, "from must not be after to");
    if (to.DayNumber - from.DayNumber + 1 > MaxRangeDays) return Invalid(res, $"The range must not exceed {MaxRangeDays} days");

    try
    {
      return res.Ok(await ComputeAsync(conn, from, to, granularity));
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  /// <summary>
  /// The <c>GET /ledger</c> summary for the inclusive UTC day range [<paramref name="from"/>, <paramref name="to"/>]:
  /// exactly the object <see cref="HandleLedger"/> answers (R18A A04 extraction, also read by the weekly digest).
  /// The caller validates the range and granularity; database errors propagate.
  /// </summary>
  internal static async Task<object> ComputeAsync(NpgsqlConnection conn, DateOnly from, DateOnly to, string granularity,
    CancellationToken ct = default)
  {
    ct.ThrowIfCancellationRequested();
    var start = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
    var end = to.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(1);

    {
      // The headline is clamped once per (automation, source) over the whole [from, to) range, never per row
      // and never per period (automation-18): a row that carries only human cost (a rejected draft's review
      // time, units 0) reduces the savings it offsets anywhere in the range instead of counting as 0, and the
      // same rows give the same headline whatever the granularity. Backfill rows carry no actual minutes, so
      // history is not offset by live review cost. The granularity only shapes the series (below).
      var perAutomation = await DbUtil.QueryAsync(conn, null,
        """
        with g as (
          select b.automation, b.unit, b.baseline_minutes_per_unit, b.baseline_source, e.source,
                 count(e.id) filter (where e.units > 0 or e.outcome = 'failure') as runs,
                 coalesce(sum(e.units), 0) as units,
                 count(e.id) filter (where e.outcome = 'failure') as failures,
                 coalesce(sum(e.units * b.baseline_minutes_per_unit), 0) as baseline_minutes,
                 coalesce(sum(coalesce(e.actual_minutes, 0)), 0) as actual_minutes,
                 greatest(0, coalesce(sum(case when e.outcome in ('success','partial')
                                               then e.units * b.baseline_minutes_per_unit - coalesce(e.actual_minutes, 0)
                                               else 0 end), 0)) as saved,
                 coalesce(sum(e.defects_caught), 0) as defects
          from automation_baselines b
          left join automation_events e
            on e.automation = b.automation and e.occurred_at >= $1 and e.occurred_at < $2
          group by b.automation, b.unit, b.baseline_minutes_per_unit, b.baseline_source, e.source
        )
        select automation as "automation", unit as "unit",
               baseline_minutes_per_unit as "baselineMinutesPerUnit", baseline_source as "baselineSource",
               sum(runs) as "runs",
               sum(units) as "units",
               sum(failures) as "failures",
               sum(baseline_minutes) as "baselineMinutes",
               sum(actual_minutes) as "actualMinutes",
               sum(saved) as "minutesSaved",
               sum(defects) as "defectsCaught",
               coalesce(sum(runs) filter (where source = 'live'), 0) as "runsLive",
               coalesce(sum(units) filter (where source = 'live'), 0) as "unitsLive",
               coalesce(sum(saved) filter (where source = 'live'), 0) as "minutesSavedLive",
               coalesce(sum(runs) filter (where source = 'backfill'), 0) as "runsBackfill",
               coalesce(sum(units) filter (where source = 'backfill'), 0) as "unitsBackfill",
               coalesce(sum(saved) filter (where source = 'backfill'), 0) as "minutesSavedBackfill"
        from g
        group by automation, unit, baseline_minutes_per_unit, baseline_source
        order by automation collate "C"
        """,
        [start, end]);

      // Each series point carries two values (backend-design-24, additive on automation-18):
      // minutesSaved keeps its original meaning, Σ max(0, net) clamped per (period, automation, source), so it is
      // never negative; netMinutes is the signed Σ net per (period, automation) and may be negative. Per
      // automation and source, netMinutes adds up to the unclamped net over the range. Σ minutesSaved can exceed
      // the headline, which is clamped once over the whole range.
      var seriesRows = await DbUtil.QueryAsync(conn, null,
        """
        with g as (
          select date_trunc($3::text, e.occurred_at at time zone 'UTC') as period, e.automation, e.source,
                 count(*) filter (where e.units > 0 or e.outcome = 'failure') as runs,
                 coalesce(sum(e.units), 0) as units,
                 coalesce(sum(case when e.outcome in ('success','partial')
                                   then e.units * b.baseline_minutes_per_unit - coalesce(e.actual_minutes, 0)
                                   else 0 end), 0) as net,
                 coalesce(sum(e.defects_caught), 0) as defects
          from automation_events e
          join automation_baselines b on b.automation = e.automation
          where e.occurred_at >= $1 and e.occurred_at < $2
          group by 1, e.automation, e.source
        )
        select to_char(period, 'YYYY-MM-DD') as "periodStart",
               automation as "automation",
               sum(runs) as "runs",
               sum(units) as "units",
               sum(greatest(0, net)) as "minutesSaved",
               sum(net) as "netMinutes",
               sum(defects) as "defectsCaught"
        from g
        group by period, automation
        order by period, automation collate "C"
        """,
        [start, end, granularity]);

      long qaFalsePositives = 0;
      var hasFindings = await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.ai_qa_findings') is not null", []);
      if (hasFindings is true)
      {
        var n = await DbUtil.ExecuteScalarAsync(conn, null,
          "select count(*) from ai_qa_findings where resolution = 'dismissed' and resolved_at >= $1 and resolved_at < $2",
          [start, end]);
        qaFalsePositives = Convert.ToInt64(n, CultureInfo.InvariantCulture);
      }

      var agentDrafts = await AgentDraftQualityAsync(conn, start, end);

      var automations = perAutomation.Select(r =>
      {
        var runs = ToLong(r["runs"]);
        var failures = ToLong(r["failures"]);
        return new
        {
          automation = (string)r["automation"]!,
          unit = (string)r["unit"]!,
          baselineMinutesPerUnit = ToDecimal(r["baselineMinutesPerUnit"]),
          baselineSource = (string)r["baselineSource"]!,
          runs,
          units = ToLong(r["units"]),
          failures,
          failureRate = runs == 0 ? 0m : Math.Round((decimal)failures / runs, 4, MidpointRounding.AwayFromZero),
          baselineMinutes = Round2(ToDecimal(r["baselineMinutes"])),
          actualMinutes = Round2(ToDecimal(r["actualMinutes"])),
          minutesSaved = Round2(ToDecimal(r["minutesSaved"])),
          defectsCaught = ToLong(r["defectsCaught"]),
        };
      }).ToArray();

      var totalSaved = perAutomation.Sum(r => ToDecimal(r["minutesSaved"]));
      var totals = new
      {
        runs = automations.Sum(a => a.runs),
        units = automations.Sum(a => a.units),
        baselineMinutes = Round2(perAutomation.Sum(r => ToDecimal(r["baselineMinutes"]))),
        actualMinutes = Round2(perAutomation.Sum(r => ToDecimal(r["actualMinutes"]))),
        minutesSaved = Round2(totalSaved),
        hoursSaved = Round2(totalSaved / 60m),
        defectsCaught = automations.Sum(a => a.defectsCaught),
        qaFalsePositives,
        // How much of the headline is measured live and how much is inferred history (automation-11).
        bySource = new
        {
          live = SourceTotals(perAutomation, "Live"),
          backfill = SourceTotals(perAutomation, "Backfill"),
        },
        // How much of the headline rests on measured baselines and how much on seeded defaults.
        byBaselineSource = BaselineSources.ToDictionary(
          b => b,
          b => new { minutesSaved = Round2(perAutomation.Where(r => (string)r["baselineSource"]! == b).Sum(r => ToDecimal(r["minutesSaved"]))) }),
      };

      var series = seriesRows.Select(r => new
      {
        periodStart = (string)r["periodStart"]!,
        automation = (string)r["automation"]!,
        runs = ToLong(r["runs"]),
        units = ToLong(r["units"]),
        // Clamped per (period, automation, source), never negative; netMinutes is the signed net for the period.
        minutesSaved = Round2(ToDecimal(r["minutesSaved"])),
        netMinutes = Round2(ToDecimal(r["netMinutes"])),
        defectsCaught = ToLong(r["defectsCaught"]),
      }).ToArray();

      return new
      {
        from = FormatDay(from),
        to = FormatDay(to),
        granularity,
        totals,
        automations,
        series,
        agentDrafts,
      };
    }
  }

  private static object SourceTotals(List<Dictionary<string, object?>> perAutomation, string suffix)
  {
    var saved = perAutomation.Sum(r => ToDecimal(r["minutesSaved" + suffix]));
    return new
    {
      runs = perAutomation.Sum(r => ToLong(r["runs" + suffix])),
      units = perAutomation.Sum(r => ToLong(r["units" + suffix])),
      minutesSaved = Round2(saved),
      hoursSaved = Round2(saved / 60m),
    };
  }

  /// <summary>
  /// The AI drafting agent's own quality over the period, from ai_review_events (automation-4): how many
  /// drafts were decided, the acceptance and edited-accept rates, the share rejected for a defect reason
  /// (the agent's defect rate, which is not a defect caught before publish), the average review time (each
  /// value capped server-side at Drafts.ReviewMsCap) and how many decisions carried no review time.
  /// Zeros on a database without migration 030.
  /// </summary>
  private static async Task<object> AgentDraftQualityAsync(NpgsqlConnection conn, DateTime start, DateTime end)
  {
    long decided = 0, accepted = 0, edited = 0, rejected = 0, defects = 0, notMeasured = 0;
    decimal? avgReviewMs = null;

    var hasEvents = await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.ai_review_events') is not null", []);
    if (hasEvents is true)
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select count(*) as "decided",
               count(*) filter (where action in ('accepted','edited_accepted')) as "accepted",
               count(*) filter (where action = 'edited_accepted') as "edited",
               count(*) filter (where action = 'rejected') as "rejected",
               count(*) filter (where action = 'rejected' and reason = any($3)) as "defects",
               avg(case when review_ms is not null then least(review_ms, $4) end) as "avgReviewMs",
               count(*) filter (where review_ms is null) as "reviewNotMeasured"
        from ai_review_events
        where action in ('accepted','edited_accepted','rejected') and created_at >= $1 and created_at < $2
        """,
        [start, end, Vpc.Review.Drafts.DefectReasons.ToArray(), Vpc.Review.Drafts.ReviewMsCap]);
      var r = rows[0];
      decided = ToLong(r["decided"]);
      accepted = ToLong(r["accepted"]);
      edited = ToLong(r["edited"]);
      rejected = ToLong(r["rejected"]);
      defects = ToLong(r["defects"]);
      avgReviewMs = r["avgReviewMs"] is null ? null : ToDecimal(r["avgReviewMs"]);
      notMeasured = ToLong(r["reviewNotMeasured"]);
    }

    return new
    {
      decided,
      accepted,
      editedAccepted = edited,
      rejected,
      defectRejects = defects,
      acceptanceRate = Rate(accepted, decided),
      editedAcceptRate = Rate(edited, accepted),
      defectRate = Rate(defects, decided),
      avgReviewMinutes = avgReviewMs is { } ms ? Round2(ms / 60000m) : (decimal?)null,
      // Decisions sent without reviewMs (automation-13): excluded from the average, and charged no human
      // cost in the savings, so the reader can see how much of the figure rests on unmeasured reviews.
      reviewNotMeasured = notMeasured,
    };
  }

  private static decimal Rate(long part, long whole) =>
    whole == 0 ? 0m : Math.Round((decimal)part / whole, 4, MidpointRounding.AwayFromZero);

  // ------------------------------------------------------------------ GET /events

  public static async Task<APIGatewayProxyResponse> HandleEvents(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, MissingPg);

    var where = new List<string>();
    var parameters = new List<object?>();

    if (Param(req, "automation") is { } automation)
    {
      if (!AutomationLedger.Automations.Contains(automation, StringComparer.Ordinal))
      {
        return Invalid(res, $"automation must be one of {string.Join(", ", AutomationLedger.Automations)}");
      }
      parameters.Add(automation);
      where.Add($"automation = ${parameters.Count}");
    }

    var limit = DefaultLimit;
    if (Param(req, "limit") is { } limitRaw)
    {
      if (!int.TryParse(limitRaw, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxLimit)
      {
        return Invalid(res, "limit must be an integer in 1..100");
      }
    }

    if (Param(req, "cursor") is { } cursorRaw)
    {
      if (!TryDecodeCursor(cursorRaw, out var lastId)) return Invalid(res, "Invalid cursor");
      parameters.Add(lastId);
      where.Add($"id < ${parameters.Count}");
    }

    parameters.Add(limit);
    var sql = $"""
      select id as "id", automation as "automation", occurred_at as "occurredAt", units as "units", outcome as "outcome",
             actual_minutes as "actualMinutes", defects_caught as "defectsCaught", deck_id as "deckId", ref as "ref",
             source as "source", dedupe_key as "dedupeKey", details as "details"
      from automation_events
      {(where.Count > 0 ? "where " + string.Join(" and ", where) : string.Empty)}
      order by id desc
      limit ${parameters.Count}
      """;

    try
    {
      var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
      foreach (var r in rows) Helpers.JsonbCell(r, "details");

      var items = rows.Select(r => new
      {
        id = ToLong(r["id"]),
        automation = (string)r["automation"]!,
        occurredAt = r["occurredAt"],
        units = Convert.ToInt32(r["units"], CultureInfo.InvariantCulture),
        outcome = (string)r["outcome"]!,
        actualMinutes = r["actualMinutes"] is null ? (decimal?)null : ToDecimal(r["actualMinutes"]),
        defectsCaught = Convert.ToInt32(r["defectsCaught"], CultureInfo.InvariantCulture),
        deckId = r["deckId"] is null ? (long?)null : ToLong(r["deckId"]),
        @ref = (string?)r["ref"],
        source = (string)r["source"]!,
        dedupeKey = (string?)r["dedupeKey"],
        details = r["details"],
      }).ToArray();

      var nextCursor = rows.Count == limit ? EncodeCursor(items[^1].id) : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  // ------------------------------------------------------------------ GET /baselines

  public static async Task<APIGatewayProxyResponse> HandleBaselines(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, MissingPg);

    try
    {
      var rows = await DbUtil.QueryAsync(conn, null, BaselineSelect + " order by automation collate \"C\"", []);
      return res.Ok(new { items = rows.Select(BaselineItem).ToArray() });
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  // ------------------------------------------------------------------ PUT /baselines/:automation

  public static async Task<APIGatewayProxyResponse> HandleBaseline(LambdaRequest req, Res res, AuthContext auth, string automation)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("PUT", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, MissingPg);

    decimal minutes;
    string source;
    var noteGiven = false;
    string? note = null;

    using (var doc = Validation.ParseJsonBody(req))
    {
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) return Invalid(res, "Body must be a JSON object");

      if (!body.TryGetProperty("baselineMinutesPerUnit", out var minutesEl) || minutesEl.ValueKind != JsonValueKind.Number
          || !minutesEl.TryGetDecimal(out minutes) || minutes < 0 || minutes > MaxBaselineMinutes)
      {
        return Invalid(res, "baselineMinutesPerUnit must be a number in 0..999999.99");
      }
      minutes = Round2(minutes);

      if (!body.TryGetProperty("baselineSource", out var sourceEl) || sourceEl.ValueKind != JsonValueKind.String
          || !BaselineSources.Contains(sourceEl.GetString()!, StringComparer.Ordinal))
      {
        return Invalid(res, "baselineSource must be one of measured, default");
      }
      source = sourceEl.GetString()!;

      if (body.TryGetProperty("note", out var noteEl))
      {
        noteGiven = true;
        if (noteEl.ValueKind == JsonValueKind.String)
        {
          var text = noteEl.GetString()!.Trim();
          if (text.Length > MaxNoteLength) return Invalid(res, $"note must be at most {MaxNoteLength} characters");
          note = text.Length == 0 ? null : text;
        }
        else if (noteEl.ValueKind != JsonValueKind.Null)
        {
          return Invalid(res, "note must be a string or null");
        }
      }
    }

    try
    {
      AdminAuditEntry entry;
      bool persisted;
      Dictionary<string, object?> updated;

      await using (var tx = await conn.BeginTransactionAsync())
      {
        var current = await DbUtil.QueryAsync(conn, tx, BaselineSelect + " where automation = $1 for update", [automation]);
        if (current.Count == 0)
        {
          return Helpers.ErrorEnvelope(res, 404, "AUTOMATION_NOT_FOUND", $"Automation {automation} not found");
        }

        var rows = await DbUtil.QueryAsync(conn, tx,
          $"""
          update automation_baselines set
            baseline_minutes_per_unit = $2,
            baseline_source = $3,
            {(noteGiven ? "note = $5," : string.Empty)}
            updated_by_sub = $4,
            updated_at = now()
          where automation = $1
          returning automation as "automation", unit as "unit", baseline_minutes_per_unit as "baselineMinutesPerUnit",
                    baseline_source as "baselineSource", note as "note", updated_at as "updatedAt"
          """,
          noteGiven
            ? [automation, minutes, source, auth.UserSub, note]
            : [automation, minutes, source, auth.UserSub]);
        updated = rows[0];

        entry = AdminAudit.Entry(auth, res, "automation.baseline.update", $"automation:{automation}",
          AuditState(current[0]), AuditState(updated));
        persisted = await AdminAudit.RecordAsync(conn, tx, entry);

        await tx.CommitAsync();
      }

      AdminAudit.Emit(entry, persisted);
      return res.Ok(BaselineItem(updated));
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  // ------------------------------------------------------------------ POST /backfill

  // Candidate sets of §9.5, keyed by their dedupe key (distinct on it, so a key shared by two source rows
  // counts once). A historical publish whose live `publish:<job_id>` event already exists is skipped as
  // well: the same publish must not be counted twice.
  private const string PublishCandidates = """
    select distinct on (k.dedupe_key) k.*
    from (
      select 'backfill:deck_publishes:' || dp.build_id as dedupe_key, dp.created_at as occurred_at,
             dp.deck_id as deck_id, dp.build_id as ref, dp.job_id as job_id
      from deck_publishes dp
      where dp.status = 'SUCCESS'
    ) k
    order by k.dedupe_key, k.occurred_at
    """;

  private const string PublishPresent = """
    exists (select 1 from automation_events e where e.dedupe_key = c.dedupe_key)
    or (c.job_id is not null and exists (select 1 from automation_events e where e.dedupe_key = 'publish:' || c.job_id))
    """;

  // Only history the live ledger cannot see: cards created before live recording began (the `live_since`
  // instant migration 028 records; without it, the first live event), and never a card that is an accepted
  // AI draft (those are ai_draft_review rows). Without this bound every live import of 5+ cards, and every
  // burst of 5+ draft accepts into one deck, would be counted a second time as a backfilled bulk_import.
  private static string ImportCandidates(bool hasDrafts) => $"""
    select 'backfill:cards:' || g.deck_id || ':' || (extract(epoch from g.minute) / 60)::bigint as dedupe_key,
           g.minute as occurred_at, g.deck_id as deck_id, g.units as units
    from (
      select cd.deck_id as deck_id, date_trunc('minute', cd.created_at) as minute, count(*)::int as units
      from cards cd
      where cd.created_at < {LiveSince}
      {(hasDrafts ? "and not exists (select 1 from ai_drafts ad where ad.accepted_card_id = cd.id)" : string.Empty)}
      group by cd.deck_id, date_trunc('minute', cd.created_at)
      having count(*) >= 5
    ) g
    """;

  private const string LiveSince = """
    coalesce(
      (select m.value_ts from automation_ledger_meta m where m.key = 'live_since'),
      (select min(e.occurred_at) from automation_events e where e.source = 'live'),
      'infinity'::timestamptz)
    """;

  private const string ImportPresent = "exists (select 1 from automation_events e where e.dedupe_key = c.dedupe_key)";

  public static async Task<APIGatewayProxyResponse> HandleBackfill(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, MissingPg);

    var dryRun = true;
    if (!string.IsNullOrWhiteSpace(req.RawBody))
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) return Invalid(res, "Body must be a JSON object");
      if (body.TryGetProperty("dryRun", out var dryEl))
      {
        if (dryEl.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Invalid(res, "dryRun must be a boolean");
        dryRun = dryEl.GetBoolean();
      }
    }

    try
    {
      long publishInserted, publishSkipped, importInserted, importSkipped;
      // ai_drafts arrives with migration 030; the ledger itself needs only 028.
      var hasDrafts = await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.ai_drafts') is not null", []) is true;
      var importCandidates = ImportCandidates(hasDrafts);

      if (dryRun)
      {
        (publishInserted, publishSkipped) = await CountCandidatesAsync(conn, null, PublishCandidates, PublishPresent);
        (importInserted, importSkipped) = await CountCandidatesAsync(conn, null, importCandidates, ImportPresent);
        return res.Ok(Counts(true, publishInserted, publishSkipped, importInserted, importSkipped));
      }

      AdminAuditEntry entry;
      bool persisted;

      await using (var tx = await conn.BeginTransactionAsync())
      {
        var (publishNew, publishPresent) = await CountCandidatesAsync(conn, tx, PublishCandidates, PublishPresent);
        var (importNew, importPresent) = await CountCandidatesAsync(conn, tx, importCandidates, ImportPresent);

        publishInserted = await DbUtil.ExecuteAsync(conn, tx,
          $"""
          insert into automation_events (automation, occurred_at, units, outcome, deck_id, ref, source, dedupe_key)
          select 'publish_pipeline', c.occurred_at, 1, 'success', c.deck_id, c.ref, 'backfill', c.dedupe_key
          from ({PublishCandidates}) c
          where not ({PublishPresent})
          on conflict (dedupe_key) do nothing
          """,
          []);

        importInserted = await DbUtil.ExecuteAsync(conn, tx,
          $"""
          insert into automation_events (automation, occurred_at, units, outcome, deck_id, source, dedupe_key, details)
          select 'bulk_import', c.occurred_at, c.units, 'success', c.deck_id, 'backfill', c.dedupe_key, $1::jsonb
          from ({importCandidates}) c
          on conflict (dedupe_key) do nothing
          """,
          [JsonSerializer.Serialize(new { heuristic = BackfillHeuristic })]);

        publishSkipped = publishNew + publishPresent - publishInserted;
        importSkipped = importNew + importPresent - importInserted;

        var counts = Counts(false, publishInserted, publishSkipped, importInserted, importSkipped);
        entry = AdminAudit.Entry(auth, res, "automation.backfill", "automation_events", null, counts);
        persisted = await AdminAudit.RecordAsync(conn, tx, entry);

        await tx.CommitAsync();
      }

      AdminAudit.Emit(entry, persisted);
      return res.Ok(Counts(false, publishInserted, publishSkipped, importInserted, importSkipped));
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  private static async Task<(long Absent, long Present)> CountCandidatesAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string candidates, string present)
  {
    var rows = await DbUtil.QueryAsync(conn, tx,
      $"""
      select count(*) filter (where not ({present})) as "absent",
             count(*) filter (where {present}) as "present"
      from ({candidates}) c
      """,
      []);
    return (ToLong(rows[0]["absent"]), ToLong(rows[0]["present"]));
  }

  private static object Counts(bool dryRun, long publishInserted, long publishSkipped, long importInserted, long importSkipped) => new
  {
    dryRun,
    inserted = new Dictionary<string, long> { ["publish_pipeline"] = publishInserted, ["bulk_import"] = importInserted },
    skipped = new Dictionary<string, long> { ["publish_pipeline"] = publishSkipped, ["bulk_import"] = importSkipped },
  };

  // ------------------------------------------------------------------ helpers

  private const string BaselineSelect = """
    select automation as "automation", unit as "unit", baseline_minutes_per_unit as "baselineMinutesPerUnit",
           baseline_source as "baselineSource", note as "note", updated_at as "updatedAt"
    from automation_baselines
    """;

  private static object BaselineItem(Dictionary<string, object?> r) => new
  {
    automation = (string)r["automation"]!,
    unit = (string)r["unit"]!,
    baselineMinutesPerUnit = ToDecimal(r["baselineMinutesPerUnit"]),
    baselineSource = (string)r["baselineSource"]!,
    note = (string?)r["note"],
    updatedAt = r["updatedAt"],
  };

  private static object AuditState(Dictionary<string, object?> r) => new
  {
    baselineMinutesPerUnit = ToDecimal(r["baselineMinutesPerUnit"]),
    baselineSource = (string)r["baselineSource"]!,
    note = (string?)r["note"],
  };

  private static APIGatewayProxyResponse MapError(Exception ex, Res res)
  {
    if (ex is PostgresException { SqlState: "42P01" or "42703" })
    {
      return Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY_LEDGER", "Run migration 028 first");
    }
    return Helpers.HandlePgError(ex, res) ?? res.Error500(ex);
  }

  private static APIGatewayProxyResponse Invalid(Res res, string message) => res.BadRequest("VALIDATION_ERROR", message);

  private static string? Param(LambdaRequest req, string name) =>
    req.Query.TryGetValue(name, out var v) && !string.IsNullOrEmpty(v) ? v : null;

  private static bool TryParseDay(string raw, out DateOnly day) =>
    DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);

  private static string FormatDay(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

  private static long ToLong(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  private static decimal ToDecimal(object? v) => Convert.ToDecimal(v, CultureInfo.InvariantCulture);

  private static decimal Round2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

  /// <summary>base64url of UTF-8 <c>{"v":1,"id":&lt;last id&gt;}</c>.</summary>
  internal static string EncodeCursor(long id) =>
    CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { v = 1, id })));

  internal static bool TryDecodeCursor(string raw, out long id)
  {
    id = 0;

    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return false;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object) return false;
      if (!CursorCodec.TryReadVersion(root)) return false;
      return root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number && idEl.TryGetInt64(out id) && id > 0;
    }
    catch (JsonException)
    {
      return false;
    }
  }
}
