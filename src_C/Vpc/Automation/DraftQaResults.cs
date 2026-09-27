using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Internal;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

internal sealed record DraftQaApplyResult(int Applied, int Items);

/// <summary>
/// Draft-QA report → decision (R18A A03, contract A00 §5.4–§5.6). Each item is applied in its own transaction with the
/// lock order decision → draft → deck (the human path locks draft → deck and touches the decision only after its own
/// commit, so there is no cycle). A replayed report is a no-op (the <c>qa_queued</c> state guard). A live pass
/// auto-accepts the draft as a brand-new card and mirrors the review into the AI QA tables so the publish gate sees
/// the card reviewed; every other outcome routes the draft to a human with a reason. Ledger rows, the
/// <c>draft.auto_accepted</c> webhook and the exception hook run after each item's commit and are best-effort.
/// </summary>
internal static class DraftQaResults
{
  public static readonly IReadOnlyList<string> ProviderErrorCodes = ["PROVIDER_ACCESS_DENIED", "PROVIDER_AUTH", "CONFIG"];

  /// <summary>What one applied item ended as; <see cref="Mode"/> is the effective mode the transition was written under.</summary>
  private sealed record ItemOutcome(long DraftId, long DeckId, Guid RunId, string To, string? Reason, string? ReasonDetail,
    decimal QaCostUsd, long? CardId, string? StableUid, int Minor, string Mode);

  internal static async Task<DraftQaApplyResult> ApplyAsync(NpgsqlConnection conn, AiQaResults.Report report, CancellationToken ct = default)
  {
    var applied = 0;
    var runIds = new List<Guid>();
    foreach (var item in report.Items)
    {
      var outcome = await ApplyItemAsync(conn, report, item, ct);
      if (outcome is null) continue;
      applied++;
      if (!runIds.Contains(outcome.RunId)) runIds.Add(outcome.RunId);
      await AfterCommitAsync(conn, report, item, outcome, ct);
    }
    // Run finalisation (A00 §6.1) for every run this report touched; best-effort, never throws.
    foreach (var runId in runIds) await AutomationRuns.TryFinalizeAsync(conn, runId, ct);
    return new DraftQaApplyResult(applied, report.Items.Count);
  }

