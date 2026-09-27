using System.Globalization;
using System.Text.Json;
using Amazon.SQS;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// Automatic draft decisions (R18A A03, contract A00 §5.1–§5.3, §5.7, §9.2): one <c>automation_draft_decisions</c> row
/// per draft an automation run submits, its prechecks, the draft-QA enqueue under the shared daily USD cap and the
/// human hooks. Every state change appends exactly one <c>automation_decision_events</c> row in the same transaction.
/// The public entry points run after the business commit and never throw (A00 §0.7).
/// </summary>
public static class DraftDecisions
{
  public const string QaEnqueueFailuresMetric = "AutomationQaEnqueueFailures";
  public const int MaxQaEnqueueAttempts = 3;

  public const string QaPending = "qa_pending", QaQueued = "qa_queued", WouldAccept = "would_accept", AutoAccepted = "auto_accepted",
    Human = "human", Superseded = "superseded";

  internal const string AutomationEventActor = "automation";

  /// <summary>
  /// A draft of an automation run still without a decision this long after its submit lost its after-commit hook
  /// (R18C, backend-design-10): the tick's <see cref="SweepMissingAsync"/> creates the decision.
  /// </summary>
  public const int MissingDecisionGraceMinutes = 5;
  internal const int MaxReasonDetailLength = 300;

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS() => _sqs ??= new AmazonSQSClient(WebhookEvents.BoundedSqsConfig());

