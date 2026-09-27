using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The eval gate for auto-decision precision (R18A A06, contract A00 §15.3–§15.4): the only record that lets
/// <c>AUTOMATION_MODE=live</c> take effect (<see cref="AutomationMode.EffectiveAsync"/> reads the newest row and
/// counts it only when it is passed and unrevoked, R18B K2). The supervisor posts the <c>dc-evals automation-gate</c> report; core re-computes every metric from
/// the report's counts and records every well-formed report, a failing one with <c>passed = false</c> (R18C L3), so a
/// newer failed evaluation blocks <c>live</c> exactly like a revoke. A revoke of the newest gate makes <c>live</c> fall
/// back to <c>dry_run</c> on the next request; an older passed gate never takes over, and the exact report of a revoked
/// gate cannot be posted again. A report generated before the newest recorded one is refused (409
/// <c>EVAL_GATE_STALE</c>, R18D M4), and the gate stores the author configuration it measured (R18D M1), which a live
/// auto-accept requires the draft's author to match. Nothing here reads or writes <c>AUTOMATION_MODE</c>.
/// </summary>
public static class EvalGate
{
  /// <summary>
  /// The reviewer transports a gate may measure (R18C L1): the bedrock-mantle Chat Completions adapter, and Converse
  /// as the fallback. The gate row pins the provider actually used; live accepts only reports of that provider.
  /// </summary>
  public static readonly IReadOnlyList<string> AutomationGateProviders = ["openai-mantle", "bedrock-converse"];

  /// <summary>
  /// The reviewer models a gate may measure (owner decision 4: GPT-5.5, never a same-vendor model): the model id of
  /// the bedrock-mantle endpoint and the global inference profile Converse uses (R18C backend-design-15).
  /// </summary>
  public static readonly IReadOnlyList<string> AutomationGateModels = ["openai.gpt-5.5", "global.openai.gpt-5.5"];
  public const int MinGateReps = 2;
  public const double SeededRecallGate = 0.90;
  public const double SeededRecallCiLowerGate = 0.85;
  public const double SeededPerClassRecallFloor = 0.75;
  public const double SeededControlFprGate = 0.20;
  public const double SeededControlUnscoredRateGate = 0.02;
  public const double AutoAcceptPrecisionGate = 0.97;
  public const double AutoAcceptPrecisionCiLowerGate = 0.93;
  public const int MinWouldAcceptCards = 120;
  public const double DefectEscapeRateGate = 0.20;
  public const double AuthoredUnscoredRateGate = 0.05;

  public const string ReportKind = "automation-gate";

  /// <summary>"AUTO_GAT": serialises the recording of gates (the freshness check and the insert).</summary>
  private const long RecordLockKey = 0x4155544F5F474154;

  /// <summary>The key of the new-facts stratum in <c>authored.strata</c> (the production runner's drafts, R18C C06).</summary>
  public const string NewFactsStratum = "new-facts";

  /// <summary>The newest gate row, whatever its state (R18B K2): only this row can make <c>live</c> effective.</summary>
  internal const string NewestGateSql = "select * from automation_eval_gates order by id desc limit 1";
  public const int HistoryLimit = 20;

  /// <summary>The check names <see cref="Check"/> returns, in evaluation order (the console and A15 show them).</summary>
  public static readonly IReadOnlyList<string> CheckNames =
  [
    "passed", "failures", "reviewer.provider", "reviewer.model", "reviewer.promptVersion", "reviewer.secondProvider", "reviewer.secondModel",
    "seeded.reps", "authored.reps", "seeded.recall", "seeded.recallCiLower", "seeded.perClassRecall", "seeded.controlFalsePositiveRate",
    "seeded.controlUnscoredRate", "authored.autoAcceptPrecision", "authored.autoAcceptPrecisionCiLower", "authored.wouldAcceptCards",
    "authored.defectEscapeRate", "authored.unscoredRate",
  ];

  /// <summary>
  /// The columns of the <c>EvalGate</c> shape over <c>g</c> = an automation_eval_gates row. <c>author_config_id</c> is the
  /// author the gate measured (R18E N1), with the same fallback the mode resolver uses (<see cref="AutomationMode.GateAuthorSql"/>),
  /// so the gate card shows exactly the author a live auto-accept compares with.
  /// </summary>
  private static string GateColumns(bool authorColumn) => $"""
    g.id, g.reviewer_provider, g.reviewer_model, g.prompt_version, g.passed, g.metrics::text as metrics, g.report_sha256, g.created_by_sub,
    g.created_at, g.revoked_at, g.revoked_by_sub, {AutomationMode.GateAuthorSql(authorColumn)} as author_config_id
    """;

