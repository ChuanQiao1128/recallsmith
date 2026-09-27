using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R18F F01 (automation fix round 5) against the shared Postgres: the cross-service contract of the QA report's
/// reasoning effort (O1, completes R18E N2; backend-design-22). The report is the exact body services/ai-qa posts for an
/// automation-profile draft review, and a live auto-accept compares its <c>effectiveEffort</c> with the gate's
/// <c>reviewer.effectiveEffort</c>. Every gate a test inserts is revoked in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationRound5Tests
{
  // The production automation reviewer (services/ai-qa/env/prod.env.json: AI_QA_AUTOMATION_PROVIDER, _MODEL) and the
  // effort providers.effective_effort returns for it at the production AI_EFFORT "high" (openai-mantle sends
  // REASONING_EFFORTS["high"] = "high"). evals records the same function's value as the gate's reviewer.effectiveEffort.
  private const string MantleProvider = "openai-mantle";
  private const string MantleModel = "openai.gpt-5.5";
  private const string ProductionEffort = "high";

  // An ai-qa automation report exactly as handler._report serializes it (json.dumps, sort_keys, compact separators):
  // v, runId, chunk, provider, model, promptVersion, items, target, profile and, for the automation profile (O1),
  // effectiveEffort. The item is review.py's done-item shape. It is one shared golden file (R18G backend-design-27):
  // services/ai-qa's suite asserts that handler._report's automation body has its key set and value types, and this
  // class loads the same file, so a rename on either side fails the other suite instead of leaving both green.
  internal static readonly string AiQaAutomationReportPath = Path.Combine("services", "ai-qa", "tests", "fixtures", "automation_report.json");

  /// <summary>The shared fixture's text, read from the repository.</summary>
  internal static string AiQaAutomationReportJson() => File.ReadAllText(Path.Combine(RepoRoot(), AiQaAutomationReportPath));

  private readonly PostgresFixture _db;

  public AutomationRound5Tests(PostgresFixture db) => _db = db;

  /// <summary>
  /// The shared ai-qa report with the values of <paramref name="e"/> put into the fixture's fields; without the
  /// <c>effectiveEffort</c> key when <paramref name="effort"/> is null. Only values change: the keys, their order and the
  /// value types are the fixture's.
  /// </summary>
  private static string AiQaReport(AutomationTestKit.Eligible e, string? effort)
  {
    var node = JsonNode.Parse(AiQaAutomationReportJson())!.AsObject();
    Set(node, "effectiveEffort", effort ?? string.Empty);
    Set(node, "model", MantleModel);
    Set(node, "promptVersion", QaRuns.AutomationPromptVersion);
    Set(node, "provider", MantleProvider);
    Set(node, "runId", e.JobId.ToString("D"));
    var item = node["items"]!.AsArray().Single()!.AsObject();
    Set(item, "cardId", e.DraftId);
    Set(item, "contentSha256", e.Hash);
    Set(item, "requestId", $"req-{Guid.NewGuid():N}");
    if (effort is null) node.Remove("effectiveEffort");
    return node.ToJsonString();
  }

  /// <summary>Replaces the value of an existing fixture key, keeping its JSON type (a renamed key fails here).</summary>
  private static void Set(JsonObject node, string key, JsonNode value)
  {
    Assert.True(node.ContainsKey(key), $"{AiQaAutomationReportPath} has no key {key}");
    Assert.Equal(node[key]!.GetValueKind(), value.GetValueKind());
    node[key] = value;
  }

  private static string RepoRoot()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, AiQaAutomationReportPath))) dir = dir.Parent;
    return dir?.FullName ?? throw new FileNotFoundException($"no {AiQaAutomationReportPath} above {AppContext.BaseDirectory}");
  }

  private async Task WithMantleGateAsync(string mode, Func<Task> body)
  {
    using var scope = new AutomationTestKit.Scope(mode);
    var gateId = await AutomationTestKit.InsertGateAsync(_db, MantleProvider, MantleModel, effectiveEffort: ProductionEffort);
    try
    {
      await body();
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  [Fact]
  public void AiQaReportFixture_HasTheAutomationReportKeys()
  {
    // The shape pin: the ai-qa automation report's top-level keys, effectiveEffort included (O1).
    var e = new AutomationTestKit.Eligible("sub", 12, "deck", Guid.NewGuid(), 4711, "uid", Guid.NewGuid(), new string('d', 64));
    using var doc = JsonDocument.Parse(AiQaReport(e, ProductionEffort));
    Assert.Equal(
      ["chunk", "effectiveEffort", "items", "model", "profile", "promptVersion", "provider", "runId", "target", "v"],
      doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray());
  }

  [Fact]
  public void AiQaReportFixture_IsTheSharedFile_WithTheProducersSerialization()
  {
    // R18G backend-design-27: the fixture is the checked-in file both suites read, not an inline copy.
    var raw = AiQaAutomationReportJson().TrimEnd('\n');
    // json.dumps(sort_keys=True, separators=(",", ":")): the keys sorted and no whitespace, at every level.
    var parsed = JsonNode.Parse(raw)!;
    Assert.Equal(raw, parsed.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
    AssertSorted(parsed);
    Assert.Equal(("automation", "draft", 1), ((string)parsed["profile"]!, (string)parsed["target"]!, (int)parsed["v"]!));
    Assert.Equal(
      ["cardId", "contentSha256", "errorCode", "estimatedCostUsd", "findings", "latencyMs", "requestId", "status", "usage"],
      parsed["items"]!.AsArray().Single()!.AsObject().Select(p => p.Key).ToArray());

    static void AssertSorted(JsonNode? node)
    {
      if (node is JsonObject o)
      {
        var keys = o.Select(p => p.Key).ToArray();
        Assert.Equal(keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(), keys);
        foreach (var p in o) AssertSorted(p.Value);
      }
      else if (node is JsonArray a)
      {
        foreach (var v in a) AssertSorted(v);
      }
    }
  }

  [Fact]
  public async Task LiveAiQaReport_WithTheGatesEffort_IsAutoAccepted()
  {
    await WithMantleGateAsync(AutomationMode.Live, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "f01-o1-match");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AiQaReport(e, ProductionEffort)));
      var d = (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!;
      Assert.Equal("auto_accepted", d["state"]);
      Assert.Equal(1, await AutomationTestKit.CountAsync(_db, "select count(*) from cards where deck_id = $1", e.DeckId));
    });
  }

  [Fact]
  public async Task LiveAiQaReport_WithoutEffectiveEffort_FailsClosed()
  {
    // A report from an ai-qa that does not send the field (before O1) matches no gate that recorded an effort.
    await WithMantleGateAsync(AutomationMode.Live, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "f01-o1-missing");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AiQaReport(e, null)));
      var d = (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!;
      Assert.Equal(("human", "REVIEWER_NOT_GATED"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from cards where deck_id = $1", e.DeckId));
    });
  }

  [Fact]
  public async Task DryRunAiQaReport_WithTheGatesEffort_RecordsThatTheReviewerMatchesTheGate()
  {
    // The shadow evidence: with O1 shipped, dry run records reviewerMatchesGate=true for the production reviewer.
    await WithMantleGateAsync(AutomationMode.DryRun, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "f01-o1-dry");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AiQaReport(e, ProductionEffort)));
      Assert.Equal("would_accept", (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!["state"]);
      var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
      using var details = JsonDocument.Parse((string)ev["details"]!);
      Assert.True(details.RootElement.GetProperty("reviewerMatchesGate").GetBoolean());
    });
  }

  // ---------------------------------------------------------------- backend-design-24: the method keeps its doc comment

  [Fact]
  public void AgentDraftQualityAsync_CarriesItsOwnDocComment()
  {
    // The eval-exclusion rule is documented on the method, not on the EvalNotePrefix constant inserted between them.
    var lines = File.ReadAllLines(Path.Combine(SourceRoot(), "Vpc", "Ledger", "LedgerRoutes.cs"));
    var method = Array.FindIndex(lines, l => l.Contains("Task<object> AgentDraftQualityAsync(", StringComparison.Ordinal));
    Assert.True(method > 0, "AgentDraftQualityAsync not found in LedgerRoutes.cs");
    var start = method;
    while (start > 0 && lines[start - 1].TrimStart().StartsWith("///", StringComparison.Ordinal)) start--;
    var doc = lines[start..method];
    Assert.Single(doc, l => l.Contains("<summary>", StringComparison.Ordinal));
    Assert.Contains(doc, l => l.Contains("The AI drafting agent's own quality", StringComparison.Ordinal));
    Assert.Contains(doc, l => l.Contains("Eval drafts are left out", StringComparison.Ordinal));
    Assert.DoesNotContain(doc, l => l.Contains("The note prefix", StringComparison.Ordinal));
  }

  /// <summary>Walks up from the test binary to the directory the projects live in.</summary>
  private static string SourceRoot()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null)
    {
      if (File.Exists(Path.Combine(dir.FullName, "Vpc", "VpcFunction.cs"))) return dir.FullName;
      dir = dir.Parent;
    }
    throw new FileNotFoundException($"no Vpc/VpcFunction.cs above {AppContext.BaseDirectory}");
  }
}
