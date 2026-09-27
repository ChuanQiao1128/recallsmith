using System.Text.Json;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R18E E01 (automation fix round 4) against the shared Postgres: a live auto-accept needs the reviewer's reasoning
/// effort the eval gate measured (N2, ai-agent-26), and AUTHOR_NOT_GATED names both authors (N1). Every gate a test
/// inserts is revoked in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationRound4Tests
{
  private const string GateEffort = "xhigh";

  private readonly PostgresFixture _db;

  public AutomationRound4Tests(PostgresFixture db) => _db = db;

  private async Task<Dictionary<string, object?>> DecisionAsync(long draftId) => (await AutomationTestKit.DecisionAsync(_db, draftId))!;

  private async Task<long> CardCountAsync(long deckId) =>
    await AutomationTestKit.CountAsync(_db, "select count(*) from cards where deck_id = $1", deckId);

  private async Task WithGateAsync(string mode, string? effort, Func<Task> body)
  {
    using var scope = new AutomationTestKit.Scope(mode);
    var gateId = await AutomationTestKit.InsertGateAsync(_db, effectiveEffort: effort);
    try
    {
      await body();
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  private static Dictionary<string, object?> Report(AutomationTestKit.Eligible e, string? effort)
  {
    var report = AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash);
    if (effort is not null) report["effectiveEffort"] = effort;
    return report;
  }

  // ---------------------------------------------------------------- N2 (ai-agent-26): the gated reviewer effort

  [Theory]
  [InlineData("high")]
  [InlineData(null)]
  public async Task LiveReport_EffortOtherThanTheGates_RoutesHumanReviewerNotGated(string? effort)
  {
    // A lowered AI_EFFORT (shared with the human reviewer) changes the automation reviewer the gate measured; a report
    // that does not say its effort cannot show it matches.
    await WithGateAsync(AutomationMode.Live, GateEffort, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, $"e01-effort-{effort ?? "none"}");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(Report(e, effort)));
      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "REVIEWER_NOT_GATED"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.Equal(0, await CardCountAsync(e.DeckId));
    });
  }

  [Fact]
  public async Task LiveReport_EffortOfTheGate_IsAutoAccepted()
  {
    await WithGateAsync(AutomationMode.Live, GateEffort, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "e01-effort-same");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(Report(e, GateEffort)));
      Assert.Equal("auto_accepted", (await DecisionAsync(e.DraftId))["state"]);
      Assert.Equal(1, await CardCountAsync(e.DeckId));
    });
  }

  [Fact]
  public async Task LiveReport_GateWithoutEffort_BindsNone()
  {
    // A gate recorded before its report carried reviewer.effectiveEffort binds provider, model and prompt version only.
    await WithGateAsync(AutomationMode.Live, null, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "e01-effort-unbound");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(Report(e, "low")));
      Assert.Equal("auto_accepted", (await DecisionAsync(e.DraftId))["state"]);
    });
  }

  [Fact]
  public async Task DryRunReport_RecordsThatTheEffortDoesNotMatchTheGate()
  {
    await WithGateAsync(AutomationMode.DryRun, GateEffort, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "e01-effort-dry");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(Report(e, "medium")));
      Assert.Equal("would_accept", (await DecisionAsync(e.DraftId))["state"]);
      var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
      using var details = JsonDocument.Parse((string)ev["details"]!);
      Assert.False(details.RootElement.GetProperty("reviewerMatchesGate").GetBoolean());
    });
  }

  [Fact]
  public async Task Report_EffectiveEffortThatIsNotAString_Returns400()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "e01-effort-bad");
    var report = AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash);
    report["effectiveEffort"] = 3;
    Assert.Equal(400, (await AutomationTestKit.PostReportAsync(report)).StatusCode);
  }

  // ---------------------------------------------------------------- N1 (backend-design-21): both authors in the detail

  [Theory]
  [InlineData("draft-author", "gate-author", "draft author draft-author, gate author gate-author")]
  [InlineData(null, "gate-author", "draft has no authorConfigId, gate author gate-author")]
  [InlineData("draft-author", null, "draft author draft-author, gate names no author")]
  public void AuthorNotGatedDetail_NamesBothAuthors(string? draft, string? gate, string expected) =>
    Assert.Equal(expected, DraftQaResults.AuthorNotGatedDetail(draft, gate));

  [Fact]
  public void AuthorNotGatedDetail_OfTwoMaximalIds_FitsTheReasonDetailColumn() =>
    Assert.InRange(DraftQaResults.AuthorNotGatedDetail(new string('a', 128), new string('b', 128)).Length, 1, DraftDecisions.MaxReasonDetailLength);
}