  /// <summary>Steps 0–10 of A00 §5.4 for one item; null when the item was ignored or replayed.</summary>
  private static async Task<ItemOutcome?> ApplyItemAsync(NpgsqlConnection conn, AiQaResults.Report report,
    AiQaResults.ReportItem item, CancellationToken ct)
  {
    await using var tx = await conn.BeginTransactionAsync(ct);
    var mode = await AutomationMode.EffectiveAsync(conn, ct);

    // 0. the decision this job was sent for
    var rows = await DbUtil.QueryAsync(conn, tx,
      """
      select state, run_id, deck_id, qa_content_sha256, qa_request_id
      from automation_draft_decisions
      where qa_job_id = $1 and draft_id = $2
      for update
      """,
      [report.RunId, item.CardId]);
    if (rows.Count == 0)
    {
      // A job released after an ambiguous send and since replaced by a fresh job id: the decision's event log names
      // it. Its Bedrock call was still paid for, so the spend is recorded (backend-design-4); nothing else changes.
      var released = await DbUtil.QueryAsync(conn, tx,
        """
        select d.draft_id from automation_draft_decisions d
        where d.draft_id = $2
          and exists (select 1 from automation_decision_events e where e.draft_id = d.draft_id and e.details ->> 'qaJobId' = $1::text)
        for update of d
        """,
        [report.RunId, item.CardId]);
      if (released.Count == 0)
      {
        Log.Event("warn", new { tag = "automation", reason = "draft_qa_unknown_item", qaJobId = report.RunId, draftId = item.CardId });
        return null;
      }
      await RecordSpendAsync(conn, tx, report.RunId, item, ct);
      await tx.CommitAsync(ct);
      Log.Event("info", new { tag = "automation", reason = "draft_qa_late_spend", qaJobId = report.RunId, draftId = item.CardId });
      return null;
    }
    var decision = rows[0];

    // 1. a replay, or a report that arrived after the decision moved on (QA_TIMEOUT, a released send, a human): no
    // transition, but its spend reaches the shared daily cap (backend-design-4). A replayed attempt adds nothing.
    if ((string)decision["state"]! != DraftDecisions.QaQueued)
    {
      await RecordSpendAsync(conn, tx, report.RunId, item, ct);
      await tx.CommitAsync(ct);
      return null;
    }

    var draftId = item.CardId;
    var runId = (Guid)decision["run_id"]!;
    var expectedHash = decision["qa_content_sha256"] as string;

    // 2. QA outputs
    var blocker = item.Findings.Count(f => f.Severity == "blocker");
    var major = item.Findings.Count(f => f.Severity == "major");
    var minor = item.Findings.Count(f => f.Severity == "minor");
    var qaCostUsd = await RecordSpendAsync(conn, tx, report.RunId, item, ct);
    await DbUtil.ExecuteAsync(conn, tx,
      """
      update automation_draft_decisions
      set qa_status = $2, qa_error_code = $3::text, qa_provider = $4::text, qa_model = $5::text, qa_prompt_version = $6::text,
        qa_request_id = $7::text, blocker_count = $8, major_count = $9, minor_count = $10, updated_at = now()
      where draft_id = $1
      """,
      [item.CardId, item.Status, item.ErrorCode, report.Provider, report.Model, report.PromptVersion, item.RequestId, blocker, major, minor]);

    var hasFindings = await DbUtil.ExecuteScalarAsync(conn, tx,
      "select 1 from automation_draft_findings where draft_id = $1 limit 1", [draftId]);
    if (hasFindings is null)
    {
      foreach (var f in item.Findings)
      {
        await DbUtil.ExecuteAsync(conn, tx,
          """
          insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message, suggested_fix)
          values ($1, $2, $3, $4, $5, $6::text)
          """,
          [draftId, report.RunId, f.Severity, f.Category, f.Message, f.SuggestedFix]);
      }
    }

    // 3. the draft (second in the lock order)
    var draftRows = await DbUtil.QueryAsync(conn, tx,
      "select status, deck_id, stable_uid, agent ->> 'authorConfigId' as author_config_id from ai_drafts where id = $1 for update", [draftId]);
    var deckId = draftRows.Count == 0
      ? Convert.ToInt64(decision["deck_id"], CultureInfo.InvariantCulture)
      : Convert.ToInt64(draftRows[0]["deck_id"], CultureInfo.InvariantCulture);
    var draftUid = draftRows.Count == 0 ? null : draftRows[0]["stable_uid"] as string;

    async Task<ItemOutcome?> Finish(string to, string? reason, string? detail = null, object? details = null)
    {
      await DraftDecisions.TransitionAsync(conn, tx, draftId, DraftDecisions.QaQueued, to, reason, detail,
        DraftDecisions.AutomationEventActor, mode.Effective, details, ct);
      await tx.CommitAsync(ct);
      return new ItemOutcome(draftId, deckId, runId, to, reason, detail, qaCostUsd, null, draftUid, minor, mode.Effective);
    }

    if (draftRows.Count == 0 || (string)draftRows[0]["status"]! != "pending")
    {
      return await Finish(DraftDecisions.Superseded, "DECIDED_BY_HUMAN");
    }

    // 4. automation switched off since the enqueue
    if (mode.Effective == AutomationMode.Off) return await Finish(DraftDecisions.Human, "MODE_OFF");

    // 5. a review of other content than was sent
    if (!string.Equals(item.ContentSha256, expectedHash, StringComparison.Ordinal))
    {
      RouteMetrics.EmitGauge(AiQaResults.HashMismatchMetric, 1);
      return await Finish(DraftDecisions.Human, "QA_HASH_MISMATCH");
    }

    // 6. no review
    if (item.Status != "done") return await Finish(DraftDecisions.Human, "QA_ERROR", item.ErrorCode);

    // 7. blocker or major findings
    if (blocker + major > 0) return await Finish(DraftDecisions.Human, "QA_FLAGGED");

    var reviewerMatchesGate = mode.Reviewer is { } reviewer &&
      string.Equals(reviewer.Provider, report.Provider, StringComparison.Ordinal) &&
      string.Equals(reviewer.Model, report.Model, StringComparison.Ordinal) &&
      string.Equals(reviewer.PromptVersion, report.PromptVersion, StringComparison.Ordinal);

    // The author the eval gate measured (R18D M1, automation-20): a gate without an author id binds no author, and a
    // draft without one (a runner that does not send it) matches no gate.
    var draftAuthor = draftRows[0]["author_config_id"] as string;
    var authorMatchesGate = mode.GateAuthorConfigId is { } gateAuthor && string.Equals(gateAuthor, draftAuthor, StringComparison.Ordinal);

    // 8. live needs the reviewer and the author the eval gate measured
    if (mode.Effective == AutomationMode.Live && !reviewerMatchesGate) return await Finish(DraftDecisions.Human, "REVIEWER_NOT_GATED");
    if (mode.Effective == AutomationMode.Live && !authorMatchesGate)
    {
      return await Finish(DraftDecisions.Human, "AUTHOR_NOT_GATED", draftAuthor is null ? "draft has no authorConfigId" : $"draft author {draftAuthor}");
    }

    // 9. dry run: record what live would do, including live's at-accept checks (automation-6)
    if (mode.Effective == AutomationMode.DryRun)
    {
      var gateDetails = new Dictionary<string, object>
      {
        ["gate"] = mode.GateId is null ? "missing" : "passed",
        ["reviewerMatchesGate"] = reviewerMatchesGate,
        ["authorMatchesGate"] = authorMatchesGate,
      };
      if (await DryRunAcceptRouteAsync(conn, tx, draftId, deckId, expectedHash, ct) is { } route)
      {
        gateDetails["check"] = "at_accept";
        return await Finish(DraftDecisions.Human, route.Reason, route.Detail, gateDetails);
      }
      return await Finish(DraftDecisions.WouldAccept, null, details: gateDetails);
    }

    // 10. live: auto-accept a brand-new card (A00 §5.5)
    await tx.SaveAsync("auto_accept", ct);
    DraftAcceptance.Accepted accepted;
    try
    {
      accepted = await DraftAcceptance.AcceptInTransactionAsync(conn, tx, draftId, deckId, DraftAcceptance.AutomationActor, null, null, ct);
    }
    catch (DraftAcceptance.DraftAcceptanceException ex)
    {
      await tx.RollbackAsync("auto_accept", ct);
      return ex.Code switch
      {
        DraftAcceptance.StableUidTaken => await Finish(DraftDecisions.Human, "EXISTING_CARD"),
        DraftAcceptance.DeckNotFound => await Finish(DraftDecisions.Human, "DECK_DELETED"),
        _ => await Finish(DraftDecisions.Superseded, "DECIDED_BY_HUMAN"),
      };
    }
    catch (PostgresException pg) when (pg is { SqlState: "23505", ConstraintName: "uq_cards_deck_uid" })
    {
      await tx.RollbackAsync("auto_accept", ct);
      return await Finish(DraftDecisions.Human, "EXISTING_CARD");
    }

    var cardRows = await DbUtil.QueryAsync(conn, tx, "select question from cards where id = $1", [accepted.CardId]);
    var question = (string)cardRows[0]["question"]!;
    var similar = await CardSimilarity.FindAsync(conn,
      new SimilarityQuery(question, [deckId], 3, 0.3, ExcludeCardIds: [accepted.CardId]), ct, tx);
    var duplicate = similar.Matches.FirstOrDefault(m => m.LikelyDuplicate);
    if (duplicate is not null)
    {
      await tx.RollbackAsync("auto_accept", ct);
      return await Finish(DraftDecisions.Human, "LIKELY_DUPLICATE", $"at accept: {duplicate.StableUid}");
    }

    var hashRows = await DbUtil.QueryAsync(conn, tx, $"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", [accepted.CardId]);
    var cardHash = CardContentHash.Compute(hashRows[0]);
    if (!string.Equals(cardHash, expectedHash, StringComparison.Ordinal))
    {
      await tx.RollbackAsync("auto_accept", ct);
      return await Finish(DraftDecisions.Human, "QA_HASH_MISMATCH");
    }

    await MirrorAsync(conn, tx, report, item, draftId, deckId, accepted, cardHash, minor, ct);

    await DbUtil.ExecuteAsync(conn, tx,
      """
      update automation_draft_decisions
      set state = 'auto_accepted', reason = null, reason_detail = null, accepted_card_id = $2, accepted_content_sha256 = $3,
        gate_id = $4::bigint, mode = $5, decided_at = now(), updated_at = now()
      where draft_id = $1
      """,
      [draftId, accepted.CardId, cardHash, mode.GateId, mode.Effective]);
    await DraftDecisions.AppendEventAsync(conn, tx, draftId, DraftDecisions.QaQueued, DraftDecisions.AutoAccepted, null,
      DraftDecisions.AutomationEventActor, mode.Effective, new { cardId = accepted.CardId, gateId = mode.GateId }, ct);
    await tx.CommitAsync(ct);

    return new ItemOutcome(draftId, deckId, runId, DraftDecisions.AutoAccepted, null, null, qaCostUsd, accepted.CardId, accepted.StableUid,
      minor, mode.Effective);
  }

