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
  // effectiveEffort. The item is review.py's done-item shape (services/ai-qa tests/test_profiles.py,
  // test_draft_report_carries_target_and_profile_and_the_automation_reviewer).
  private const string AiQaAutomationReportJson = """
    {"chunk":0,"effectiveEffort":"<effort>","items":[{"cardId":<draft_id>,"contentSha256":"<sha>","errorCode":null,"estimatedCostUsd":0.0088,"findings":[],"latencyMs":2140,"requestId":"<request_id>","status":"done","usage":{"cacheReadInputTokens":0,"inputTokens":1000,"outputTokens":100}}],"model":"<model>","profile":"automation","promptVersion":"<prompt_version>","provider":"<provider>","runId":"<run_id>","target":"draft","v":1}
    """;

  private readonly PostgresFixture _db;

  public AutomationRound5Tests(PostgresFixture db) => _db = db;

  /// <summary>The ai-qa report for <paramref name="e"/>; without the <c>effectiveEffort</c> key when <paramref name="effort"/> is null.</summary>
  private static string AiQaReport(AutomationTestKit.Eligible e, string? effort)
  {
    var raw = AiQaAutomationReportJson.Trim()
      .Replace("<effort>", effort ?? string.Empty, StringComparison.Ordinal)
      .Replace("<draft_id>", e.DraftId.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal)
      .Replace("<sha>", e.Hash, StringComparison.Ordinal)
      .Replace("<request_id>", $"req-{Guid.NewGuid():N}", StringComparison.Ordinal)
      .Replace("<model>", MantleModel, StringComparison.Ordinal)
      .Replace("<prompt_version>", QaRuns.AutomationPromptVersion, StringComparison.Ordinal)
      .Replace("<provider>", MantleProvider, StringComparison.Ordinal)
      .Replace("<run_id>", e.JobId.ToString("D"), StringComparison.Ordinal);
    if (effort is not null) return raw;
    var node = JsonNode.Parse(raw)!.AsObject();
    node.Remove("effectiveEffort");
    return node.ToJsonString();
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
