using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The eval gate (R18A A06, contract A00 §15.3–§15.4): a passing <c>dc-evals automation-gate</c> report is recorded
/// and becomes the current gate that lets <c>AUTOMATION_MODE=live</c> take effect; core re-computes every metric from
/// the counts and refuses a report that fails any check (by name) or is malformed; super_admin only for writes; a
/// revoke makes live fall back to dry_run. Reports are synthetic, built from the literal §15.4 JSON. Every test runs
/// against this class's own scratch database and revokes every gate it recorded in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class EvalGateTests
{
  private const string ScratchName = "it_a06_gate";
  private const string GatePath = "/api/v1/admin/automation/eval-gate";

  // A00 §15.4 report JSON, verbatim.
  private const string ContractReportJson = """
    { "v": 1, "kind": "automation-gate", "createdAt": "…", "passed": true, "failures": [],
      "reviewer": { "provider": "bedrock-converse", "model": "global.openai.gpt-5.5", "promptVersion": "qa-v4-auto", "secondProvider": null, "secondModel": null },
      "thresholds": { "seededRecall": 0.90, "seededRecallCiLower": 0.85, "seededPerClassRecallFloor": 0.75, "seededControlFpr": 0.20,
                      "seededControlUnscoredRate": 0.02, "autoAcceptPrecision": 0.97, "autoAcceptPrecisionCiLower": 0.93,
                      "minWouldAcceptCards": 120, "defectEscapeRate": 0.20, "authoredUnscoredRate": 0.05, "minReps": 2 },
      "seeded": { "report": "evals/reports/<file>.json", "reportSha256": "…", "dataset": "seeded-v3", "datasetSha256": "…", "reps": 2, "n": 0,
                  "tp": 0, "fn": 0, "recall": 0.0, "recallCi95": [0.0, 0.0], "perClassRecall": { "<class>": 0.0 },
                  "controlFalsePositiveRate": 0.0, "controlUnscoredRate": 0.0 },
      "authored": { "report": "evals/reports/<file>.json", "reportSha256": "…", "dataset": "authored-v2", "datasetSha256": "…", "labelsSha256": "…",
                    "reps": 2, "n": 0, "scored": 0, "wouldAccept": 0, "wouldAcceptCorrect": 0, "wouldAcceptCards": 0,
                    "autoAcceptPrecision": 0.0, "autoAcceptPrecisionCi95": [0.0, 0.0], "defectiveLabeled": 0, "defectEscaped": 0,
                    "defectEscapeRate": 0.0, "humanRouteRate": 0.0, "unscoredRate": 0.0, "estimatedCostUsd": 0.0 } }
    """;

  // A00 §15.4 EvalGate, in contract order.
  private static readonly string[] GateKeys =
    ["gateId", "reviewer", "passed", "metrics", "reportSha256", "createdBySub", "createdAt", "revokedAt", "revokedBySub", "authorConfigId"];

  private static readonly string[] MetricKeys =
  [
    "seededRecall", "seededRecallCiLower", "autoAcceptPrecision", "autoAcceptPrecisionCiLower", "wouldAcceptCards", "defectEscapeRate",
    "controlFalsePositiveRate", "seededReps", "authoredReps",
  ];

  private static readonly SemaphoreSlim ScratchGate = new(1, 1);
  private static string? _scratch;
  private static int _reportSeq;

  private readonly PostgresFixture _db;
  public EvalGateTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- scratch database

  private async Task<string> ScratchAsync()
  {
    await ScratchGate.WaitAsync();
    try
    {
      if (_scratch is null)
      {
        var cs = await _db.CreateScratchDatabaseAsync(ScratchName);
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
        _scratch = cs;
      }
      return _scratch;
    }
    finally
    {
      ScratchGate.Release();
    }
  }

  /// <summary>
  /// Runs <paramref name="body"/> against the scratch database (<c>PGDATABASE</c> switch) with <c>AUTOMATION_MODE</c>
  /// unset; afterwards revokes every gate still current and restores both variables.
  /// </summary>
  private async Task InScratchAsync(Func<Task> body)
  {
    var cs = await ScratchAsync();
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    var savedMode = Environment.GetEnvironmentVariable(AutomationMode.EnvName);
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", ScratchName);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, null);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body();
    }
    finally
    {
      await using (var conn = new NpgsqlConnection(cs))
      {
        await conn.OpenAsync();
        await DbUtil.ExecuteAsync(conn, null,
          "update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-a06-cleanup' where revoked_at is null", []);
      }
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, savedMode);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  private async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    return await DbUtil.QueryAsync(conn, null, sql, parameters);
  }

  private async Task<object?> ScalarAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    return await DbUtil.ExecuteScalarAsync(conn, null, sql, parameters);
  }

  private async Task<EffectiveMode> EffectiveAsync(string configured)
  {
    var saved = Environment.GetEnvironmentVariable(AutomationMode.EnvName);
    try
    {
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, configured);
      await using var conn = new NpgsqlConnection(await ScratchAsync());
      await conn.OpenAsync();
      return await AutomationMode.EffectiveAsync(conn);
    }
    finally
    {
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, saved);
    }
  }

  // ---------------------------------------------------------------- helpers

  private static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  private static AuthContext Ctx(bool superAdmin = true, string? sub = null) => new(
    Claims: new Dictionary<string, JsonElement>(),
    UserSub: sub ?? $"it-a06-gate-{Guid.NewGuid():N}",
    Username: null,
    Groups: superAdmin ? ["super_admin"] : ["editor"],
    IsSuperAdmin: superAdmin,
    IsEditor: !superAdmin,
    IsAdmin: true,
    IsAgentClient: false);

  private static LambdaRequest Request(string method, string path, string? body) => new(JsonSerializer.SerializeToElement(new
  {
    rawPath = path,
    requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
    headers = new Dictionary<string, string> { ["content-type"] = "application/json" },
    queryStringParameters = new Dictionary<string, string>(),
    body,
    isBase64Encoded = false,
  }));

  private static Task<APIGatewayProxyResponse> PostAsync(string body, AuthContext? auth = null)
  {
    var req = Request("POST", GatePath, body);
    return EvalGate.HandleGate(req, new Res(req.TraceId), auth ?? Ctx());
  }

  private static Task<APIGatewayProxyResponse> GetAsync(AuthContext? auth = null)
  {
    var req = Request("GET", GatePath, null);
    return EvalGate.HandleGate(req, new Res(req.TraceId), auth ?? Ctx(superAdmin: false));
  }

  private static Task<APIGatewayProxyResponse> RevokeAsync(string gateId, AuthContext? auth = null)
  {
    var req = Request("POST", $"{GatePath}/{gateId}/revoke", null);
    return EvalGate.HandleRevoke(req, new Res(req.TraceId), auth ?? Ctx(), gateId);
  }

  /// <summary>
  /// The §15.4 contract report with passing synthetic numbers: seeded recall 184/200 = 0.92, auto-accept precision
  /// 294/300 = 0.98, defect escape 4/40 = 0.10, 150 would-accept cards, 2 reps each. Every call has its own
  /// <c>createdAt</c>, so its bytes (and sha256) differ from every earlier report: the cleanup revokes every gate, and
  /// the exact bytes of a revoked report are refused (R18C L3). The times increase with every call, as re-runs of the
  /// evaluation do, because a report older than the newest recorded one is refused (R18D M4).
  /// </summary>
  private static JsonObject PassingReport()
  {
    var r = JsonNode.Parse(ContractReportJson)!.AsObject();
    r["createdAt"] = NextCreatedAt();
    r["reviewer"]!["promptVersion"] = QaRuns.AutomationPromptVersion;
    // R18E N2: evals records the effort the review sent; required for an automation reviewer since R18G backend-design-26.
    r["reviewer"]!["effectiveEffort"] = "high";
    var s = r["seeded"]!.AsObject();
    s["n"] = 400;
    s["tp"] = 184;
    s["fn"] = 16;
    s["recall"] = 0.92;
    s["recallCi95"] = new JsonArray(0.87, 0.95);
    s["perClassRecall"] = new JsonObject { ["incorrect_answer"] = 0.95, ["answer_leak"] = 0.8 };
    s["controlFalsePositiveRate"] = 0.1;
    s["controlUnscoredRate"] = 0.01;
    var a = r["authored"]!.AsObject();
    a["n"] = 480;
    a["scored"] = 470;
    a["wouldAccept"] = 300;
    a["wouldAcceptCorrect"] = 294;
    a["wouldAcceptCards"] = 150;
    a["autoAcceptPrecision"] = 0.98;
    a["autoAcceptPrecisionCi95"] = new JsonArray(0.95, 0.99);
    a["defectiveLabeled"] = 40;
    a["defectEscaped"] = 4;
    a["defectEscapeRate"] = 0.1;
    a["humanRouteRate"] = 0.36;
    a["unscoredRate"] = 0.02;
    a["estimatedCostUsd"] = 12.5;
    return r;
  }

  private static readonly DateTimeOffset ReportEpoch = new(2026, 9, 28, 0, 0, 0, TimeSpan.Zero);

  /// <summary>A report time later than every earlier one of this class (one second apart).</summary>
  private static string NextCreatedAt() =>
    ReportEpoch.AddSeconds(Interlocked.Increment(ref _reportSeq)).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

  /// <summary><paramref name="patch"/> = <c>path=json;path=json</c> with dotted paths; <c>path=</c> removes the key.</summary>
  private static JsonObject Patched(string patch)
  {
    var r = PassingReport();
    foreach (var part in patch.Split(';', StringSplitOptions.RemoveEmptyEntries))
    {
      var eq = part.IndexOf('=');
      var path = part[..eq].Split('.');
      var value = part[(eq + 1)..];
      var parent = r;
      foreach (var seg in path[..^1]) parent = parent[seg]!.AsObject();
      if (value.Length == 0) parent.Remove(path[^1]);
      else parent[path[^1]] = JsonNode.Parse(value);
    }
    return r;
  }

  private static IReadOnlyList<string> Check(JsonNode report)
  {
    using var doc = JsonDocument.Parse(report.ToJsonString());
    return EvalGate.Check(doc.RootElement);
  }

  private static List<string> Failures(APIGatewayProxyResponse response)
  {
    AutomationTestKit.AssertError(response, 400, "EVAL_GATE_FAILED");
    using var doc = JsonDocument.Parse(response.Body!);
    Assert.Equal(["success", "data", "error", "traceId", "version"], doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray());
    var error = doc.RootElement.GetProperty("error");
    var failures = error.GetProperty("failures").EnumerateArray().Select(f => f.GetString()!).ToList();
    Assert.All(failures, f => Assert.Contains(f, error.GetProperty("message").GetString()));
    return failures;
  }

  private async Task<long> GateCountAsync() => Long(await ScalarAsync("select count(*) from automation_eval_gates"));

  // ---------------------------------------------------------------- POST

  [Fact]
  public async Task PostGate_PassingReport_IsRecorded()
  {
    await InScratchAsync(async () =>
    {
      Assert.Empty(Check(PassingReport()));

      var raw = PassingReport().ToJsonString();
      var sub = $"it-a06-gate-{Guid.NewGuid():N}";
      var gate = AutomationTestKit.Data(await PostAsync(raw, Ctx(sub: sub)));

      Assert.Equal(GateKeys, gate.EnumerateObject().Select(p => p.Name).ToArray());
      var gateId = gate.GetProperty("gateId").GetInt64();
      Assert.Equal("bedrock-converse", gate.GetProperty("reviewer").GetProperty("provider").GetString());
      Assert.Equal("global.openai.gpt-5.5", gate.GetProperty("reviewer").GetProperty("model").GetString());
      Assert.Equal(QaRuns.AutomationPromptVersion, gate.GetProperty("reviewer").GetProperty("promptVersion").GetString());
      Assert.True(gate.GetProperty("passed").GetBoolean());
      Assert.Equal(sub, gate.GetProperty("createdBySub").GetString());
      Assert.EndsWith("Z", gate.GetProperty("createdAt").GetString());
      Assert.Equal(JsonValueKind.Null, gate.GetProperty("revokedAt").ValueKind);
      Assert.Equal(JsonValueKind.Null, gate.GetProperty("revokedBySub").ValueKind);

      var sha = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
      Assert.Equal(sha, gate.GetProperty("reportSha256").GetString());

      var metrics = gate.GetProperty("metrics");
      // jsonb stores object keys in its own order, so the metric names are compared as a set.
      Assert.Equal(MetricKeys.Order(StringComparer.Ordinal), metrics.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
      Assert.Equal(184.0 / 200, metrics.GetProperty("seededRecall").GetDouble());
      Assert.Equal(0.87, metrics.GetProperty("seededRecallCiLower").GetDouble());
      Assert.Equal(294.0 / 300, metrics.GetProperty("autoAcceptPrecision").GetDouble());
      Assert.Equal(0.95, metrics.GetProperty("autoAcceptPrecisionCiLower").GetDouble());
      Assert.Equal(150, metrics.GetProperty("wouldAcceptCards").GetInt64());
      Assert.Equal(4.0 / 40, metrics.GetProperty("defectEscapeRate").GetDouble());
      Assert.Equal(0.1, metrics.GetProperty("controlFalsePositiveRate").GetDouble());
      Assert.Equal(2, metrics.GetProperty("seededReps").GetInt64());
      Assert.Equal(2, metrics.GetProperty("authoredReps").GetInt64());

      var row = Assert.Single(await QueryAsync(
        "select reviewer_provider, reviewer_model, prompt_version, passed, report_sha256, created_by_sub, report = $2::jsonb as same_report " +
        "from automation_eval_gates where id = $1", gateId, raw));
      Assert.Equal("bedrock-converse", row["reviewer_provider"]);
      Assert.Equal("global.openai.gpt-5.5", row["reviewer_model"]);
      Assert.Equal(QaRuns.AutomationPromptVersion, row["prompt_version"]);
      Assert.Equal(true, row["passed"]);
      Assert.Equal(sha, row["report_sha256"]);
      Assert.Equal(sub, row["created_by_sub"]);
      Assert.Equal(true, row["same_report"]);

      // It is the current gate, and live now takes effect.
      var current = AutomationTestKit.Data(await GetAsync()).GetProperty("current");
      Assert.Equal(gateId, current.GetProperty("gateId").GetInt64());
      var live = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal(AutomationMode.Live, live.Effective);
      Assert.Null(live.LiveBlockedReason);
      Assert.Equal(gateId, live.GateId);
      Assert.Equal(new GateReviewer("bedrock-converse", "global.openai.gpt-5.5", QaRuns.AutomationPromptVersion, "high"), live.Reviewer);

      // Exactly at every threshold still passes (the comparisons are strict the right way round).
      var edge = Patched(
        "seeded.tp=180;seeded.fn=20;seeded.recallCi95=[0.85,0.95];seeded.perClassRecall={\"x\":0.75};seeded.controlFalsePositiveRate=0.20;" +
        "seeded.controlUnscoredRate=0.02;authored.wouldAccept=200;authored.wouldAcceptCorrect=194;authored.autoAcceptPrecisionCi95=[0.93,0.99];" +
        "authored.wouldAcceptCards=120;authored.defectiveLabeled=10;authored.defectEscaped=2;authored.unscoredRate=0.05");
      Assert.Empty(Check(edge));
    });
  }

  [Fact]
  public async Task PostGate_ClaimedPassButFailingCounts_Returns400EvalGateFailed()
  {
    await InScratchAsync(async () =>
    {
      // The report claims passed with the right rates, but its counts say otherwise: core re-computes.
      var report = Patched("seeded.tp=80;seeded.fn=20;seeded.recall=0.95;authored.wouldAcceptCorrect=280;authored.autoAcceptPrecision=0.98;" +
                           "authored.defectEscaped=10;authored.defectEscapeRate=0.1");
      Assert.True(report["passed"]!.GetValue<bool>());
      Assert.Empty(report["failures"]!.AsArray());

      var before = await GateCountAsync();
      var failures = Failures(await PostAsync(report.ToJsonString()));
      Assert.Equal(["seeded.recall", "authored.autoAcceptPrecision", "authored.defectEscapeRate"], failures);
      Assert.Equal(failures, Check(report));
      // R18C L3: the failing report is recorded as a failed gate (it used to be dropped), and it is not current.
      Assert.Equal(before + 1, await GateCountAsync());
      Assert.Equal(false, await ScalarAsync("select passed from automation_eval_gates order by id desc limit 1"));
      Assert.Equal(JsonValueKind.Null, AutomationTestKit.Data(await GetAsync()).GetProperty("current").ValueKind);
    });
  }

  public static TheoryData<string, string> Thresholds => new()
  {
    { "passed=false", "passed" },
    { "failures=[\"seeded.recall\"]", "failures" },
    { "seeded.reps=1", "seeded.reps" },
    { "authored.reps=1", "authored.reps" },
    { "seeded.tp=179;seeded.fn=21", "seeded.recall" },
    { "seeded.tp=0;seeded.fn=0", "seeded.recall" },
    { "seeded.recallCi95=[0.849,0.95]", "seeded.recallCiLower" },
    { "seeded.perClassRecall={\"incorrect_answer\":0.95,\"answer_leak\":0.749}", "seeded.perClassRecall" },
    { "seeded.perClassRecall={}", "seeded.perClassRecall" },
    { "seeded.controlFalsePositiveRate=0.201", "seeded.controlFalsePositiveRate" },
    { "seeded.controlUnscoredRate=0.021", "seeded.controlUnscoredRate" },
    { "authored.wouldAcceptCorrect=290", "authored.autoAcceptPrecision" },
    { "authored.wouldAccept=0;authored.wouldAcceptCorrect=0", "authored.autoAcceptPrecision" },
    { "authored.autoAcceptPrecisionCi95=[0.929,0.99]", "authored.autoAcceptPrecisionCiLower" },
    { "authored.wouldAcceptCards=119", "authored.wouldAcceptCards" },
    { "authored.defectEscaped=9", "authored.defectEscapeRate" },
    { "authored.defectiveLabeled=0;authored.defectEscaped=0", "authored.defectEscapeRate" },
    { "authored.unscoredRate=0.051", "authored.unscoredRate" },
  };

  [Theory]
  [MemberData(nameof(Thresholds))]
  public async Task PostGate_EachThreshold_FailsWithItsCheck(string patch, string check)
  {
    await InScratchAsync(async () =>
    {
      var report = Patched(patch);
      Assert.Equal([check], Check(report));
      Assert.Contains(check, EvalGate.CheckNames);

      var before = await GateCountAsync();
      Assert.Equal([check], Failures(await PostAsync(report.ToJsonString())));
      // R18C L3: recorded as the newest row, failed.
      Assert.Equal(before + 1, await GateCountAsync());
      Assert.Equal(false, await ScalarAsync("select passed from automation_eval_gates order by id desc limit 1"));
    });
  }

  [Fact]
  public async Task PostGate_WrongProviderOrPromptVersion_Fails()
  {
    await InScratchAsync(async () =>
    {
      Assert.Equal(["reviewer.provider"], Failures(await PostAsync(Patched("reviewer.provider=\"anthropic\"").ToJsonString())));
      Assert.Equal(["reviewer.provider"], Failures(await PostAsync(Patched("reviewer.provider=\"Bedrock-Converse\"").ToJsonString())));
      Assert.Equal(["reviewer.promptVersion"], Failures(await PostAsync(Patched("reviewer.promptVersion=\"qa-v3\"").ToJsonString())));
      // R18B K1: the human-run prompt version is not the automation reviewer; the gate measures qa-v4-auto only.
      Assert.Equal(["reviewer.promptVersion"], Failures(await PostAsync(Patched($"reviewer.promptVersion=\"{QaRuns.PromptVersion}\"").ToJsonString())));
      Assert.Equal(["reviewer.model"], Failures(await PostAsync(Patched("reviewer.model=\"  \"").ToJsonString())));
      Assert.Equal(["reviewer.provider", "reviewer.promptVersion"],
        Failures(await PostAsync(Patched("reviewer.provider=\"openai\";reviewer.promptVersion=\"qa-v5\"").ToJsonString())));
      // R18C L3: the failed reports are recorded, but none of them is a passed gate.
      Assert.Null(await ScalarAsync("select id from automation_eval_gates where passed and revoked_at is null"));
    });
  }

  [Fact]
  public async Task PostGate_SecondReviewer_Fails()
  {
    await InScratchAsync(async () =>
    {
      Assert.Equal(["reviewer.secondProvider", "reviewer.secondModel"],
        Failures(await PostAsync(Patched("reviewer.secondProvider=\"anthropic\";reviewer.secondModel=\"synthetic-second-model\"").ToJsonString())));
      Assert.Equal(["reviewer.secondModel"], Failures(await PostAsync(Patched("reviewer.secondModel=\"synthetic-second-model\"").ToJsonString())));
      Assert.Equal(["reviewer.secondProvider"], Failures(await PostAsync(Patched("reviewer.secondProvider=\"bedrock-converse\"").ToJsonString())));
      Assert.Null(await ScalarAsync("select id from automation_eval_gates where passed and revoked_at is null"));
    });
  }

  [Fact]
  public async Task PostGate_Malformed_Returns400EvalGateInvalid()
  {
    await InScratchAsync(async () =>
    {
      var bodies = new[]
      {
        "[]", "1", "\"report\"", "null", "{}",
        Patched("v=2").ToJsonString(),
        Patched("v=").ToJsonString(),
        Patched("v=\"1\"").ToJsonString(),
        Patched("kind=\"seeded-gate\"").ToJsonString(),
        Patched("kind=").ToJsonString(),
        Patched("reviewer=").ToJsonString(),
        Patched("reviewer=[]").ToJsonString(),
        Patched("reviewer.provider=5").ToJsonString(),
        Patched("reviewer.model=").ToJsonString(),
        Patched("reviewer.promptVersion=null").ToJsonString(),
        Patched("reviewer.secondProvider=").ToJsonString(),
        Patched("reviewer.secondModel=7").ToJsonString(),
        Patched("seeded=").ToJsonString(),
        Patched("seeded.tp=\"184\"").ToJsonString(),
        Patched("seeded.fn=-1").ToJsonString(),
        Patched("seeded.reps=2.5").ToJsonString(),
        Patched("seeded.recallCi95=[0.9]").ToJsonString(),
        Patched("seeded.recallCi95=[\"0.9\",0.95]").ToJsonString(),
        Patched("seeded.perClassRecall=[0.9]").ToJsonString(),
        Patched("seeded.perClassRecall={\"x\":\"high\"}").ToJsonString(),
        Patched("seeded.controlFalsePositiveRate=").ToJsonString(),
        Patched("seeded.controlUnscoredRate=null").ToJsonString(),
        Patched("authored=").ToJsonString(),
        Patched("authored.wouldAccept=").ToJsonString(),
        Patched("authored.wouldAcceptCorrect=301").ToJsonString(),
        Patched("authored.wouldAcceptCards=true").ToJsonString(),
        Patched("authored.autoAcceptPrecisionCi95=0.95").ToJsonString(),
        Patched("authored.defectEscaped=41").ToJsonString(),
        Patched("authored.unscoredRate=\"0.01\"").ToJsonString(),
      };
      var before = await GateCountAsync();
      foreach (var body in bodies)
      {
        var response = await PostAsync(body);
        Assert.True(response.StatusCode == 400 && response.Body!.Contains("\"EVAL_GATE_INVALID\"", StringComparison.Ordinal),
          $"{body[..Math.Min(body.Length, 80)]}: {response.StatusCode} {response.Body}");
      }
      Assert.Throws<EvalGate.InvalidReport>(() => Check(Patched("v=2")));

      // Unparseable JSON keeps the §8.1 convention.
      AutomationTestKit.AssertError(await PostAsync("{not json"), 400, "BAD_REQUEST");
      AutomationTestKit.AssertError(await PostAsync(""), 400, "BAD_REQUEST");
      Assert.Equal(before, await GateCountAsync());
    });
  }

  [Fact]
  public async Task PostGate_Editor_Returns403()
  {
    await InScratchAsync(async () =>
    {
      var before = await GateCountAsync();
      AutomationTestKit.AssertError(await PostAsync(PassingReport().ToJsonString(), Ctx(superAdmin: false)), 403, "FORBIDDEN");
      Assert.Equal(before, await GateCountAsync());

      // The editor still reads the gate; only super_admin revokes.
      Assert.Equal(200, (await GetAsync(Ctx(superAdmin: false))).StatusCode);
      var gateId = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      AutomationTestKit.AssertError(await RevokeAsync(gateId.ToString(CultureInfo.InvariantCulture), Ctx(superAdmin: false)), 403, "FORBIDDEN");
      Assert.Null(await ScalarAsync("select revoked_at from automation_eval_gates where id = $1", gateId));

      // Other methods: 405.
      var req = Request("DELETE", GatePath, null);
      Assert.Equal(405, (await EvalGate.HandleGate(req, new Res(req.TraceId), Ctx())).StatusCode);
      var revokeGet = Request("GET", $"{GatePath}/{gateId}/revoke", null);
      Assert.Equal(405, (await EvalGate.HandleRevoke(revokeGet, new Res(revokeGet.TraceId), Ctx(), gateId.ToString(CultureInfo.InvariantCulture))).StatusCode);
    });
  }

  // ---------------------------------------------------------------- GET

  [Fact]
  public async Task GetGate_ReturnsCurrentAndHistory()
  {
    await InScratchAsync(async () =>
    {
      // No current gate (every earlier test revoked its own).
      var empty = AutomationTestKit.Data(await GetAsync());
      Assert.Equal(["current", "history"], empty.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(JsonValueKind.Null, empty.GetProperty("current").ValueKind);

      // 22 older revoked rows, then two posted gates: the latest unrevoked is current, history is the latest 20 by id.
      for (var i = 0; i < 22; i++)
      {
        await ScalarAsync(
          "insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub, revoked_at, revoked_by_sub) " +
          "values ('bedrock-converse', 'global.openai.gpt-5.5', $1, true, '{}'::jsonb, $2, '{}'::jsonb, 'it-a06', now(), 'it-a06') returning id",
          QaRuns.AutomationPromptVersion, new string('f', 64));
      }
      var first = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      var second = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      Assert.True(second > first);

      var data = AutomationTestKit.Data(await GetAsync());
      var current = data.GetProperty("current");
      Assert.Equal(GateKeys, current.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(second, current.GetProperty("gateId").GetInt64());
      var history = data.GetProperty("history").EnumerateArray().ToList();
      Assert.Equal(20, history.Count);
      Assert.Equal(second, history[0].GetProperty("gateId").GetInt64());
      Assert.Equal(first, history[1].GetProperty("gateId").GetInt64());
      var ids = history.Select(h => h.GetProperty("gateId").GetInt64()).ToList();
      Assert.Equal(ids.OrderByDescending(x => x).ToList(), ids);
      Assert.All(history, h => Assert.Equal(GateKeys, h.EnumerateObject().Select(p => p.Name).ToArray()));
      Assert.NotEqual(JsonValueKind.Null, history[2].GetProperty("revokedAt").ValueKind);

      // Revoking the latest leaves no current gate (R18B K2): the earlier unrevoked one never takes over.
      AutomationTestKit.Data(await RevokeAsync(second.ToString(CultureInfo.InvariantCulture)));
      Assert.Equal(JsonValueKind.Null, AutomationTestKit.Data(await GetAsync()).GetProperty("current").ValueKind);
      Assert.Equal(AutomationMode.DryRun, (await EffectiveAsync(AutomationMode.Live)).Effective);
      AutomationTestKit.Data(await RevokeAsync(first.ToString(CultureInfo.InvariantCulture)));
    });
  }

  // ---------------------------------------------------------------- revoke

  [Fact]
  public async Task RevokeGate_MakesLiveEffectiveDryRun()
  {
    await InScratchAsync(async () =>
    {
      var gateId = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      Assert.Equal(AutomationMode.Live, (await EffectiveAsync(AutomationMode.Live)).Effective);

      var sub = $"it-a06-revoker-{Guid.NewGuid():N}";
      var revoked = AutomationTestKit.Data(await RevokeAsync(gateId.ToString(CultureInfo.InvariantCulture), Ctx(sub: sub)));
      Assert.Equal(GateKeys, revoked.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(gateId, revoked.GetProperty("gateId").GetInt64());
      Assert.EndsWith("Z", revoked.GetProperty("revokedAt").GetString());
      Assert.Equal(sub, revoked.GetProperty("revokedBySub").GetString());
      Assert.True(revoked.GetProperty("passed").GetBoolean());

      var after = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal(AutomationMode.DryRun, after.Effective);
      Assert.Equal(AutomationMode.EvalGateMissing, after.LiveBlockedReason);
      Assert.Null(after.GateId);
      Assert.Equal(JsonValueKind.Null, AutomationTestKit.Data(await GetAsync()).GetProperty("current").ValueKind);
    });
  }

  [Fact]
  public async Task RevokeGate_Twice_Returns409EvalGateRevoked()
  {
    await InScratchAsync(async () =>
    {
      var gateId = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64().ToString(CultureInfo.InvariantCulture);
      var firstSub = $"it-a06-first-{Guid.NewGuid():N}";
      AutomationTestKit.Data(await RevokeAsync(gateId, Ctx(sub: firstSub)));
      AutomationTestKit.AssertError(await RevokeAsync(gateId), 409, "EVAL_GATE_REVOKED");
      Assert.Equal(firstSub, await ScalarAsync("select revoked_by_sub from automation_eval_gates where id = $1", long.Parse(gateId, CultureInfo.InvariantCulture)));
    });
  }

  [Fact]
  public async Task RevokeGate_Unknown_Returns404EvalGateNotFound()
  {
    await InScratchAsync(async () =>
    {
      foreach (var id in new[] { "abc", "0", "-1", "1e3", (long.MaxValue - 5).ToString(CultureInfo.InvariantCulture) })
      {
        AutomationTestKit.AssertError(await RevokeAsync(id), 404, "EVAL_GATE_NOT_FOUND");
      }
    });
  }

  // ---------------------------------------------------------------- R18C L3 / L1 (C02)

  [Fact]
  public async Task PostGate_FailingReport_IsRecordedAndBlocksLive()
  {
    await InScratchAsync(async () =>
    {
      var passedId = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      Assert.Equal(AutomationMode.Live, (await EffectiveAsync(AutomationMode.Live)).Effective);

      // The owner re-runs the evaluation (same model id, drift) and it fails: posted through the route, not SQL.
      var failing = Patched("authored.wouldAcceptCorrect=250");
      var sub = $"it-c02-gate-{Guid.NewGuid():N}";
      Assert.Equal(["authored.autoAcceptPrecision"], Failures(await PostAsync(failing.ToJsonString(), Ctx(sub: sub))));

      var row = Assert.Single(await QueryAsync(
        "select id, passed, revoked_at, created_by_sub, reviewer_model, metrics->>'autoAcceptPrecision' as precision " +
        "from automation_eval_gates order by id desc limit 1"));
      Assert.True(Long(row["id"]) > passedId);
      Assert.Equal(false, row["passed"]);
      Assert.Null(row["revoked_at"]);
      Assert.Equal(sub, row["created_by_sub"]);
      Assert.Equal("global.openai.gpt-5.5", row["reviewer_model"]);
      Assert.Equal(250.0 / 300, double.Parse((string)row["precision"]!, CultureInfo.InvariantCulture));

      // R18B K2 through the API: the newest evaluation failed, so live drops to dry_run; the older pass never counts.
      var blocked = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal(AutomationMode.DryRun, blocked.Effective);
      Assert.Equal(AutomationMode.EvalGateMissing, blocked.LiveBlockedReason);
      Assert.Null(blocked.GateId);
      var data = AutomationTestKit.Data(await GetAsync());
      Assert.Equal(JsonValueKind.Null, data.GetProperty("current").ValueKind);
      var newest = data.GetProperty("history")[0];
      Assert.Equal(Long(row["id"]), newest.GetProperty("gateId").GetInt64());
      Assert.False(newest.GetProperty("passed").GetBoolean());

      // A newer passing evaluation restores live.
      var again = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      var live = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal((AutomationMode.Live, (long?)again), (live.Effective, live.GateId));
    });
  }

  [Fact]
  public async Task PostGate_RevokedReportAgain_Returns409()
  {
    await InScratchAsync(async () =>
    {
      var raw = PassingReport().ToJsonString();
      var gateId = AutomationTestKit.Data(await PostAsync(raw)).GetProperty("gateId").GetInt64();
      AutomationTestKit.Data(await RevokeAsync(gateId.ToString(CultureInfo.InvariantCulture)));
      var before = await GateCountAsync();

      // Pasting the revoked gate's exact report again does not reinstate live.
      AutomationTestKit.AssertError(await PostAsync(raw), 409, "EVAL_GATE_REVOKED");
      Assert.Equal(before, await GateCountAsync());
      Assert.Equal(AutomationMode.DryRun, (await EffectiveAsync(AutomationMode.Live)).Effective);

      // A fresh evaluation (other bytes) is recorded as usual.
      var fresh = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      Assert.True(fresh > gateId);
      Assert.Equal(AutomationMode.Live, (await EffectiveAsync(AutomationMode.Live)).Effective);
    });
  }

  [Fact]
  public async Task PostGate_OpenAiMantleProvider_IsAcceptedAndPinned()
  {
    await InScratchAsync(async () =>
    {
      Assert.Equal(["openai-mantle", "bedrock-converse"], EvalGate.AutomationGateProviders);
      var report = Patched("reviewer.provider=\"openai-mantle\";reviewer.model=\"openai.gpt-5.5\"");
      Assert.Empty(Check(report));
      var gate = AutomationTestKit.Data(await PostAsync(report.ToJsonString()));
      Assert.Equal("openai-mantle", gate.GetProperty("reviewer").GetProperty("provider").GetString());
      Assert.Equal("openai.gpt-5.5", gate.GetProperty("reviewer").GetProperty("model").GetString());

      var live = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal(new GateReviewer("openai-mantle", "openai.gpt-5.5", QaRuns.AutomationPromptVersion, "high"), live.Reviewer);
    });
  }

  [Fact]
  public async Task PostGate_ModelOutsideAllowlist_FailsReviewerModel()
  {
    await InScratchAsync(async () =>
    {
      // Owner decision 4: GPT-5.5 only; a same-vendor or any other model never enables live.
      foreach (var model in new[] { "global.anthropic.claude-sonnet-synthetic", "anthropic.claude-synthetic", "openai.gpt-4o", "GLOBAL.OPENAI.GPT-5.5", "" })
      {
        var report = Patched($"reviewer.model=\"{model}\"");
        Assert.Equal(["reviewer.model"], Check(report));
        Assert.Equal(["reviewer.model"], Failures(await PostAsync(report.ToJsonString())));
      }
      Assert.Null(await ScalarAsync("select id from automation_eval_gates where passed and revoked_at is null"));
      Assert.Equal(AutomationMode.DryRun, (await EffectiveAsync(AutomationMode.Live)).Effective);
    });
  }

  // ---------------------------------------------------------------- R18D M4 (automation-26): stale reports

  [Fact]
  public async Task PostGate_OlderPassingReportAfterNewerFailure_Returns409Stale()
  {
    await InScratchAsync(async () =>
    {
      // pass, fail, then the first (passing) report again: it must not make live effective.
      var first = PassingReport().ToJsonString();
      AutomationTestKit.Data(await PostAsync(first));
      Assert.Equal(AutomationMode.Live, (await EffectiveAsync(AutomationMode.Live)).Effective);
      Assert.Equal(["authored.autoAcceptPrecision"], Failures(await PostAsync(Patched("authored.wouldAcceptCorrect=250").ToJsonString())));
      var before = await GateCountAsync();

      var stale = await PostAsync(first);
      AutomationTestKit.AssertError(stale, 409, "EVAL_GATE_STALE");
      Assert.Equal(before, await GateCountAsync());
      var mode = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal((AutomationMode.DryRun, AutomationMode.EvalGateMissing), (mode.Effective, mode.LiveBlockedReason));

      // An older report of other bytes (a mis-pasted file) is refused the same way; generatedAt wins over createdAt.
      var older = PassingReport();
      older["generatedAt"] = "2026-01-01T00:00:00Z";
      AutomationTestKit.AssertError(await PostAsync(older.ToJsonString()), 409, "EVAL_GATE_STALE");

      // A newer evaluation is recorded and restores live.
      var fresh = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString())).GetProperty("gateId").GetInt64();
      Assert.Equal((AutomationMode.Live, (long?)fresh), ((await EffectiveAsync(AutomationMode.Live)).Effective, (await EffectiveAsync(AutomationMode.Live)).GateId));
    });
  }

  [Theory]
  [InlineData("createdAt=")]
  [InlineData("createdAt=\"yesterday\"")]
  [InlineData("createdAt=\"2026-09-28T00:00:00\"")]
  [InlineData("createdAt=12")]
  public async Task PostGate_WithoutAGenerationTime_Returns400Invalid(string patch)
  {
    await InScratchAsync(async () =>
    {
      var before = await GateCountAsync();
      AutomationTestKit.AssertError(await PostAsync(Patched(patch).ToJsonString()), 400, "EVAL_GATE_INVALID");
      Assert.Equal(before, await GateCountAsync());
    });
  }

  // ---------------------------------------------------------------- R18D M1 (automation-20): the gated author

  private const string GatedAuthor = "d01a0000000000000000000000000000000000000000000000000000000000a1";

  private static JsonObject WithNewFacts(JsonObject report, string? authorConfigId)
  {
    var authored = report["authored"]!.AsObject();
    authored["strata"] = new JsonObject { ["docs"] = new JsonObject { ["rows"] = 80 }, [EvalGate.NewFactsStratum] = new JsonObject { ["rows"] = 60 } };
    authored["author"] = authorConfigId is null
      ? new JsonObject { ["model"] = "synthetic-model", ["skillVersion"] = "1" }
      : new JsonObject { ["model"] = "synthetic-model", ["skillVersion"] = "1", ["authorConfigId"] = authorConfigId };
    return report;
  }

  [Fact]
  public async Task PostGate_StoresTheAuthorConfigId_AndLiveReadsIt()
  {
    await InScratchAsync(async () =>
    {
      var posted = AutomationTestKit.Data(await PostAsync(WithNewFacts(PassingReport(), GatedAuthor).ToJsonString()));
      var gateId = posted.GetProperty("gateId").GetInt64();
      Assert.Equal(GatedAuthor, await ScalarAsync("select author_config_id from automation_eval_gates where id = $1", gateId));
      var live = await EffectiveAsync(AutomationMode.Live);
      Assert.Equal((AutomationMode.Live, (long?)gateId, GatedAuthor), (live.Effective, live.GateId, live.GateAuthorConfigId));

      // R18E N1 (backend-design-21, automation-28): every gate surface names the author the gate measured.
      Assert.Equal(GatedAuthor, posted.GetProperty("authorConfigId").GetString());
      var got = AutomationTestKit.Data(await GetAsync());
      Assert.Equal(GatedAuthor, got.GetProperty("current").GetProperty("authorConfigId").GetString());
      Assert.Equal(GatedAuthor, got.GetProperty("history")[0].GetProperty("authorConfigId").GetString());

      // A report that measured no author binds none: live then routes every draft to a human (AUTHOR_NOT_GATED).
      var unbound = AutomationTestKit.Data(await PostAsync(PassingReport().ToJsonString()));
      var unboundId = unbound.GetProperty("gateId").GetInt64();
      Assert.Null(await ScalarAsync("select author_config_id from automation_eval_gates where id = $1", unboundId));
      Assert.Null((await EffectiveAsync(AutomationMode.Live)).GateAuthorConfigId);
      Assert.Equal(JsonValueKind.Null, unbound.GetProperty("authorConfigId").ValueKind);
      var after = AutomationTestKit.Data(await GetAsync());
      Assert.Equal(JsonValueKind.Null, after.GetProperty("current").GetProperty("authorConfigId").ValueKind);
      Assert.Equal(GatedAuthor, after.GetProperty("history")[1].GetProperty("authorConfigId").GetString());

      // The revoke answer names it too.
      var revoked = AutomationTestKit.Data(await RevokeAsync(unboundId.ToString(CultureInfo.InvariantCulture)));
      Assert.Equal(JsonValueKind.Null, revoked.GetProperty("authorConfigId").ValueKind);
    });
  }

  [Fact]
  public async Task PostGate_RecordsTheReviewerEffort_AndLiveReadsIt()
  {
    // R18E N2 (ai-agent-26): the effort the gate's review sent (reviewer.effectiveEffort) binds the live reviewer.
    await InScratchAsync(async () =>
    {
      var report = WithNewFacts(PassingReport(), GatedAuthor);
      report["reviewer"]!["effectiveEffort"] = "xhigh";
      AutomationTestKit.Data(await PostAsync(report.ToJsonString()));
      Assert.Equal("xhigh", (await EffectiveAsync(AutomationMode.Live)).Reviewer!.Effort);

      // A report that recorded no effort is refused (R18G backend-design-26), so the recorded effort still binds.
      var unbound = WithNewFacts(PassingReport(), GatedAuthor);
      unbound["reviewer"]!.AsObject().Remove("effectiveEffort");
      AutomationTestKit.AssertError(await PostAsync(unbound.ToJsonString()), 400, "EVAL_GATE_INVALID");
      Assert.Equal("xhigh", (await EffectiveAsync(AutomationMode.Live)).Reviewer!.Effort);
    });
  }

  [Fact]
  public async Task PostGate_AutomationReviewerWithoutEffectiveEffort_Returns400Invalid_AndRecordsNothing()
  {
    // R18G backend-design-26: the N2 effort binding is fail-closed at intake too. A gate without the effort would bind
    // none, so a later AI_EFFORT change would pass unnoticed.
    await InScratchAsync(async () =>
    {
      var before = await GateCountAsync();
      foreach (var provider in EvalGate.AutomationGateProviders)
      {
        foreach (Action<JsonObject> patch in new Action<JsonObject>[]
        {
          reviewer => reviewer.Remove("effectiveEffort"),
          reviewer => reviewer["effectiveEffort"] = null,
          reviewer => reviewer["effectiveEffort"] = "",
          reviewer => reviewer["effectiveEffort"] = 5,
          reviewer => reviewer["effectiveEffort"] = new string('e', RecallSmith.Lambda.Vpc.Internal.AiQaResults.MaxLabelLength + 1),
        })
        {
          var report = WithNewFacts(PassingReport(), GatedAuthor);
          var reviewer = report["reviewer"]!.AsObject();
          reviewer["provider"] = provider;
          patch(reviewer);
          var response = await PostAsync(report.ToJsonString());
          AutomationTestKit.AssertError(response, 400, "EVAL_GATE_INVALID");
          Assert.Contains("reviewer.effectiveEffort", response.Body);
        }
      }
      Assert.Equal(before, await GateCountAsync());

      // Another provider is recorded as a failing gate on reviewer.provider, with or without an effort.
      var other = WithNewFacts(PassingReport(), GatedAuthor);
      other["reviewer"]!["provider"] = "anthropic";
      other["reviewer"]!.AsObject().Remove("effectiveEffort");
      Assert.Equal(["reviewer.provider"], Failures(await PostAsync(other.ToJsonString())));
      Assert.Equal(before + 1, await GateCountAsync());
    });
  }

  [Fact]
  public async Task PostGate_NewFactsStratumWithoutAuthorConfigId_Returns400Invalid()
  {
    await InScratchAsync(async () =>
    {
      var before = await GateCountAsync();
      foreach (var report in new[]
      {
        WithNewFacts(PassingReport(), null),
        WithNewFacts(PassingReport(), ""),
        WithNewFacts(PassingReport(), new string('a', 129)),
      })
      {
        var response = await PostAsync(report.ToJsonString());
        AutomationTestKit.AssertError(response, 400, "EVAL_GATE_INVALID");
        Assert.Contains("authored.author.authorConfigId", response.Body);
      }
      Assert.Equal(before, await GateCountAsync());
    });
  }

  [Fact]
  public async Task EffectiveMode_Before036_ReadsTheGatedAuthorFromTheStoredReport()
  {
    // Migrate-before-code tolerance: on a database at 035 the column is missing; the report jsonb still binds the author.
    const string name = "it_d01_gate_035";
    var cs = await _db.CreateScratchDatabaseAsync(name);
    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 35);
    }
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      var gate = AutomationTestKit.Data(await PostAsync(WithNewFacts(PassingReport(), GatedAuthor).ToJsonString()));
      Assert.True(gate.GetProperty("passed").GetBoolean());
      // R18E N1: before 036 the gate shape reads the author from the stored report, as the mode resolver does.
      Assert.Equal(GatedAuthor, gate.GetProperty("authorConfigId").GetString());
      Assert.Equal(GatedAuthor, AutomationTestKit.Data(await GetAsync()).GetProperty("current").GetProperty("authorConfigId").GetString());

      var saved = Environment.GetEnvironmentVariable(AutomationMode.EnvName);
      try
      {
        Environment.SetEnvironmentVariable(AutomationMode.EnvName, AutomationMode.Live);
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var live = await AutomationMode.EffectiveAsync(conn);
        Assert.Equal((AutomationMode.Live, GatedAuthor), (live.Effective, live.GateAuthorConfigId));
      }
      finally
      {
        Environment.SetEnvironmentVariable(AutomationMode.EnvName, saved);
      }
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }
}
