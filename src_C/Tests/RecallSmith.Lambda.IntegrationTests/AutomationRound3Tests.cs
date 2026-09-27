using System.Text.Json;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R18D D01 (automation fix round 3) against the shared Postgres: a live auto-accept needs the author the eval gate
/// measured (M1, automation-20), and a human decision records whether the verdict was shown as the console reports it
/// (M3, automation-4). Every gate a test inserts is revoked in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationRound3Tests
{
  private readonly PostgresFixture _db;

  public AutomationRound3Tests(PostgresFixture db) => _db = db;

  private async Task<Dictionary<string, object?>> DecisionAsync(long draftId) => (await AutomationTestKit.DecisionAsync(_db, draftId))!;

  private async Task<long> CardCountAsync(long deckId) =>
    await AutomationTestKit.CountAsync(_db, "select count(*) from cards where deck_id = $1", deckId);

  private async Task LiveAsync(string? gateAuthor, Func<Task> body)
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Live);
    var gateId = await AutomationTestKit.InsertGateAsync(_db, authorConfigId: gateAuthor);
    try
    {
      await body();
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  // ---------------------------------------------------------------- M1 (automation-20): the gated author

  [Fact]
  public async Task LiveReport_DraftOfAnotherAuthor_RoutesHumanAuthorNotGated()
  {
    // A skill, prompt or model change after the gate gives the runner a new authorConfigId.
    await LiveAsync("d01b0000000000000000000000000000000000000000000000000000000000b2", async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-author");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "AUTHOR_NOT_GATED"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.Equal($"draft author {AutomationTestKit.AuthorConfigId}", d["reason_detail"]);
      Assert.Equal(0, await CardCountAsync(e.DeckId));
      Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
      var route = (await _db.QueryAsync("select outcome from automation_events where dedupe_key = $1", $"auto-route:{e.DraftId}")).Single();
      Assert.Equal("success", route["outcome"]);
    });
  }

  [Fact]
  public async Task LiveReport_GateWithoutAuthor_RoutesHumanAuthorNotGated()
  {
    // A gate recorded before R18D (or from a report without a new-facts stratum) measured no author: fail closed.
    await LiveAsync(null, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-unbound");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
      Assert.Equal(("human", "AUTHOR_NOT_GATED"), ((string)(await DecisionAsync(e.DraftId))["state"]!, (string)(await DecisionAsync(e.DraftId))["reason"]!));
      Assert.Equal(0, await CardCountAsync(e.DeckId));
    });
  }

  [Fact]
  public async Task LiveReport_DraftWithoutAuthorConfigId_RoutesHumanAuthorNotGated()
  {
    await LiveAsync(AutomationTestKit.AuthorConfigId, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-noid");
      await _db.QueryAsync("update ai_drafts set agent = agent - 'authorConfigId' where id = $1", e.DraftId);
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "AUTHOR_NOT_GATED", "draft has no authorConfigId"), ((string)d["state"]!, (string)d["reason"]!, (string)d["reason_detail"]!));
    });
  }

  [Fact]
  public async Task LiveReport_DraftOfTheGatedAuthor_IsAutoAccepted()
  {
    await LiveAsync(AutomationTestKit.AuthorConfigId, async () =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-gated");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
      Assert.Equal("auto_accepted", (await DecisionAsync(e.DraftId))["state"]);
      Assert.Equal(1, await CardCountAsync(e.DeckId));
    });
  }

  [Fact]
  public async Task DryRunReport_RecordsWhetherTheAuthorMatchesTheGate()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var gateId = await AutomationTestKit.InsertGateAsync(_db, authorConfigId: "d01c0000000000000000000000000000000000000000000000000000000000c3");
    try
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-dryauthor");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
      Assert.Equal("would_accept", (await DecisionAsync(e.DraftId))["state"]);
      var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
      using var details = JsonDocument.Parse((string)ev["details"]!);
      Assert.False(details.RootElement.GetProperty("authorMatchesGate").GetBoolean());
      Assert.True(details.RootElement.GetProperty("reviewerMatchesGate").GetBoolean());
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  [Fact]
  public async Task Submit_AgentAuthorConfigId_IsStored_AndCappedAt128()
  {
    using var scope = new AutomationTestKit.Scope();
    var sub = AutomationTestKit.Sub("d01-agent");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "d01-agent");
    var auth = AutomationTestKit.Ctx(sub);
    var id = new string('a', 128);

    var ok = AutomationTestKit.Data(await AutomationTestKit.SubmitAsync(auth, deck.Id, new { name = "it-agent", authorConfigId = id },
      AutomationTestKit.Card(AutomationTestKit.Uid("d01-agent"))));
    var draftId = ok.GetProperty("created")[0].GetProperty("draftId").GetInt64();
    Assert.Equal(id, await _db.ScalarAsync("select agent ->> 'authorConfigId' from ai_drafts where id = $1", draftId));

    AutomationTestKit.AssertError(await AutomationTestKit.SubmitAsync(auth, deck.Id, new { authorConfigId = new string('a', 129) },
      AutomationTestKit.Card(AutomationTestKit.Uid("d01-long"))), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await AutomationTestKit.SubmitAsync(auth, deck.Id, new { authorConfigId = 7 },
      AutomationTestKit.Card(AutomationTestKit.Uid("d01-num"))), 400, "VALIDATION_ERROR");
  }

  // ---------------------------------------------------------------- M3 (automation-4): blindness is a reported fact

  private static string HumanActionDetails(List<Dictionary<string, object?>> events) =>
    (string)events.Single(ev => (string?)ev["reason"] == AutomationReasons.HumanAction)["details"]!;

  [Fact]
  public async Task HumanDecision_WithoutVerdictShown_IsNotBlind()
  {
    // Before R18D every decision on a dry-run would_accept was "blind" by construction, whatever the person saw.
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var owner = AutomationTestKit.Ctx(AutomationTestKit.Sub("d01-owner"), agent: false);
    var unknown = await AutomationTestKit.EligibleDraftAsync(_db, "d01-unknown");
    var seen = await AutomationTestKit.EligibleDraftAsync(_db, "d01-seen");
    foreach (var e in new[] { unknown, seen })
    {
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
      Assert.Equal("would_accept", (await DecisionAsync(e.DraftId))["state"]);
    }

    AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(unknown.DraftId, owner));
    AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(seen.DraftId, owner, new { verdictShown = true }));

    var unknownDetails = HumanActionDetails(await AutomationTestKit.EventsAsync(_db, unknown.DraftId));
    Assert.Contains("\"blinded\": false", unknownDetails);
    Assert.Contains("\"verdictShown\": null", unknownDetails);
    Assert.Contains("\"blinded\": false", HumanActionDetails(await AutomationTestKit.EventsAsync(_db, seen.DraftId)));
  }

  [Fact]
  public async Task HumanDecision_RejectWithVerdictShownFalse_IsBlind()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var owner = AutomationTestKit.Ctx(AutomationTestKit.Sub("d01-owner-r"), agent: false);
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-blind-reject");
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

    AutomationTestKit.Data(await AutomationTestKit.RejectAsync(e.DraftId, owner, body: new { reason = "ambiguous", verdictShown = false }));
    var details = HumanActionDetails(await AutomationTestKit.EventsAsync(_db, e.DraftId));
    Assert.Contains("\"blinded\": true", details);
    Assert.Contains("\"verdictShown\": false", details);
  }

  [Fact]
  public async Task Decide_VerdictShownNotABoolean_Returns400()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var owner = AutomationTestKit.Ctx(AutomationTestKit.Sub("d01-owner-v"), agent: false);
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "d01-verdict-type");

    AutomationTestKit.AssertError(await AutomationTestKit.AcceptAsync(e.DraftId, owner, new { verdictShown = "no" }), 400, "VALIDATION_ERROR",
      "verdictShown must be a boolean");
    AutomationTestKit.AssertError(await AutomationTestKit.RejectAsync(e.DraftId, owner, body: new { reason = "incorrect", verdictShown = 0 }), 400,
      "VALIDATION_ERROR", "verdictShown must be a boolean");
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
  }
}