  /// <summary>
  /// The at-accept checks of step 10 without writing a card (automation-6), so a dry run routes a draft to a human
  /// where live would: the deck is gone (<c>DECK_DELETED</c>), the stable uid is taken (<c>EXISTING_CARD</c>), the
  /// draft's content no longer hashes to what QA reviewed (<c>QA_HASH_MISMATCH</c>), or the question is a likely
  /// duplicate (<c>LIKELY_DUPLICATE</c>) of a card of the deck or of another pending <c>would_accept</c> draft of the
  /// deck (live would have made that draft a card already). The deck row is locked like the live accept locks it, so
  /// two reports of one batch see each other. Null when live would auto-accept.
  /// </summary>
  private static async Task<(string Reason, string? Detail)?> DryRunAcceptRouteAsync(NpgsqlConnection conn, NpgsqlTransaction tx,
    long draftId, long deckId, string? expectedHash, CancellationToken ct)
  {
    var deck = await DbUtil.QueryAsync(conn, tx, "select id from decks where id = $1 and is_deleted = 0 for update", [deckId]);
    if (deck.Count == 0) return ("DECK_DELETED", null);

    DraftCard card;
    var draftRows = await DbUtil.QueryAsync(conn, tx, "select card::text as card from ai_drafts where id = $1", [draftId]);
    using (var doc = JsonDocument.Parse((string)draftRows[0]["card"]!))
    {
      card = DraftCard.Parse(doc.RootElement);
    }

    var taken = await DbUtil.ExecuteScalarAsync(conn, tx, "select 1 from cards where deck_id = $1 and stable_uid = $2", [deckId, card.StableUid]);
    if (taken is not null) return ("EXISTING_CARD", null);

    var similar = await CardSimilarity.FindAsync(conn, new SimilarityQuery(card.Question, [deckId], 3, 0.3), ct, tx);
    if (similar.Matches.FirstOrDefault(m => m.LikelyDuplicate) is { } duplicate) return ("LIKELY_DUPLICATE", $"at accept: {duplicate.StableUid}");

    var siblings = await DbUtil.QueryAsync(conn, tx,
      """
      select a.stable_uid, a.card->>'question' as question
      from automation_draft_decisions d
      join ai_drafts a on a.id = d.draft_id
      where d.deck_id = $1 and d.state = 'would_accept' and a.status = 'pending' and d.draft_id <> $2
      order by d.draft_id desc
      limit $3
      """, [deckId, draftId, CardSimilarity.FallbackCandidateLimit]);
    foreach (var s in siblings)
    {
      // The rounding CardSimilarity applies before its LikelyDuplicate flag, so both comparisons agree.
      if (s["question"] is string q &&
          Math.Round((double)Trigram.Similarity(q, card.Question), 4, MidpointRounding.AwayFromZero) >= CardSimilarity.LikelyDuplicateThreshold)
      {
        return ("LIKELY_DUPLICATE", $"at accept: {s["stable_uid"]}");
      }
    }

    var hash = await DraftDecisions.DraftContentHashAsync(conn, tx, card, ct);
    if (!string.Equals(hash, expectedHash, StringComparison.Ordinal)) return ("QA_HASH_MISMATCH", null);
    return null;
  }

