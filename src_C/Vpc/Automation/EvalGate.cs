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

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The eval gate for auto-decision precision (R18A A06, contract A00 §15.3–§15.4): the only record that lets
/// <c>AUTOMATION_MODE=live</c> take effect (<see cref="AutomationMode.EffectiveAsync"/> reads the newest row and
/// counts it only when it is passed and unrevoked, R18B K2). The supervisor posts the <c>dc-evals automation-gate</c> report; core re-computes every metric from
/// the report's counts and records every well-formed report, a failing one with <c>passed = false</c> (R18C L3), so a
/// newer failed evaluation blocks <c>live</c> exactly like a revoke. A revoke of the newest gate makes <c>live</c> fall
/// back to <c>dry_run</c> on the next request; an older passed gate never takes over, and the exact report of a revoked
/// gate cannot be posted again. Nothing here reads or writes <c>AUTOMATION_MODE</c>.
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

  private const string GateColumns = """
    id, reviewer_provider, reviewer_model, prompt_version, passed, metrics::text as metrics, report_sha256, created_by_sub, created_at,
    revoked_at, revoked_by_sub
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
      var history = (await DbUtil.QueryAsync(conn, null,
        $"select {GateColumns} from automation_eval_gates order by id desc limit {HistoryLimit}", []))
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

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      // A revoke is final (R18C L3): the same report bytes never reinstate a revoked gate.
      var revoked = await DbUtil.ExecuteScalarAsync(conn, null,
        "select 1 from automation_eval_gates where report_sha256 = $1 and revoked_at is not null limit 1", [sha]);
      if (revoked is not null)
      {
        return Helpers.ErrorEnvelope(res, 409, "EVAL_GATE_REVOKED", "This report belongs to a revoked eval gate; run the evaluation again");
      }

      // Every well-formed report is recorded (R18C L3): a failing one becomes the newest row with passed = false,
      // which blocks live (R18B K2) until a newer passing report is recorded.
      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub)
        values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
        returning {GateColumns}
        """, [report.Provider, report.Model, report.PromptVersion, passed, metrics, sha, raw, auth.UserSub]);
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

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        update automation_eval_gates set revoked_at = now(), revoked_by_sub = $2
        where id = $1 and revoked_at is null
        returning {GateColumns}
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
    long WouldAcceptCards, double? DefectEscapeRate, double AuthoredUnscoredRate)
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

      return new GateReport(
        passed,
        failuresEmpty,
        Text(reviewer, "reviewer", "provider"),
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
        Number(authored, "authored", "unscoredRate"));
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
    var rows = await DbUtil.QueryAsync(conn, null,
      $"select {GateColumns} from ({NewestGateSql}) g where passed and revoked_at is null", []);
    return rows.Count == 0 ? null : ToGate(rows[0]);
  }

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
    };
  }
}
