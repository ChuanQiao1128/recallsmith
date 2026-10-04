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

namespace RecallSmith.Lambda.Vpc.Reports;

/// <summary>
/// Anonymous card reports (R28 ANONREPORT, user-perspective review 2026-10-04 item U2): a learner who is not signed in
/// reports a problem with a card through <c>POST /api/v1/public/card-reports</c>. The route follows the public funnel
/// ingest (<c>POST /api/v1/public/events</c>): no auth (the dispatcher never resolves a bearer for it, so a signed-in
/// caller is never linked), an exact gateway route with its own throttle, a small body cap, a per-container request
/// budget and a global daily cap.
/// <para>
/// Structured data only: <c>{ deckSlug, stableUid, reason, appVersion }</c>, nothing else (an unknown key, a note
/// included, is a 400). The row is an ordinary <c>card_reports</c> row with <c>user_sub</c> null and <c>note</c> null
/// (migration 046), so the console list, <c>automation/status</c> and the weekly digest count it with no other change.
/// No account, device or install id and no IP is read or stored; the body is never logged. Only a card of a live free
/// deck can be reported (an anonymous caller has no entitlement). One anonymous report per card, reason and UTC day:
/// a repeat is answered exactly like a new one and stores nothing. Unlike a signed-in report, a new anonymous report
/// never starts the AI triage re-check, so an unauthenticated caller cannot spend model budget.
/// </para>
/// </summary>
public static class AnonymousCardReports
{
  public const string RoutePath = "/api/v1/public/card-reports";

  /// <summary>New anonymous reports per UTC day across all callers; <c>"0"</c> turns the anonymous route off.</summary>
  public const string DailyCapEnv = "CARD_REPORT_ANON_DAILY_CAP";

  public const int DefaultDailyCap = 100;
  public const int MaxBodyBytes = 1024;
  public const int MaxAppVersionChars = 20;

  internal const int MaxRequestsPerWindow = 30;
  internal const long WindowMs = 60_000;

  /// <summary>The <c>card_report_anon_daily_cap</c> warn line is written at most once per container per this many ms.</summary>
  internal const long DailyCapLineMs = 3_600_000;

  /// <summary>The body keys this route accepts; any other key is refused so free text cannot arrive by mistake.</summary>
  public static readonly IReadOnlyList<string> Fields = ["deckSlug", "stableUid", "reason", "appVersion"];

