using System.Globalization;
using System.Text.Json;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Draft-QA reports (R18A A03, contract A00 §5.4–§5.6, §9.4, §13, §14) through <c>POST /api/internal/ai-qa/results</c>
/// against the shared Postgres: the <c>target</c> dispatch before the run lookup, every step of the report → decision
/// ladder, the live auto-accept with its QA mirror, and the after-commit ledger rows and webhook. The ai-qa Lambda is
/// contract-only here: each test signs the §9.4 report body itself with the fake <c>test-secret</c>. A test that
/// inserts a passed eval gate revokes it in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DraftQaResultsTests
{
  private readonly PostgresFixture _db;
  public DraftQaResultsTests(PostgresFixture db) => _db = db;

  private async Task<Dictionary<string, object?>> DecisionAsync(long draftId) => (await AutomationTestKit.DecisionAsync(_db, draftId))!;

  private async Task<long> CardCountAsync(long deckId) =>
    await AutomationTestKit.CountAsync(_db, "select count(*) from cards where deck_id = $1", deckId);

  private async Task<long> LedgerCountAsync(string dedupeKey) =>
    await AutomationTestKit.CountAsync(_db, "select count(*) from automation_events where dedupe_key = $1", dedupeKey);

  /// <summary>Runs <paramref name="body"/> in live mode with a passed gate for the automation reviewer.</summary>
  private async Task LiveAsync(Func<AutomationTestKit.Scope, long, Task> body, string gateModel = AutomationTestKit.ReviewerModel)
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Live);
    var gateId = await AutomationTestKit.InsertGateAsync(_db, model: gateModel);
    try
    {
      await body(scope, gateId);
    }
    finally
    {
      await AutomationTestKit.RevokeGateAsync(_db, gateId);
    }
  }

  // ---------------------------------------------------------------- dispatch

  [Fact]
  public async Task Report_TargetDraft_IsDispatchedBeforeTheRunLookup()
  {
    using var scope = new AutomationTestKit.Scope();
    var unknownJob = Guid.NewGuid();

    // No ai_qa_runs row carries this id: the card path answers 404, the draft path never looks.
    var cardPath = await AutomationTestKit.PostReportAsync(new { v = 1, runId = unknownJob, chunk = 0, items = Array.Empty<object>() });
    AutomationTestKit.AssertError(cardPath, 404, "RUN_NOT_FOUND");
    var explicitCard = await AutomationTestKit.PostReportAsync(new { v = 1, runId = unknownJob, chunk = 0, target = "card", items = Array.Empty<object>() });
    AutomationTestKit.AssertError(explicitCard, 404, "RUN_NOT_FOUND");

    var empty = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(new { v = 1, runId = unknownJob, chunk = 0, target = "draft", items = Array.Empty<object>() }));
    Assert.Equal(["runId", "runStatus", "cardsDone", "cardCount"], empty.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(unknownJob, empty.GetProperty("runId").GetGuid());
    Assert.Equal("done", empty.GetProperty("runStatus").GetString());
    Assert.Equal(0, empty.GetProperty("cardsDone").GetInt32());
    Assert.Equal(0, empty.GetProperty("cardCount").GetInt32());

    var e = await AutomationTestKit.EligibleDraftAsync(_db, "dispatch");
    Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from ai_qa_runs where id = $1", e.JobId));
    var applied = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
    Assert.Equal(1, applied.GetProperty("cardsDone").GetInt32());
    Assert.Equal(1, applied.GetProperty("cardCount").GetInt32());
    Assert.Equal("would_accept", (await DecisionAsync(e.DraftId))["state"]);
  }

  [Fact]
  public async Task Report_UnknownTarget_Returns400ValidationError()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "badtarget");

    AutomationTestKit.AssertError(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, target: "deck")),
      400, "VALIDATION_ERROR", "target must be card or draft");
    var numeric = AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash);
    numeric["target"] = 2;
    AutomationTestKit.AssertError(await AutomationTestKit.PostReportAsync(numeric), 400, "VALIDATION_ERROR");
    Assert.Equal("qa_queued", (await DecisionAsync(e.DraftId))["state"]);
  }

  [Fact]
  public async Task Report_UnknownDraftItem_IsIgnored()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "unknownitem");
    var other = await AutomationTestKit.EligibleDraftAsync(_db, "unknownitem-b");

    // The right job with another draft's id, and another draft's id under this job: neither names a decision.
    var wrongDraft = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, other.DraftId, other.Hash)));
    var wrongJob = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(Guid.NewGuid(), e.DraftId, e.Hash)));

    Assert.Equal(0, wrongDraft.GetProperty("cardsDone").GetInt32());
    Assert.Equal(1, wrongDraft.GetProperty("cardCount").GetInt32());
    Assert.Equal(0, wrongJob.GetProperty("cardsDone").GetInt32());
    Assert.Equal("qa_queued", (await DecisionAsync(e.DraftId))["state"]);
    Assert.Equal("qa_queued", (await DecisionAsync(other.DraftId))["state"]);
    Assert.Null((await DecisionAsync(e.DraftId))["qa_status"]);
  }

  // ---------------------------------------------------------------- dry run

  [Fact]
  public async Task Report_DryRunPass_IsWouldAccept_AndWritesNoCard()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "dry");

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, requestId: "req-dry")));

    var d = await DecisionAsync(e.DraftId);
    Assert.Equal("would_accept", d["state"]);
    Assert.Null(d["reason"]);
    Assert.NotNull(d["decided_at"]);
    Assert.Null(d["accepted_card_id"]);
    Assert.Equal("done", d["qa_status"]);
    Assert.Equal(AutomationTestKit.ReviewerProvider, d["qa_provider"]);
    Assert.Equal("req-dry", d["qa_request_id"]);
    Assert.Equal(1200L, AutomationTestKit.Long(d["input_tokens"]));
    Assert.Equal(0.0001m, Convert.ToDecimal(d["estimated_cost_usd"], CultureInfo.InvariantCulture));

    Assert.Equal(0, await CardCountAsync(e.DeckId));
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
    Assert.Equal(0, await LedgerCountAsync($"draft-qa:{e.JobId}"));
    Assert.Equal(0, await LedgerCountAsync($"auto-accept:{e.DraftId}"));
    Assert.Empty(scope.WebhookSent);

    var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
    Assert.Equal(("qa_queued", "would_accept"), ((string)ev["from_state"]!, (string)ev["to_state"]!));
    using var details = JsonDocument.Parse((string)ev["details"]!);
    Assert.Equal("missing", details.RootElement.GetProperty("gate").GetString());
    Assert.False(details.RootElement.GetProperty("reviewerMatchesGate").GetBoolean());
  }

  [Fact]
  public async Task Report_MinorOnly_DoesNotRoute()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "minor");

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash,
      findings: [AutomationTestKit.Finding("minor", "weak_distractor"), AutomationTestKit.Finding("minor", "other", "Second synthetic finding.")])));

    var d = await DecisionAsync(e.DraftId);
    Assert.Equal("would_accept", d["state"]);
    Assert.Equal(2, Convert.ToInt32(d["minor_count"], CultureInfo.InvariantCulture));
    Assert.Equal(0, Convert.ToInt32(d["blocker_count"], CultureInfo.InvariantCulture));
    Assert.Equal(2, await AutomationTestKit.CountAsync(_db, "select count(*) from automation_draft_findings where draft_id = $1", e.DraftId));
  }

  // ---------------------------------------------------------------- routed to a human

  [Theory]
  [InlineData("blocker")]
  [InlineData("major")]
  public async Task Report_BlockerOrMajor_RoutesHumanQaFlagged(string severity)
  {
    await LiveAsync(async (scope, _) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "flag");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash,
        findings: [AutomationTestKit.Finding(severity, "incorrect_answer"), AutomationTestKit.Finding("minor")])));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "QA_FLAGGED"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.Equal(1, Convert.ToInt32(d[$"{severity}_count"], CultureInfo.InvariantCulture));
      var findings = await _db.QueryAsync("select severity, category, qa_job_id from automation_draft_findings where draft_id = $1 order by id", e.DraftId);
      Assert.Equal([severity, "minor"], findings.Select(f => (string)f["severity"]!).ToArray());
      Assert.All(findings, f => Assert.Equal(e.JobId, f["qa_job_id"]));
      Assert.Equal(0, await CardCountAsync(e.DeckId));

      // Live: the route row (success: the automation routed as designed) and the QA review row.
      var route = (await _db.QueryAsync("select outcome, units from automation_events where dedupe_key = $1", $"auto-route:{e.DraftId}")).Single();
      Assert.Equal(("success", 0), ((string)route["outcome"]!, Convert.ToInt32(route["units"], CultureInfo.InvariantCulture)));
      Assert.Equal(1, await LedgerCountAsync($"draft-qa:{e.JobId}"));
    });
  }

  [Fact]
  public async Task Report_ItemError_RoutesHumanQaError()
  {
    await LiveAsync(async (scope, _) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "error");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash,
        status: "error", errorCode: "PROVIDER_ACCESS_DENIED")));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "QA_ERROR", "PROVIDER_ACCESS_DENIED"), ((string)d["state"]!, (string)d["reason"]!, (string)d["reason_detail"]!));
      Assert.Equal("error", d["qa_status"]);
      Assert.Equal("PROVIDER_ACCESS_DENIED", d["qa_error_code"]);
      Assert.Equal(0, await CardCountAsync(e.DeckId));
      var route = (await _db.QueryAsync("select outcome, details::text as details from automation_events where dedupe_key = $1", $"auto-route:{e.DraftId}")).Single();
      Assert.Equal("failure", route["outcome"]);
      Assert.Contains("PROVIDER_ACCESS_DENIED", (string)route["details"]!);
      // No review happened, so no ai_qa_review row.
      Assert.Equal(0, await LedgerCountAsync($"draft-qa:{e.JobId}"));
    });
  }

  [Fact]
  public async Task Report_HashMismatch_RoutesHumanQaHashMismatch()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "hash");

    var stdout = await EmfCapture.StdoutAsync(async () =>
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, new string('0', 64)))));

    var d = await DecisionAsync(e.DraftId);
    Assert.Equal(("human", "QA_HASH_MISMATCH"), ((string)d["state"]!, (string)d["reason"]!));
    Assert.Equal(1, EmfCapture.GaugeSum(stdout, "AiQaHashMismatch"));
  }

  [Fact]
  public async Task Report_ReviewerNotGated_RoutesHuman()
  {
    await LiveAsync(async (scope, _) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "gate");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, model: "some-other-model")));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "REVIEWER_NOT_GATED"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.Equal(0, await CardCountAsync(e.DeckId));
      Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
    });
  }

  [Fact]
  public async Task Report_ModeOff_RoutesHumanModeOff()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "off");
    scope.Set(AutomationMode.EnvName, AutomationMode.Off);

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

    var d = await DecisionAsync(e.DraftId);
    Assert.Equal(("human", "MODE_OFF"), ((string)d["state"]!, (string)d["reason"]!));
    Assert.Equal("off", (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1]["mode"]);
  }

  [Fact]
  public async Task Report_DraftDecidedByHuman_IsSuperseded()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "decided");
    // Decided without the human hook (as if the hook had failed): the report still never overrides the human.
    await _db.QueryAsync("update ai_drafts set status = 'rejected', decided_at = now(), decided_by_sub = 'it-a03-human' where id = $1", e.DraftId);

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

    var d = await DecisionAsync(e.DraftId);
    Assert.Equal(("superseded", "DECIDED_BY_HUMAN"), ((string)d["state"]!, (string)d["reason"]!));
    Assert.Equal("rejected", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
  }

  [Fact]
  public async Task Report_Replay_IsNoOp()
  {
    await LiveAsync(async (scope, _) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "replay");
      var report = AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, findings: [AutomationTestKit.Finding("minor")], requestId: "req-replay");

      var first = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(report));
      var events = (await AutomationTestKit.EventsAsync(_db, e.DraftId)).Count;
      var before = await DecisionAsync(e.DraftId);
      var second = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(report));

      Assert.Equal(1, first.GetProperty("cardsDone").GetInt32());
      Assert.Equal(0, second.GetProperty("cardsDone").GetInt32());
      var after = await DecisionAsync(e.DraftId);
      Assert.Equal("auto_accepted", after["state"]);
      Assert.Equal(before["updated_at"], after["updated_at"]);
      Assert.Equal(before["estimated_cost_usd"], after["estimated_cost_usd"]);
      Assert.Equal(events, (await AutomationTestKit.EventsAsync(_db, e.DraftId)).Count);
      Assert.Equal(1, await CardCountAsync(e.DeckId));
      Assert.Equal(1, await AutomationTestKit.CountAsync(_db, "select count(*) from automation_draft_findings where draft_id = $1", e.DraftId));
      Assert.Equal(1, await LedgerCountAsync($"auto-accept:{e.DraftId}"));
    });
  }

  [Fact]
  public async Task Report_DryRun_TwoNearIdenticalDraftsInOneBatch_SecondIsLikelyDuplicate()
  {
    // automation-6: live accepts the first draft as a card, then its at-accept check routes the second as a likely
    // duplicate; dry run must record the same, not two would_accept.
    using var scope = new AutomationTestKit.Scope();
    var sub = AutomationTestKit.Sub("drydup");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "drydup");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);
    var firstUid = AutomationTestKit.Uid("drydup-a");
    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId,
      AutomationTestKit.Card(firstUid, "Which synthetic harbour crane lifts the heaviest containers at night?"),
      AutomationTestKit.Card(AutomationTestKit.Uid("drydup-b"), "Which synthetic harbour crane lifts the heaviest containers at night time?"));
    var first = await AutomationTestKit.QueuedJobAsync(_db, ids[0]);
    var second = await AutomationTestKit.QueuedJobAsync(_db, ids[1]);

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(first.JobId, ids[0], first.Hash)));
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(second.JobId, ids[1], second.Hash)));

    Assert.Equal("would_accept", (await DecisionAsync(ids[0]))["state"]);
    var d = await DecisionAsync(ids[1]);
    Assert.Equal(("human", "LIKELY_DUPLICATE", $"at accept: {firstUid}"), ((string)d["state"]!, (string)d["reason"]!, (string)d["reason_detail"]!));
    var ev = (await AutomationTestKit.EventsAsync(_db, ids[1]))[^1];
    Assert.Equal(("qa_queued", "human", "dry_run"), ((string)ev["from_state"]!, (string)ev["to_state"]!, (string)ev["mode"]!));
    using (var details = JsonDocument.Parse((string)ev["details"]!))
    {
      Assert.Equal("at_accept", details.RootElement.GetProperty("check").GetString());
    }
    Assert.Equal(0, await CardCountAsync(deck.Id));
  }

  [Fact]
  public async Task Report_DryRun_StableUidTakenSinceSubmit_IsExistingCard()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "dryexisting");
    await AutomationTestKit.NewCardAsync(_db, e.DeckId, e.Uid, "A synthetic card a person accepted meanwhile about lighthouses?");

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

    var d = await DecisionAsync(e.DraftId);
    Assert.Equal(("human", "EXISTING_CARD"), ((string)d["state"]!, (string)d["reason"]!));
  }

  // ---------------------------------------------------------------- spend (R18B backend-design-4)

  private async Task<decimal> SpentTodayAsync()
  {
    await using var conn = await _db.OpenAsync();
    return (await QaRuns.SpendTodayAsync(conn, null)).Spent;
  }

  [Fact]
  public async Task Report_AfterQaTimeout_StillReachesTheDailyCap_WithoutATransition()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "latespend");
    // The tick timed the decision out (A00 §9.3): its reservation is gone, the Bedrock call is still running.
    await _db.QueryAsync(
      "update automation_draft_decisions set state = 'human', reason = 'QA_TIMEOUT', decided_at = now() where draft_id = $1", e.DraftId);
    var events = (await AutomationTestKit.EventsAsync(_db, e.DraftId)).Count;
    var before = await SpentTodayAsync();
    var report = AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, requestId: "req-late");

    var applied = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(report));
    Assert.Equal(0, applied.GetProperty("cardsDone").GetInt32());
    Assert.Equal(before + 0.0001m, await SpentTodayAsync());
    var d = await DecisionAsync(e.DraftId);
    Assert.Equal(("human", "QA_TIMEOUT"), ((string)d["state"]!, (string)d["reason"]!));
    Assert.Equal(0.0001m, Convert.ToDecimal(d["estimated_cost_usd"], CultureInfo.InvariantCulture));
    Assert.Equal(1200L, AutomationTestKit.Long(d["input_tokens"]));
    Assert.Null(d["qa_status"]);
    Assert.Equal(events, (await AutomationTestKit.EventsAsync(_db, e.DraftId)).Count);

    // A replay of the same attempt adds nothing; another attempt of the same job (a new request id) adds.
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(report));
    Assert.Equal(before + 0.0001m, await SpentTodayAsync());
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, requestId: "req-late-2")));
    Assert.Equal(before + 0.0002m, await SpentTodayAsync());
    Assert.Equal(0.0002m, Convert.ToDecimal((await DecisionAsync(e.DraftId))["estimated_cost_usd"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Report_OfAReleasedJobReplacedByAFreshOne_StillReachesTheDailyCap()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "releasedspend");
    // An ambiguous send released the reservation (qa_queued -> qa_pending, A00 §9.2) and the tick re-sent a fresh job.
    await _db.QueryAsync(
      "update automation_draft_decisions set state = 'qa_pending', reason = 'ENQUEUE_RETRY', qa_enqueued_at = null where draft_id = $1", e.DraftId);
    await using (var conn = await _db.OpenAsync())
    {
      Assert.Equal("qa_queued", await DraftDecisions.EnqueueQaAsync(conn, e.DraftId));
    }
    var (freshJob, _) = await AutomationTestKit.QueuedJobAsync(_db, e.DraftId);
    Assert.NotEqual(e.JobId, freshJob);
    var before = await SpentTodayAsync();

    // The first job's report arrives after all: its spend counts, the fresh job stays in flight.
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, requestId: "req-old")));
    Assert.Equal(before + 0.0001m, await SpentTodayAsync());
    Assert.Equal(("qa_queued", freshJob), ((string)(await DecisionAsync(e.DraftId))["state"]!, (Guid)(await DecisionAsync(e.DraftId))["qa_job_id"]!));

    // The fresh job reports as usual; both attempts are on the decision and in today's spend.
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(freshJob, e.DraftId, e.Hash, requestId: "req-new")));
    var d = await DecisionAsync(e.DraftId);
    Assert.Equal("would_accept", d["state"]);
    Assert.Equal(0.0002m, Convert.ToDecimal(d["estimated_cost_usd"], CultureInfo.InvariantCulture));
    Assert.Equal(before + 0.0002m, await SpentTodayAsync());
  }

  [Fact]
  public async Task Report_SpendIsDatedWhenReported_NotWhenTheDecisionWasCreated()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "spenddate");
    // Submitted at 23:59 UTC yesterday, reviewed today: the money was spent today.
    await _db.QueryAsync("update automation_draft_decisions set created_at = now() - interval '2 days' where draft_id = $1", e.DraftId);
    var before = await SpentTodayAsync();

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

    Assert.Equal("would_accept", (await DecisionAsync(e.DraftId))["state"]);
    Assert.Equal(before + 0.0001m, await SpentTodayAsync());
  }

  // ---------------------------------------------------------------- live auto-accept (A00 §5.5–§5.6)

  [Fact]
  public async Task Report_LivePass_AutoAcceptsTheCard()
  {
    await LiveAsync(async (scope, gateId) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "live");
      Assert.Equal("live", (await DecisionAsync(e.DraftId))["mode"]);
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal("auto_accepted", d["state"]);
      Assert.Null(d["reason"]);
      Assert.NotNull(d["decided_at"]);
      Assert.Equal(gateId, AutomationTestKit.Long(d["gate_id"]));
      Assert.Equal(e.Hash, d["accepted_content_sha256"]);
      var cardId = AutomationTestKit.Long(d["accepted_card_id"]);

      var card = (await _db.QueryAsync("select deck_id, stable_uid, revision, is_deleted, source::text as source from cards where id = $1", cardId)).Single();
      Assert.Equal(e.DeckId, AutomationTestKit.Long(card["deck_id"]));
      Assert.Equal(e.Uid, card["stable_uid"]);
      Assert.Equal(1, Convert.ToInt32(card["revision"], CultureInfo.InvariantCulture));
      Assert.DoesNotContain("grounding", (string)card["source"]!);

      var draft = (await _db.QueryAsync("select status, decided_by_sub, accepted_card_id from ai_drafts where id = $1", e.DraftId)).Single();
      Assert.Equal(("accepted", "automation", cardId), ((string)draft["status"]!, (string)draft["decided_by_sub"]!, AutomationTestKit.Long(draft["accepted_card_id"])));
      var review = (await _db.QueryAsync("select action, actor_sub from ai_review_events where draft_id = $1 order by id desc limit 1", e.DraftId)).Single();
      Assert.Equal(("accepted", "automation"), ((string)review["action"]!, (string)review["actor_sub"]!));

      var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
      Assert.Equal(("qa_queued", "auto_accepted", "automation", "live"),
        ((string)ev["from_state"]!, (string)ev["to_state"]!, (string)ev["actor"]!, (string)ev["mode"]!));
    });
  }

  [Fact]
  public async Task Report_LivePass_MirrorsQaSoTheGateSeesItReviewed()
  {
    await LiveAsync(async (scope, _) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "mirror");
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash,
        findings: [AutomationTestKit.Finding("minor", "weak_distractor", "Synthetic minor to mirror.")], requestId: "req-mirror")));
      var cardId = AutomationTestKit.Long((await DecisionAsync(e.DraftId))["accepted_card_id"]);

      // The card's hash, read the way the gate reads it, is the hash the draft was reviewed at.
      var row = (await _db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", cardId)).Single();
      var hash = CardContentHash.Compute(row);
      Assert.Equal(e.Hash, hash);

      await using (var conn = await _db.OpenAsync())
      {
        var reviewed = await QaGate.ReviewedCardIdsAsync(conn, [cardId], [hash]);
        Assert.Contains(cardId, reviewed);
      }

      var mirrorId = AutomationIds.Derived($"qa-mirror:{e.DraftId}");
      var run = (await _db.QueryAsync("select deck_id, scope, status, requested_by_sub, card_count, cards_done, minor_count, estimated_cost_usd, provider, model, prompt_version, finished_at from ai_qa_runs where id = $1", mirrorId)).Single();
      Assert.Equal(e.DeckId, AutomationTestKit.Long(run["deck_id"]));
      Assert.Equal(("cards", "done", "automation"), ((string)run["scope"]!, (string)run["status"]!, (string)run["requested_by_sub"]!));
      Assert.Equal((1, 1, 1), (Convert.ToInt32(run["card_count"], CultureInfo.InvariantCulture), Convert.ToInt32(run["cards_done"], CultureInfo.InvariantCulture),
        Convert.ToInt32(run["minor_count"], CultureInfo.InvariantCulture)));
      Assert.Equal(0m, Convert.ToDecimal(run["estimated_cost_usd"], CultureInfo.InvariantCulture));
      Assert.Equal((AutomationTestKit.ReviewerProvider, AutomationTestKit.ReviewerModel, QaRuns.AutomationPromptVersion),
        ((string)run["provider"]!, (string)run["model"]!, (string)run["prompt_version"]!));
      Assert.NotNull(run["finished_at"]);

      var item = (await _db.QueryAsync("select status, content_sha256, request_id, prompt_version from ai_qa_items where run_id = $1 and card_id = $2", mirrorId, cardId)).Single();
      Assert.Equal(("done", hash, "req-mirror", QaRuns.AutomationPromptVersion),
        ((string)item["status"]!, (string)item["content_sha256"]!, (string)item["request_id"]!, (string)item["prompt_version"]!));
      var finding = (await _db.QueryAsync("select severity, category, resolution, content_sha256 from ai_qa_findings where run_id = $1", mirrorId)).Single();
      Assert.Equal(("minor", "weak_distractor", "open", hash),
        ((string)finding["severity"]!, (string)finding["category"]!, (string)finding["resolution"]!, (string)finding["content_sha256"]!));

      // AutomationIds.Derived is the DerivedEventId algorithm with its own prefix: a version-8, RFC-variant uuid.
      var text = mirrorId.ToString("N");
      Assert.Equal('8', text[12]);
      Assert.Contains(text[16], "89ab");
      Assert.Equal(mirrorId, AutomationIds.Derived($"qa-mirror:{e.DraftId}"));
      Assert.NotEqual(WebhookEvents.DerivedEventId($"qa-mirror:{e.DraftId}"), mirrorId);
    });
  }

  [Fact]
  public async Task Report_UidTakenSinceSubmit_RoutesHumanExistingCard()
  {
    await LiveAsync(async (scope, _) =>
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, "uid");
      // A deleted card takes the uid after the submit: automation never re-accepts over any existing card.
      var taken = await AutomationTestKit.NewCardAsync(_db, e.DeckId, e.Uid, "An unrelated synthetic prompt about lighthouses", isDeleted: 1);

      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      var d = await DecisionAsync(e.DraftId);
      Assert.Equal(("human", "EXISTING_CARD"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.Null(d["accepted_card_id"]);
      Assert.Equal(1, await CardCountAsync(e.DeckId));
      Assert.Equal(taken, AutomationTestKit.Long(await _db.ScalarAsync("select id from cards where deck_id = $1", e.DeckId)));
      Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
      Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from ai_qa_runs where id = $1", AutomationIds.Derived($"qa-mirror:{e.DraftId}")));
      Assert.Equal(1, await LedgerCountAsync($"auto-route:{e.DraftId}"));
    });
  }

  [Fact]
  public async Task Report_NearDuplicateInBatch_RoutesHumanLikelyDuplicate()
  {
    await LiveAsync(async (scope, _) =>
    {
      var sub = AutomationTestKit.Sub("dup");
      var deck = await AutomationTestKit.NewDeckAsync(_db, "dup");
      var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);
      var uidA = AutomationTestKit.Uid("dup-a");
      var uidB = AutomationTestKit.Uid("dup-b");
      var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId,
        AutomationTestKit.Card(uidA, "Which synthetic queue service buffers a burst of writes for slow consumers?"),
        AutomationTestKit.Card(uidB, "Which synthetic queue service buffers a burst of writes for the slow consumers?"));
      var a = await AutomationTestKit.QueuedJobAsync(_db, ids[0]);
      var b = await AutomationTestKit.QueuedJobAsync(_db, ids[1]);

      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(a.JobId, ids[0], a.Hash)));
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(b.JobId, ids[1], b.Hash)));

      Assert.Equal("auto_accepted", (await DecisionAsync(ids[0]))["state"]);
      var d = await DecisionAsync(ids[1]);
      Assert.Equal(("human", "LIKELY_DUPLICATE", $"at accept: {uidA}"), ((string)d["state"]!, (string)d["reason"]!, (string)d["reason_detail"]!));
      Assert.Equal(1, await CardCountAsync(deck.Id));
      Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from cards where deck_id = $1 and stable_uid = $2", deck.Id, uidB));
      Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", ids[1]));
    });
  }

  [Fact]
  public async Task Report_LiveAccept_WritesLedgerRowsAndWebhook()
  {
    await LiveAsync(async (scope, _) =>
    {
      scope.Set(RecallSmith.Lambda.Db.WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
      var subscriptionId = AutomationTestKit.Long(await _db.ScalarAsync(
        "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, true) returning id",
        $"it-a03-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-a03/{Guid.NewGuid():N}", new[] { "draft.auto_accepted" }));
      try
      {
        var e = await AutomationTestKit.EligibleDraftAsync(_db, "ledger");
        AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash,
          findings: [AutomationTestKit.Finding("minor")])));
        var cardId = AutomationTestKit.Long((await DecisionAsync(e.DraftId))["accepted_card_id"]);

        var autoAccept = (await _db.QueryAsync("select automation, units, outcome, deck_id, ref, details::text as details from automation_events where dedupe_key = $1",
          $"auto-accept:{e.DraftId}")).Single();
        Assert.Equal(("auto_accept", 1, "success", e.DeckId, e.DraftId.ToString(CultureInfo.InvariantCulture)),
          ((string)autoAccept["automation"]!, Convert.ToInt32(autoAccept["units"], CultureInfo.InvariantCulture), (string)autoAccept["outcome"]!,
           AutomationTestKit.Long(autoAccept["deck_id"]), (string)autoAccept["ref"]!));
        using (var details = JsonDocument.Parse((string)autoAccept["details"]!))
        {
          Assert.Equal(e.RunId, details.RootElement.GetProperty("runId").GetGuid());
          Assert.Equal(0.0001m, details.RootElement.GetProperty("qaCostUsd").GetDecimal());
          Assert.Equal(AutomationTestKit.ReviewerModel, details.RootElement.GetProperty("model").GetString());
        }

        var review = (await _db.QueryAsync("select automation, units, outcome, actual_minutes, details::text as details from automation_events where dedupe_key = $1",
          $"draft-accept:{e.DraftId}")).Single();
        Assert.Equal(("ai_draft_review", 1, "success"), ((string)review["automation"]!, Convert.ToInt32(review["units"], CultureInfo.InvariantCulture), (string)review["outcome"]!));
        // R18C automation-14: nets the auto_accept baseline (the avoided review), like a human accept nets its review time.
        Assert.Equal(await _db.ScalarAsync("select baseline_minutes_per_unit from automation_baselines where automation = 'auto_accept'"),
          review["actual_minutes"]);
        Assert.Contains("\"automated\": true", (string)review["details"]!);

        var qa = (await _db.QueryAsync("select automation, units, outcome, details::text as details from automation_events where dedupe_key = $1",
          $"draft-qa:{e.JobId}")).Single();
        Assert.Equal(("ai_qa_review", 1, "success"), ((string)qa["automation"]!, Convert.ToInt32(qa["units"], CultureInfo.InvariantCulture), (string)qa["outcome"]!));
        Assert.Contains(e.DraftId.ToString(CultureInfo.InvariantCulture), (string)qa["details"]!);
        Assert.Equal(0, await LedgerCountAsync($"auto-route:{e.DraftId}"));

        var delivery = (await _db.QueryAsync("select body from webhook_deliveries where subscription_id = $1 and event = 'draft.auto_accepted'", subscriptionId)).Single();
        using var doc = JsonDocument.Parse((string)delivery["body"]!);
        var data = doc.RootElement.GetProperty("data");
        Assert.Equal(["deckId", "deckSlug", "draftId", "cardId", "stableUid", "runId", "qa", "consoleUrl"], data.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(e.DeckId, data.GetProperty("deckId").GetInt64());
        Assert.Equal(e.DeckSlug, data.GetProperty("deckSlug").GetString());
        Assert.Equal(e.DraftId, data.GetProperty("draftId").GetInt64());
        Assert.Equal(cardId, data.GetProperty("cardId").GetInt64());
        Assert.Equal(e.Uid, data.GetProperty("stableUid").GetString());
        Assert.Equal(e.RunId, data.GetProperty("runId").GetGuid());
        var qaBlock = data.GetProperty("qa");
        Assert.Equal(["provider", "model", "promptVersion", "minor"], qaBlock.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(1, qaBlock.GetProperty("minor").GetInt32());
        Assert.Equal($"https://console.example.com/automation?draftId={e.DraftId}", data.GetProperty("consoleUrl").GetString());
        Assert.Contains(scope.WebhookSent, r => r.QueueUrl == AutomationTestKit.FakeWebhookQueueUrl);
      }
      finally
      {
        await _db.QueryAsync("update webhook_subscriptions set is_active = false where id = $1", subscriptionId);
      }
    });
  }
}