  // ---------------------------------------------------------------------------------------------
  // submit (A00 §5.1)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Records a decision for every created draft of an automation run (effective mode <c>dry_run</c>/<c>live</c>, an
  /// agent client, an <c>agent.runId</c> naming an <c>automation_runs</c> row), runs the prechecks in contract order
  /// and enqueues draft QA for the eligible ones. Never throws.
  /// </summary>
  public static async Task OnSubmittedAsync(NpgsqlConnection conn, AuthContext auth, long deckId, string deckSlug, string? agentJson,
    IReadOnlyList<long> createdDraftIds, CancellationToken ct = default)
  {
    try
    {
      if (createdDraftIds.Count == 0) return;
      var rawRunId = RunIdOf(agentJson);
      if (rawRunId is null) return;

      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      if (mode.Effective is not (AutomationMode.DryRun or AutomationMode.Live)) return;
      if (!auth.IsAgentClient) return;

      if (!Guid.TryParse(rawRunId, out var runId))
      {
        Log.Event("warn", new { tag = "automation", reason = "run_unknown", deckId, detail = "unparsable" });
        return;
      }
      var runRows = await DbUtil.QueryAsync(conn, null,
        "select status, owner_sub, deck_id from automation_runs where run_id = $1", [runId]);
      if (runRows.Count == 0)
      {
        Log.Event("warn", new { tag = "automation", reason = "run_unknown", deckId, runId });
        return;
      }
      var run = runRows[0];

      var drafts = await DbUtil.QueryAsync(conn, null,
        """select id, deck_id, stable_uid, card::text as card, "similar"::text as similar_json from ai_drafts where id = any($1) order by id""",
        [createdDraftIds.ToArray()]);

      foreach (var draft in drafts)
      {
        await DecideAsync(conn, auth.UserSub, run, runId, draft, deckSlug, mode.Effective, ct);
      }
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", sqlState = pg.SqlState, where = "on_submitted" });
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "on_submitted_failed", deckId, error = ex.Message });
      AutomationFailures.Record();
    }
  }

  /// <summary>
  /// The decision of one draft of run <paramref name="runId"/> submitted by <paramref name="submitterSub"/>: the
  /// prechecks, the row and its first event (a draft that already has a decision is left alone), then the ledger row of
  /// a live human route or the draft-QA enqueue. Returns whether a decision was created.
  /// </summary>
  private static async Task<bool> DecideAsync(NpgsqlConnection conn, string? submitterSub, Dictionary<string, object?> run, Guid runId,
    Dictionary<string, object?> draft, string deckSlug, string mode, CancellationToken ct)
  {
    var draftId = Convert.ToInt64(draft["id"], CultureInfo.InvariantCulture);
    var deckId = Convert.ToInt64(draft["deck_id"], CultureInfo.InvariantCulture);
    var reason = await PrecheckAsync(conn, submitterSub, run, draft, deckSlug, ct);
    var state = reason is null ? QaPending : Human;

    bool inserted;
    await using (var tx = await conn.BeginTransactionAsync(ct))
    {
      var rows = await DbUtil.QueryAsync(conn, tx,
        """
        insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, reason, decided_at)
        values ($1, $2, $3, $4, $5, $6::text, case when $5 = 'human' then now() end)
        on conflict (draft_id) do nothing
        returning draft_id
        """,
        [draftId, runId, deckId, mode, state, reason]);
      inserted = rows.Count > 0;
      if (inserted)
      {
        await AppendEventAsync(conn, tx, draftId, null, state, reason, AutomationEventActor, mode, new { runId }, ct);
      }
      await tx.CommitAsync(ct);
    }
    if (!inserted) return false;

    Log.Event("info", new { tag = "automation", outcome = "decision_created", draftId, runId, state, reason, mode });
    if (state == Human)
    {
      if (mode == AutomationMode.Live) await AutomationLedger.RecordAsync(conn, RouteLedgerEvent(draftId, deckId, reason!, null), ct);
    }
    else
    {
      await EnqueueQaAsync(conn, draftId, ct);
    }
    return true;
  }

  /// <summary>
  /// Tick step (R18C, backend-design-10/automation-18): a pending draft that names an automation run in
  /// <c>agent.runId</c>, was submitted by that run's owner more than <see cref="MissingDecisionGraceMinutes"/> ago and
  /// still has no decision lost its <see cref="OnSubmittedAsync"/> hook (a crash or a swallowed error after the submit
  /// commit). It gets its decision now, through the same prechecks: a run that is no longer <c>running</c> routes it to a
  /// human with <c>RUN_NOT_RUNNING</c>, so a late decision is never automatic. At most <paramref name="max"/>; returns how
  /// many decisions were created. Effective <c>off</c> creates nothing. Throws, so the tick counts a failing sweep.
  /// </summary>
  internal static async Task<int> SweepMissingAsync(NpgsqlConnection conn, int max, Func<bool>? stop = null, CancellationToken ct = default)
  {
    var mode = await AutomationMode.EffectiveAsync(conn, ct);
    if (mode.Effective is not (AutomationMode.DryRun or AutomationMode.Live)) return 0;

    var drafts = await DbUtil.QueryAsync(conn, null,
      """
      select a.id, a.deck_id, a.stable_uid, a.card::text as card, a."similar"::text as similar_json, a.submitted_by_sub,
             d.slug as deck_slug, r.run_id, r.status, r.owner_sub, r.deck_id as run_deck_id
      from ai_drafts a
      join automation_runs r on r.run_id::text = lower(a.agent->>'runId') and r.owner_sub = a.submitted_by_sub
      join decks d on d.id = a.deck_id
      where a.status = 'pending'
        and a.created_at < now() - make_interval(mins => $2)
        and not exists (select 1 from automation_draft_decisions x where x.draft_id = a.id)
      order by a.id
      limit $1
      """, [max, MissingDecisionGraceMinutes]);
    var created = 0;
    foreach (var draft in drafts)
    {
      if (stop?.Invoke() == true) break;
      var run = new Dictionary<string, object?>(StringComparer.Ordinal)
      {
        ["status"] = draft["status"],
        ["owner_sub"] = draft["owner_sub"],
        ["deck_id"] = draft["run_deck_id"],
      };
      var runId = (Guid)draft["run_id"]!;
      if (!await DecideAsync(conn, draft["submitted_by_sub"] as string, run, runId, draft, (string)draft["deck_slug"]!, mode.Effective, ct)) continue;
      created++;
      Log.Event("warn", new { tag = "automation", outcome = "decision_swept", draftId = draft["id"], runId });
    }
    return created;
  }

  /// <summary>The first failing precheck of A00 §5.1 in table order, or null when the draft is eligible for draft QA.</summary>
  private static async Task<string?> PrecheckAsync(NpgsqlConnection conn, string? submitterSub, Dictionary<string, object?> run,
    Dictionary<string, object?> draft, string deckSlug, CancellationToken ct)
  {
    ct.ThrowIfCancellationRequested();
    var draftDeckId = Convert.ToInt64(draft["deck_id"], CultureInfo.InvariantCulture);

    if ((string)run["status"]! != "running" || !string.Equals(run["owner_sub"] as string, submitterSub, StringComparison.Ordinal))
    {
      return "RUN_NOT_RUNNING";
    }
    if (run["deck_id"] is null || Convert.ToInt64(run["deck_id"], CultureInfo.InvariantCulture) != draftDeckId) return "DECK_MISMATCH";

    var slugs = AutomationEnv.DeckSlugs();
    if (slugs is not null && !slugs.Contains(deckSlug)) return "DECK_NOT_ALLOWED";

    var existing = await DbUtil.ExecuteScalarAsync(conn, null,
      "select 1 from cards where deck_id = $1 and stable_uid = $2 limit 1", [draftDeckId, (string)draft["stable_uid"]!]);
    if (existing is not null) return "EXISTING_CARD";

    using (var similar = JsonDocument.Parse(draft["similar_json"] as string ?? "[]"))
    {
      if (similar.RootElement.ValueKind == JsonValueKind.Array && similar.RootElement.EnumerateArray().Any(e =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty("likelyDuplicate", out var d) && d.ValueKind == JsonValueKind.True))
      {
        return "LIKELY_DUPLICATE";
      }
    }

    using var card = JsonDocument.Parse((string)draft["card"]!);
    var source = card.RootElement.TryGetProperty("source", out var s) && s.ValueKind == JsonValueKind.Object ? s : (JsonElement?)null;
    var grounded = source is { } src && src.TryGetProperty("grounding", out var g) && g.ValueKind == JsonValueKind.Object &&
      g.TryGetProperty("matched", out var matched) && matched.ValueKind == JsonValueKind.True;
    if (!grounded) return "UNGROUNDED";

    var url = source is { } so && so.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
    if (url is null || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || !AutomationEnv.SourceHosts().Contains(uri.Host.ToLowerInvariant()))
    {
      return "SOURCE_HOST_NOT_ALLOWED";
    }

    if (!QaAvailable()) return "QA_UNAVAILABLE";
    return null;
  }

  private static bool QaAvailable() =>
    Env.Flag(QaGate.EnabledEnv) && !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(QaRuns.QueueUrlEnv));

  private static string? RunIdOf(string? agentJson)
  {
    if (agentJson is null) return null;
    using var doc = JsonDocument.Parse(agentJson);
    return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("runId", out var el) &&
      el.ValueKind == JsonValueKind.String ? el.GetString() : null;
  }

  // ---------------------------------------------------------------------------------------------
  // draft-QA enqueue (A00 §9.2)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Enqueues draft QA for a <c>qa_pending</c> decision: reserves the spend under the shared daily cap, marks the
  /// decision <c>qa_queued</c> with a fresh job id and sends the §9.2 message. Returns the decision's state afterwards
  /// (<c>none</c> without a decision, <c>unknown</c> when something failed). Never throws.
  /// </summary>
  internal static async Task<string> EnqueueQaAsync(NpgsqlConnection conn, long draftId, CancellationToken ct = default)
  {
    try
    {
      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      var jobId = Guid.NewGuid();
      string? routedReason = null;
      long deckId;
      string stableUid;
      string contentSha256;
      DraftCard card;
      (string Slug, string Title) deck;
      var capReached = false;

      await using (var tx = await conn.BeginTransactionAsync(ct))
      {
        var rows = await DbUtil.QueryAsync(conn, tx,
          """
          select d.state, d.mode, d.deck_id, a.status as draft_status, a.stable_uid, a.card::text as card
          from automation_draft_decisions d
          join ai_drafts a on a.id = d.draft_id
          where d.draft_id = $1
          for update of d
          """,
          [draftId]);
        if (rows.Count == 0) return "none";
        var row = rows[0];
        var state = (string)row["state"]!;
        if (state != QaPending) return state;
        deckId = Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture);
        stableUid = (string)row["stable_uid"]!;

        if ((string)row["draft_status"]! != "pending")
        {
          await TransitionAsync(conn, tx, draftId, QaPending, Superseded, "DECIDED_BY_HUMAN", null, AutomationEventActor, mode.Effective, null, ct);
          await tx.CommitAsync(ct);
          return Superseded;
        }
        if (!QaAvailable())
        {
          var applied = await TransitionAsync(conn, tx, draftId, QaPending, Human, "QA_UNAVAILABLE", null, AutomationEventActor, mode.Effective, null, ct);
          await tx.CommitAsync(ct);
          routedReason = "QA_UNAVAILABLE";
          // The ledger follows the mode this transition applied (R18C backend-design-16), not the mode of the submit.
          if (applied == AutomationMode.Live) await AutomationLedger.RecordAsync(conn, RouteLedgerEvent(draftId, deckId, routedReason, null), ct);
          return Human;
        }

        using (var cardDoc = JsonDocument.Parse((string)row["card"]!))
        {
          card = DraftCard.Parse(cardDoc.RootElement);
        }
        contentSha256 = await DraftContentHashAsync(conn, tx, card, ct);

        var deckRows = await DbUtil.QueryAsync(conn, tx, "select slug, title from decks where id = $1", [deckId]);
        deck = deckRows.Count == 0
          ? (string.Empty, string.Empty)
          : (Convert.ToString(deckRows[0]["slug"], CultureInfo.InvariantCulture) ?? string.Empty,
             Convert.ToString(deckRows[0]["title"], CultureInfo.InvariantCulture) ?? string.Empty);

        // The shared daily cap (A00 §9.5): the same reservation rule and lock as a human QA run start.
        await DbUtil.ExecuteAsync(conn, tx, "select pg_advisory_xact_lock($1)", [QaRuns.DailyCapLockKey]);
        var (spent, openCards) = await QaRuns.SpendTodayAsync(conn, tx);
        var cap = QaRuns.DecimalEnv(QaRuns.DailyCapEnv, QaRuns.DefaultDailyCapUsd);
        var perCard = QaRuns.DecimalEnv(QaRuns.EstUsdPerCardEnv, QaRuns.DefaultEstUsdPerCard);
        if (spent >= cap || spent + openCards * perCard + perCard > cap)
        {
          // A reason change without a state change: no event.
          await DbUtil.ExecuteAsync(conn, tx,
            "update automation_draft_decisions set reason = 'AI_QA_DAILY_CAP', reason_detail = null, updated_at = now() where draft_id = $1",
            [draftId]);
          capReached = true;
        }
        else
        {
          await DbUtil.ExecuteAsync(conn, tx,
            """
            update automation_draft_decisions
            set qa_job_id = $2, qa_content_sha256 = $3, qa_enqueued_at = now(), qa_attempts = qa_attempts + 1, state = 'qa_queued',
              reason = null, reason_detail = null, updated_at = now()
            where draft_id = $1
            """,
            [draftId, jobId, contentSha256]);
          await AppendEventAsync(conn, tx, draftId, QaPending, QaQueued, null, AutomationEventActor, mode.Effective, new { qaJobId = jobId }, ct);
        }
        await tx.CommitAsync(ct);
      }

      if (capReached)
      {
        var waiting = await DbUtil.ExecuteScalarAsync(conn, null,
          "select count(*) from automation_draft_decisions where state = 'qa_pending' and reason = 'AI_QA_DAILY_CAP'", []);
        var utcDate = DateTime.UtcNow;
        await RaiseExceptionAsync(conn, "ai_qa_daily_cap",
          $"exception:ai_qa_daily_cap:{utcDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}",
          new Dictionary<string, string> { ["waiting"] = Convert.ToString(waiting, CultureInfo.InvariantCulture) ?? "0" }, ct);
        return QaPending;
      }

      var message = JsonSerializer.Serialize(new
      {
        v = 1,
        runId = jobId,
        chunk = 0,
        chunkCount = 1,
        promptVersion = QaRuns.AutomationPromptVersion,
        target = "draft",
        profile = QaRuns.AutomationProfile,
        deck = new { id = deckId, slug = deck.Slug, title = deck.Title },
        reviewDate = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        cards = new[]
        {
          new
          {
            cardId = draftId,
            stableUid,
            contentSha256,
            difficulty = card.Difficulty,
            topic = card.Topic,
            question = card.Question,
            explanation = card.Explanation,
            codeSnippet = card.CodeSnippet,
            codeLanguage = card.CodeLanguage,
            realWorldUsage = card.RealWorldUsage,
            mcq = card.McqJson is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(card.McqJson),
            source = JsonSerializer.Deserialize<JsonElement>(card.SourceJson),
          },
        },
      });
      var request = new SendMessageRequest { QueueUrl = Environment.GetEnvironmentVariable(QaRuns.QueueUrlEnv)?.Trim(), MessageBody = message };

      try
      {
        if (QaRuns.TestSendSeam is not null) await QaRuns.TestSendSeam(request);
        else await SQS().SendMessageAsync(request, ct);
        Log.Event("info", new { tag = "automation", outcome = "draft_qa_enqueued", draftId, qaJobId = jobId });
        return QaQueued;
      }
      catch (Exception ex)
      {
        Log.Event("error", new { tag = "automation", outcome = "draft_qa_enqueue_failed", draftId, qaJobId = jobId, error = ex.Message });
        RouteMetrics.EmitGauge(QaEnqueueFailuresMetric, 1);
        return await EnqueueFailedAsync(conn, draftId, jobId, deckId, ct);
      }
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", sqlState = pg.SqlState, where = "enqueue_qa", draftId });
      return "unknown";
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "enqueue_qa_failed", draftId, error = ex.Message });
      AutomationFailures.Record();
      return "unknown";
    }
  }

  /// <summary>
  /// A failed send of job <paramref name="jobId"/>: the reservation is released (<c>qa_queued</c> → <c>qa_pending</c> /
  /// <c>ENQUEUE_RETRY</c>, retried by the tick) or, after <see cref="MaxQaEnqueueAttempts"/> attempts, the draft goes to
  /// a human with <c>ENQUEUE_FAILED</c>.
  /// </summary>
  private static async Task<string> EnqueueFailedAsync(NpgsqlConnection conn, long draftId, Guid jobId, long deckId, CancellationToken ct)
  {
    var mode = await AutomationMode.EffectiveAsync(conn, ct);
    string to;
    string applied;
    await using (var tx = await conn.BeginTransactionAsync(ct))
    {
      var rows = await DbUtil.QueryAsync(conn, tx,
        "select state, qa_job_id, qa_attempts from automation_draft_decisions where draft_id = $1 for update", [draftId]);
      if (rows.Count == 0) return "none";
      var state = (string)rows[0]["state"]!;
      // A report or a human decision got there first: nothing to release.
      if (state != QaQueued || rows[0]["qa_job_id"] as Guid? != jobId) return state;

      var attempts = Convert.ToInt32(rows[0]["qa_attempts"], CultureInfo.InvariantCulture);
      to = attempts < MaxQaEnqueueAttempts ? QaPending : Human;
      var reason = to == QaPending ? "ENQUEUE_RETRY" : "ENQUEUE_FAILED";
      await DbUtil.ExecuteAsync(conn, tx,
        "update automation_draft_decisions set qa_enqueued_at = null where draft_id = $1", [draftId]);
      applied = await TransitionAsync(conn, tx, draftId, QaQueued, to, reason, null, AutomationEventActor, mode.Effective,
        new { qaJobId = jobId, attempts }, ct);
      await tx.CommitAsync(ct);
    }

    if (to == Human && applied == AutomationMode.Live)
    {
      await AutomationLedger.RecordAsync(conn, RouteLedgerEvent(draftId, deckId, "ENQUEUE_FAILED", null), ct);
    }
    return to;
  }

  /// <summary>
  /// The content hash of a draft as the accepted card will hash (A00 §9.2 step 1): <see cref="CardContentHash.Compute"/>
  /// over the DraftCard's columns, with <c>mcq</c>/<c>source</c> (no grounding) read back through PostgreSQL's jsonb
  /// text exactly as a <c>cards</c> row yields them.
  /// </summary>
  internal static async Task<string> DraftContentHashAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, DraftCard card, CancellationToken ct = default)
  {
    ct.ThrowIfCancellationRequested();
    var rows = await DbUtil.QueryAsync(conn, tx, "select $1::jsonb::text as mcq, $2::jsonb::text as source", [card.McqJson, card.SourceJson]);
    var row = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["question"] = card.Question,
      ["explanation"] = card.Explanation,
      ["codeSnippet"] = card.CodeSnippet,
      ["codeLanguage"] = card.CodeLanguage,
      ["realWorldUsage"] = card.RealWorldUsage,
      ["difficulty"] = card.Difficulty,
      ["topic"] = card.Topic,
      ["mcq"] = rows[0]["mcq"],
      ["source"] = rows[0]["source"],
    };
    return CardContentHash.Compute(row);
  }

  // ---------------------------------------------------------------------------------------------
  // human actions (A00 §5.7)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Records a human accept/reject on the draft's decision: an unfinished one (<c>qa_pending</c>/<c>qa_queued</c>)
  /// becomes <c>superseded</c> / <c>DECIDED_BY_HUMAN</c>; a finished one keeps its state and gets a
  /// <c>HUMAN_ACTION</c> event (shadow measurement). That event records <c>blinded</c>: whether the verdict was hidden
  /// from the person when they decided (a dry-run <c>would_accept</c>, which the review queue and the batch email hide),
  /// so the shadow agreement counts blind decisions only (R18C automation-4). No decision ⇒ nothing. Never throws.
  /// </summary>
  public static async Task OnHumanDecisionAsync(NpgsqlConnection conn, long draftId, string action, string? reason, string actorSub,
    CancellationToken ct = default)
  {
    try
    {
      var exists = await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.automation_draft_decisions') is not null", []);
      if (exists is not true)
      {
        Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", where = "on_human_decision", draftId });
        return;
      }

      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      await using var tx = await conn.BeginTransactionAsync(ct);
      var rows = await DbUtil.QueryAsync(conn, tx, "select state, mode from automation_draft_decisions where draft_id = $1 for update", [draftId]);
      if (rows.Count == 0) return;
      var state = (string)rows[0]["state"]!;
      var blinded = state == WouldAccept && (string)rows[0]["mode"]! == AutomationMode.DryRun;

      await DbUtil.ExecuteAsync(conn, tx,
        """
        update automation_draft_decisions
        set human_action = $2, human_reason = $3::text, human_decided_at = now(), updated_at = now()
        where draft_id = $1
        """,
        [draftId, action, reason]);

      var actor = $"human:{actorSub}";
      var details = new { humanAction = action, humanReason = reason };
      if (state is QaPending or QaQueued)
      {
        await TransitionAsync(conn, tx, draftId, state, Superseded, "DECIDED_BY_HUMAN", null, actor, mode.Effective, details, ct);
      }
      else
      {
        await AppendEventAsync(conn, tx, draftId, state, state, AutomationReasons.HumanAction, actor, mode.Effective,
          new { humanAction = action, humanReason = reason, blinded }, ct);
      }
      await tx.CommitAsync(ct);
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", sqlState = pg.SqlState, where = "on_human_decision", draftId });
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "on_human_decision_failed", draftId, error = ex.Message });
      AutomationFailures.Record();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // shared helpers (also used by DraftQaResults)
  // ---------------------------------------------------------------------------------------------

  /// <summary>The <c>auto_accept</c> ledger row of a live decision routed to a human (A00 §14).</summary>
  internal static AutomationEvent RouteLedgerEvent(long draftId, long deckId, string reason, string? reasonDetail) =>
    new("auto_accept", 0, AutomationReasons.LedgerOutcome(reason), DeckId: deckId, Ref: draftId.ToString(CultureInfo.InvariantCulture),
      DedupeKey: $"auto-route:{draftId.ToString(CultureInfo.InvariantCulture)}", Details: new { reason, reasonDetail });

  /// <summary>
  /// The exception hook (A00 §12.4): the alert email through <see cref="Notifications.RaiseExceptionAsync"/>. Never throws.
  /// </summary>
  internal static Task RaiseExceptionAsync(NpgsqlConnection conn, string subkind, string dedupeKey,
    IReadOnlyDictionary<string, string> facts, CancellationToken ct = default) =>
    Notifications.RaiseExceptionAsync(conn, subkind, dedupeKey, facts, ct: ct);

  /// <summary>
  /// One state change of a decision plus its event, inside <paramref name="tx"/>. Terminal states set <c>decided_at</c>
  /// and the decision's <c>mode</c> to <paramref name="mode"/>, the effective mode the deciding transaction applied
  /// (R18C backend-design-16), so a draft submitted in <c>dry_run</c> and decided under <c>live</c> reads <c>live</c>.
  /// Effective <c>off</c> is not a decision mode: the mode of the submit stays. Returns the decision's mode afterwards,
  /// which is the mode its ledger row follows.
  /// </summary>
  internal static async Task<string> TransitionAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long draftId, string from, string to,
    string? reason, string? reasonDetail, string actor, string mode, object? details, CancellationToken ct)
  {
    var detail = reasonDetail is { Length: > MaxReasonDetailLength } ? reasonDetail[..MaxReasonDetailLength] : reasonDetail;
    var rows = await DbUtil.QueryAsync(conn, tx,
      """
      update automation_draft_decisions
      set state = $2, reason = $3::text, reason_detail = $4::text, updated_at = now(),
        decided_at = case when $2 in ('would_accept','auto_accepted','human','superseded') then now() else decided_at end,
        mode = case when $2 in ('would_accept','auto_accepted','human','superseded') and $5 in ('dry_run','live') then $5 else mode end
      where draft_id = $1
      returning mode
      """,
      [draftId, to, reason, detail, mode]);
    await AppendEventAsync(conn, tx, draftId, from, to, reason, actor, mode, details, ct);
    return rows.Count == 0 ? mode : (string)rows[0]["mode"]!;
  }

  /// <summary>Appends one <c>automation_decision_events</c> row inside <paramref name="tx"/>.</summary>
  internal static async Task AppendEventAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long draftId, string? from, string to,
    string? reason, string actor, string mode, object? details, CancellationToken ct)
  {
    ct.ThrowIfCancellationRequested();
    await DbUtil.ExecuteAsync(conn, tx,
      """
      insert into automation_decision_events (draft_id, from_state, to_state, reason, actor, mode, details)
      values ($1, $2::text, $3, $4::text, $5, $6, $7::jsonb)
      """,
      [draftId, from, to, reason, actor, mode, details is null ? null : JsonSerializer.Serialize(details)]);
  }
}
