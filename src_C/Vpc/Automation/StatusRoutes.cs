using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Pagination;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The console Automation page's read API (R18A A06, contract A00 §16.2): the status overview, the runs with their
/// decision counts and publishes, and every automatic decision with its QA, findings and event timeline. Read-only
/// and admin-only (editors allowed); nothing here exposes a recipient address, a secret, a token or page text.
/// Time-ordered lists page with base64url cursors of <c>{"v":1,"at":"&lt;ISO&gt;","id":"&lt;id&gt;"}</c> whose
/// <c>at</c> carries the stored timestamp to the microsecond, so a same-timestamp batch never repeats or skips.
/// </summary>
public static class StatusRoutes
{
  public const int DefaultListLimit = 50;
  public const int MaxListLimit = 100;
  public const int MaxQuestionLength = 200;
  public const int WatchFailingThreshold = 3;

  public static readonly IReadOnlyList<string> DecisionStates = ["qa_pending", "qa_queued", "would_accept", "auto_accepted", "human", "superseded"];
  public static readonly IReadOnlyList<string> PublishStates = ["waiting", "publishing", "published", "would_publish", "human"];
  public static readonly IReadOnlyList<string> RunStatuses = ["running", "completed", "failed", "abandoned"];

  private const string CursorTimeFormat = "yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'";

  private const string DecisionColumns = """
    dd.draft_id, dd.run_id, dd.deck_id, dk.slug as deck_slug, a.stable_uid, a.card->>'question' as question, dd.mode, dd.state, dd.reason,
    dd.reason_detail, dd.qa_job_id, dd.qa_status, dd.qa_error_code, dd.qa_provider, dd.qa_model, dd.qa_prompt_version, dd.blocker_count,
    dd.major_count, dd.minor_count, dd.estimated_cost_usd, dd.qa_attempts, dd.accepted_card_id, dd.human_action, dd.human_reason,
    dd.created_at, dd.updated_at, dd.decided_at
    """;

  private const string DecisionFrom = """
    from automation_draft_decisions dd
    join ai_drafts a on a.id = dd.draft_id
    left join decks dk on dk.id = dd.deck_id
    """;

  /// <summary>
  /// An open decision exception (R18B K7, R18C L4) over <c>dd</c> = automation_draft_decisions and <c>a</c> = its
  /// ai_drafts row: routed to a human, no human action yet, the draft still pending. The backlog count and the
  /// <c>open=true</c> decisions list share it.
  /// </summary>
  internal const string OpenDecisionSql = "dd.state = 'human' and dd.human_action is null and a.status = 'pending'";

  /// <summary>
  /// An open publish exception (R18B K7) over <c>p</c> = automation_publishes: a live row in state <c>human</c> that no
  /// successful deck publish created after the row's last change resolved.
  /// </summary>
  internal const string OpenHumanPublishSql = """
    p.state = 'human' and p.mode = 'live'
      and not exists (select 1 from deck_publishes dp
                      where dp.deck_id = p.deck_id and dp.status = 'SUCCESS' and dp.created_at > p.updated_at)
    """;

  /// <summary>The most <c>humanPublishItems</c> the status backlog lists (R18C L4).</summary>
  public const int MaxHumanPublishItems = 20;

