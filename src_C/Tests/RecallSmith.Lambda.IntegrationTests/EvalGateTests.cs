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
    ["gateId", "reviewer", "passed", "metrics", "reportSha256", "createdBySub", "createdAt", "revokedAt", "revokedBySub"];

  private static readonly string[] MetricKeys =
  [
    "seededRecall", "seededRecallCiLower", "autoAcceptPrecision", "autoAcceptPrecisionCiLower", "wouldAcceptCards", "defectEscapeRate",
    "controlFalsePositiveRate", "seededReps", "authoredReps",
  ];

  private static readonly SemaphoreSlim ScratchGate = new(1, 1);
  private static string? _scratch;

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
  /// 294/300 = 0.98, defect escape 4/40 = 0.10, 150 would-accept cards, 2 reps each.
  /// </summary>
  private static JsonObject PassingReport()
  {
    var r = JsonNode.Parse(ContractReportJson)!.AsObject();
    r["createdAt"] = "2026-09-28T00:00:00Z";
    r["reviewer"]!["promptVersion"] = QaRuns.AutomationPromptVersion;
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
      Assert.Equal(new GateReviewer("bedrock-converse", "global.openai.gpt-5.5", QaRuns.AutomationPromptVersion), live.Reviewer);

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
      Assert.Equal(before, await GateCountAsync());
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
      Assert.Equal(before, await GateCountAsync());
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
      Assert.Null(await ScalarAsync("select id from automation_eval_gates where revoked_at is null"));
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
      Assert.Null(await ScalarAsync("select id from automation_eval_gates where revoked_at is null"));
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
      var secondReport = PassingReport();
      secondReport["createdAt"] = "2026-09-28T01:00:00Z";
      var second = AutomationTestKit.Data(await PostAsync(secondReport.ToJsonString())).GetProperty("gateId").GetInt64();
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
}
