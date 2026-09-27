using System.Data;
using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>The outcome of one auto-publish evaluation: the <c>automation_publishes</c> row and its state.</summary>
public sealed record AutoPublishOutcome(long PublishId, string State, string? Reason, string? ReasonDetail);

/// <summary>A card of the deck's pending change set (changed since the live build, live or deleted) with its current hash.</summary>
public sealed record PendingCard(long CardId, string StableUid, bool IsDeleted, string ContentSha256);

/// <summary>
/// Auto-publish (R18A A04, contract A00 §6.2, §6.3, §6.5). A deck a final run touched is published by the existing
/// pipeline (actor <c>automation</c>, snapshot-bound) only when its pending change set is exactly automation-created,
/// unchanged cards; any human change, deleted card, deck-settings edit, first publish, gate refusal or failure goes to
/// a human with a reason. <c>dry_run</c> records <c>would_publish</c> and never enqueues. There is no count cap.
/// </summary>
public static class AutoPublisher
{
  public const int PublishWaitTimeoutMinutes = 120, MaxStaleAttempts = 3, StuckJobMinutes = 60;
  public const string Actor = "automation";
  public const int MaxListedUids = 10, MaxDetailLength = 300;

  public const string Waiting = "waiting", Publishing = "publishing", Published = "published", WouldPublish = "would_publish",
    Human = "human";

  /// <summary>Publish refusal codes that route to a human with the same reason (A00 §6.2 check 9).</summary>
  private static readonly string[] HumanRefusalCodes = ["MCQ_PUBLISH_GATE", "AI_QA_REQUIRED", "AI_QA_BLOCKED", "CONFIG_ERROR", "SERVER_NOT_READY_AI_QA",
    "DECK_DELETED"];

  /// <summary>What checks 1–8 decided; <see cref="StartPublish"/> means every check passed and check 9 runs.</summary>
  private sealed record Verdict(string State, string? Reason, string? Detail, string? DeckSlug, string? BuildId, string? Snapshot, bool StartPublish);

  // ---------------------------------------------------------------------------------------------
  // evaluation (A00 §6.2)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Evaluates <paramref name="deckId"/> for the final run <paramref name="runId"/>: one <c>automation_publishes</c> row
  /// per evaluation, or the deck's open <c>waiting</c> row with the run's accepted card ids appended. When the deck's row
  /// is already <c>publishing</c> its build cannot contain this run's cards: they are only recorded as deferred on it,
  /// and the reconcile opens a new <c>waiting</c> row for them once the job ends. Effective <c>off</c> ⇒ null and
  /// nothing written. Never throws.
  /// </summary>
  public static async Task<AutoPublishOutcome?> EvaluateAsync(NpgsqlConnection conn, long deckId, Guid runId, CancellationToken ct = default)
  {
    try
    {
      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      if (mode.Effective == AutomationMode.Off) return null;

      var (publishId, state) = await OpenRunRowAsync(conn, null, deckId, runId, mode.Effective, ct);
      if (state == Publishing)
      {
        // A build is already in flight for this deck and cannot contain this run's cards (they are deferred on the row);
        // the tick's reconcile opens a new waiting row for them when the job ends.
        return new AutoPublishOutcome(publishId, Publishing, null, null);
      }
      return await EvaluateRowAsync(conn, publishId, deckId, runId, mode.Effective, ct);
    }
    catch (Exception ex)
    {
      LogFailure(ex, "evaluate", deckId);
      return null;
    }
  }

  /// <summary>Tick step 6: a <c>waiting</c> row runs checks 1–9 again. Null when the row is not waiting or the mode is off. Never throws.</summary>
  internal static async Task<AutoPublishOutcome?> ReevaluateAsync(NpgsqlConnection conn, long publishId, CancellationToken ct = default)
  {
    try
    {
      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      if (mode.Effective == AutomationMode.Off) return null;
      var rows = await DbUtil.QueryAsync(conn, null, "select deck_id, run_id, state from automation_publishes where id = $1", [publishId]);
      if (rows.Count == 0 || (string)rows[0]["state"]! != Waiting) return null;
      return await EvaluateRowAsync(conn, publishId, Convert.ToInt64(rows[0]["deck_id"], CultureInfo.InvariantCulture),
        rows[0]["run_id"] as Guid?, mode.Effective, ct);
    }
    catch (Exception ex)
    {
      LogFailure(ex, "reevaluate", publishId);
      return null;
    }
  }