  /// <summary>
  /// A <c>would_accept</c> decision (<c>dd</c>) a person decided while its verdict was hidden from them (R18C
  /// automation-4): its <c>HUMAN_ACTION</c> event records <c>blinded: true</c>.
  /// </summary>
  private const string BlindDecidedSql = """
    exists (select 1 from automation_decision_events e
            where e.draft_id = dd.draft_id and e.reason = 'HUMAN_ACTION' and e.details->>'blinded' = 'true')
    """;

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/automation/status
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleStatus(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Guard(req, res, auth);
    if (deny is not null) return deny;

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var effective = await AutomationMode.EffectiveAsync(conn);
      var serverTime = await DbUtil.ExecuteScalarAsync(conn, null, "select now()", []);

      var runnerRows = await DbUtil.QueryAsync(conn, null,
        """
        select runner_id, host, runner_version, claude_version, state, last_heartbeat_at,
          last_heartbeat_at < now() - make_interval(mins => $1) as stale,
          login_expires_at,
          round((extract(epoch from (login_expires_at - now())) / 86400)::numeric, 1) as login_expires_in_days,
          last_run_id, last_run_at, last_run_outcome, last_error
        from automation_runners
        order by runner_id
        """, [AutomationEnv.RunnerStaleMinutes()]);
      var runners = runnerRows.Select(r => new
      {
        runnerId = r["runner_id"],
        host = r["host"],
        runnerVersion = r["runner_version"],
        claudeVersion = r["claude_version"],
        state = r["state"],
        lastHeartbeatAt = RunnerRoutes.Timestamp(r["last_heartbeat_at"]),
        stale = r["stale"] is true,
        loginExpiresAt = RunnerRoutes.Timestamp(r["login_expires_at"]),
        loginExpiresInDays = r["login_expires_in_days"] is null ? (decimal?)null : Dec(r["login_expires_in_days"]),
        lastRunId = r["last_run_id"] as Guid?,
        lastRunAt = RunnerRoutes.Timestamp(r["last_run_at"]),
        lastRunOutcome = r["last_run_outcome"],
        lastError = r["last_error"],
      }).ToList();

      var q = (await DbUtil.QueryAsync(conn, null,
        """
        select
          count(*) filter (where status = 'queued') as queued,
          count(*) filter (where status = 'queued' and not_before <= now() and deck_id is not null) as due,
          count(*) filter (where status = 'claimed') as claimed,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where status = 'done' and finished_at >= now() - interval '7 days') as done_last_7d
        from authoring_queue_items
        """, []))[0];
      var queue = new
      {
        queued = RunnerRoutes.Long(q["queued"]),
        due = RunnerRoutes.Long(q["due"]),
        claimed = RunnerRoutes.Long(q["claimed"]),
        failed = RunnerRoutes.Long(q["failed"]),
        doneLast7d = RunnerRoutes.Long(q["done_last_7d"]),
      };

      var byState = ZeroFilled(DecisionStates);
      foreach (var r in await DbUtil.QueryAsync(conn, null,
        "select state, count(*) as n from automation_draft_decisions where created_at >= now() - interval '24 hours' group by state", []))
      {
        byState[(string)r["state"]!] = RunnerRoutes.Long(r["n"]);
      }
      var byReason = new SortedDictionary<string, long>(StringComparer.Ordinal);
      foreach (var r in await DbUtil.QueryAsync(conn, null,
        """
        select reason, count(*) as n from automation_draft_decisions
        where created_at >= now() - interval '24 hours' and reason is not null
        group by reason
        """, []))
      {
        byReason[(string)r["reason"]!] = RunnerRoutes.Long(r["n"]);
      }
      var decisions24h = new { byState, byReason };

      // The shadow agreement counts only blind decisions (R18C automation-4): a person who saw the would_accept
      // verdict before deciding measures nothing. The other counts cover every human decision.
      var s = (await DbUtil.QueryAsync(conn, null,
        $"""
        select
          count(*) as would_accept,
          count(*) filter (where dd.human_action is not null) as human_decided,
          count(*) filter (where dd.human_action = 'accepted') as human_accepted,
          count(*) filter (where dd.human_action = 'edited_accepted') as human_edited_accepted,
          count(*) filter (where dd.human_action = 'rejected') as human_rejected,
          count(*) filter (where dd.human_action is not null and {BlindDecidedSql}) as blind_decided,
          count(*) filter (where dd.human_action = 'accepted' and {BlindDecidedSql}) as blind_accepted
        from automation_draft_decisions dd
        where dd.state = 'would_accept' and dd.created_at >= now() - interval '30 days'
        """, []))[0];
      var blindDecided = RunnerRoutes.Long(s["blind_decided"]);
      var blindAccepted = RunnerRoutes.Long(s["blind_accepted"]);
      var shadow = new
      {
        wouldAccept = RunnerRoutes.Long(s["would_accept"]),
        humanDecided = RunnerRoutes.Long(s["human_decided"]),
        humanAccepted = RunnerRoutes.Long(s["human_accepted"]),
        humanEditedAccepted = RunnerRoutes.Long(s["human_edited_accepted"]),
        humanRejected = RunnerRoutes.Long(s["human_rejected"]),
        agreementRate = blindDecided == 0 ? (decimal?)null : Math.Round((decimal)blindAccepted / blindDecided, 4, MidpointRounding.AwayFromZero),
        blindDecided,
        blindAccepted,
      };

      var publishStates = ZeroFilled(PublishStates);
      foreach (var r in await DbUtil.QueryAsync(conn, null,
        "select state, count(*) as n from automation_publishes where created_at >= now() - interval '7 days' group by state", []))
      {
        publishStates[(string)r["state"]!] = RunnerRoutes.Long(r["n"]);
      }
      var publishes7d = new { byState = publishStates };

      var (spent, openCards) = await QaRuns.SpendTodayAsync(conn, null);
      var perCard = QaRuns.DecimalEnv(QaRuns.EstUsdPerCardEnv, QaRuns.DefaultEstUsdPerCard);
      var automationToday = await DbUtil.ExecuteScalarAsync(conn, null,
        """
        select coalesce(sum(estimated_cost_usd), 0) from automation_qa_spend
        where spent_at >= date_trunc('day', now(), 'UTC')
        """, []);
      var spend = new
      {
        todayUsd = spent,
        automationTodayUsd = Dec(automationToday),
        reservedUsd = openCards * perCard,
        dailyCapUsd = QaRuns.DecimalEnv(QaRuns.DailyCapEnv, QaRuns.DefaultDailyCapUsd),
      };

      var w = (await DbUtil.QueryAsync(conn, null,
        """
        select
          count(*) as targets,
          count(*) filter (where active) as active,
          count(*) filter (where consecutive_failures >= $1) as failing,
          max(last_checked_at) as last_checked_at,
          (select count(*) from source_watch_events
           where kind in ('changed', 'gone') and created_at >= now() - interval '7 days') as changes_7d
        from source_watch_targets
        """, [WatchFailingThreshold]))[0];
      var watch = new
      {
        targets = RunnerRoutes.Long(w["targets"]),
        active = RunnerRoutes.Long(w["active"]),
        failing = RunnerRoutes.Long(w["failing"]),
        lastCheckedAt = RunnerRoutes.Timestamp(w["last_checked_at"]),
        changes7d = RunnerRoutes.Long(w["changes_7d"]),
      };

      var n = (await DbUtil.QueryAsync(conn, null,
        """
        select
          count(*) filter (where status = 'sent' and sent_at >= now() - interval '24 hours') as sent_24h,
          count(*) filter (where status = 'failed' and updated_at >= now() - interval '24 hours') as failed_24h,
          count(*) filter (where status in ('queued', 'enqueue_failed')) as queued,
          count(*) filter (where status = 'queued' and attempts > 0 and updated_at < now() - make_interval(mins => $1)) as unconfirmed,
          max(sent_at) filter (where status = 'sent') as last_sent_at
        from automation_notifications
        """, [Notifications.UnconfirmedAfterMinutes]))[0];
      var notifications = new
      {
        sent24h = RunnerRoutes.Long(n["sent_24h"]),
        failed24h = RunnerRoutes.Long(n["failed_24h"]),
        queued = RunnerRoutes.Long(n["queued"]),
        unconfirmed = RunnerRoutes.Long(n["unconfirmed"]),
        lastSentAt = RunnerRoutes.Timestamp(n["last_sent_at"]),
      };

      var evalGate = await EvalGate.LoadCurrentAsync(conn);
      var open = await LoadBacklogAsync(conn);
      var backlog = new
      {
        humanPending = open.HumanPending,
        oldestHumanPendingAt = RunnerRoutes.Timestamp(open.OldestHumanPendingAt),
        humanPublishes = open.HumanPublishes,
        humanPublishItems = open.HumanPublishItems.Select(i => new
        {
          deckId = RunnerRoutes.Long(i["deck_id"]),
          deckSlug = i["deck_slug"],
          reason = i["reason"],
          since = RunnerRoutes.Timestamp(i["updated_at"]),
        }).ToList(),
      };

      return res.Ok(new
      {
        serverTime = RunnerRoutes.Timestamp(serverTime),
        mode = new
        {
          configured = effective.Configured,
          effective = effective.Effective,
          liveBlockedReason = effective.LiveBlockedReason,
          autoPublish = AutomationEnv.AutoPublish(),
        },
        evalGate,
        runners,
        queue,
        decisions24h,
        shadow,
        publishes7d,
        spend,
        watch,
        notifications,
        backlog,
      });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  /// <summary>The open exceptions a person still has to handle, whenever they were raised (R18B K7).</summary>
  internal sealed record Backlog(long HumanPending, object? OldestHumanPendingAt, long HumanPublishes,
    IReadOnlyList<Dictionary<string, object?>> HumanPublishItems);

  /// <summary>
  /// The open-exception backlog (R18B K7). <c>humanPending</c>: decisions in state <c>human</c> with no
  /// <c>human_action</c> whose draft is still <c>pending</c>; <c>oldestHumanPendingAt</c>: the earliest time one of them
  /// was routed (<c>decided_at</c>, else <c>created_at</c>). <c>humanPublishes</c>: live <c>automation_publishes</c> rows
  /// in state <c>human</c> that no later successful deck publish resolved. The row never leaves <c>human</c> (the
  /// person publishes from the console, not through the row), so a <c>deck_publishes</c> row of the same deck with
  /// status <c>SUCCESS</c> created after the row's last change resolves it; a newer automation publish of the deck
  /// that reached <c>published</c> implies one. A dry-run <c>human</c> row accepted nothing and is not counted (a row
  /// holding cards accepted in live keeps the <c>live</c> label after a rollback, R18C automation-12).
  /// <c>humanPublishItems</c> lists the oldest <see cref="MaxHumanPublishItems"/> of the counted rows (R18C L4).
  /// </summary>
  internal static async Task<Backlog> LoadBacklogAsync(NpgsqlConnection conn)
  {
    var row = (await DbUtil.QueryAsync(conn, null,
      $"""
      select
        (select count(*) from automation_draft_decisions dd join ai_drafts a on a.id = dd.draft_id
         where {OpenDecisionSql}) as human_pending,
        (select min(coalesce(dd.decided_at, dd.created_at)) from automation_draft_decisions dd join ai_drafts a on a.id = dd.draft_id
         where {OpenDecisionSql}) as oldest_human_pending_at,
        (select count(*) from automation_publishes p where {OpenHumanPublishSql}) as human_publishes
      """, []))[0];
    var items = await DbUtil.QueryAsync(conn, null,
      $"""
      select p.deck_id, d.slug as deck_slug, p.reason, p.updated_at
      from automation_publishes p
      left join decks d on d.id = p.deck_id
      where {OpenHumanPublishSql}
      order by p.updated_at, p.id
      limit $1
      """, [MaxHumanPublishItems]);
    return new Backlog(RunnerRoutes.Long(row["human_pending"]), row["oldest_human_pending_at"], RunnerRoutes.Long(row["human_publishes"]), items);
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/automation/runs?status=&deckId=&limit=&cursor=
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleRuns(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Guard(req, res, auth);
    if (deny is not null) return deny;

    try
    {
      var status = QueryEnum(req, "status", RunStatuses);
      var deckId = QueryId(req, "deckId");
      var limit = QueryLimit(req);
      var cursor = QueryCursor(req);
      Guid? cursorRunId = null;
      if (cursor is { } c)
      {
        if (!Guid.TryParseExact(c.Id, "D", out var rid)) throw new ValidationError("Invalid cursor", "cursor");
        cursorRunId = rid;
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var parameters = new List<object?>();
      var where = new List<string> { "true" };
      if (status is not null)
      {
        parameters.Add(status);
        where.Add($"r.status = ${parameters.Count}");
      }
      if (deckId is not null)
      {
        parameters.Add(deckId.Value);
        where.Add($"r.deck_id = ${parameters.Count}");
      }
      if (cursor is { } cur)
      {
        parameters.Add(cur.At);
        var at = parameters.Count;
        parameters.Add(cursorRunId!.Value);
        where.Add($"(r.started_at < ${at} or (r.started_at = ${at} and r.run_id > ${parameters.Count}))");
      }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select r.run_id, r.queue_item_id, q.kind, q.url, q.title, r.deck_id, d.slug as deck_slug, r.runner_id, r.status, r.outcome,
          r.started_at, r.completed_at, r.finalized_at, r.summary_notification_id, r.error, r.summary
        from automation_runs r
        join authoring_queue_items q on q.id = r.queue_item_id
        left join decks d on d.id = r.deck_id
        where {string.Join(" and ", where)}
        order by r.started_at desc, r.run_id
        limit ${parameters.Count}
        """, parameters);
      var page = rows.Take(limit).ToList();
      var runIds = page.Select(r => (Guid)r["run_id"]!).ToArray();

      var counts = new Dictionary<Guid, Dictionary<string, object?>>();
      var accepted = new Dictionary<Guid, HashSet<long>>();
      var publishes = new List<Dictionary<string, object?>>();
      if (runIds.Length > 0)
      {
        foreach (var r in await DbUtil.QueryAsync(conn, null,
          """
          select run_id, count(*) as submitted,
            count(*) filter (where state = 'qa_pending') as qa_pending,
            count(*) filter (where state = 'qa_queued') as qa_queued,
            count(*) filter (where state = 'would_accept') as would_accept,
            count(*) filter (where state = 'auto_accepted') as auto_accepted,
            count(*) filter (where state = 'human') as human,
            count(*) filter (where state = 'superseded') as superseded,
            coalesce(array_agg(accepted_card_id) filter (where accepted_card_id is not null), '{}') as accepted_card_ids
          from automation_draft_decisions
          where run_id = any($1)
          group by run_id
          """, [runIds]))
        {
          var id = (Guid)r["run_id"]!;
          counts[id] = r;
          accepted[id] = [.. (long[])r["accepted_card_ids"]!];
        }

        var allAccepted = accepted.Values.SelectMany(x => x).Distinct().ToArray();
        publishes = await DbUtil.QueryAsync(conn, null,
          """
          select p.id, p.deck_id, d.slug as deck_slug, p.run_id, p.mode, p.state, p.reason, p.reason_detail, p.job_id, p.build_id,
            p.card_ids || p.deferred_card_ids as run_card_ids, p.updated_at
          from automation_publishes p
          left join decks d on d.id = p.deck_id
          where p.run_id = any($1) or (p.card_ids || p.deferred_card_ids) && $2::bigint[]
          order by p.id
          """, [runIds, allAccepted]);
      }

      var items = page.Select(r =>
      {
        var runId = (Guid)r["run_id"]!;
        counts.TryGetValue(runId, out var cnt);
        var mine = accepted.TryGetValue(runId, out var set) ? set : [];
        long Count(string key) => cnt is null ? 0 : RunnerRoutes.Long(cnt[key]);
        return new
        {
          runId,
          queueItemId = RunnerRoutes.Long(r["queue_item_id"]),
          kind = r["kind"],
          url = r["url"],
          title = r["title"],
          deckId = NullableLong(r["deck_id"]),
          deckSlug = r["deck_slug"],
          runnerId = r["runner_id"],
          status = r["status"],
          outcome = r["outcome"],
          startedAt = RunnerRoutes.Timestamp(r["started_at"]),
          completedAt = RunnerRoutes.Timestamp(r["completed_at"]),
          finalizedAt = RunnerRoutes.Timestamp(r["finalized_at"]),
          counts = new
          {
            submitted = Count("submitted"),
            qaPending = Count("qa_pending"),
            qaQueued = Count("qa_queued"),
            wouldAccept = Count("would_accept"),
            autoAccepted = Count("auto_accepted"),
            human = Count("human"),
            superseded = Count("superseded"),
          },
          publishes = publishes
            // The batch summary's rule (R18C backend-design-17): the run's row, or a row holding one of the run's
            // accepted cards, built (card_ids) or deferred behind the deck's in-flight build (deferred_card_ids).
            .Where(p => p["run_id"] as Guid? == runId || ((long[])p["run_card_ids"]!).Any(mine.Contains))
            .Select(p => new
            {
              publishId = RunnerRoutes.Long(p["id"]),
              deckId = RunnerRoutes.Long(p["deck_id"]),
              deckSlug = p["deck_slug"],
              mode = p["mode"],
              state = p["state"],
              reason = p["reason"],
              reasonDetail = p["reason_detail"],
              jobId = p["job_id"],
              buildId = p["build_id"],
              updatedAt = RunnerRoutes.Timestamp(p["updated_at"]),
            }).ToList(),
          summaryNotificationId = r["summary_notification_id"] as Guid?,
          error = r["error"],
          // The runner's final-message notes (R18B K3): plain text, at most 2000 characters (ck_automation_runs_text).
          summary = r["summary"] as string is { } notes && !string.IsNullOrWhiteSpace(notes) ? notes : null,
        };
      }).ToList();

      var nextCursor = rows.Count > limit
        ? EncodeCursor((DateTime)page[^1]["started_at"]!, ((Guid)page[^1]["run_id"]!).ToString("D"))
        : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/automation/decisions?runId=&deckId=&state=&reason=&open=&limit=&cursor=
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleDecisions(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Guard(req, res, auth);
    if (deny is not null) return deny;

    try
    {
      Guid? runId = null;
      if (req.Query.TryGetValue("runId", out var rawRun) && !string.IsNullOrEmpty(rawRun))
      {
        if (!Guid.TryParseExact(rawRun, "D", out var rid)) throw new ValidationError("runId must be a uuid", "runId");
        runId = rid;
      }
      var deckId = QueryId(req, "deckId");
      var state = QueryEnum(req, "state", DecisionStates);
      var reason = QueryEnum(req, "reason", AutomationReasons.DecisionReasons);
      var open = QueryFlag(req, "open");
      var limit = QueryLimit(req);
      var cursor = QueryCursor(req);
      long? cursorDraftId = null;
      if (cursor is { } c)
      {
        if (!long.TryParse(c.Id, NumberStyles.None, CultureInfo.InvariantCulture, out var did) || did <= 0)
        {
          throw new ValidationError("Invalid cursor", "cursor");
        }
        cursorDraftId = did;
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var parameters = new List<object?>();
      var where = new List<string> { "true" };
      void Filter(string column, object value)
      {
        parameters.Add(value);
        where.Add($"{column} = ${parameters.Count}");
      }
      if (runId is not null) Filter("dd.run_id", runId.Value);
      if (deckId is not null) Filter("dd.deck_id", deckId.Value);
      if (state is not null) Filter("dd.state", state);
      if (reason is not null) Filter("dd.reason", reason);
      // R18C L4: only the open exceptions the backlog counts (same predicate, same keyset order).
      if (open) where.Add(OpenDecisionSql);
      if (cursor is { } cur)
      {
        parameters.Add(cur.At);
        var at = parameters.Count;
        parameters.Add(cursorDraftId!.Value);
        where.Add($"(dd.created_at < ${at} or (dd.created_at = ${at} and dd.draft_id > ${parameters.Count}))");
      }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {DecisionColumns}
        {DecisionFrom}
        where {string.Join(" and ", where)}
        order by dd.created_at desc, dd.draft_id
        limit ${parameters.Count}
        """, parameters);
      var page = rows.Take(limit).ToList();
      var items = page.Select(ToDecision).ToList();
      var nextCursor = rows.Count > limit
        ? EncodeCursor((DateTime)page[^1]["created_at"]!, RunnerRoutes.Long(page[^1]["draft_id"]).ToString(CultureInfo.InvariantCulture))
        : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/automation/decisions/:draftId
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleDecision(LambdaRequest req, Res res, AuthContext auth, string draftId)
  {
    var deny = Guard(req, res, auth);
    if (deny is not null) return deny;

    if (!long.TryParse(draftId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) return DecisionNotFound(res);

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {DecisionColumns}, a.card::text as card_json
        {DecisionFrom}
        where dd.draft_id = $1
        """, [id]);
      if (rows.Count == 0) return DecisionNotFound(res);
      var row = rows[0];

      var findings = (await DbUtil.QueryAsync(conn, null,
        "select severity, category, message, suggested_fix from automation_draft_findings where draft_id = $1 order by id", [id]))
        .Select(f => new
        {
          severity = f["severity"],
          category = f["category"],
          message = f["message"],
          suggestedFix = f["suggested_fix"],
        }).ToList();

      var events = (await DbUtil.QueryAsync(conn, null,
        """
        select from_state, to_state, reason, actor, mode, details::text as details, created_at
        from automation_decision_events where draft_id = $1 order by id
        """, [id]))
        .Select(e => new
        {
          fromState = e["from_state"],
          toState = e["to_state"],
          reason = e["reason"],
          actor = e["actor"],
          mode = e["mode"],
          details = JsonOrNull(e["details"] as string),
          createdAt = RunnerRoutes.Timestamp(e["created_at"]),
        }).ToList();

      var decision = ToDecision(row);
      decision["card"] = CardWithoutGrounding((string)row["card_json"]!);
      decision["findings"] = findings;
      decision["events"] = events;
      return res.Ok(decision);
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------------------------

  private static APIGatewayProxyResponse? Guard(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    return null;
  }

  private static APIGatewayProxyResponse DecisionNotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "DRAFT_DECISION_NOT_FOUND", "Draft decision not found");

  private static Dictionary<string, long> ZeroFilled(IEnumerable<string> keys) => keys.ToDictionary(k => k, _ => 0L, StringComparer.Ordinal);

  private static decimal Dec(object? v) => Convert.ToDecimal(v, CultureInfo.InvariantCulture);

  private static long? NullableLong(object? v) => v is null ? null : RunnerRoutes.Long(v);

  private static JsonElement? JsonOrNull(string? json)
  {
    if (json is null) return null;
    using var doc = JsonDocument.Parse(json);
    return doc.RootElement.Clone();
  }

  private static string? QueryEnum(LambdaRequest req, string name, IReadOnlyList<string> allowed)
  {
    if (!req.Query.TryGetValue(name, out var v) || string.IsNullOrEmpty(v)) return null;
    if (!allowed.Contains(v, StringComparer.Ordinal)) throw new ValidationError($"{name} must be one of {string.Join(", ", allowed)}", name);
    return v;
  }

  /// <summary>A boolean query flag: <c>true</c>/<c>1</c> or <c>false</c>/<c>0</c>; absent or empty is false.</summary>
  private static bool QueryFlag(LambdaRequest req, string name)
  {
    if (!req.Query.TryGetValue(name, out var v) || string.IsNullOrEmpty(v)) return false;
    return v switch
    {
      "true" or "1" => true,
      "false" or "0" => false,
      _ => throw new ValidationError($"{name} must be true or false", name),
    };
  }

  private static long? QueryId(LambdaRequest req, string name)
  {
    if (!req.Query.TryGetValue(name, out var v) || string.IsNullOrEmpty(v)) return null;
    if (!long.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0)
    {
      throw new ValidationError($"{name} must be a positive integer", name);
    }
    return id;
  }

  private static int QueryLimit(LambdaRequest req)
  {
    if (!req.Query.TryGetValue("limit", out var v) || string.IsNullOrEmpty(v)) return DefaultListLimit;
    if (!int.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out var limit) || limit is < 1 or > MaxListLimit)
    {
      throw new ValidationError($"limit must be an integer in 1..{MaxListLimit}", "limit");
    }
    return limit;
  }

  private readonly record struct TimeCursor(DateTime At, string Id);

  private static TimeCursor? QueryCursor(LambdaRequest req)
  {
    if (!req.Query.TryGetValue("cursor", out var raw) || string.IsNullOrEmpty(raw)) return null;
    return DecodeCursor(raw) ?? throw new ValidationError("Invalid cursor", "cursor");
  }

  /// <summary>base64url of <c>{"v":1,"at":"&lt;ISO, microseconds, UTC&gt;","id":"&lt;id&gt;"}</c> (A00 §16.2).</summary>
  internal static string EncodeCursor(DateTime at, string id)
  {
    var utc = DateTime.SpecifyKind(at, DateTimeKind.Utc);
    var json = JsonSerializer.Serialize(new { v = 1, at = utc.ToString(CursorTimeFormat, CultureInfo.InvariantCulture), id });
    return CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(json));
  }

  private static TimeCursor? DecodeCursor(string raw)
  {
    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return null;
    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object || !CursorCodec.TryReadVersion(root)) return null;
      if (!root.TryGetProperty("at", out var atEl) || atEl.ValueKind != JsonValueKind.String) return null;
      if (!root.TryGetProperty("id", out var idEl) || idEl.ValueKind != JsonValueKind.String) return null;
      if (!DateTime.TryParseExact(atEl.GetString(), CursorTimeFormat, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at))
      {
        return null;
      }
      var id = idEl.GetString();
      if (string.IsNullOrEmpty(id)) return null;
      return new TimeCursor(DateTime.SpecifyKind(at, DateTimeKind.Utc), id);
    }
    catch (JsonException)
    {
      return null;
    }
  }

  private static string? Truncate(string? s, int max)
  {
    if (s is null || s.Length <= max) return s;
    var cut = char.IsHighSurrogate(s[max - 1]) ? max - 1 : max;
    return s[..cut];
  }

  private static Dictionary<string, object?> ToDecision(Dictionary<string, object?> r)
  {
    var qa = r["qa_job_id"] is null ? null : new
    {
      jobId = r["qa_job_id"] as Guid?,
      status = r["qa_status"],
      errorCode = r["qa_error_code"],
      provider = r["qa_provider"],
      model = r["qa_model"],
      promptVersion = r["qa_prompt_version"],
      blocker = Convert.ToInt32(r["blocker_count"], CultureInfo.InvariantCulture),
      major = Convert.ToInt32(r["major_count"], CultureInfo.InvariantCulture),
      minor = Convert.ToInt32(r["minor_count"], CultureInfo.InvariantCulture),
      estimatedCostUsd = Dec(r["estimated_cost_usd"]),
      attempts = Convert.ToInt32(r["qa_attempts"], CultureInfo.InvariantCulture),
    };
    return new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["draftId"] = RunnerRoutes.Long(r["draft_id"]),
      ["runId"] = r["run_id"] as Guid?,
      ["deckId"] = RunnerRoutes.Long(r["deck_id"]),
      ["deckSlug"] = r["deck_slug"],
      ["stableUid"] = r["stable_uid"],
      ["question"] = Truncate(r["question"] as string, MaxQuestionLength),
      ["mode"] = r["mode"],
      ["state"] = r["state"],
      ["reason"] = r["reason"],
      ["reasonDetail"] = r["reason_detail"],
      ["qa"] = qa,
      ["acceptedCardId"] = NullableLong(r["accepted_card_id"]),
      ["humanAction"] = r["human_action"],
      ["humanReason"] = r["human_reason"],
      ["createdAt"] = RunnerRoutes.Timestamp(r["created_at"]),
      ["updatedAt"] = RunnerRoutes.Timestamp(r["updated_at"]),
      ["decidedAt"] = RunnerRoutes.Timestamp(r["decided_at"]),
    };
  }

  /// <summary>
  /// The stored draft card as <see cref="DraftCard.ToJson"/> without grounding. A stored card that no longer parses
  /// (a rule tightened after submit) is returned as stored, minus <c>source.grounding</c>.
  /// </summary>
  private static JsonElement CardWithoutGrounding(string cardJson)
  {
    using var doc = JsonDocument.Parse(cardJson);
    try
    {
      using var clean = JsonDocument.Parse(DraftCard.Parse(doc.RootElement).ToJson(includeGrounding: false));
      return clean.RootElement.Clone();
    }
    catch (DraftCardError)
    {
      using var stream = new MemoryStream();
      using (var writer = new Utf8JsonWriter(stream))
      {
        writer.WriteStartObject();
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
          if (prop.Name == "source" && prop.Value.ValueKind == JsonValueKind.Object)
          {
            writer.WritePropertyName("source");
            writer.WriteStartObject();
            foreach (var sp in prop.Value.EnumerateObject().Where(sp => sp.Name != "grounding")) sp.WriteTo(writer);
            writer.WriteEndObject();
          }
          else
          {
            prop.WriteTo(writer);
          }
        }
        writer.WriteEndObject();
      }
      using var stripped = JsonDocument.Parse(stream.ToArray());
      return stripped.RootElement.Clone();
    }
  }
}