  // ---------------------------------------------------------------------------------------------
  // GET | POST /api/v1/admin/automation/eval-gate
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleGate(LambdaRequest req, Res res, AuthContext auth)
  {
    var isPost = req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase);
    var deny = isPost ? Auth.RequireSuperAdmin(auth, res) : Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (isPost) return await PostAsync(req, res, auth);
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var current = await LoadCurrentAsync(conn);
      var authorColumn = await AuthorColumnAsync(conn, null);
      var history = (await DbUtil.QueryAsync(conn, null,
        $"select {GateColumns(authorColumn)} from automation_eval_gates g order by g.id desc limit {HistoryLimit}", []))
        .Select(ToGate).ToList();
      return res.Ok(new { current, history });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static async Task<APIGatewayProxyResponse> PostAsync(LambdaRequest req, Res res, AuthContext auth)
  {
    try
    {
      if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");
      var raw = Validation.GetRawBody(req);
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      GateReport report;
      try
      {
        report = GateReport.Read(doc.RootElement);
      }
      catch (InvalidReport ex)
      {
        return res.BadRequest("EVAL_GATE_INVALID", ex.Message);
      }

      var failures = Evaluate(report);
      var passed = failures.Count == 0;
      var sha = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
      var metrics = JsonSerializer.Serialize(new
      {
        seededRecall = report.SeededRecall,
        seededRecallCiLower = report.SeededRecallCiLower,
        autoAcceptPrecision = report.AutoAcceptPrecision,
        autoAcceptPrecisionCiLower = report.AutoAcceptPrecisionCiLower,
        wouldAcceptCards = report.WouldAcceptCards,
        defectEscapeRate = report.DefectEscapeRate,
        controlFalsePositiveRate = report.ControlFalsePositiveRate,
        seededReps = report.SeededReps,
        authoredReps = report.AuthoredReps,
      });

      DateTimeOffset generatedAt;
      try
      {
        generatedAt = ReportTimestamp(doc.RootElement)
          ?? throw new InvalidReport("generatedAt (or createdAt) must be an ISO-8601 timestamp with an offset");
      }
      catch (InvalidReport ex)
      {
        return res.BadRequest("EVAL_GATE_INVALID", ex.Message);
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      await using var tx = await conn.BeginTransactionAsync();
      // One recording at a time, so the freshness check below and the insert see the same newest row.
      await DbUtil.ExecuteAsync(conn, tx, "select pg_advisory_xact_lock($1)", [RecordLockKey]);

      // A revoke is final (R18C L3): the same report bytes never reinstate a revoked gate.
      var revoked = await DbUtil.ExecuteScalarAsync(conn, tx,
        "select 1 from automation_eval_gates where report_sha256 = $1 and revoked_at is not null limit 1", [sha]);
      if (revoked is not null)
      {
        await tx.RollbackAsync();
        return Helpers.ErrorEnvelope(res, 409, "EVAL_GATE_REVOKED", "This report belongs to a revoked eval gate; run the evaluation again");
      }

      // A report older than the newest recorded one never governs live (R18D M4, automation-26): re-posting an earlier
      // passing report after a newer failed evaluation would otherwise make live effective again.
      var newest = await DbUtil.QueryAsync(conn, tx,
        $"select report ->> 'generatedAt' as generated_at, report ->> 'createdAt' as created_at from ({NewestGateSql}) g", []);
      if (newest.Count > 0 && ParseTimestamp(newest[0]["generated_at"] as string ?? newest[0]["created_at"] as string) is { } newestAt
          && generatedAt < newestAt)
      {
        await tx.RollbackAsync();
        return Helpers.ErrorEnvelope(res, 409, "EVAL_GATE_STALE",
          $"This report was generated at {Iso(generatedAt)}, before the newest recorded eval gate ({Iso(newestAt)}); run the evaluation again");
      }

      // Every well-formed report is recorded (R18C L3): a failing one becomes the newest row with passed = false,
      // which blocks live (R18B K2) until a newer passing report is recorded. The gated author (R18D M1) goes into
      // author_config_id once migration 036 added it; before, it stays readable in the stored report.
      var authorColumn = await AuthorColumnAsync(conn, tx);
      var rows = await DbUtil.QueryAsync(conn, tx,
        authorColumn
          ? $"""
            insert into automation_eval_gates as g (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report,
              created_by_sub, author_config_id)
            values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9::text)
            returning {GateColumns(authorColumn)}
            """
          : $"""
            insert into automation_eval_gates as g (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report,
              created_by_sub)
            values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
            returning {GateColumns(authorColumn)}
            """,
        authorColumn
          ? [report.Provider, report.Model, report.PromptVersion, passed, metrics, sha, raw, auth.UserSub, report.AuthorConfigId]
          : [report.Provider, report.Model, report.PromptVersion, passed, metrics, sha, raw, auth.UserSub]);
      await tx.CommitAsync();
      if (!passed)
      {
        Log.Event("info", new { tag = "automation", reason = "eval_gate_failed_recorded", gateId = RunnerRoutes.Long(rows[0]["id"]), failures });
        var message = $"The eval gate report fails: {string.Join(", ", failures)}";
        return res.Raw(400, new
        {
          success = false,
          data = (object?)null,
          error = new { code = "EVAL_GATE_FAILED", message, failures },
          traceId = res.TraceId,
          version = "v1",
        });
      }
      Log.Event("info", new { tag = "automation", reason = "eval_gate_recorded", gateId = RunnerRoutes.Long(rows[0]["id"]) });
      return res.Ok(ToGate(rows[0]));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/admin/automation/eval-gate/:gateId/revoke
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleRevoke(LambdaRequest req, Res res, AuthContext auth, string gateId)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    if (!long.TryParse(gateId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) return GateNotFound(res);
    if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var authorColumn = await AuthorColumnAsync(conn, null);
      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        update automation_eval_gates g set revoked_at = now(), revoked_by_sub = $2
        where g.id = $1 and g.revoked_at is null
        returning {GateColumns(authorColumn)}
        """, [id, auth.UserSub]);
      if (rows.Count == 0)
      {
        var exists = await DbUtil.ExecuteScalarAsync(conn, null, "select id from automation_eval_gates where id = $1", [id]);
        return exists is null
          ? GateNotFound(res)
          : Helpers.ErrorEnvelope(res, 409, "EVAL_GATE_REVOKED", "The eval gate is already revoked");
      }
      Log.Event("info", new { tag = "automation", reason = "eval_gate_revoked", gateId = id });
      return res.Ok(ToGate(rows[0]));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // checks (A00 §15.3–§15.4)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Pure: the names of the failed checks (<see cref="CheckNames"/> order), empty when the report passes. Every rate is
  /// re-computed from the report's counts. Throws <see cref="InvalidReport"/> when the report is malformed.
  /// </summary>
  internal static IReadOnlyList<string> Check(JsonElement report) => Evaluate(GateReport.Read(report));

  private static List<string> Evaluate(GateReport r)
  {
    var failed = new List<string>();
    void Fail(bool condition, string name)
    {
      if (condition) failed.Add(name);
    }

    Fail(!r.Passed, "passed");
    Fail(!r.FailuresEmpty, "failures");
    Fail(!AutomationGateProviders.Contains(r.Provider, StringComparer.Ordinal), "reviewer.provider");
    Fail(!AutomationGateModels.Contains(r.Model, StringComparer.Ordinal), "reviewer.model");
    Fail(r.PromptVersion != QaRuns.AutomationPromptVersion, "reviewer.promptVersion");
    Fail(r.SecondProvider is not null, "reviewer.secondProvider");
    Fail(r.SecondModel is not null, "reviewer.secondModel");
    Fail(r.SeededReps < MinGateReps, "seeded.reps");
    Fail(r.AuthoredReps < MinGateReps, "authored.reps");
    Fail(r.SeededRecall is not { } recall || recall < SeededRecallGate, "seeded.recall");
    Fail(r.SeededRecallCiLower < SeededRecallCiLowerGate, "seeded.recallCiLower");
    Fail(r.PerClassRecall.Count == 0 || r.PerClassRecall.Any(v => v < SeededPerClassRecallFloor), "seeded.perClassRecall");
    Fail(r.ControlFalsePositiveRate > SeededControlFprGate, "seeded.controlFalsePositiveRate");
    Fail(r.ControlUnscoredRate > SeededControlUnscoredRateGate, "seeded.controlUnscoredRate");
    Fail(r.AutoAcceptPrecision is not { } precision || precision < AutoAcceptPrecisionGate, "authored.autoAcceptPrecision");
    Fail(r.AutoAcceptPrecisionCiLower < AutoAcceptPrecisionCiLowerGate, "authored.autoAcceptPrecisionCiLower");
    Fail(r.WouldAcceptCards < MinWouldAcceptCards, "authored.wouldAcceptCards");
    Fail(r.DefectEscapeRate is not { } escape || escape > DefectEscapeRateGate, "authored.defectEscapeRate");
    Fail(r.AuthoredUnscoredRate > AuthoredUnscoredRateGate, "authored.unscoredRate");
    return failed;
  }

  /// <summary>A malformed gate report (400 <c>EVAL_GATE_INVALID</c>).</summary>
  internal sealed class InvalidReport(string message) : Exception(message);

  /// <summary>The fields of the §15.4 report the checks read, with the re-computed rates (null when the denominator is 0).</summary>
  private sealed record GateReport(
    bool Passed, bool FailuresEmpty, string Provider, string Model, string PromptVersion, string? SecondProvider, string? SecondModel,
    long SeededReps, long AuthoredReps, double? SeededRecall, double SeededRecallCiLower, IReadOnlyList<double> PerClassRecall,
    double ControlFalsePositiveRate, double ControlUnscoredRate, double? AutoAcceptPrecision, double AutoAcceptPrecisionCiLower,
    long WouldAcceptCards, double? DefectEscapeRate, double AuthoredUnscoredRate, string? AuthorConfigId, string? EffectiveEffort)
  {
    public static GateReport Read(JsonElement root)
    {
      if (root.ValueKind != JsonValueKind.Object) throw new InvalidReport("The report must be a JSON object");
      if (!root.TryGetProperty("v", out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetInt32(out var version) || version != 1)
      {
        throw new InvalidReport("v must be 1");
      }
      if (!root.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String || kind.GetString() != ReportKind)
      {
        throw new InvalidReport($"kind must be {ReportKind}");
      }
      var passed = root.TryGetProperty("passed", out var p) && p.ValueKind == JsonValueKind.True;
      var failuresEmpty = root.TryGetProperty("failures", out var f) && f.ValueKind == JsonValueKind.Array && f.GetArrayLength() == 0;

      var reviewer = Section(root, "reviewer");
      var seeded = Section(root, "seeded");
      var authored = Section(root, "authored");

      var tp = Count(seeded, "seeded", "tp");
      var fn = Count(seeded, "seeded", "fn");
      var perClass = Section(seeded, "seeded", "perClassRecall").EnumerateObject()
        .Select(c => Number(c.Value, $"seeded.perClassRecall.{c.Name}")).ToList();

      var wouldAccept = Count(authored, "authored", "wouldAccept");
      var wouldAcceptCorrect = Count(authored, "authored", "wouldAcceptCorrect");
      if (wouldAcceptCorrect > wouldAccept) throw new InvalidReport("authored.wouldAcceptCorrect exceeds authored.wouldAccept");
      var defectiveLabeled = Count(authored, "authored", "defectiveLabeled");
      var defectEscaped = Count(authored, "authored", "defectEscaped");
      if (defectEscaped > defectiveLabeled) throw new InvalidReport("authored.defectEscaped exceeds authored.defectiveLabeled");
      var authorConfigId = AuthorConfigIdOf(authored);
      var provider = Text(reviewer, "reviewer", "provider");
      var effectiveEffort = EffectiveEffortOf(reviewer, provider);

      return new GateReport(
        passed,
        failuresEmpty,
        provider,
        Text(reviewer, "reviewer", "model"),
        Text(reviewer, "reviewer", "promptVersion"),
        NullableText(reviewer, "reviewer", "secondProvider"),
        NullableText(reviewer, "reviewer", "secondModel"),
        Count(seeded, "seeded", "reps"),
        Count(authored, "authored", "reps"),
        tp + fn == 0 ? null : (double)tp / (tp + fn),
        CiLower(seeded, "seeded", "recallCi95"),
        perClass,
        Number(seeded, "seeded", "controlFalsePositiveRate"),
        Number(seeded, "seeded", "controlUnscoredRate"),
        wouldAccept == 0 ? null : (double)wouldAcceptCorrect / wouldAccept,
        CiLower(authored, "authored", "autoAcceptPrecisionCi95"),
        Count(authored, "authored", "wouldAcceptCards"),
        defectiveLabeled == 0 ? null : (double)defectEscaped / defectiveLabeled,
        Number(authored, "authored", "unscoredRate"),
        authorConfigId,
        effectiveEffort);
    }

    /// <summary>
    /// <c>reviewer.effectiveEffort</c> (R18E N2, R18G backend-design-26): the reasoning effort the gate's review really
    /// sent, a string of 1..<see cref="Internal.AiQaResults.MaxLabelLength"/> characters (the most a QA report's
    /// <c>effectiveEffort</c> can carry, so a longer one could never match). Required when the reviewer is an automation
    /// provider: a gate without it would bind no effort, and AI_EFFORT, shared with the human reviewer, could then change
    /// the gated reviewer unnoticed. For another provider it is optional (the gate fails on <c>reviewer.provider</c>).
    /// </summary>
    private static string? EffectiveEffortOf(JsonElement reviewer, string provider)
    {
      var max = Internal.AiQaResults.MaxLabelLength;
      var message = $"reviewer.effectiveEffort must be a string of 1..{max} characters";
      string? effort = null;
      if (reviewer.TryGetProperty("effectiveEffort", out var el) && el.ValueKind != JsonValueKind.Null)
      {
        if (el.ValueKind != JsonValueKind.String || el.GetString() is not { Length: >= 1 } value || value.Length > max)
        {
          throw new InvalidReport(message);
        }
        effort = value;
      }
      if (effort is null && AutomationGateProviders.Contains(provider, StringComparer.Ordinal))
      {
        throw new InvalidReport($"{message}: the reviewer is the automation provider {provider}");
      }
      return effort;
    }

    /// <summary>
    /// <c>authored.author.authorConfigId</c> (R18D M1): optional, 1..128 characters when present, and required when the
    /// report measured a new-facts stratum (<c>authored.strata["new-facts"].rows</c> &gt; 0), because live accepts only
    /// drafts of the author a gate measured.
    /// </summary>
    private static string? AuthorConfigIdOf(JsonElement authored)
    {
      string? id = null;
      if (authored.TryGetProperty("author", out var author) && author.ValueKind == JsonValueKind.Object &&
          author.TryGetProperty("authorConfigId", out var el) && el.ValueKind != JsonValueKind.Null)
      {
        if (el.ValueKind != JsonValueKind.String || el.GetString() is not { Length: >= 1 and <= Drafts.MaxAuthorConfigIdLength } value)
        {
          throw new InvalidReport($"authored.author.authorConfigId must be a string of 1..{Drafts.MaxAuthorConfigIdLength} characters");
        }
        id = value;
      }
      var newFacts = authored.TryGetProperty("strata", out var strata) && strata.ValueKind == JsonValueKind.Object &&
        strata.TryGetProperty(NewFactsStratum, out var stratum) && stratum.ValueKind == JsonValueKind.Object &&
        stratum.TryGetProperty("rows", out var rows) && rows.ValueKind == JsonValueKind.Number && rows.TryGetInt64(out var n) && n > 0;
      if (newFacts && id is null)
      {
        throw new InvalidReport(
          $"authored.author.authorConfigId must be a string of 1..{Drafts.MaxAuthorConfigIdLength} characters: the report measured a new-facts stratum");
      }
      return id;
    }

    private static JsonElement Section(JsonElement root, string name) => Section(root, null, name);

    private static JsonElement Section(JsonElement parent, string? prefix, string name)
    {
      var path = prefix is null ? name : $"{prefix}.{name}";
      if (!parent.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.Object) throw new InvalidReport($"{path} must be an object");
      return el;
    }

    private static string Text(JsonElement section, string prefix, string name)
    {
      if (!section.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.String) throw new InvalidReport($"{prefix}.{name} must be a string");
      return el.GetString()!;
    }

    private static string? NullableText(JsonElement section, string prefix, string name)
    {
      if (!section.TryGetProperty(name, out var el) || el.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
      {
        throw new InvalidReport($"{prefix}.{name} must be a string or null");
      }
      return el.ValueKind == JsonValueKind.Null ? null : el.GetString();
    }

    private static long Count(JsonElement section, string prefix, string name)
    {
      if (!section.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.Number || !el.TryGetInt64(out var n) || n < 0)
      {
        throw new InvalidReport($"{prefix}.{name} must be a non-negative integer");
      }
      return n;
    }

    private static double Number(JsonElement section, string prefix, string name)
    {
      if (!section.TryGetProperty(name, out var el)) throw new InvalidReport($"{prefix}.{name} must be a number");
      return Number(el, $"{prefix}.{name}");
    }

    private static double Number(JsonElement el, string path)
    {
      if (el.ValueKind != JsonValueKind.Number || !el.TryGetDouble(out var d) || !double.IsFinite(d)) throw new InvalidReport($"{path} must be a number");
      return d;
    }

    private static double CiLower(JsonElement section, string prefix, string name)
    {
      if (!section.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.Array || el.GetArrayLength() != 2)
      {
        throw new InvalidReport($"{prefix}.{name} must be an array of two numbers");
      }
      var lower = Number(el[0], $"{prefix}.{name}[0]");
      Number(el[1], $"{prefix}.{name}[1]");
      return lower;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// The current gate as the <c>EvalGate</c> shape, or null: the newest row when it is passed and unrevoked (R18B K2,
  /// the same rule as <see cref="AutomationMode.EffectiveAsync"/>).
  /// </summary>
  internal static async Task<object?> LoadCurrentAsync(NpgsqlConnection conn)
  {
    var authorColumn = await AuthorColumnAsync(conn, null);
    var rows = await DbUtil.QueryAsync(conn, null,
      $"select {GateColumns(authorColumn)} from ({NewestGateSql}) g where g.passed and g.revoked_at is null", []);
    return rows.Count == 0 ? null : ToGate(rows[0]);
  }

  /// <summary>
  /// The report's generation time (R18D M4): <c>generatedAt</c>, else <c>createdAt</c> (what <c>dc-evals automation-gate</c>
  /// writes). Null when neither is an ISO-8601 timestamp with an offset.
  /// </summary>
  internal static DateTimeOffset? ReportTimestamp(JsonElement root)
  {
    if (root.ValueKind != JsonValueKind.Object) return null;
    foreach (var name in new[] { "generatedAt", "createdAt" })
    {
      if (root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String) return ParseTimestamp(el.GetString());
    }
    return null;
  }

  private static DateTimeOffset? ParseTimestamp(string? text)
  {
    if (string.IsNullOrWhiteSpace(text)) return null;
    // An offset is required: a local time would compare differently on every machine.
    if (!text.EndsWith('Z') && !System.Text.RegularExpressions.Regex.IsMatch(text, @"[+-]\d{2}:?\d{2}$")) return null;
    return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var at) ? at : null;
  }

  private static string Iso(DateTimeOffset at) => at.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFF'Z'", CultureInfo.InvariantCulture);

  /// <summary>Whether migration 036's <c>author_config_id</c> column exists (the code runs before and after it, R18D M1).</summary>
  private static async Task<bool> AuthorColumnAsync(NpgsqlConnection conn, NpgsqlTransaction? tx) =>
    await DbUtil.ExecuteScalarAsync(conn, tx,
      "select exists (select 1 from pg_attribute where attrelid = 'public.automation_eval_gates'::regclass and attname = 'author_config_id' and not attisdropped)",
      []) is true;

  private static APIGatewayProxyResponse GateNotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "EVAL_GATE_NOT_FOUND", "Eval gate not found");

  private static object ToGate(Dictionary<string, object?> r)
  {
    using var metrics = JsonDocument.Parse((string)r["metrics"]!);
    return new
    {
      gateId = RunnerRoutes.Long(r["id"]),
      reviewer = new
      {
        provider = r["reviewer_provider"],
        model = r["reviewer_model"],
        promptVersion = r["prompt_version"],
      },
      passed = r["passed"] is true,
      metrics = metrics.RootElement.Clone(),
      reportSha256 = r["report_sha256"],
      createdBySub = r["created_by_sub"],
      createdAt = RunnerRoutes.Timestamp(r["created_at"]),
      revokedAt = RunnerRoutes.Timestamp(r["revoked_at"]),
      revokedBySub = r["revoked_by_sub"],
      // The author configuration the gate measured (R18E N1); null when the gate binds none.
      authorConfigId = r["author_config_id"] as string,
    };
  }
}