  /// <summary>
  /// Records one QA attempt's usage in <c>automation_qa_spend</c> (keyed by job and request id, dated by when the report
  /// arrived; the shared daily cap sums it) and adds the change to the decision's cost columns. A new request id is a
  /// new attempt and adds; a replayed one keeps the greater values (the former IsNewAttempt rule, now per attempt, so
  /// it also holds for reports of an older job). The caller holds the decision row lock. Returns the decision's cost.
  /// </summary>
  private static async Task<decimal> RecordSpendAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid qaJobId,
    AiQaResults.ReportItem item, CancellationToken ct)
  {
    ct.ThrowIfCancellationRequested();
    var rows = await DbUtil.QueryAsync(conn, tx,
      """
      with prev as (
        select input_tokens, output_tokens, estimated_cost_usd from automation_qa_spend where qa_job_id = $1 and request_key = $3
      ), up as (
        insert into automation_qa_spend (qa_job_id, request_key, draft_id, input_tokens, output_tokens, estimated_cost_usd)
        values ($1, $3, $2, $4, $5, $6)
        on conflict (qa_job_id, request_key) do update
        set input_tokens = greatest(automation_qa_spend.input_tokens, excluded.input_tokens),
          output_tokens = greatest(automation_qa_spend.output_tokens, excluded.output_tokens),
          estimated_cost_usd = greatest(automation_qa_spend.estimated_cost_usd, excluded.estimated_cost_usd)
        returning input_tokens, output_tokens, estimated_cost_usd
      )
      select up.input_tokens - coalesce(prev.input_tokens, 0) as d_in, up.output_tokens - coalesce(prev.output_tokens, 0) as d_out,
        up.estimated_cost_usd - coalesce(prev.estimated_cost_usd, 0) as d_cost
      from up left join prev on true
      """,
      [qaJobId, item.CardId, item.RequestId ?? string.Empty, (long)item.InputTokens, (long)item.OutputTokens, item.EstimatedCostUsd]);
    var dIn = Convert.ToInt64(rows[0]["d_in"], CultureInfo.InvariantCulture);
    var dOut = Convert.ToInt64(rows[0]["d_out"], CultureInfo.InvariantCulture);
    var dCost = Convert.ToDecimal(rows[0]["d_cost"], CultureInfo.InvariantCulture);
    if (dIn == 0 && dOut == 0 && dCost == 0)
    {
      return Convert.ToDecimal(await DbUtil.ExecuteScalarAsync(conn, tx,
        "select estimated_cost_usd from automation_draft_decisions where draft_id = $1", [item.CardId]), CultureInfo.InvariantCulture);
    }
    // Only the cost columns: a late report changes no state and no updated_at.
    return Convert.ToDecimal(await DbUtil.ExecuteScalarAsync(conn, tx,
      """
      update automation_draft_decisions
      set input_tokens = input_tokens + $2, output_tokens = output_tokens + $3, estimated_cost_usd = estimated_cost_usd + $4
      where draft_id = $1
      returning estimated_cost_usd
      """,
      [item.CardId, dIn, dOut, dCost]), CultureInfo.InvariantCulture);
  }

  /// <summary>
  /// The QA mirror (A00 §5.6): a finished <c>cards</c>-scope run with a derived id, one done item at the card's hash
  /// and the minor findings, so <see cref="QaGate"/> treats the auto-accepted card as reviewed. Its cost is 0: the
  /// spend sits on the decision row (§9.5).
  /// </summary>
  private static async Task MirrorAsync(NpgsqlConnection conn, NpgsqlTransaction tx, AiQaResults.Report report, AiQaResults.ReportItem item,
    long draftId, long deckId, DraftAcceptance.Accepted accepted, string cardHash, int minor, CancellationToken ct)
  {
    ct.ThrowIfCancellationRequested();
    var mirrorId = AutomationIds.Derived("qa-mirror:" + draftId.ToString(CultureInfo.InvariantCulture));
    await DbUtil.ExecuteAsync(conn, tx,
      """
      insert into ai_qa_runs (id, deck_id, scope, status, provider, model, prompt_version, requested_by_sub, card_count, chunk_count,
        cards_done, minor_count, input_tokens, output_tokens, estimated_cost_usd, finished_at)
      values ($1, $2, 'cards', 'done', $3::text, $4::text, $5::text, $6, 1, 1, 1, $7, $8, $9, 0, now())
      on conflict (id) do nothing
      """,
      [mirrorId, deckId, report.Provider, report.Model, report.PromptVersion, DraftAcceptance.AutomationActor, minor,
       (long)item.InputTokens, (long)item.OutputTokens]);
    await DbUtil.ExecuteAsync(conn, tx,
      """
      insert into ai_qa_items (run_id, card_id, stable_uid, content_sha256, status, prompt_version, request_id, updated_at)
      values ($1, $2, $3, $4, 'done', $5::text, $6::text, now())
      on conflict (run_id, card_id) do nothing
      """,
      [mirrorId, accepted.CardId, accepted.StableUid, cardHash, report.PromptVersion, item.RequestId]);
    foreach (var f in item.Findings.Where(f => f.Severity == "minor"))
    {
      await DbUtil.ExecuteAsync(conn, tx,
        """
        insert into ai_qa_findings (run_id, card_id, content_sha256, severity, category, message, suggested_fix, resolution)
        values ($1, $2, $3, 'minor', $4, $5, $6::text, 'open')
        """,
        [mirrorId, accepted.CardId, cardHash, f.Category, f.Message, f.SuggestedFix]);
    }
  }

  /// <summary>Ledger rows (live only), the webhook and the exception hook of one committed item. Never throws.</summary>
  private static async Task AfterCommitAsync(NpgsqlConnection conn, AiQaResults.Report report, AiQaResults.ReportItem item,
    ItemOutcome outcome, CancellationToken ct)
  {
    try
    {
      var live = outcome.Mode == AutomationMode.Live;
      var draftRef = outcome.DraftId.ToString(CultureInfo.InvariantCulture);

      if (live && outcome.To == DraftDecisions.AutoAccepted)
      {
        await AutomationLedger.RecordAsync(conn, new AutomationEvent(
          Automation: "auto_accept", Units: 1, Outcome: "success", DeckId: outcome.DeckId, Ref: draftRef,
          DedupeKey: $"auto-accept:{draftRef}",
          Details: new { runId = outcome.RunId, qaCostUsd = outcome.QaCostUsd, provider = report.Provider, model = report.Model }), ct);
        // The avoided human review is credited once, by auto_accept (R18C automation-14): like a human accept nets
        // its measured review time, the automated ai_draft_review row nets the auto_accept baseline, so one card
        // saves the ai_draft_review baseline in all, not that plus the review again.
        var avoidedReview = await DbUtil.ExecuteScalarAsync(conn, null,
          "select baseline_minutes_per_unit from automation_baselines where automation = 'auto_accept'", []);
        await AutomationLedger.RecordAsync(conn, new AutomationEvent(
          Automation: "ai_draft_review", Units: 1, Outcome: "success",
          ActualMinutes: avoidedReview is null ? null : Convert.ToDecimal(avoidedReview, CultureInfo.InvariantCulture),
          DeckId: outcome.DeckId, Ref: draftRef, DedupeKey: $"draft-accept:{draftRef}", Details: new { automated = true }), ct);
      }
      else if (live && outcome.To == DraftDecisions.Human)
      {
        await AutomationLedger.RecordAsync(conn, DraftDecisions.RouteLedgerEvent(outcome.DraftId, outcome.DeckId, outcome.Reason!, outcome.ReasonDetail), ct);
      }

      if (live && item.Status == "done")
      {
        await AutomationLedger.RecordAsync(conn, new AutomationEvent(
          Automation: "ai_qa_review", Units: 1, Outcome: "success", DeckId: outcome.DeckId, Ref: draftRef,
          DedupeKey: $"draft-qa:{report.RunId}", Details: new { draftId = outcome.DraftId, provider = report.Provider, model = report.Model }), ct);
      }

      if (live && outcome.To == DraftDecisions.AutoAccepted)
      {
        var deckSlug = Convert.ToString(await DbUtil.ExecuteScalarAsync(conn, null, "select slug from decks where id = $1", [outcome.DeckId]),
          CultureInfo.InvariantCulture);
        await WebhookEvents.EnqueueAsync(conn, "draft.auto_accepted", new
        {
          deckId = outcome.DeckId,
          deckSlug,
          draftId = outcome.DraftId,
          cardId = outcome.CardId,
          stableUid = outcome.StableUid,
          runId = outcome.RunId,
          qa = new { provider = report.Provider, model = report.Model, promptVersion = report.PromptVersion, minor = outcome.Minor },
          consoleUrl = $"{ConsoleBaseUrl()}/automation?draftId={draftRef}",
        }, ct: ct);
      }

      if (outcome.To == DraftDecisions.Human && outcome.Reason == "QA_ERROR" && outcome.ReasonDetail is { } code &&
          ProviderErrorCodes.Contains(code, StringComparer.Ordinal))
      {
        var utcDate = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        await DraftDecisions.RaiseExceptionAsync(conn, "qa_provider_error", $"exception:qa_provider_error:{code}:{utcDate}",
          new Dictionary<string, string>
          {
            ["code"] = code,
            ["draftId"] = draftRef,
            ["runId"] = outcome.RunId.ToString(),
          }, ct);
      }

      Log.Event("info", new { tag = "automation", outcome = "draft_qa_applied", draftId = outcome.DraftId, qaJobId = report.RunId,
        state = outcome.To, reason = outcome.Reason, mode = outcome.Mode });
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "draft_qa_after_commit_failed", draftId = outcome.DraftId, error = ex.Message });
      AutomationFailures.Record();
    }
  }

  private static string ConsoleBaseUrl()
  {
    var raw = Environment.GetEnvironmentVariable("CONSOLE_BASE_URL");
    return string.IsNullOrWhiteSpace(raw) ? Drafts.DefaultConsoleBaseUrl : raw.Trim().TrimEnd('/');
  }
}