  // ASCII digits and \z, not \d and $: in .NET \d matches any Unicode digit (e.g. Arabic-Indic) and $ also matches
  // before a final "\n", so "2.0.0\n" or 2.0.0 in Arabic-Indic digits would reach client_version (R28 ANONREPORT-R3).
  private static readonly Regex AppVersionRegex = new(@"^[0-9]+\.[0-9]+\.[0-9]+\z", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));

  /// <summary>The clock of the request budget and the cap line. Internal so a test can move "now".</summary>
  internal static Func<DateTime> UtcNow = () => DateTime.UtcNow;

  // A per-container budget guarded by a lock (the AnonFunnel pattern): static, so it survives warm invocations.
  private static readonly object BudgetLock = new();
  private static long _windowStart;
  private static int _count;
  private static bool _budgetLineWritten;
  private static long? _dailyCapLineAt;

  /// <summary><c>CARD_REPORT_ANON_DAILY_CAP</c>, read per call; unset or not a non-negative integer means 100.</summary>
  public static int DailyCap() =>
    int.TryParse(Environment.GetEnvironmentVariable(DailyCapEnv)?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var n)
      ? n
      : DefaultDailyCap;

  /// <summary>Zeroes the per-container window and the cap line. For tests only.</summary>
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

  private sealed record Input(string DeckSlug, string StableUid, string Reason, string AppVersion);

  /// <summary>
  /// The ingest. Takes no <see cref="AuthContext"/> on purpose: a bearer sent with the call is never read. Answers
  /// <c>202 { received: true }</c> for a new report and for a repeat alike.
  /// </summary>
  public static async Task<APIGatewayProxyResponse> HandleCreate(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    if (!CardReports.Enabled() || DailyCap() <= 0) return CardReports.Disabled(res);

    var raw = req.RawBody ?? string.Empty;
    if (raw.Length > MaxBodyBytes || Encoding.UTF8.GetByteCount(raw) > MaxBodyBytes)
    {
      return Helpers.ErrorEnvelope(res, 413, "PAYLOAD_TOO_LARGE", $"report exceeds {MaxBodyBytes} bytes");
    }

    if (!TakeBudget())
    {
      return res.Raw(429,
        new { success = false, data = (object?)null, error = new { code = "RATE_LIMITED", message = "Too many requests" }, traceId = res.TraceId, version = "v1" },
        new Dictionary<string, string> { ["Retry-After"] = "60" });
    }

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("VALIDATION_ERROR", "Invalid JSON body");
      var input = Parse(doc.RootElement);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      long reportId, deckId;
      object? createdAt;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        // Migration 046 lets user_sub be null and adds the per-day unique index; without it nothing is written.
        if (await DbUtil.ExecuteScalarAsync(conn, tx, "select to_regclass('uq_card_reports_anonymous_day') is not null", []) is not true)
        {
          return NotReady(res);
        }

        // One anonymous report at a time: the dedupe, the daily count and the insert see the same rows.
        await DbUtil.ExecuteAsync(conn, tx, "select pg_advisory_xact_lock(hashtext('card_reports:anonymous'))", []);

        // Only a card anyone can see: a live free deck. Anything else is the same 404 as an unknown card.
        var card = await DbUtil.QueryAsync(conn, tx,
          $"""
          select d.id as deck_id, c.id as card_id, left(c.question, {CardReports.MaxQuestionLength}) as question
          from decks d join cards c on c.deck_id = d.id
          where d.slug = $1 and d.is_deleted = 0 and c.stable_uid = $2 and c.is_deleted = 0
            and d.availability = 'live' and d.tier = 'free'
          order by d.id, c.id
          limit 1
          """, [input.DeckSlug, input.StableUid]);
        if (card.Count == 0) return Helpers.ErrorEnvelope(res, 404, "CARD_NOT_FOUND", "Card not found");
        deckId = RunnerRoutes.Long(card[0]["deck_id"]);
        var cardId = RunnerRoutes.Long(card[0]["card_id"]);
        var question = card[0]["question"] as string;

        var existing = await DbUtil.ExecuteScalarAsync(conn, tx,
          """
          select id from card_reports
          where user_sub is null and deck_slug = $1 and stable_uid = $2 and reason = $3
            and created_at >= date_trunc('day', now(), 'UTC')
          limit 1
          """, [input.DeckSlug, input.StableUid, input.Reason]);
        if (existing is not null)
        {
          await tx.CommitAsync();
          Log.Event("info", new { tag = "card_reports", outcome = "duplicate", anonymous = true, reportId = RunnerRoutes.Long(existing) });
          return Received(res);
        }

        var today = RunnerRoutes.Long(await DbUtil.ExecuteScalarAsync(conn, tx,
          "select count(*) from card_reports where user_sub is null and created_at >= date_trunc('day', now(), 'UTC')", []));
        if (today >= DailyCap())
        {
          DailyCapLine();
          return Helpers.ErrorEnvelope(res, 429, "REPORT_DAILY_CAP", "Too many reports today. Try again tomorrow.");
        }

        var inserted = (await DbUtil.QueryAsync(conn, tx,
          """
          insert into card_reports (user_sub, deck_id, deck_slug, card_id, stable_uid, reason, note, client_version, question)
          values (null, $1, $2, $3, $4, $5, null, $6::text, $7::text)
          returning id, created_at
          """, [deckId, input.DeckSlug, cardId, input.StableUid, input.Reason, input.AppVersion, question]))[0];
        reportId = RunnerRoutes.Long(inserted["id"]);
        createdAt = inserted["created_at"];
        await tx.CommitAsync();
      }

      Log.Event("info", new { tag = "card_reports", outcome = "created", anonymous = true, reportId, deckId, reason = input.Reason });

      // After commit, best-effort, the signed-in route's event: no note and no user. No AI triage (see the summary).
      await WebhookEvents.EnqueueAsync(conn, "card.reported", new
      {
        reportId,
        deckSlug = input.DeckSlug,
        stableUid = input.StableUid,
        reason = input.Reason,
        createdAt = RunnerRoutes.Timestamp(createdAt),
      });

      return Received(res);
    }
    catch (ValidationError ex)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703" or "23502")
    {
      // No card_reports table (before 037/041) or a NOT NULL user_sub (before 046).
      return NotReady(res);
    }
    catch (PostgresException ex) when (ex.SqlState == "23505")
    {
      // The per-day unique index caught a repeat the locked check did not see: still a repeat.
      Log.Event("info", new { tag = "card_reports", outcome = "duplicate", anonymous = true });
      return Received(res);
    }
    catch (Exception ex)
    {
      var handled = Helpers.HandlePgError(ex, res);
      return handled ?? res.Error500(ex);
    }
  }

  private static Input Parse(JsonElement root)
  {
    var body = AutomationBody.Object(root);
    foreach (var p in body.EnumerateObject())
    {
      if (!Fields.Contains(p.Name, StringComparer.Ordinal))
      {
        throw new ValidationError(
          p.Name == "note"
            ? "note is accepted only from a signed-in learner"
            : $"unknown field (allowed: {string.Join(", ", Fields)})",
          "body");
      }
    }

    var deckSlug = StringProp(body, "deckSlug");
    if (!Validation.IsValidSlug(deckSlug)) throw new ValidationError("deckSlug must match " + Validation.SlugPattern, "deckSlug");
    // The signed-in route's rule; the card lookup then admits only a uid that exists, so nothing free-form is stored.
    var stableUid = CardReports.RequiredKey(body, "stableUid");
    var reason = AutomationBody.RequiredEnum(body, "reason", CardReports.Reasons);
    var appVersion = StringProp(body, "appVersion");
    if (appVersion is null || appVersion.Length > MaxAppVersionChars || !AppVersionRegex.IsMatch(appVersion))
    {
      throw new ValidationError($"appVersion must look like 2.0.0 (at most {MaxAppVersionChars} characters)", "appVersion");
    }
    return new Input(deckSlug!, stableUid, reason, appVersion);
  }

  private static string? StringProp(JsonElement obj, string name) =>
    obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

  private static APIGatewayProxyResponse Received(Res res) =>
    res.Raw(202, new { success = true, data = new { received = true }, error = (object?)null, traceId = res.TraceId, version = "v1" });

  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "NOT_READY", "Run the database migration (046_card_reports_anonymous)");

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
          Log.Event("warn", new { tag = "card_report_anon_budget", limitedAfter = MaxRequestsPerWindow, windowMs = WindowMs });
        }
        return false;
      }
      _count++;
      return true;
    }
  }

  /// <summary>One <c>card_report_anon_daily_cap</c> warn line per container per hour at most.</summary>
  private static void DailyCapLine()
  {
    lock (BudgetLock)
    {
      var now = new DateTimeOffset(UtcNow().ToUniversalTime()).ToUnixTimeMilliseconds();
      if (_dailyCapLineAt is { } at && now - at < DailyCapLineMs) return;
      _dailyCapLineAt = now;
    }
    Log.Event("warn", new { tag = "card_report_anon_daily_cap", dailyCap = DailyCap() });
  }
}