  /// <summary>
  /// <see cref="OpenRowAsync"/> with the run's <c>auto_accepted</c> card ids of the deck. Used by the evaluation and,
  /// inside the finalisation transaction (<paramref name="tx"/>), to record the evaluation intent durably.
  /// </summary>
  internal static async Task<(long Id, string State)> OpenRunRowAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long deckId, Guid runId,
    string mode, CancellationToken ct)
  {
    var cardRows = await DbUtil.QueryAsync(conn, tx,
      """
      select accepted_card_id from automation_draft_decisions
      where run_id = $1 and deck_id = $2 and state = 'auto_accepted' and accepted_card_id is not null
      order by accepted_card_id
      """, [runId, deckId]);
    var cardIds = cardRows.Select(r => Convert.ToInt64(r["accepted_card_id"], CultureInfo.InvariantCulture)).ToArray();
    return await OpenRowAsync(conn, tx, deckId, runId, mode, cardIds, ct);
  }

  /// <summary>
  /// The deck's open row, or a new <c>waiting</c> row. A <c>waiting</c> row gets <paramref name="cardIds"/> appended to
  /// <c>card_ids</c>; a <c>publishing</c> row never does (its build snapshot is already bound), it records the ids it
  /// does not already cover in <c>deferred_card_ids</c>. Exception-free on the unique-index race, so it is safe inside a
  /// transaction: the insert yields to the row another evaluation opened first, and the loop re-selects it.
  /// </summary>
  private static async Task<(long Id, string State)> OpenRowAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long deckId, Guid? runId,
    string mode, long[] cardIds, CancellationToken ct)
  {
    for (var attempt = 0; ; attempt++)
    {
      ct.ThrowIfCancellationRequested();
      var open = await DbUtil.QueryAsync(conn, tx,
        """
        update automation_publishes
        set card_ids = case when state = 'waiting'
              then (select coalesce(array_agg(distinct x order by x), '{}') from unnest(card_ids || $2::bigint[]) as u(x))
              else card_ids end,
            deferred_card_ids = case when state = 'publishing'
              then (select coalesce(array_agg(distinct x order by x), '{}') from unnest(deferred_card_ids || $2::bigint[]) as u(x)
                    where not x = any(card_ids))
              else deferred_card_ids end,
            updated_at = now()
        where deck_id = $1 and state in ('waiting', 'publishing')
        returning id, state
        """, [deckId, cardIds]);
      if (open.Count > 0) return (Convert.ToInt64(open[0]["id"], CultureInfo.InvariantCulture), (string)open[0]["state"]!);

      var id = await DbUtil.ExecuteScalarAsync(conn, tx,
        """
        insert into automation_publishes (deck_id, run_id, mode, state, card_ids)
        values ($1, $2, $3, 'waiting', $4::bigint[])
        on conflict (deck_id) where state in ('waiting', 'publishing') do nothing
        returning id
        """, [deckId, runId, mode, cardIds]);
      if (id is not null and not DBNull) return (Convert.ToInt64(id, CultureInfo.InvariantCulture), Waiting);
      // Another evaluation opened the deck's row first: reuse it.
      if (attempt >= 3) throw new InvalidOperationException($"no open automation_publishes row for deck {deckId} after {attempt + 1} attempts");
    }
  }

  /// <summary>Checks 1–9 for the <c>waiting</c> row <paramref name="publishId"/>, then the row update and the after-commit effects.</summary>
  private static async Task<AutoPublishOutcome> EvaluateRowAsync(NpgsqlConnection conn, long publishId, long deckId, Guid? runId, string mode,
    CancellationToken ct)
  {
    var verdict = await RunChecksAsync(conn, deckId, mode, ct);
    var state = verdict.State;
    var reason = verdict.Reason;
    var detail = verdict.Detail;
    string? jobId = null, buildId = verdict.BuildId, snapshot = null;
    var staleRefusal = false;

    if (verdict.StartPublish)
    {
      try
      {
        var start = await Publish.StartPublishAsync(conn, deckId, Actor, $"auto-publish run {runId?.ToString("D") ?? "unknown"}",
          bindSnapshot: true, expectedSnapshot: verdict.Snapshot, allowResume: false, ct);
        if (start.Outcome is Publish.Queued or Publish.Resumed)
        {
          (state, reason, detail, jobId, buildId, snapshot) = (Publishing, null, null, start.JobId, start.BuildId, start.SnapshotSha256);
        }
        else if (start.Code == PublishSnapshot.StaleErrorCode)
        {
          (state, reason, detail) = (Waiting, PublishSnapshot.StaleErrorCode, null);
          staleRefusal = true;
        }
        else if (start.Code == "PUBLISH_IN_PROGRESS")
        {
          (state, reason, detail) = (Waiting, "PUBLISH_IN_PROGRESS", null);
        }
        else if (start.Code is { } code && HumanRefusalCodes.Contains(code))
        {
          (state, reason, detail) = (Human, code, Detail(start.Message));
        }
        else if (start.HttpStatus == 404)
        {
          (state, reason, detail) = (Human, "DECK_DELETED", null);
        }
        else
        {
          (state, reason, detail) = (Human, "PUBLISH_FAILED", Detail($"{start.Code}: {start.Message}"));
        }
      }
      catch (PostgresException pg) when (pg is { SqlState: "23505", ConstraintName: "uq_deck_publishes_active" })
      {
        (state, reason, detail) = (Waiting, "PUBLISH_IN_PROGRESS", null);
      }
      catch (Exception ex) when (ex is not OperationCanceledException)
      {
        Log.Event("warn", new { tag = "automation", reason = "auto_publish_start_failed", deckId, publishId, error = ex.Message });
        (state, reason, detail) = (Human, "PUBLISH_FAILED", Detail($"enqueue failed: {ex.Message}"));
      }
    }

    var rows = await DbUtil.QueryAsync(conn, null,
      "select attempts, created_at < now() - make_interval(mins => $2) as wait_expired from automation_publishes where id = $1",
      [publishId, PublishWaitTimeoutMinutes]);
    var attempts = Convert.ToInt32(rows[0]["attempts"], CultureInfo.InvariantCulture);
    if (staleRefusal)
    {
      attempts++;
      if (attempts >= MaxStaleAttempts) (state, detail) = (Human, Detail($"cards changed during {attempts} publish attempts"));
    }
    if (state == Waiting && reason == "PUBLISH_IN_PROGRESS" && rows[0]["wait_expired"] is true)
    {
      (state, reason, detail) = (Human, "PUBLISH_WAIT_TIMEOUT", Detail($"another publish of the deck was still active after {PublishWaitTimeoutMinutes} minutes"));
    }

    var updated = await DbUtil.QueryAsync(conn, null,
      """
      update automation_publishes
      set mode = $2, state = $3, reason = $4::text, reason_detail = $5::text, job_id = coalesce($6::text, job_id),
          build_id = coalesce($7::text, build_id), snapshot_sha256 = coalesce($8::text, snapshot_sha256), attempts = $9,
          finished_at = case when $3 in ('published', 'would_publish', 'human') then now() else null end, updated_at = now()
      where id = $1 and state = 'waiting'
      returning id
      """, [publishId, mode, state, reason, detail, jobId, buildId, snapshot, attempts]);
    if (updated.Count == 0)
    {
      // Someone else moved the row meanwhile; report what it is now.
      var now = await DbUtil.QueryAsync(conn, null, "select state, reason, reason_detail from automation_publishes where id = $1", [publishId]);
      return new AutoPublishOutcome(publishId, (string)now[0]["state"]!, now[0]["reason"] as string, now[0]["reason_detail"] as string);
    }

    Log.Event("info", new { tag = "automation", outcome = "auto_publish_evaluated", publishId, deckId, runId, mode, state, reason, jobId });
    if (state == Human) await RouteHumanAsync(conn, publishId, deckId, verdict.DeckSlug, runId, mode, reason!, detail, ct);
    return new AutoPublishOutcome(publishId, state, reason, detail);
  }

  /// <summary>Checks 1–8 of A00 §6.2 in order, read in one repeatable-read snapshot.</summary>
  private static async Task<Verdict> RunChecksAsync(NpgsqlConnection conn, long deckId, string mode, CancellationToken ct)
  {
    await using var tx = await conn.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
    var decks = await DbUtil.QueryAsync(conn, tx,
      """
      select d.slug, d.is_deleted, d.live_build_id, d.updated_at,
        (select p.created_at from deck_publishes p where p.deck_id = d.id and p.build_id = d.live_build_id order by p.created_at desc limit 1) as t,
        d.updated_at <= coalesce((select p.created_at from deck_publishes p where p.deck_id = d.id and p.build_id = d.live_build_id
                                  order by p.created_at desc limit 1), '-infinity'::timestamptz) as settings_unchanged
      from decks d where d.id = $1
      """, [deckId]);

    // 1. the deck exists and is live
    if (decks.Count == 0 || Convert.ToInt32(decks[0]["is_deleted"], CultureInfo.InvariantCulture) != 0)
    {
      return new Verdict(Human, "DECK_DELETED", null, decks.Count == 0 ? null : decks[0]["slug"] as string, null, null, false);
    }
    var deck = decks[0];
    var slug = deck["slug"] as string;

    // 2. staged rollout switch (not a count cap)
    if (!AutomationEnv.AutoPublish()) return new Verdict(Human, "AUTO_PUBLISH_DISABLED", null, slug, null, null, false);

    // 3. the first publish of a deck is always human
    var liveBuildId = deck["live_build_id"] as string;
    if (liveBuildId is null) return new Verdict(Human, "DECK_NEVER_PUBLISHED", null, slug, null, null, false);

    // 4. no active job
    var active = await DbUtil.ExecuteScalarAsync(conn, tx,
      "select 1 from deck_publishes where deck_id = $1 and status in ('PENDING', 'PROCESSING') limit 1", [deckId]);
    if (active is not null) return new Verdict(Waiting, "PUBLISH_IN_PROGRESS", null, slug, null, null, false);

    // 5. deck settings unchanged since the live build
    if (deck["settings_unchanged"] is not true)
    {
      return new Verdict(Human, "DECK_HAS_HUMAN_CHANGES", "deck settings changed", slug, null, null, false);
    }

    // 6. the pending change set is automation-owned
    var changed = await DbUtil.QueryAsync(conn, tx,
      $"""
      select {CardContentHash.CardColumnsSql}, c.is_deleted
      from cards c
      where c.deck_id = $1 and c.updated_at > $2
      order by c.order_in_deck, c.id
      """, [deckId, deck["t"]]);
    var pending = changed.Select(r => new PendingCard(
      Convert.ToInt64(r["id"], CultureInfo.InvariantCulture),
      Convert.ToString(r["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty,
      Convert.ToInt32(r["is_deleted"], CultureInfo.InvariantCulture) != 0,
      CardContentHash.Compute(r))).ToList();
    var owned = new Dictionary<long, string>();
    if (mode == AutomationMode.Live && pending.Count > 0)
    {
      var ownedRows = await DbUtil.QueryAsync(conn, tx,
        """
        select accepted_card_id, accepted_content_sha256 from automation_draft_decisions
        where state = 'auto_accepted' and accepted_card_id = any($1)
        """, [pending.Select(p => p.CardId).ToArray()]);
      foreach (var o in ownedRows) owned[Convert.ToInt64(o["accepted_card_id"], CultureInfo.InvariantCulture)] = (string)o["accepted_content_sha256"]!;
    }
    var (ok, humanUids) = CheckPendingChangeSet(pending, owned, mode);
    if (!ok)
    {
      var listed = string.Join(", ", humanUids.Take(MaxListedUids));
      var more = humanUids.Count > MaxListedUids ? $" (+{humanUids.Count - MaxListedUids} more)" : string.Empty;
      return new Verdict(Human, "DECK_HAS_HUMAN_CHANGES", Detail($"cards changed by a human: {listed}{more}"), slug, null, null, false);
    }

    // The export rows the publish will be bound to (A00 §6.2 check 9, §6.3).
    var export = await DbUtil.QueryAsync(conn, tx, Publish.CardsSql, [deckId]);
    var snapshot = PublishSnapshot.Digest(export.Select(PublishSnapshot.FromRow));
    await tx.CommitAsync(ct);

    // 7. dry run stops here
    if (mode != AutomationMode.Live) return new Verdict(WouldPublish, null, null, slug, null, null, false);

    // 8. nothing pending: an earlier build already shipped these cards
    if (pending.Count == 0) return new Verdict(Published, null, null, slug, liveBuildId, null, false);

    // 9. publish
    return new Verdict(Waiting, null, null, slug, null, snapshot, true);
  }

  /// <summary>
  /// Check 6 of A00 §6.2 (pure): every card of <paramref name="pending"/> must be live, with an automation-owned hash
  /// equal to its current hash. In <c>dry_run</c> nothing is automation-owned, so the set must be empty. Returns the
  /// stable uids that make the set human (all of them, in the given order).
  /// </summary>
  internal static (bool Ok, IReadOnlyList<string> HumanUids) CheckPendingChangeSet(IReadOnlyList<PendingCard> pending,
    IReadOnlyDictionary<long, string> automationOwnedHashes, string mode)
  {
    var live = mode == AutomationMode.Live;
    var human = pending
      .Where(p => !live || p.IsDeleted || !automationOwnedHashes.TryGetValue(p.CardId, out var owned) ||
                  !string.Equals(owned, p.ContentSha256, StringComparison.Ordinal))
      .Select(p => p.StableUid)
      .ToList();
    return (human.Count == 0, human);
  }

  /// <summary>The <c>publish_blocked</c> alert and, in live, the ledger row of a human outcome (after the row update).</summary>
  private static async Task RouteHumanAsync(NpgsqlConnection conn, long publishId, long deckId, string? deckSlug, Guid? runId, string mode,
    string reason, string? detail, CancellationToken ct)
  {
    var id = publishId.ToString(CultureInfo.InvariantCulture);
    var facts = new Dictionary<string, string>
    {
      ["publishId"] = id,
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["deckSlug"] = deckSlug ?? $"deck {deckId.ToString(CultureInfo.InvariantCulture)}",
      ["reason"] = reason,
      ["reasonDetail"] = detail ?? string.Empty,
    };
    if (runId is { } r) facts["runId"] = r.ToString("D");
    await Notifications.RaiseExceptionAsync(conn, "publish_blocked", $"exception:publish_blocked:{id}", facts, runId, ct);

    if (mode == AutomationMode.Live)
    {
      await AutomationLedger.RecordAsync(conn, new AutomationEvent("auto_publish", 0, "success", DeckId: deckId, Ref: id,
        DedupeKey: $"auto-publish-human:{id}", Details: new { reason }), ct);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // reconciliation (A00 §6.5)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Tick step 5a (before finalisation): each <c>publishing</c> row follows its job. <c>SUCCESS</c> ⇒ <c>published</c>
  /// (+ ledger in live) with <c>card_ids</c> cut to the cards the build covered; every automation-accepted card of the
  /// deck the build missed (changed after the job was created, or deferred on the row) goes to a new <c>waiting</c>
  /// row, which the tick evaluates next. <c>FAILED</c> with <c>AI_QA_STALE</c> (cards changed between the bound snapshot
  /// and the build) ⇒ back to <c>waiting</c> for a fresh evaluation, whose check 6 routes any human change to a human;
  /// after <see cref="MaxStaleAttempts"/> stale attempts, or on any other failure ⇒ <c>human</c> / <c>PUBLISH_FAILED</c>
  /// with the job's error (+ <c>publish_failed</c> alert, ledger in live). A job still active is left alone (the existing
  /// reaper handles stuck jobs). Stops early once <paramref name="stop"/> says the tick's budget is spent. Returns the
  /// rows moved. Never throws.
  /// </summary>
  internal static async Task<int> ReconcileAsync(NpgsqlConnection conn, int max, CancellationToken ct = default, Func<bool>? stop = null)
  {
    var moved = 0;
    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select a.id, a.deck_id, a.run_id, a.mode, a.job_id, d.slug as deck_slug,
               p.status as job_status, p.error_message, p.updated_at < now() - make_interval(mins => $2) as stuck
        from automation_publishes a
        left join deck_publishes p on p.job_id = a.job_id
        left join decks d on d.id = a.deck_id
        where a.state = 'publishing'
        order by a.id
        limit $1
        """, [max, StuckJobMinutes]);
      foreach (var row in rows)
      {
        ct.ThrowIfCancellationRequested();
        if (stop?.Invoke() == true) break;
        var publishId = Convert.ToInt64(row["id"], CultureInfo.InvariantCulture);
        var deckId = Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture);
        var jobId = row["job_id"] as string;
        var live = (string)row["mode"]! == AutomationMode.Live;
        var status = row["job_status"] as string;
        if (jobId is null || status is null) continue;

        if (status == "SUCCESS")
        {
          var next = await PublishedAsync(conn, publishId, deckId, jobId, (string)row["mode"]!, ct);
          if (next is null) continue;
          moved++;
          if (live)
          {
            await AutomationLedger.RecordAsync(conn, new AutomationEvent("auto_publish", 1, "success", DeckId: deckId, Ref: jobId,
              DedupeKey: $"auto-publish:{jobId}"), ct);
          }
          Log.Event("info", new { tag = "automation", outcome = "auto_publish_published", publishId, deckId, jobId, nextPublishId = next.Value.NextId,
            uncovered = next.Value.Uncovered });
        }
        else if (status == "FAILED")
        {
          var error = row["error_message"] as string ?? "the publish job failed";
          if (error.StartsWith(PublishSnapshot.StaleErrorCode, StringComparison.Ordinal))
          {
            var retried = await DbUtil.QueryAsync(conn, null,
              """
              update automation_publishes
              set state = 'waiting', reason = $2, reason_detail = null, attempts = attempts + 1,
                  card_ids = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(card_ids || deferred_card_ids) as u(x)),
                  deferred_card_ids = '{}', finished_at = null, updated_at = now()
              where id = $1 and state = 'publishing' and attempts + 1 < $3
              returning id
              """, [publishId, PublishSnapshot.StaleErrorCode, MaxStaleAttempts]);
            if (retried.Count > 0)
            {
              moved++;
              Log.Event("info", new { tag = "automation", outcome = "auto_publish_stale_retry", publishId, deckId, jobId });
              continue;
            }
          }
          var done = await DbUtil.QueryAsync(conn, null,
            """
            update automation_publishes
            set state = 'human', reason = 'PUBLISH_FAILED', reason_detail = $2,
                card_ids = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(card_ids || deferred_card_ids) as u(x)),
                deferred_card_ids = '{}', finished_at = now(), updated_at = now()
            where id = $1 and state = 'publishing' returning id
            """, [publishId, Detail(error)]);
          if (done.Count == 0) continue;
          moved++;
          await Notifications.RaiseExceptionAsync(conn, "publish_failed", $"exception:publish_failed:{jobId}", new Dictionary<string, string>
          {
            ["jobId"] = jobId,
            ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
            ["deckSlug"] = row["deck_slug"] as string ?? $"deck {deckId.ToString(CultureInfo.InvariantCulture)}",
            ["error"] = Detail(error)!,
          }, row["run_id"] as Guid?, ct);
          if (live)
          {
            await AutomationLedger.RecordAsync(conn, new AutomationEvent("auto_publish", 0, "failure", DeckId: deckId, Ref: jobId,
              DedupeKey: $"auto-publish-fail:{jobId}", Details: new { error = Detail(error) }), ct);
          }
          Log.Event("info", new { tag = "automation", outcome = "auto_publish_failed", publishId, deckId, jobId });
        }
        else if (row["stuck"] is true)
        {
          Log.Event("warn", new { tag = "automation", reason = "auto_publish_job_stuck", publishId, deckId, jobId, status });
        }
      }
    }
    catch (Exception ex)
    {
      LogFailure(ex, "reconcile", 0);
    }
    return moved;
  }

  /// <summary>
  /// A <c>publishing</c> row whose job succeeded, in one transaction: the automation-accepted cards of the deck the build
  /// did not cover are the deferred ids plus every such card changed after the job was created (the Worker builds the
  /// bound snapshot, so a later change cannot be in it). The row becomes <c>published</c> with only the covered ids, and
  /// the uncovered ones open the deck's next <c>waiting</c> row (allowed by the open-row index now that this one is
  /// terminal), owned by the newest run among them. Null when the row was no longer <c>publishing</c>.
  /// </summary>
  private static async Task<(long? NextId, long[] Uncovered)?> PublishedAsync(NpgsqlConnection conn, long publishId, long deckId, string jobId,
    string mode, CancellationToken ct)
  {
    await using var tx = await conn.BeginTransactionAsync(ct);
    var locked = await DbUtil.QueryAsync(conn, tx,
      "select deferred_card_ids from automation_publishes where id = $1 and state = 'publishing' for update", [publishId]);
    if (locked.Count == 0)
    {
      await tx.RollbackAsync(ct);
      return null;
    }
    var uncoveredRows = await DbUtil.QueryAsync(conn, tx,
      """
      select distinct dd.accepted_card_id as id
      from automation_draft_decisions dd
      join cards c on c.id = dd.accepted_card_id
      where c.deck_id = $1 and dd.state = 'auto_accepted'
        and c.updated_at > (select p.created_at from deck_publishes p where p.job_id = $2)
      union
      select unnest($3::bigint[])
      order by 1
      """, [deckId, jobId, (long[])locked[0]["deferred_card_ids"]!]);
    var uncovered = uncoveredRows.Select(r => Convert.ToInt64(r["id"], CultureInfo.InvariantCulture)).ToArray();

    await DbUtil.ExecuteAsync(conn, tx,
      """
      update automation_publishes
      set state = 'published', reason = null, reason_detail = null, finished_at = now(), updated_at = now(),
          card_ids = (select coalesce(array_agg(x order by x), '{}') from unnest(card_ids) as u(x) where not x = any($2::bigint[])),
          deferred_card_ids = '{}'
      where id = $1
      """, [publishId, uncovered]);

    long? nextId = null;
    if (uncovered.Length > 0)
    {
      var owner = await DbUtil.ExecuteScalarAsync(conn, tx,
        """
        select run_id from automation_draft_decisions
        where accepted_card_id = any($1) and state = 'auto_accepted' and run_id is not null
        order by decided_at desc nulls last, created_at desc
        limit 1
        """, [uncovered]);
      (nextId, _) = await OpenRowAsync(conn, tx, deckId, owner as Guid?, mode, uncovered, ct);
    }
    await tx.CommitAsync(ct);
    return (nextId, uncovered);
  }

  private static string? Detail(string? text) =>
    text is null ? null : text.Length <= MaxDetailLength ? text : text[..(MaxDetailLength - 1)] + "…";

  private static void LogFailure(Exception ex, string where, long id)
  {
    if (ex is PostgresException { SqlState: "42P01" or "42703" } pg)
    {
      Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", sqlState = pg.SqlState, where = $"auto_publish_{where}", id });
      AutomationFailures.Record();
      return;
    }
    Log.Event("warn", new { tag = "automation", reason = $"auto_publish_{where}_failed", id, error = ex.Message });
    AutomationFailures.Record();
  }
}
