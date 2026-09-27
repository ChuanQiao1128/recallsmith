using System.Globalization;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R18C C02 (automation fix round 2b) against the shared Postgres: the mode a decision records is the mode its deciding
/// transaction applied (backend-design-16), a human decision records whether the verdict was hidden (automation-4),
/// an auto-accepted card is credited the avoided review once (automation-14), and after a rollback (live → dry_run)
/// the cards accepted in live keep a live label, a truthful reason and their place in the backlog (automation-12).
/// Every gate a test inserts is revoked in <c>finally</c> or by the scope.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationRound2bTests
{
  private readonly PostgresFixture _db;
  private readonly A04Kit.Sql _sql;

  public AutomationRound2bTests(PostgresFixture db)
  {
    _db = db;
    _sql = new A04Kit.Sql(db.ConnectionString);
  }

  private async Task<Dictionary<string, object?>> DecisionAsync(long draftId) => (await AutomationTestKit.DecisionAsync(_db, draftId))!;

  // ---------------------------------------------------------------- backend-design-16: the mode of the deciding transaction

  [Fact]
  public async Task Report_DryRunSubmit_DecidedUnderLive_RecordsLiveMode()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "c02-mode-live");
    Assert.Equal("dry_run", (await DecisionAsync(e.DraftId))["mode"]);

    var gateId = await AutomationTestKit.InsertGateAsync(_db);
    try
    {
      scope.Set(AutomationMode.EnvName, AutomationMode.Live);
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("auto_accepted", "live"), ((string)d["state"]!, (string)d["mode"]!));
      Assert.Equal(1, await AutomationTestKit.CountAsync(_db, "select count(*) from automation_events where dedupe_key = $1", $"auto-accept:{e.DraftId}"));
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  [Fact]
  public async Task Report_LiveSubmit_DecidedAfterRevoke_RecordsDryRunMode()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Live);
    var gateId = await AutomationTestKit.InsertGateAsync(_db);
    try
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "c02-mode-dry");
      Assert.Equal("live", (await DecisionAsync(e.DraftId))["mode"]);

      // The emergency stop: the draft is decided in dry_run, so it is a would_accept with the dry_run label (which the
      // review queue blinds), not a live decision that accepted nothing.
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("would_accept", "dry_run"), ((string)d["state"]!, (string)d["mode"]!));
      Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from automation_events where ref = $1",
        e.DraftId.ToString(CultureInfo.InvariantCulture)));
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  // ---------------------------------------------------------------- automation-4: blind human decisions

  [Fact]
  public async Task HumanDecision_OnHiddenWouldAccept_IsRecordedBlind()
  {
    // R18D M3 (automation-4) changed the rule this test pins: blindness is what the console reports in verdictShown,
    // no longer inferred from the state (which made every would_accept decision "blind" whatever the person saw).
    using var scope = new AutomationTestKit.Scope(AutomationMode.DryRun);
    var would = await AutomationTestKit.EligibleDraftAsync(_db, "c02-blind");
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(would.JobId, would.DraftId, would.Hash)));
    Assert.Equal("would_accept", (await DecisionAsync(would.DraftId))["state"]);
    var flagged = await AutomationTestKit.EligibleDraftAsync(_db, "c02-seen");
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(flagged.JobId, flagged.DraftId, flagged.Hash,
      findings: [AutomationTestKit.Finding("major")])));
    Assert.Equal("human", (await DecisionAsync(flagged.DraftId))["state"]);

    var owner = AutomationTestKit.Ctx(AutomationTestKit.Sub("c02-owner"), agent: false);
    AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(would.DraftId, owner, new { verdictShown = false }));
    AutomationTestKit.Data(await AutomationTestKit.RejectAsync(flagged.DraftId, owner, body: new { reason = "incorrect", verdictShown = true }));

    static string Details(List<Dictionary<string, object?>> events) =>
      (string)events.Single(ev => (string?)ev["reason"] == AutomationReasons.HumanAction)["details"]!;
    var blind = Details(await AutomationTestKit.EventsAsync(_db, would.DraftId));
    Assert.Contains("\"blinded\": true", blind);
    Assert.Contains("\"verdictShown\": false", blind);
    // A human-routed draft shows its reason in the review queue: its decision was not blind.
    var seen = Details(await AutomationTestKit.EventsAsync(_db, flagged.DraftId));
    Assert.Contains("\"blinded\": false", seen);
    Assert.Contains("\"verdictShown\": true", seen);
  }

  // ---------------------------------------------------------------- automation-14: one credit for the avoided review

  [Fact]
  public async Task LiveAutoAccept_CreditsTheDraftReviewBaselineOnce()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Live);
    var gateId = await AutomationTestKit.InsertGateAsync(_db);
    try
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "c02-ledger");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
      Assert.Equal("auto_accepted", (await DecisionAsync(e.DraftId))["state"]);

      // The ledger's own formula (LedgerRoutes): units × baseline − actual, over the card's two authoring rows.
      var saved = await _db.ScalarAsync(
        """
        select sum(e.units * b.baseline_minutes_per_unit - coalesce(e.actual_minutes, 0))
        from automation_events e join automation_baselines b on b.automation = e.automation
        where e.dedupe_key in ($1, $2)
        """, $"auto-accept:{e.DraftId}", $"draft-accept:{e.DraftId}");
      var draftReviewBaseline = await _db.ScalarAsync("select baseline_minutes_per_unit from automation_baselines where automation = 'ai_draft_review'");
      Assert.Equal(Convert.ToDecimal(draftReviewBaseline, CultureInfo.InvariantCulture), Convert.ToDecimal(saved, CultureInfo.InvariantCulture));
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  // ---------------------------------------------------------------- automation-12 / backend-design-16: rollback labels

  private async Task<(A04Kit.Scope Scope, long GateId)> LiveScopeAsync()
  {
    var scope = new A04Kit.Scope(AutomationMode.Live);
    return (scope, await scope.GateAsync(_sql));
  }

  private async Task<AutoPublishOutcome?> EvaluateAsync(long deckId, Guid runId)
  {
    await using var conn = await _db.OpenAsync();
    return await AutoPublisher.EvaluateAsync(conn, deckId, runId);
  }

  private async Task<bool> InBacklogAsync(long publishId) =>
    await _sql.ScalarAsync($"select 1 from automation_publishes p where p.id = $1 and {StatusRoutes.OpenHumanPublishSql}", publishId) is not null;

  [Fact]
  public async Task Evaluate_AfterRevoke_LiveAcceptedCards_KeepLiveLabelAndTruthfulReason()
  {
    var (scope, gateId) = await LiveScopeAsync();
    await using var _ = scope;
    var sub = AutomationTestKit.Sub("c02-rollback");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "c02-rollback");
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic lever stops the automation at once?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);

    // The emergency stop before the deck is evaluated: effective mode is dry_run from now on.
    await _sql.QueryAsync("update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-c02' where id = $1", gateId);

    var outcome = await EvaluateAsync(deck.Id, runId);

    Assert.NotNull(outcome);
    Assert.Equal(("human", "AUTO_PUBLISH_DISABLED"), (outcome!.State, outcome.Reason));
    Assert.Equal($"live is not effective (gate revoked or missing); auto-accepted before rollback: {card.Uid}", outcome.ReasonDetail);
    Assert.DoesNotContain("changed by a human", outcome.ReasonDetail);
    var row = await A04Kit.PublishRowAsync(_sql, outcome.PublishId);
    Assert.Equal("live", row["mode"]);
    Assert.Empty(scope.PublishSent);
    Assert.True(await InBacklogAsync(outcome.PublishId));

    // The alert is a live one (the owner has cards to check and publish), not a "(dry run)" one.
    var subject = (string)(await _sql.ScalarAsync("select subject from automation_notifications where dedupe_key = $1",
      $"exception:publish_blocked:{outcome.PublishId}"))!;
    Assert.Equal($"[DeveloperCards] Action needed: publish {deck.Slug} (AUTO_PUBLISH_DISABLED)", subject);
  }

  [Fact]
  public async Task Evaluate_AfterRevoke_HumanChangeAndLiveAcceptedCard_AreToldApart()
  {
    var (scope, gateId) = await LiveScopeAsync();
    await using var _ = scope;
    var sub = AutomationTestKit.Sub("c02-mixed");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "c02-mixed");
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic flag marks a rolled back card?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);
    // A person edited the old card of the deck meanwhile.
    await _sql.QueryAsync("update cards set explanation = 'Edited by a person.', updated_at = now() where deck_id = $1 and stable_uid = $2", deck.Id, deck.OldUid);
    await _sql.QueryAsync("update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-c02' where id = $1", gateId);

    var outcome = await EvaluateAsync(deck.Id, runId);

    Assert.Equal(("human", "DECK_HAS_HUMAN_CHANGES"), (outcome!.State, outcome.Reason));
    Assert.Equal($"cards changed by a human: {deck.OldUid}; auto-accepted before rollback: {card.Uid}", outcome.ReasonDetail);
    Assert.Equal("live", (await A04Kit.PublishRowAsync(_sql, outcome.PublishId))["mode"]);
    Assert.True(await InBacklogAsync(outcome.PublishId));
  }

  [Fact]
  public void AcceptedBeforeRollback_ListsOnlyLiveUnchangedOwnedCards()
  {
    var owned = new Dictionary<long, string> { [1] = "h1", [2] = "h2", [3] = "h3" };
    var pending = new List<PendingCard>
    {
      new(1, "owned-unchanged", false, "h1"),
      new(2, "owned-edited", false, "h2-edited"),
      new(3, "owned-deleted", true, "h3"),
      new(4, "human", false, "h4"),
    };
    Assert.Equal(["owned-unchanged"], AutoPublisher.AcceptedBeforeRollback(pending, owned));
  }
}
