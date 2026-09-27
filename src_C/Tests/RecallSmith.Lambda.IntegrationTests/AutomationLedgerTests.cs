using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Internal;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Automation Ledger (R18 J08, contract §3.3, §9) against a real Postgres: migration 028, the never-throwing
/// <see cref="AutomationLedger.RecordAsync"/>, the admin routes (summary maths, weekly series, validation,
/// baseline editing, keyset event list, permissions, routing, 503 on a pre-028 schema) and the four live
/// emission sites. Summary tests write rows in a far-past year of their own and query only that range;
/// emission tests select by their own dedupe key or fresh deck id; a test that edits a baseline restores it.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationLedgerTests
{
  private readonly PostgresFixture _db;
  public AutomationLedgerTests(PostgresFixture db) => _db = db;

  private const string LedgerPath = "/api/v1/admin/automation/ledger";
  private const string EventsPath = "/api/v1/admin/automation/events";
  private const string BaselinesPath = "/api/v1/admin/automation/baselines";
  private const string BackfillPath = "/api/v1/admin/automation/backfill";

  private static readonly string[] SeededAutomations =
    ["ai_draft_review", "ai_qa_review", "bulk_import", "publish_gate", "publish_pipeline", "webhook_notification"];

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-j08-{Guid.NewGuid():N}";

  private static JsonElement Event(string method, string path, string sub, string[] groups, IDictionary<string, string>? query, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
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
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  /// <summary>Through the deployed entry point: VpcFunction routes, the handler answers.</summary>
  private static Task<APIGatewayProxyResponse> CallAsync(
    string method, string path, object? body = null, IDictionary<string, string>? query = null, string[]? groups = null, string? sub = null)
  {
    var raw = body is null ? null : body as string ?? JsonSerializer.Serialize(body);
    var evt = Event(method, path, sub ?? NewSub(), groups ?? ["super_admin"], query, raw);
    return new RecallSmith.Lambda.VpcFunction().Handler(evt);
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static async Task<JsonElement> LedgerAsync(string from, string to, string? granularity = null)
  {
    var query = new Dictionary<string, string> { ["from"] = from, ["to"] = to };
    if (granularity is not null) query["granularity"] = granularity;
    var resp = await CallAsync("GET", LedgerPath, query: query, groups: ["editor"]);
    Assert.True(resp.StatusCode == 200, resp.Body);
    return Data(resp);
  }

  private static JsonElement Automation(JsonElement ledger, string name) =>
    ledger.GetProperty("automations").EnumerateArray().Single(a => a.GetProperty("automation").GetString() == name);

  private static DateTimeOffset At(int year, int month, int day, int hour = 12) => new(year, month, day, hour, 0, 0, TimeSpan.Zero);

  private async Task RecordAsync(AutomationEvent e)
  {
    await using var conn = await _db.OpenAsync();
    await AutomationLedger.RecordAsync(conn, e);
  }

  private async Task<long> NewDeckAsync(string tag)
  {
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      $"it-j08-{tag}-{Guid.NewGuid():N}", $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private Task<List<Dictionary<string, object?>>> EventsByKeyAsync(string dedupeKey) =>
    _db.QueryAsync(
      "select automation, units, outcome, defects_caught, deck_id, ref, source, details::text as details from automation_events where dedupe_key = $1",
      dedupeKey);

  private async Task<string> ScratchAsync(string name, int maxVersion)
  {
    var scratch = await _db.CreateScratchDatabaseAsync(name);
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion);
    return scratch;
  }

  private static Task<string> Migration028TextAsync() =>
    File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "028_automation_ledger.sql"));

  /// <summary>Snapshot of one baseline row, restorable byte for byte.</summary>
  private async Task<Func<Task>> SnapshotBaselineAsync(string automation)
  {
    var row = (await _db.QueryAsync(
      "select baseline_minutes_per_unit, baseline_source, note, updated_by_sub, updated_at from automation_baselines where automation = $1",
      automation)).Single();
    return () => _db.ScalarAsync(
      "update automation_baselines set baseline_minutes_per_unit = $2, baseline_source = $3, note = $4, updated_by_sub = $5, updated_at = $6 where automation = $1",
      automation, row["baseline_minutes_per_unit"], row["baseline_source"], row["note"], row["updated_by_sub"], row["updated_at"]);
  }

  // ---------------------------------------------------------------- migration

  [Fact]
  public async Task Migration028_SeedsSixDefaultBaselines()
  {
    var scratch = await ScratchAsync("j08_028_seed", 28);
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();

    var rows = await DbUtil.QueryAsync(conn, null,
      "select automation, unit, baseline_minutes_per_unit, baseline_source, note from automation_baselines order by automation collate \"C\"", []);
    Assert.Equal(SeededAutomations, rows.Select(r => (string)r["automation"]!).ToArray());
    Assert.All(rows, r => Assert.Equal("default", (string)r["baseline_source"]!));
    Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace((string?)r["note"])));

    var minutes = rows.ToDictionary(r => (string)r["automation"]!, r => (decimal)r["baseline_minutes_per_unit"]!);
    Assert.Equal(20.00m, minutes["publish_pipeline"]);
    Assert.Equal(1.50m, minutes["bulk_import"]);
    Assert.Equal(12.00m, minutes["ai_draft_review"]);
    Assert.Equal(3.00m, minutes["ai_qa_review"]);
    Assert.Equal(1.00m, minutes["webhook_notification"]);
    Assert.Equal(0.00m, minutes["publish_gate"]);

    var units = rows.ToDictionary(r => (string)r["automation"]!, r => (string)r["unit"]!);
    Assert.Equal("publish", units["publish_pipeline"]);
    Assert.Equal("card", units["bulk_import"]);
    Assert.Equal("blocked publish", units["publish_gate"]);

    Assert.Equal(0L, Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from automation_events", []), CultureInfo.InvariantCulture));
    var constraint = await DbUtil.ExecuteScalarAsync(conn, null,
      "select count(*) from pg_constraint where conname = 'uq_automation_events_dedupe'", []);
    Assert.Equal(1L, Convert.ToInt64(constraint, CultureInfo.InvariantCulture));

    // The shared suite database carries the same six names.
    var shared = await _db.QueryAsync("select automation from automation_baselines order by automation collate \"C\"");
    Assert.Equal(SeededAutomations, shared.Select(r => (string)r["automation"]!).ToArray());
    Assert.Equal(SeededAutomations.OrderBy(a => a, StringComparer.Ordinal), AutomationLedger.Automations.OrderBy(a => a, StringComparer.Ordinal));
  }

  [Fact]
  public async Task Migration028_IsIdempotent()
  {
    var scratch = await ScratchAsync("j08_028_idem", 28);
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();

    // An edited baseline survives a re-run: the seed is `on conflict do nothing`.
    await DbUtil.ExecuteAsync(conn, null,
      "update automation_baselines set baseline_minutes_per_unit = 7.25, baseline_source = 'measured' where automation = 'publish_gate'", []);
    await AutomationLedger.RecordAsync(conn, new AutomationEvent("publish_gate", 0, "success", DefectsCaught: 1, DedupeKey: "it-j08-idem"));

    var sql = await Migration028TextAsync();
    await DbUtil.ExecuteAsync(conn, null, sql, []);
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    Assert.Equal(6L, Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from automation_baselines", []), CultureInfo.InvariantCulture));
    var gate = (await DbUtil.QueryAsync(conn, null,
      "select baseline_minutes_per_unit, baseline_source from automation_baselines where automation = 'publish_gate'", [])).Single();
    Assert.Equal(7.25m, (decimal)gate["baseline_minutes_per_unit"]!);
    Assert.Equal("measured", (string)gate["baseline_source"]!);
    Assert.Equal(1L, Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from automation_events", []), CultureInfo.InvariantCulture));
  }

  // ---------------------------------------------------------------- RecordAsync

  [Fact]
  public async Task Record_InsertsRow()
  {
    var deckId = await NewDeckAsync("rec");
    var key = $"it-j08-rec-{Guid.NewGuid():N}";
    var longRef = new string('r', 300);

    await RecordAsync(new AutomationEvent("ai_draft_review", 2, "partial", ActualMinutes: 3.5m, DefectsCaught: 1,
      DeckId: deckId, Ref: longRef, DedupeKey: key, Details: new { note = "x", n = 2 }, OccurredAt: At(2000, 2, 3)));

    var row = (await _db.QueryAsync(
      "select automation, occurred_at, units, outcome, actual_minutes, defects_caught, deck_id, ref, source, details::text as details from automation_events where dedupe_key = $1",
      key)).Single();
    Assert.Equal("ai_draft_review", (string)row["automation"]!);
    Assert.Equal(At(2000, 2, 3).UtcDateTime, ((DateTime)row["occurred_at"]!).ToUniversalTime());
    Assert.Equal(2, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));
    Assert.Equal("partial", (string)row["outcome"]!);
    Assert.Equal(3.5m, (decimal)row["actual_minutes"]!);
    Assert.Equal(1, Convert.ToInt32(row["defects_caught"], CultureInfo.InvariantCulture));
    Assert.Equal(deckId, Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(200, ((string)row["ref"]!).Length);
    Assert.Equal("live", (string)row["source"]!);
    using var details = JsonDocument.Parse((string)row["details"]!);
    Assert.Equal("x", details.RootElement.GetProperty("note").GetString());

    // Defaults: occurred_at = now(), null details stay SQL null.
    var key2 = $"it-j08-rec2-{Guid.NewGuid():N}";
    await RecordAsync(new AutomationEvent("bulk_import", 1, "success", DedupeKey: key2));
    var row2 = (await _db.QueryAsync(
      "select occurred_at > now() - interval '5 minutes' as recent, details, deck_id, actual_minutes from automation_events where dedupe_key = $1", key2)).Single();
    Assert.True((bool)row2["recent"]!);
    Assert.Null(row2["details"]);
    Assert.Null(row2["deck_id"]);
    Assert.Null(row2["actual_minutes"]);
  }

  [Fact]
  public async Task Record_DuplicateDedupeKey_IsIgnored()
  {
    var key = $"it-j08-dup-{Guid.NewGuid():N}";
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", Ref: "first", DedupeKey: key));
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", Ref: "second", DedupeKey: key));

    var rows = await EventsByKeyAsync(key);
    Assert.Single(rows);
    Assert.Equal("first", (string)rows[0]["ref"]!);
  }

  [Fact]
  public async Task Record_MissingTable_DoesNotThrow()
  {
    var scratch = await ScratchAsync("j08_pre028_record", 27);
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();

    await AutomationLedger.RecordAsync(conn, new AutomationEvent("publish_pipeline", 1, "success", DedupeKey: "it-j08-missing"));

    // The connection is still usable afterwards (no transaction was left aborted).
    Assert.Equal(1, Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, null, "select 1", []), CultureInfo.InvariantCulture));
    Assert.Equal(false, await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.automation_events') is not null", []));
  }

  [Fact]
  public async Task Record_DroppedWrite_EmitsLedgerWriteFailures()
  {
    // backend-design-10: a dropped best-effort write is alarmable, not only a warn line.
    var key = $"it-x01-drop-{Guid.NewGuid():N}";
    var dropped = await EmfCapture.StdoutAsync(() => RecordAsync(new AutomationEvent("bulk_import", 3, "success", DeckId: 987_654_321_097, DedupeKey: key)));
    Assert.Equal(1, EmfCapture.GaugeSum(dropped, AutomationLedger.WriteFailuresMetric));
    Assert.Equal("LedgerWriteFailures", AutomationLedger.WriteFailuresMetric);

    var scratch = await ScratchAsync("x01_pre028_metric", 27);
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    var notReady = await EmfCapture.StdoutAsync(() => AutomationLedger.RecordAsync(conn, new AutomationEvent("publish_pipeline", 1, "success")));
    Assert.Equal(1, EmfCapture.GaugeSum(notReady, AutomationLedger.WriteFailuresMetric));

    var ok = await EmfCapture.StdoutAsync(() => RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", DedupeKey: key + "-ok")));
    Assert.Equal(0, EmfCapture.GaugeSum(ok, AutomationLedger.WriteFailuresMetric));
  }

  [Fact]
  public async Task Record_UnknownDeck_DoesNotThrow()
  {
    var key = $"it-j08-nodeck-{Guid.NewGuid():N}";
    await RecordAsync(new AutomationEvent("bulk_import", 3, "success", DeckId: 987_654_321_098, DedupeKey: key));
    Assert.Empty(await EventsByKeyAsync(key));

    // An unknown automation (FK to the baselines) and a bad outcome (check) are dropped the same way.
    await RecordAsync(new AutomationEvent("no_such_automation", 1, "success", DedupeKey: key));
    await RecordAsync(new AutomationEvent("bulk_import", 1, "done", DedupeKey: key));
    Assert.Empty(await EventsByKeyAsync(key));
  }

  // ---------------------------------------------------------------- GET /ledger

  [Fact]
  public async Task Ledger_ComputesTotalsAndMinutesSaved()
  {
    for (var i = 0; i < 3; i++)
    {
      await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: At(2001, 3, 5 + i)));
    }
    await RecordAsync(new AutomationEvent("bulk_import", 40, "success", OccurredAt: At(2001, 4, 2)));
    await RecordAsync(new AutomationEvent("ai_draft_review", 1, "success", ActualMinutes: 2.5m, OccurredAt: At(2001, 5, 7)));
    // Outside the range on both sides: never counted.
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: new DateTimeOffset(2000, 12, 31, 23, 59, 59, TimeSpan.Zero)));
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: new DateTimeOffset(2001, 7, 1, 0, 0, 0, TimeSpan.Zero)));

    var data = await LedgerAsync("2001-01-01", "2001-06-30");
    Assert.Equal(new[] { "from", "to", "granularity", "totals", "automations", "series", "agentDrafts" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal("2001-01-01", data.GetProperty("from").GetString());
    Assert.Equal("2001-06-30", data.GetProperty("to").GetString());
    Assert.Equal("week", data.GetProperty("granularity").GetString());

    var totals = data.GetProperty("totals");
    Assert.Equal(
      new[] { "runs", "units", "baselineMinutes", "actualMinutes", "minutesSaved", "hoursSaved", "defectsCaught", "qaFalsePositives", "bySource", "byBaselineSource" },
      totals.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(5, totals.GetProperty("runs").GetInt64());
    Assert.Equal(44, totals.GetProperty("units").GetInt64());
    // 3 × 20 + 40 × 1.5 + 1 × 12 = 132; actual 2.5; saved 129.5; hours 2.1583… → 2.16.
    Assert.Equal(132m, totals.GetProperty("baselineMinutes").GetDecimal());
    Assert.Equal(2.5m, totals.GetProperty("actualMinutes").GetDecimal());
    Assert.Equal(129.5m, totals.GetProperty("minutesSaved").GetDecimal());
    Assert.Equal(2.16m, totals.GetProperty("hoursSaved").GetDecimal());
    Assert.Equal(0, totals.GetProperty("defectsCaught").GetInt64());
    Assert.Equal(0, totals.GetProperty("qaFalsePositives").GetInt64());

    var automations = data.GetProperty("automations").EnumerateArray().ToList();
    Assert.Equal(SeededAutomations, automations.Select(a => a.GetProperty("automation").GetString()).ToArray());
    Assert.Equal(
      new[] { "automation", "unit", "baselineMinutesPerUnit", "baselineSource", "runs", "units", "failures", "failureRate", "baselineMinutes", "actualMinutes", "minutesSaved", "defectsCaught" },
      automations[0].EnumerateObject().Select(p => p.Name).ToArray());

    var publish = Automation(data, "publish_pipeline");
    Assert.Equal(20m, publish.GetProperty("baselineMinutesPerUnit").GetDecimal());
    Assert.Equal("default", publish.GetProperty("baselineSource").GetString());
    Assert.Equal(3, publish.GetProperty("runs").GetInt64());
    Assert.Equal(60m, publish.GetProperty("minutesSaved").GetDecimal());

    var import = Automation(data, "bulk_import");
    Assert.Equal(1, import.GetProperty("runs").GetInt64());
    Assert.Equal(40, import.GetProperty("units").GetInt64());
    Assert.Equal(60m, import.GetProperty("baselineMinutes").GetDecimal());

    var draft = Automation(data, "ai_draft_review");
    Assert.Equal(12m, draft.GetProperty("baselineMinutes").GetDecimal());
    Assert.Equal(2.5m, draft.GetProperty("actualMinutes").GetDecimal());
    Assert.Equal(9.5m, draft.GetProperty("minutesSaved").GetDecimal());

    // Idle automations are present with zeros.
    var idle = Automation(data, "webhook_notification");
    Assert.Equal(0, idle.GetProperty("runs").GetInt64());
    Assert.Equal(0m, idle.GetProperty("failureRate").GetDecimal());
    Assert.Equal(0m, idle.GetProperty("minutesSaved").GetDecimal());
  }

  [Fact]
  public async Task Ledger_FailuresSaveNothingAndCountInFailureRate()
  {
    for (var i = 0; i < 3; i++)
    {
      await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: At(2002, 6, 3 + i)));
    }
    await RecordAsync(new AutomationEvent("publish_pipeline", 0, "failure", OccurredAt: At(2002, 6, 10)));
    // A failure with units still saves nothing, but its baseline minutes are reported.
    await RecordAsync(new AutomationEvent("bulk_import", 2, "failure", OccurredAt: At(2002, 6, 11)));
    // A MCQ gate refusal: no run (units 0, outcome success), one defect.
    await RecordAsync(new AutomationEvent("publish_gate", 0, "success", DefectsCaught: 1, OccurredAt: At(2002, 6, 12)));

    var data = await LedgerAsync("2002-01-01", "2002-12-31", "month");

    var publish = Automation(data, "publish_pipeline");
    Assert.Equal(4, publish.GetProperty("runs").GetInt64());
    Assert.Equal(1, publish.GetProperty("failures").GetInt64());
    Assert.Equal(0.25m, publish.GetProperty("failureRate").GetDecimal());
    Assert.Equal(60m, publish.GetProperty("minutesSaved").GetDecimal());

    var import = Automation(data, "bulk_import");
    Assert.Equal(1, import.GetProperty("runs").GetInt64());
    Assert.Equal(1, import.GetProperty("failures").GetInt64());
    Assert.Equal(1m, import.GetProperty("failureRate").GetDecimal());
    Assert.Equal(3m, import.GetProperty("baselineMinutes").GetDecimal());
    Assert.Equal(0m, import.GetProperty("minutesSaved").GetDecimal());

    var gate = Automation(data, "publish_gate");
    Assert.Equal(0, gate.GetProperty("runs").GetInt64());
    Assert.Equal(1, gate.GetProperty("defectsCaught").GetInt64());

    var totals = data.GetProperty("totals");
    Assert.Equal(5, totals.GetProperty("runs").GetInt64());
    Assert.Equal(60m, totals.GetProperty("minutesSaved").GetDecimal());
    Assert.Equal(1m, totals.GetProperty("hoursSaved").GetDecimal());
    Assert.Equal(1, totals.GetProperty("defectsCaught").GetInt64());

    var series = data.GetProperty("series").EnumerateArray().ToList();
    Assert.All(series, s => Assert.Equal("2002-06-01", s.GetProperty("periodStart").GetString()));
    Assert.Equal(new[] { "bulk_import", "publish_gate", "publish_pipeline" }, series.Select(s => s.GetProperty("automation").GetString()).ToArray());
  }

  [Fact]
  public async Task Ledger_ReviewCostOffsetsSavingsPerAutomation_AndSplitsBySource()
  {
    // automation-4: savings are clamped per automation (and source), not per row, so a reject's review time
    // (units 0) reduces what the accepts saved.
    await RecordAsync(new AutomationEvent("ai_draft_review", 1, "success", ActualMinutes: 2m, OccurredAt: At(2007, 3, 1)));
    await RecordAsync(new AutomationEvent("ai_draft_review", 0, "success", ActualMinutes: 3m, OccurredAt: At(2007, 3, 2)));
    // automation-11: live and backfilled rows are reported apart.
    await RecordAsync(new AutomationEvent("bulk_import", 2, "success", OccurredAt: At(2007, 3, 3)));
    await RecordAsync(new AutomationEvent("bulk_import", 10, "success", Source: "backfill", OccurredAt: At(2007, 3, 4)));

    var data = await LedgerAsync("2007-01-01", "2007-12-31", "month");

    var draft = Automation(data, "ai_draft_review");
    Assert.Equal(1, draft.GetProperty("runs").GetInt64());
    Assert.Equal(5m, draft.GetProperty("actualMinutes").GetDecimal());
    // max(0, 1 × 12 − (2 + 3)) = 7; a per-row clamp would have reported 10.
    Assert.Equal(7m, draft.GetProperty("minutesSaved").GetDecimal());

    var totals = data.GetProperty("totals");
    // 7 + 2 × 1.5 + 10 × 1.5 = 25.
    Assert.Equal(25m, totals.GetProperty("minutesSaved").GetDecimal());
    var live = totals.GetProperty("bySource").GetProperty("live");
    var backfill = totals.GetProperty("bySource").GetProperty("backfill");
    Assert.Equal(new[] { "runs", "units", "minutesSaved", "hoursSaved" }, live.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(10m, live.GetProperty("minutesSaved").GetDecimal());
    Assert.Equal(3, live.GetProperty("units").GetInt64());
    Assert.Equal(2, live.GetProperty("runs").GetInt64());
    Assert.Equal(15m, backfill.GetProperty("minutesSaved").GetDecimal());
    Assert.Equal(10, backfill.GetProperty("units").GetInt64());
    Assert.Equal(1, backfill.GetProperty("runs").GetInt64());
    Assert.Equal(0.25m, backfill.GetProperty("hoursSaved").GetDecimal());

    var byBaseline = totals.GetProperty("byBaselineSource");
    Assert.Equal(
      totals.GetProperty("minutesSaved").GetDecimal(),
      byBaseline.GetProperty("measured").GetProperty("minutesSaved").GetDecimal() + byBaseline.GetProperty("default").GetProperty("minutesSaved").GetDecimal());

    var series = data.GetProperty("series").EnumerateArray().ToList();
    var draftPoint = Assert.Single(series, s => s.GetProperty("automation").GetString() == "ai_draft_review");
    Assert.Equal(7m, draftPoint.GetProperty("minutesSaved").GetDecimal());
    var importPoint = Assert.Single(series, s => s.GetProperty("automation").GetString() == "bulk_import");
    Assert.Equal(18m, importPoint.GetProperty("minutesSaved").GetDecimal());
  }

  [Fact]
  public async Task Ledger_Headline_IsIndependentOfGranularity_SeriesIsNet()
  {
    // automation-18 (replaces Ledger_SeriesAddsUpToTotals_AcrossPeriods, which pinned a headline that changed with
    // the granularity): the headline is clamped once per automation and source over the range, so the same rows
    // give the same "Hours saved" for day, week and month; the series' netMinutes is the unclamped net per period.
    // 2013-03-04 and 2013-03-11 are Mondays of two weeks in one month.
    var baseline = Automation(await LedgerAsync("2013-01-01", "2013-12-31"), "ai_draft_review").GetProperty("baselineMinutesPerUnit").GetDecimal();
    await RecordAsync(new AutomationEvent("ai_draft_review", 1, "success", ActualMinutes: 0m, OccurredAt: At(2013, 3, 5)));
    await RecordAsync(new AutomationEvent("ai_draft_review", 0, "success", ActualMinutes: baseline + 8m, OccurredAt: At(2013, 3, 12)));
    await RecordAsync(new AutomationEvent("bulk_import", 4, "success", OccurredAt: At(2013, 3, 6)));
    await RecordAsync(new AutomationEvent("bulk_import", 2, "success", Source: "backfill", OccurredAt: At(2013, 3, 13)));

    var headlines = new List<decimal>();
    foreach (var granularity in new[] { "day", "week", "month" })
    {
      var data = await LedgerAsync("2013-01-01", "2013-12-31", granularity);
      headlines.Add(data.GetProperty("totals").GetProperty("minutesSaved").GetDecimal());
      // The draft automation nets −8 over the range and is clamped to 0 once, at every grain.
      Assert.Equal(0m, Automation(data, "ai_draft_review").GetProperty("minutesSaved").GetDecimal());

      var series = data.GetProperty("series").EnumerateArray().ToList();
      var draftNet = series.Where(s => s.GetProperty("automation").GetString() == "ai_draft_review").Sum(s => s.GetProperty("netMinutes").GetDecimal());
      // Σ series(net) = Σ (units × baseline − actual) for the automation.
      Assert.Equal(1 * baseline - (baseline + 8m), draftNet);
      var importPoints = series.Where(s => s.GetProperty("automation").GetString() == "bulk_import").ToList();
      var importBaseline = Automation(data, "bulk_import").GetProperty("baselineMinutesPerUnit").GetDecimal();
      Assert.Equal(6 * importBaseline, importPoints.Sum(s => s.GetProperty("netMinutes").GetDecimal()));
      // backend-design-24: series minutesSaved keeps its meaning (clamped per period, automation and source), so
      // it is never negative and never below the signed net.
      Assert.All(series, s => Assert.True(s.GetProperty("minutesSaved").GetDecimal() >= 0m, s.ToString()));
      Assert.All(series, s => Assert.True(s.GetProperty("minutesSaved").GetDecimal() >= s.GetProperty("netMinutes").GetDecimal(), s.ToString()));
    }
    Assert.Single(headlines.Distinct());

    // At week grain the second week's net is negative instead of floored to 0; its minutesSaved is 0.
    var weekly = await LedgerAsync("2013-01-01", "2013-12-31", "week");
    var weeks = weekly.GetProperty("series").EnumerateArray().Where(s => s.GetProperty("automation").GetString() == "ai_draft_review").ToList();
    Assert.Equal(new[] { baseline, -(baseline + 8m) }, weeks.Select(s => s.GetProperty("netMinutes").GetDecimal()).ToArray());
    Assert.Equal(new[] { baseline, 0m }, weeks.Select(s => s.GetProperty("minutesSaved").GetDecimal()).ToArray());

    // At month grain the draft automation's only period is net-negative: netMinutes −8, minutesSaved 0.
    var monthly = await LedgerAsync("2013-01-01", "2013-12-31", "month");
    var month = Assert.Single(monthly.GetProperty("series").EnumerateArray(), s => s.GetProperty("automation").GetString() == "ai_draft_review");
    Assert.Equal(-8m, month.GetProperty("netMinutes").GetDecimal());
    Assert.Equal(0m, month.GetProperty("minutesSaved").GetDecimal());
  }

  [Fact]
  public async Task Ledger_ReportsAgentDraftQuality()
  {
    // automation-4: acceptance rate, edited-accept rate, the agent's defect rate and review time.
    var deckId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author) values ($1, 'x01 agent', 'tests') returning id", $"it-x01-agent-{Guid.NewGuid():N}"), CultureInfo.InvariantCulture);
    var batch = Guid.NewGuid();
    var decisions = new (string Action, string? Reason, int? Ms)[]
    {
      ("accepted", null, 60000),
      ("edited_accepted", null, 120000),
      ("rejected", "incorrect", 180000),
      ("rejected", "low_value", null),
    };
    for (var i = 0; i < decisions.Length; i++)
    {
      var draftId = Convert.ToInt64(await _db.ScalarAsync(
        """
        insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, status, card, submitted_by_sub)
        values ($1, $2, $3, $4, 'pending', '{}'::jsonb, 'it-x01') returning id
        """,
        deckId, batch, $"k{i}", $"agent-{i}"), CultureInfo.InvariantCulture);
      await _db.ScalarAsync(
        "insert into ai_review_events (draft_id, action, reason, review_ms, created_at) values ($1, $2, $3, $4, $5)",
        draftId, decisions[i].Action, decisions[i].Reason, decisions[i].Ms, At(2008, 4, 1 + i).UtcDateTime);
    }

    var agent = (await LedgerAsync("2008-01-01", "2008-12-31")).GetProperty("agentDrafts");
    Assert.Equal(
      new[] { "decided", "accepted", "editedAccepted", "rejected", "defectRejects", "acceptanceRate", "editedAcceptRate", "defectRate", "avgReviewMinutes", "reviewNotMeasured" },
      agent.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(4, agent.GetProperty("decided").GetInt64());
    Assert.Equal(2, agent.GetProperty("accepted").GetInt64());
    Assert.Equal(1, agent.GetProperty("editedAccepted").GetInt64());
    Assert.Equal(2, agent.GetProperty("rejected").GetInt64());
    Assert.Equal(1, agent.GetProperty("defectRejects").GetInt64());
    Assert.Equal(0.5m, agent.GetProperty("acceptanceRate").GetDecimal());
    Assert.Equal(0.5m, agent.GetProperty("editedAcceptRate").GetDecimal());
    Assert.Equal(0.25m, agent.GetProperty("defectRate").GetDecimal());
    Assert.Equal(2m, agent.GetProperty("avgReviewMinutes").GetDecimal());
    // automation-13: the reject sent without reviewMs is reported as not measured.
    Assert.Equal(1, agent.GetProperty("reviewNotMeasured").GetInt64());

    // An empty period answers zeros and a null average.
    var empty = (await LedgerAsync("1990-01-01", "1990-12-31")).GetProperty("agentDrafts");
    Assert.Equal(0, empty.GetProperty("decided").GetInt64());
    Assert.Equal(0m, empty.GetProperty("acceptanceRate").GetDecimal());
    Assert.Equal(JsonValueKind.Null, empty.GetProperty("avgReviewMinutes").ValueKind);
  }

  [Fact]
  public async Task Ledger_WeeklySeries_StartsMonday()
  {
    // 2003-01-01 is a Wednesday; its ISO week starts Monday 2002-12-30.
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: At(2003, 1, 1)));
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: new DateTimeOffset(2003, 1, 5, 23, 59, 0, TimeSpan.Zero)));
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: new DateTimeOffset(2003, 1, 6, 0, 0, 0, TimeSpan.Zero)));
    await RecordAsync(new AutomationEvent("webhook_notification", 1, "success", OccurredAt: At(2003, 1, 7)));

    var data = await LedgerAsync("2003-01-01", "2003-01-31", "week");
    var series = data.GetProperty("series").EnumerateArray().ToList();
    Assert.Equal(
      new[] { "periodStart", "automation", "runs", "units", "minutesSaved", "netMinutes", "defectsCaught" },
      series[0].EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(
      new[] { "2002-12-30 publish_pipeline 2", "2003-01-06 publish_pipeline 1", "2003-01-06 webhook_notification 1" },
      series.Select(s => $"{s.GetProperty("periodStart").GetString()} {s.GetProperty("automation").GetString()} {s.GetProperty("units").GetInt64()}").ToArray());
    Assert.Equal(40m, series[0].GetProperty("minutesSaved").GetDecimal());

    var daily = await LedgerAsync("2003-01-01", "2003-01-31", "day");
    Assert.Equal(
      new[] { "2003-01-01", "2003-01-05", "2003-01-06", "2003-01-07" },
      daily.GetProperty("series").EnumerateArray().Select(s => s.GetProperty("periodStart").GetString()).ToArray());
  }

  [Fact]
  public async Task Ledger_BadRange_Is400()
  {
    async Task Expect400(Dictionary<string, string> query)
    {
      var resp = await CallAsync("GET", LedgerPath, query: query);
      Assert.True(resp.StatusCode == 400, $"{JsonSerializer.Serialize(query)} returned {resp.StatusCode}: {resp.Body}");
      Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    }

    await Expect400(new() { ["from"] = "2024-13-01" });
    await Expect400(new() { ["to"] = "yesterday" });
    await Expect400(new() { ["from"] = "2024-02-30", ["to"] = "2024-03-01" });
    await Expect400(new() { ["from"] = "2024-03-02", ["to"] = "2024-03-01" });
    await Expect400(new() { ["from"] = "2024-01-01", ["to"] = "2025-01-01" }); // 367 days
    await Expect400(new() { ["granularity"] = "year" });
    await Expect400(new() { ["granularity"] = "Week" });

    // 366 days inclusive is the limit.
    var ok = await CallAsync("GET", LedgerPath, query: new Dictionary<string, string> { ["from"] = "2024-01-01", ["to"] = "2024-12-31" });
    Assert.True(ok.StatusCode == 200, ok.Body);

    // Defaults: the last 90 days ending today (UTC), weekly; one given date derives the other.
    var defaults = Data(await CallAsync("GET", LedgerPath));
    var today = DateOnly.FromDateTime(DateTime.UtcNow);
    Assert.Equal(today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), defaults.GetProperty("to").GetString());
    Assert.Equal(today.AddDays(-89).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), defaults.GetProperty("from").GetString());
    Assert.Equal("week", defaults.GetProperty("granularity").GetString());

    var onlyFrom = Data(await CallAsync("GET", LedgerPath, query: new Dictionary<string, string> { ["from"] = "2001-01-01" }));
    Assert.Equal("2001-03-31", onlyFrom.GetProperty("to").GetString());
    var onlyTo = Data(await CallAsync("GET", LedgerPath, query: new Dictionary<string, string> { ["to"] = "2001-03-31" }));
    Assert.Equal("2001-01-01", onlyTo.GetProperty("from").GetString());
  }

  [Fact]
  public async Task Ledger_BaselineEdit_RecomputesHistory()
  {
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: At(2004, 2, 2)));
    await RecordAsync(new AutomationEvent("publish_pipeline", 1, "success", OccurredAt: At(2004, 2, 3)));

    var before = Automation(await LedgerAsync("2004-01-01", "2004-12-31"), "publish_pipeline");
    Assert.Equal(40m, before.GetProperty("minutesSaved").GetDecimal());
    Assert.Equal("default", before.GetProperty("baselineSource").GetString());

    var restore = await SnapshotBaselineAsync("publish_pipeline");
    try
    {
      var put = await CallAsync("PUT", $"{BaselinesPath}/publish_pipeline", new { baselineMinutesPerUnit = 30, baselineSource = "measured" });
      Assert.True(put.StatusCode == 200, put.Body);

      var after = await LedgerAsync("2004-01-01", "2004-12-31");
      var publish = Automation(after, "publish_pipeline");
      Assert.Equal(60m, publish.GetProperty("minutesSaved").GetDecimal());
      Assert.Equal(60m, publish.GetProperty("baselineMinutes").GetDecimal());
      Assert.Equal(30m, publish.GetProperty("baselineMinutesPerUnit").GetDecimal());
      Assert.Equal("measured", publish.GetProperty("baselineSource").GetString());
      Assert.Equal(1m, after.GetProperty("totals").GetProperty("hoursSaved").GetDecimal());
    }
    finally
    {
      await restore();
    }
  }

  // ---------------------------------------------------------------- GET /events

  [Fact]
  public async Task Events_FilterAndKeysetPagination()
  {
    var deckId = await NewDeckAsync("events");
    var mine = new List<string>();
    for (var i = 0; i < 5; i++)
    {
      var key = $"it-j08-ev-{i}-{Guid.NewGuid():N}";
      mine.Add(key);
      await RecordAsync(new AutomationEvent("ai_qa_review", i + 1, "success", DeckId: deckId, Ref: $"run-{i}", DedupeKey: key,
        Details: i == 0 ? new { chunk = 0 } : null, OccurredAt: At(1999, 1, 1 + i)));
    }
    await RecordAsync(new AutomationEvent("bulk_import", 1, "success", DedupeKey: $"it-j08-ev-other-{Guid.NewGuid():N}"));

    var seen = new List<JsonElement>();
    string? cursor = null;
    var pages = 0;
    do
    {
      var query = new Dictionary<string, string> { ["automation"] = "ai_qa_review", ["limit"] = "2" };
      if (cursor is not null) query["cursor"] = cursor;
      var resp = await CallAsync("GET", EventsPath, query: query, groups: ["editor"]);
      Assert.True(resp.StatusCode == 200, resp.Body);
      var data = Data(resp);
      Assert.Equal(new[] { "items", "nextCursor" }, data.EnumerateObject().Select(p => p.Name).ToArray());
      var items = data.GetProperty("items").EnumerateArray().ToList();
      Assert.True(items.Count <= 2);
      seen.AddRange(items);
      cursor = data.GetProperty("nextCursor").ValueKind == JsonValueKind.Null ? null : data.GetProperty("nextCursor").GetString();
      if (items.Count < 2) Assert.Null(cursor);
      pages++;
    }
    while (cursor is not null && pages < 10_000);

    Assert.All(seen, e => Assert.Equal("ai_qa_review", e.GetProperty("automation").GetString()));
    var ids = seen.Select(e => e.GetProperty("id").GetInt64()).ToList();
    Assert.Equal(ids.Distinct().Count(), ids.Count);
    Assert.Equal(ids.OrderByDescending(x => x).ToList(), ids);

    var ours = seen.Where(e => e.GetProperty("dedupeKey").GetString() is { } k && mine.Contains(k)).ToList();
    Assert.Equal(Enumerable.Reverse(mine).ToArray(), ours.Select(e => e.GetProperty("dedupeKey").GetString()).ToArray());

    var first = ours[^1];
    Assert.Equal(
      new[] { "id", "automation", "occurredAt", "units", "outcome", "actualMinutes", "defectsCaught", "deckId", "ref", "source", "dedupeKey", "details" },
      first.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(JsonValueKind.Object, first.GetProperty("details").ValueKind);
    Assert.Equal(0, first.GetProperty("details").GetProperty("chunk").GetInt32());
    Assert.Equal(deckId, first.GetProperty("deckId").GetInt64());
    Assert.Equal("run-0", first.GetProperty("ref").GetString());
    Assert.Equal("live", first.GetProperty("source").GetString());
    Assert.Equal(JsonValueKind.Null, first.GetProperty("actualMinutes").ValueKind);
    Assert.Equal(JsonValueKind.Null, ours[0].GetProperty("details").ValueKind);

    // The cursor is base64url of {"v":1,"id":<last id>}.
    var page = Data(await CallAsync("GET", EventsPath, query: new Dictionary<string, string> { ["automation"] = "ai_qa_review", ["limit"] = "1" }));
    var next = page.GetProperty("nextCursor").GetString()!;
    var lastId = page.GetProperty("items")[0].GetProperty("id").GetInt64();
    var decoded = Encoding.UTF8.GetString(RecallSmith.Lambda.Vpc.Pagination.CursorCodec.FromBase64Url(next)!);
    Assert.Equal($"{{\"v\":1,\"id\":{lastId}}}", decoded);

    foreach (var bad in new Dictionary<string, string>[]
    {
      new() { ["cursor"] = "not-a-cursor!" },
      new() { ["cursor"] = RecallSmith.Lambda.Vpc.Pagination.CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes("{\"v\":2,\"id\":5}")) },
      new() { ["automation"] = "nope" },
      new() { ["limit"] = "0" },
      new() { ["limit"] = "101" },
    })
    {
      var resp = await CallAsync("GET", EventsPath, query: bad);
      Assert.True(resp.StatusCode == 400, $"{JsonSerializer.Serialize(bad)} returned {resp.StatusCode}: {resp.Body}");
      Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    }
  }

  // ---------------------------------------------------------------- baselines

  [Fact]
  public async Task Baselines_ListReturnsSix()
  {
    var resp = await CallAsync("GET", BaselinesPath, groups: ["editor"]);
    Assert.True(resp.StatusCode == 200, resp.Body);
    var items = Data(resp).GetProperty("items").EnumerateArray().ToList();
    Assert.Equal(SeededAutomations, items.Select(i => i.GetProperty("automation").GetString()).ToArray());
    Assert.Equal(
      new[] { "automation", "unit", "baselineMinutesPerUnit", "baselineSource", "note", "updatedAt" },
      items[0].EnumerateObject().Select(p => p.Name).ToArray());
    var bulk = items.Single(i => i.GetProperty("automation").GetString() == "bulk_import");
    Assert.Equal("card", bulk.GetProperty("unit").GetString());
    Assert.Equal(1.5m, bulk.GetProperty("baselineMinutesPerUnit").GetDecimal());
    Assert.Equal("default", bulk.GetProperty("baselineSource").GetString());
  }

  [Fact]
  public async Task Baselines_Put_UpdatesAndAudits()
  {
    const string name = "webhook_notification";
    var actor = NewSub();
    var restore = await SnapshotBaselineAsync(name);
    var auditFloor = Convert.ToInt64(await _db.ScalarAsync("select coalesce(max(id), 0) from admin_audit"), CultureInfo.InvariantCulture);
    try
    {
      var resp = await CallAsync("PUT", $"{BaselinesPath}/{name}",
        new { baselineMinutesPerUnit = 1.234, baselineSource = "measured", note = "  timed 2026-09  " }, sub: actor);
      Assert.True(resp.StatusCode == 200, resp.Body);
      var item = Data(resp);
      Assert.Equal(name, item.GetProperty("automation").GetString());
      Assert.Equal(1.23m, item.GetProperty("baselineMinutesPerUnit").GetDecimal());
      Assert.Equal("measured", item.GetProperty("baselineSource").GetString());
      Assert.Equal("timed 2026-09", item.GetProperty("note").GetString());

      var row = (await _db.QueryAsync(
        "select baseline_minutes_per_unit, baseline_source, note, updated_by_sub, updated_at > now() - interval '5 minutes' as fresh from automation_baselines where automation = $1",
        name)).Single();
      Assert.Equal(1.23m, (decimal)row["baseline_minutes_per_unit"]!);
      Assert.Equal(actor, (string)row["updated_by_sub"]!);
      Assert.True((bool)row["fresh"]!);

      var audit = (await _db.QueryAsync(
        "select action, actor_sub, before_state::text as before, after_state::text as after from admin_audit where target = $1 and id > $2 order by id",
        $"automation:{name}", auditFloor)).Single();
      Assert.Equal("automation.baseline.update", (string)audit["action"]!);
      Assert.Equal(actor, (string)audit["actor_sub"]!);
      using (var beforeDoc = JsonDocument.Parse((string)audit["before"]!))
      using (var afterDoc = JsonDocument.Parse((string)audit["after"]!))
      {
        Assert.Equal("default", beforeDoc.RootElement.GetProperty("baselineSource").GetString());
        Assert.Equal(1m, beforeDoc.RootElement.GetProperty("baselineMinutesPerUnit").GetDecimal());
        Assert.Equal(1.23m, afterDoc.RootElement.GetProperty("baselineMinutesPerUnit").GetDecimal());
        Assert.Equal("measured", afterDoc.RootElement.GetProperty("baselineSource").GetString());
        Assert.Equal("timed 2026-09", afterDoc.RootElement.GetProperty("note").GetString());
      }

      // An absent note is unchanged; null or blank clears it.
      var keep = Data(await CallAsync("PUT", $"{BaselinesPath}/{name}", new { baselineMinutesPerUnit = 2, baselineSource = "measured" }));
      Assert.Equal("timed 2026-09", keep.GetProperty("note").GetString());
      var cleared = Data(await CallAsync("PUT", $"{BaselinesPath}/{name}", "{\"baselineMinutesPerUnit\":2,\"baselineSource\":\"default\",\"note\":null}"));
      Assert.Equal(JsonValueKind.Null, cleared.GetProperty("note").ValueKind);
      await CallAsync("PUT", $"{BaselinesPath}/{name}", new { baselineMinutesPerUnit = 2, baselineSource = "default", note = "x" });
      var blank = Data(await CallAsync("PUT", $"{BaselinesPath}/{name}", new { baselineMinutesPerUnit = 2, baselineSource = "default", note = "   " }));
      Assert.Equal(JsonValueKind.Null, blank.GetProperty("note").ValueKind);

      foreach (var bad in new object[]
      {
        new { baselineMinutesPerUnit = -1, baselineSource = "measured" },
        new { baselineMinutesPerUnit = 1000000, baselineSource = "measured" },
        new { baselineMinutesPerUnit = "5", baselineSource = "measured" },
        new { baselineSource = "measured" },
        new { baselineMinutesPerUnit = 5 },
        new { baselineMinutesPerUnit = 5, baselineSource = "guessed" },
        new { baselineMinutesPerUnit = 5, baselineSource = "measured", note = new string('n', 501) },
        new { baselineMinutesPerUnit = 5, baselineSource = "measured", note = 3 },
      })
      {
        var r = await CallAsync("PUT", $"{BaselinesPath}/{name}", bad);
        Assert.True(r.StatusCode == 400, $"{JsonSerializer.Serialize(bad)} returned {r.StatusCode}: {r.Body}");
        Assert.Equal("VALIDATION_ERROR", ErrorCode(r));
      }
      Assert.Equal("BAD_REQUEST", ErrorCode(await CallAsync("PUT", $"{BaselinesPath}/{name}", "{not json")));
    }
    finally
    {
      await restore();
    }
  }

  [Fact]
  public async Task Baselines_Put_Unknown_Is404()
  {
    var resp = await CallAsync("PUT", $"{BaselinesPath}/no_such_automation", new { baselineMinutesPerUnit = 1, baselineSource = "measured" });
    Assert.Equal(404, resp.StatusCode);
    Assert.Equal("AUTOMATION_NOT_FOUND", ErrorCode(resp));
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from automation_baselines where automation = 'no_such_automation'"), CultureInfo.InvariantCulture));
  }

  // ---------------------------------------------------------------- permissions and routing

  [Fact]
  public async Task LedgerRoutes_PermissionMatrix()
  {
    var putBody = new { baselineMinutesPerUnit = 1, baselineSource = "measured" };

    foreach (var path in new[] { LedgerPath, EventsPath, BaselinesPath })
    {
      Assert.Equal(200, (await CallAsync("GET", path, groups: ["editor"])).StatusCode);
      Assert.Equal(200, (await CallAsync("GET", path, groups: ["super_admin"])).StatusCode);
      Assert.Equal(403, (await CallAsync("GET", path, groups: [])).StatusCode);
      Assert.Equal(403, (await CallAsync("GET", path, groups: ["premium"])).StatusCode);
    }

    Assert.Equal(403, (await CallAsync("PUT", $"{BaselinesPath}/publish_gate", putBody, groups: ["editor"])).StatusCode);
    Assert.Equal(403, (await CallAsync("PUT", $"{BaselinesPath}/publish_gate", putBody, groups: [])).StatusCode);
    Assert.Equal(403, (await CallAsync("POST", BackfillPath, new { dryRun = true }, groups: ["editor"])).StatusCode);
    Assert.Equal(403, (await CallAsync("POST", BackfillPath, new { dryRun = true }, groups: [])).StatusCode);

    // Refused requests change nothing.
    var gate = (await _db.QueryAsync("select baseline_source from automation_baselines where automation = 'publish_gate'")).Single();
    Assert.Equal("default", (string)gate["baseline_source"]!);
  }

  [Fact]
  public async Task LedgerRoutes_AreRoutedByVpcFunction()
  {
    Assert.Equal(200, (await CallAsync("GET", LedgerPath)).StatusCode);
    Assert.Equal(200, (await CallAsync("GET", EventsPath)).StatusCode);
    Assert.Equal(200, (await CallAsync("GET", BaselinesPath)).StatusCode);
    Assert.Equal(200, (await CallAsync("POST", BackfillPath, new { dryRun = true })).StatusCode);

    Assert.Equal(405, (await CallAsync("POST", LedgerPath)).StatusCode);
    Assert.Equal(405, (await CallAsync("DELETE", EventsPath)).StatusCode);
    Assert.Equal(405, (await CallAsync("PUT", BaselinesPath)).StatusCode);
    Assert.Equal(405, (await CallAsync("GET", $"{BaselinesPath}/publish_gate")).StatusCode);
    Assert.Equal(405, (await CallAsync("GET", BackfillPath)).StatusCode);

    Assert.Equal("AUTOMATION_NOT_FOUND", ErrorCode(await CallAsync("PUT", $"{BaselinesPath}/nope", new { baselineMinutesPerUnit = 1, baselineSource = "measured" })));

    // A trailing slash is stripped by the dispatcher; the metrics label is the route literal.
    Assert.Equal(200, (await CallAsync("GET", LedgerPath + "/")).StatusCode);
    Assert.Equal(LedgerPath, RouteMetrics.RouteFor(LedgerPath));
    Assert.Equal($"{BaselinesPath}/:automation", RouteMetrics.RouteFor($"{BaselinesPath}/publish_gate"));
  }

  [Fact]
  public async Task LedgerRoutes_MissingTables_Is503()
  {
    const string scratchName = "j08_pre028_routes";
    await ScratchAsync(scratchName, 27);

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", scratchName);
      Pg.Reset();

      var calls = new (string Method, string Path, object? Body)[]
      {
        ("GET", LedgerPath, null),
        ("GET", EventsPath, null),
        ("GET", BaselinesPath, null),
        ("PUT", $"{BaselinesPath}/publish_gate", new { baselineMinutesPerUnit = 1, baselineSource = "measured" }),
        ("POST", BackfillPath, new { dryRun = true }),
        ("POST", BackfillPath, new { dryRun = false }),
      };
      foreach (var (method, path, body) in calls)
      {
        var resp = await CallAsync(method, path, body);
        Assert.True(resp.StatusCode == 503, $"{method} {path} returned {resp.StatusCode}: {resp.Body}");
        Assert.Equal("SERVER_NOT_READY_LEDGER", ErrorCode(resp));
      }
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Pg.Reset();
    }
  }

  // ---------------------------------------------------------------- emission: publish pipeline

  private sealed class NullUploader : IS3DeckUploader
  {
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data) => Task.FromResult(new S3UploadResult());
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) => Task.FromResult(new S3UploadResult());
    public Task<string> DownloadJsonAsync(string s3Key) => Task.FromResult("{}");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  private async Task<(long DeckId, string JobId)> SeedPublishJobAsync(string status)
  {
    var slug = $"it-j08-pub-{Guid.NewGuid():N}";
    var deckRows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id", slug, "deck j08", "tests");
    var deckId = Convert.ToInt64(deckRows[0]["id"], CultureInfo.InvariantCulture);
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,0)",
      deckId, "uid-1", "q1", 1);
    var buildId = $"b-j08-{Guid.NewGuid():N}";
    var jobId = Guid.NewGuid().ToString();
    await _db.ScalarAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,$6)",
      deckId, slug, buildId, $"content/{buildId}/deck.json", jobId, status);
    return (deckId, jobId);
  }

  [Fact]
  public async Task PublishPipeline_Success_RecordsLedgerEvent()
  {
    var (deckId, jobId) = await SeedPublishJobAsync("PENDING");
    var processor = new PublishJobProcessor(new JobRepository(), new NullUploader(), new NoopArtifacts());

    await processor.ProcessAsync(jobId, 1);
    Assert.Equal("SUCCESS", Convert.ToString(await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId), CultureInfo.InvariantCulture));

    var row = (await EventsByKeyAsync($"publish:{jobId}")).Single();
    Assert.Equal("publish_pipeline", (string)row["automation"]!);
    Assert.Equal(1, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));
    Assert.Equal("success", (string)row["outcome"]!);
    Assert.Equal(deckId, Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(jobId, (string)row["ref"]!);
    Assert.Equal("live", (string)row["source"]!);

    // A duplicate delivery of the finished job is acknowledged and records nothing more.
    await processor.ProcessAsync(jobId, 2);
    Assert.Single(await EventsByKeyAsync($"publish:{jobId}"));
  }

  [Fact]
  public async Task PublishPipeline_Failure_RecordsFailureEvent()
  {
    var (deckId, jobId) = await SeedPublishJobAsync("PROCESSING");
    var processor = new PublishJobProcessor(new JobRepository(), new NullUploader(), new NoopArtifacts());

    var message = "Deck has no cards " + new string('x', 400);
    await processor.FailAsync(jobId, message);
    await processor.FailAsync(jobId, message);

    Assert.Equal("FAILED", Convert.ToString(await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId), CultureInfo.InvariantCulture));

    var row = (await EventsByKeyAsync($"publish-fail:{jobId}")).Single();
    Assert.Equal("publish_pipeline", (string)row["automation"]!);
    Assert.Equal(0, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));
    Assert.Equal("failure", (string)row["outcome"]!);
    Assert.Equal(deckId, Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(jobId, (string)row["ref"]!);
    using var details = JsonDocument.Parse((string)row["details"]!);
    Assert.Equal(message[..300], details.RootElement.GetProperty("error").GetString());

    // A job the repository does not know still records a failure, with no deck.
    var ghost = Guid.NewGuid().ToString();
    await processor.FailAsync(ghost, "gone");
    var ghostRow = (await EventsByKeyAsync($"publish-fail:{ghost}")).Single();
    Assert.Null(ghostRow["deck_id"]);
  }

  // ---------------------------------------------------------------- emission: bulk import

  private static async Task<APIGatewayProxyResponse> ImportAsync(long deckId, object[] cards)
  {
    var body = JsonSerializer.Serialize(new { deckId, cards });
    var req = new LambdaRequest(Event("POST", "/api/v1/authoring/cards/import", NewSub(), ["super_admin"], null, body));
    return await CardsImport.HandleCardsImport(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
  }

  private static object ImportCard(string uid, int order, string question = "q") =>
    new { stableUid = uid, question, explanation = "a", orderInDeck = order, difficulty = 2 };

  [Fact]
  public async Task BulkImport_SuccessAndFailure_RecordLedgerEvents()
  {
    var deckId = await NewDeckAsync("import");

    var ok = await ImportAsync(deckId, [ImportCard("a", 1), ImportCard("b", 2), ImportCard("c", 3)]);
    Assert.True(ok.StatusCode == 200, ok.Body);

    var update = await ImportAsync(deckId, [ImportCard("a", 1, "q2"), ImportCard("b", 2), ImportCard("c", 3), ImportCard("d", 4)]);
    Assert.True(update.StatusCode == 200, update.Body);

    var bad = await ImportAsync(deckId, [ImportCard("x", 1), ImportCard("x", 2)]);
    Assert.Equal(400, bad.StatusCode);

    var rows = await _db.QueryAsync(
      "select units, outcome, deck_id, dedupe_key, details::text as details from automation_events where automation = 'bulk_import' and deck_id = $1 and source = 'live' order by id",
      deckId);
    Assert.Equal(3, rows.Count);
    Assert.All(rows, r => Assert.Null(r["dedupe_key"]));

    Assert.Equal(3, Convert.ToInt32(rows[0]["units"], CultureInfo.InvariantCulture));
    Assert.Equal("success", (string)rows[0]["outcome"]!);
    using (var d0 = JsonDocument.Parse((string)rows[0]["details"]!))
    {
      Assert.Equal(3, d0.RootElement.GetProperty("received").GetInt32());
      Assert.Equal(3, d0.RootElement.GetProperty("created").GetInt32());
      Assert.Equal(0, d0.RootElement.GetProperty("updated").GetInt32());
    }

    // 1 created + 1 updated; the two unchanged cards are not units.
    Assert.Equal(2, Convert.ToInt32(rows[1]["units"], CultureInfo.InvariantCulture));
    using (var d1 = JsonDocument.Parse((string)rows[1]["details"]!))
    {
      Assert.Equal(4, d1.RootElement.GetProperty("received").GetInt32());
      Assert.Equal(1, d1.RootElement.GetProperty("created").GetInt32());
      Assert.Equal(1, d1.RootElement.GetProperty("updated").GetInt32());
    }

    Assert.Equal(0, Convert.ToInt32(rows[2]["units"], CultureInfo.InvariantCulture));
    Assert.Equal("failure", (string)rows[2]["outcome"]!);
    using (var d2 = JsonDocument.Parse((string)rows[2]["details"]!))
    {
      Assert.Equal("VALIDATION_ERROR", d2.RootElement.GetProperty("errorCode").GetString());
    }

    // A super_admin import into a deck id with no row: the failure is recorded without a deck.
    var before = Convert.ToInt64(await _db.ScalarAsync(
      "select count(*) from automation_events where automation = 'bulk_import' and outcome = 'failure' and deck_id is null"), CultureInfo.InvariantCulture);
    var ghost = await ImportAsync(987_654_321_077, [ImportCard("x", 1), ImportCard("x", 2)]);
    Assert.Equal(400, ghost.StatusCode);
    var after = Convert.ToInt64(await _db.ScalarAsync(
      "select count(*) from automation_events where automation = 'bulk_import' and outcome = 'failure' and deck_id is null"), CultureInfo.InvariantCulture);
    Assert.Equal(before + 1, after);
  }

  // ---------------------------------------------------------------- emission: publish gate

  private const string BadVersionMcq =
    """{"v":2,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private static async Task<APIGatewayProxyResponse> PublishAsync(long deckId)
  {
    var req = new LambdaRequest(Event("POST", "/api/v1/authoring/publish", NewSub(), ["super_admin"], null, JsonSerializer.Serialize(new { deckId })));
    return await Publish.HandleAuthoringPublish(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
  }

  [Fact]
  public async Task PublishGate_Refusal_RecordsOneDefectPerCardVersion()
  {
    var deckId = await NewDeckAsync("gate");
    await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, mcq) values ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      deckId, "gate-1", "Which service buffers a burst", "queue it", 2, 1, BadVersionMcq);

    var sent = new List<SendMessageRequest>();
    Publish.TestEnqueueSeam = new("https://sqs.test/000000000000/j08", "it-j08-bucket", r => { sent.Add(r); return Task.CompletedTask; });
    try
    {
      string? firstError = null;
      for (var i = 0; i < 2; i++)
      {
        var resp = await PublishAsync(deckId);
        Assert.Equal(400, resp.StatusCode);
        using var doc = JsonDocument.Parse(resp.Body!);
        var error = doc.RootElement.GetProperty("error");
        Assert.Equal("MCQ_PUBLISH_GATE", error.GetProperty("code").GetString());
        Assert.Equal("gate-1: MCQ_BAD_VERSION", error.GetProperty("message").GetString());
        firstError ??= error.GetRawText();
        Assert.Equal(firstError, error.GetRawText());
      }

      var rows = await _db.QueryAsync(
        "select units, outcome, defects_caught, ref, dedupe_key, details::text as details from automation_events where automation = 'publish_gate' and deck_id = $1 order by id",
        deckId);
      var only = Assert.Single(rows);
      Assert.Equal(0, Convert.ToInt32(only["units"], CultureInfo.InvariantCulture));
      Assert.Equal("success", (string)only["outcome"]!);
      Assert.Equal(1, Convert.ToInt32(only["defects_caught"], CultureInfo.InvariantCulture));
      Assert.Equal("gate-1", (string)only["ref"]!);
      using (var details = JsonDocument.Parse((string)only["details"]!))
      {
        Assert.Equal("MCQ_BAD_VERSION", details.RootElement.GetProperty("code").GetString());
      }

      // The key's fingerprint: first 16 hex chars of SHA-256 over question, explanation, difficulty, mcq text.
      var mcqText = Convert.ToString(await _db.ScalarAsync("select mcq::text from cards where deck_id = $1 and stable_uid = 'gate-1'", deckId), CultureInfo.InvariantCulture);
      var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"Which service buffers a burst\nqueue it\n2\n{mcqText}"))).ToLowerInvariant()[..16];
      Assert.Equal($"publish-gate:{deckId}:gate-1:{fingerprint}", (string)only["dedupe_key"]!);

      // An edit makes it a new defect.
      await _db.ScalarAsync("update cards set explanation = 'queue it, then drain' where deck_id = $1 and stable_uid = 'gate-1'", deckId);
      Assert.Equal(400, (await PublishAsync(deckId)).StatusCode);
      Assert.Equal(2L, Convert.ToInt64(await _db.ScalarAsync(
        "select count(*) from automation_events where automation = 'publish_gate' and deck_id = $1", deckId), CultureInfo.InvariantCulture));
    }
    finally
    {
      Publish.TestEnqueueSeam = null;
    }

    Assert.Empty(sent);
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from deck_publishes where deck_id = $1", deckId), CultureInfo.InvariantCulture));
  }

  // ---------------------------------------------------------------- emission: webhook notification

  private static string Sign(string secret, long timestampMs, string body)
  {
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var hash = mac.ComputeHash(Encoding.UTF8.GetBytes($"{timestampMs.ToString(CultureInfo.InvariantCulture)}.{body}"));
    return "v1=" + Convert.ToHexString(hash).ToLowerInvariant();
  }

  private static async Task<APIGatewayProxyResponse> ReportAsync(Guid deliveryId, int attempt, string outcome)
  {
    var body = JsonSerializer.Serialize(new { attempt, deliveryId, durationMs = 50, error = (string?)null, outcome, statusCode = outcome == "delivered" ? 200 : 503 });
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/internal/webhooks/deliveries/report",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
      headers = new Dictionary<string, string>
      {
        ["content-type"] = "application/json",
        ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
        ["x-internal-signature"] = Sign("test-secret", ts, body),
      },
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });

    var saved = Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET");
    try
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", "test-secret");
      var req = new LambdaRequest(evt);
      return await WebhookDeliveryReport.HandleReport(req, new Res(req.TraceId));
    }
    finally
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", saved);
    }
  }

  private async Task<(Guid DeliveryId, string Key)> SeedDeliveryAsync(string eventType)
  {
    var rows = await _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, true) returning id",
      "it-j08-report", $"https://hooks.example.com/j08/{Guid.NewGuid():N}", new[] { "deck.published" });
    var subscriptionId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
    var eventId = Guid.NewGuid();
    var deliveryId = await SeedRedeliveryAsync(eventId, subscriptionId, eventType);
    return (deliveryId, $"webhook:{eventId:D}:{subscriptionId.ToString(CultureInfo.InvariantCulture)}");
  }

  /// <summary>A delivery row for an existing event and subscription, as RedeliverAsync inserts one.</summary>
  private async Task<Guid> SeedRedeliveryAsync(Guid eventId, long subscriptionId, string eventType)
  {
    var deliveryId = Guid.NewGuid();
    await _db.ScalarAsync(
      "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, body) values ($1, $2, $3, $4, 'queued', $5)",
      deliveryId, eventId, eventType, subscriptionId, "{\"event\":\"x\"}");
    return deliveryId;
  }

  [Fact]
  public async Task WebhookDelivered_RecordsNotificationOnce()
  {
    var (deliveryId, key) = await SeedDeliveryAsync("deck.published");

    var retry = await ReportAsync(deliveryId, 1, "retry");
    Assert.Equal(200, retry.StatusCode);
    Assert.Empty(await EventsByKeyAsync(key));

    var first = await ReportAsync(deliveryId, 2, "delivered");
    Assert.True(first.StatusCode == 200, first.Body);
    var second = await ReportAsync(deliveryId, 3, "delivered");
    Assert.Equal(200, second.StatusCode);
    // The response shape is J03's, unchanged.
    Assert.Equal(new[] { "deliveryId", "status", "stop" }, Data(second).EnumerateObject().Select(p => p.Name).ToArray());

    var row = (await EventsByKeyAsync(key)).Single();
    Assert.Equal("webhook_notification", (string)row["automation"]!);
    Assert.Equal(1, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));
    Assert.Equal("success", (string)row["outcome"]!);
    Assert.Equal(deliveryId.ToString("D"), (string)row["ref"]!);

    var (testDelivery, testKey) = await SeedDeliveryAsync("webhook.test");
    var test = await ReportAsync(testDelivery, 1, "delivered");
    Assert.Equal(200, test.StatusCode);
    Assert.Empty(await EventsByKeyAsync(testKey));
  }

  [Fact]
  public async Task WebhookRedelivered_CountsOneNotificationPerEventAndSubscription()
  {
    // automation-10: a manual redelivery of an already delivered event is a new delivery_id with the same
    // event_id and subscription. It must not add another saved unit.
    var (deliveryId, key) = await SeedDeliveryAsync("deck.published");
    var source = (await _db.QueryAsync("select event_id, subscription_id from webhook_deliveries where delivery_id = $1", deliveryId)).Single();
    var eventId = (Guid)source["event_id"]!;
    var subscriptionId = Convert.ToInt64(source["subscription_id"], CultureInfo.InvariantCulture);

    Assert.Equal(200, (await ReportAsync(deliveryId, 1, "delivered")).StatusCode);
    var redelivery = await SeedRedeliveryAsync(eventId, subscriptionId, "deck.published");
    Assert.Equal(200, (await ReportAsync(redelivery, 1, "delivered")).StatusCode);

    var rows = await EventsByKeyAsync(key);
    Assert.Single(rows);
    var total = await _db.ScalarAsync(
      "select count(*) from automation_events where automation = 'webhook_notification' and ref in ($1, $2)",
      deliveryId.ToString("D"), redelivery.ToString("D"));
    Assert.Equal(1L, Convert.ToInt64(total, CultureInfo.InvariantCulture));
  }
}
