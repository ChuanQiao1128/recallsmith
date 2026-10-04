using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The core half of the source watch (R18A A05, contract A00 §10.3–§10.5): the watcher Lambda asks which pages and
/// feeds are due (<c>targets</c>), fetches them itself and reports what it saw (<c>report</c>); core owns every decision.
/// A changed or vanished cited page never touches an existing card (decision 2): it starts an AI QA re-check of the
/// cards citing it, whose findings go to a human, and queues a <c>source_changed</c> item so the runner can draft new
/// cards. New matching feed items become <c>feed_item</c> queue items; a first observation is a baseline and queues
/// nothing. Re-check starts, webhooks, exception emails and the ledger row run after the report's commit and never fail
/// it. Logs carry ids, statuses and counts only, never page text or quotes.
/// </summary>
public static class SourceWatchRoutes
{
  public const int LeaseMinutes = 15, PageIntervalMinutes = 10080, FailingThreshold = 3, MaxObservations = 100, MaxFeedItems = 200,
    MaxQuotes = 50, MaxRecheckCards = 200;

  /// <summary>The normaliser whose hashes are comparable (A00 §10.6); any other stored value re-baselines the target.</summary>
  public const string Normalizer = "v1";
  public const int MaxUrlLength = 2048;
  public const int MaxQueueTextLength = 300;
  /// <summary>A <c>waiting</c> re-check still pending after this long is given up (tick step 8).</summary>
  public const int RecheckGiveUpHours = 24;

  /// <summary>
  /// The <c>last_error</c> prefix of a queued <c>source_changed</c> item skipped because a newer change of the same page
  /// queued an item for the same deck (R28 review F4): one queued item per page and deck, so a page that changes again
  /// while the daily claim cap holds its first item is authored once, from its newest state.
  /// </summary>
  public const string SupersededError = "SUPERSEDED";

  private static readonly string[] Statuses = ["ok", "not_modified", "failed", "gone", "unsupported", "robots_disallowed"];
  private static readonly string[] ErrorCodes = ["TIMEOUT", "DNS", "TLS", "URL_REJECTED", "TOO_LARGE", "HTTP_4XX", "HTTP_5XX", "REDIRECT_LIMIT", "PARSE"];
  private static readonly Regex Sha256Regex = new("^[0-9a-f]{64}$", RegexOptions.Compiled);

  // ---------------------------------------------------------------------------------------------
  // POST /api/internal/source-watch/targets (A00 §10.4)
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleTargets(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    var v = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.SourceWatchSecretEnv);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);
      RequireVersion(body);
      var watchRunId = AutomationBody.OptionalUuid(body, "watchRunId") ?? throw new ValidationError("watchRunId must be a uuid", "watchRunId");
      var max = AutomationBody.OptionalInt(body, "max", 1, MaxObservations) ?? throw new ValidationError($"max must be an integer in 1..{MaxObservations}", "max");

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      if (!await ReadyAsync(conn)) return RunnerRoutes.NotReady(res);

      var mode = await AutomationMode.EffectiveAsync(conn);
      if (mode.LiveBlockedReason == AutomationMode.ServerNotReady) return RunnerRoutes.NotReady(res);
      if (mode.Effective == AutomationMode.Off)
      {
        return res.Ok(new { mode = mode.Configured, effectiveMode = mode.Effective, targets = Array.Empty<object>() });
      }

      var targets = new List<object>();
      int synced;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        synced = await DbUtil.ExecuteAsync(conn, tx,
          """
          insert into source_watch_targets (kind, url, active, check_interval_minutes, created_by)
          select distinct 'page', c.source->>'url', true, 10080, 'cards'
          from cards c
          where c.is_deleted = 0 and c.source is not null
            and c.source->>'url' like 'https://%' and char_length(c.source->>'url') <= 2048
          on conflict (url) do nothing
          """, []);

        var due = await DbUtil.QueryAsync(conn, tx,
          $"""
          with due as (
            select t.id from source_watch_targets t
            where t.active and t.consecutive_failures < 10
              and (t.leased_until is null or t.leased_until < now())
              and (t.last_checked_at is null or t.last_checked_at < now() - make_interval(mins => t.check_interval_minutes))
              and (t.kind <> 'page' or exists (select 1 from cards c where c.is_deleted = 0 and c.source->>'url' = t.url))
            order by t.last_checked_at nulls first, t.id
            limit $1
            for update skip locked
          )
          update source_watch_targets t set leased_until = now() + interval '{LeaseMinutes} minutes', updated_at = now()
          from due where t.id = due.id
          returning t.id, t.kind, t.url, t.feed_format, t.etag, t.last_modified, t.content_sha256, t.normalizer, t.last_checked_at
          """, [max]);

        foreach (var t in due.OrderBy(r => r["last_checked_at"] is null ? 0 : 1).ThenBy(r => r["last_checked_at"] as DateTime? ?? DateTime.MinValue)
                   .ThenBy(r => RunnerRoutes.Long(r["id"])))
        {
          var kind = (string)t["kind"]!;
          var quotes = new List<object>();
          if (kind == "page")
          {
            var rows = await DbUtil.QueryAsync(conn, tx,
              $"""
              select id, source->>'quote' as quote from cards
              where is_deleted = 0 and source->>'url' = $1 and source->>'quote' is not null
              order by id limit {MaxQuotes}
              """, [t["url"]]);
            quotes.AddRange(rows.Select(q => (object)new { cardId = RunnerRoutes.Long(q["id"]), quote = (string)q["quote"]! }));
          }
          targets.Add(new
          {
            targetId = RunnerRoutes.Long(t["id"]),
            kind,
            url = (string)t["url"]!,
            feedFormat = t["feed_format"] as string,
            etag = t["etag"] as string,
            lastModified = t["last_modified"] as string,
            contentSha256 = t["content_sha256"] as string,
            normalizer = t["normalizer"] as string,
            quotes,
          });
        }
        await tx.CommitAsync();
      }

      Log.Event("info", new { tag = "source_watch", outcome = "targets", watchRunId, mode = mode.Effective, synced, leased = targets.Count });
      return res.Ok(new { mode = mode.Configured, effectiveMode = mode.Effective, targets });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/internal/source-watch/report (A00 §10.5)
  // ---------------------------------------------------------------------------------------------

  /// <summary>One feed item; <see cref="Summary"/> (optional, R20 V07) only feeds the full-text query and is never stored.</summary>
  private sealed record FeedItem(string Url, string? Title, string? PublishedAt, string? Summary = null);

  private sealed record Observation(long TargetId, string Url, string Status, int? HttpStatus, string? ContentSha256, string? Normalizer,
    string? Etag, string? LastModified, DateTimeOffset FetchedAt, string? ErrorCode, long[] MissingQuoteCardIds, FeedItem[] FeedItems,
    bool HasFeedItems);

  /// <summary>A page event (changed/gone) whose re-checks start after the commit.</summary>
  private sealed record PageEvent(long EventId, long TargetId, string Url, string Change, int CitingCards, long[] MissingQuoteCardIds,
    List<long> QueueItemIds, List<long> DeckIds);

  private sealed class ReportCounts
  {
    public int Applied, Changed, Gone, Failed, Checks, Detections, Queued, FeedItemsQueued, Rechecks, Superseded;
  }

  public static async Task<APIGatewayProxyResponse> HandleReport(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    var v = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.SourceWatchSecretEnv);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    try
    {
      Guid watchRunId;
      List<Observation> observations;
      using (var doc = Validation.ParseJsonBody(req))
      {
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        var body = AutomationBody.Object(doc.RootElement);
        RequireVersion(body);
        watchRunId = AutomationBody.OptionalUuid(body, "watchRunId") ?? throw new ValidationError("watchRunId must be a uuid", "watchRunId");
        observations = ParseObservations(body);
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      if (!await ReadyAsync(conn)) return RunnerRoutes.NotReady(res);

      var mode = await AutomationMode.EffectiveAsync(conn);
      if (mode.LiveBlockedReason == AutomationMode.ServerNotReady) return RunnerRoutes.NotReady(res);
      var counts = new ReportCounts();
      if (mode.Effective == AutomationMode.Off) return Answer(res, watchRunId, counts);

      var pageEvents = new List<PageEvent>();
      var feedImpacts = new List<ChangeImpact.FeedItemImpact>();
      var failingEvents = new List<(long EventId, long TargetId, string Url, string? ErrorCode)>();
      await using (var tx = await conn.BeginTransactionAsync())
      {
        var ids = observations.Select(o => o.TargetId).Distinct().ToArray();
        var targets = (await DbUtil.QueryAsync(conn, tx,
          """
          select id, kind, url, feed_format, deck_id, item_title_pattern, content_sha256, normalizer, last_status, consecutive_failures
          from source_watch_targets where id = any($1) order by id for update
          """, [ids])).ToDictionary(r => RunnerRoutes.Long(r["id"]));

        foreach (var o in observations)
        {
          if (!targets.TryGetValue(o.TargetId, out var t))
          {
            Log.Event("warn", new { tag = "source_watch", reason = "watch_unknown_target", watchRunId, targetId = o.TargetId });
            continue;
          }
          await ApplyAsync(conn, tx, watchRunId, o, t, counts, pageEvents, feedImpacts, failingEvents);
        }
        await tx.CommitAsync();
      }

      // After the commit, best effort: re-checks, webhooks, exception emails, the ledger row.
      foreach (var pe in pageEvents)
      {
        var outcome = await StartRechecksAsync(conn, pe.EventId, pe.Url, pe.DeckIds, [], false);
        counts.Rechecks += outcome.Started;
        await WebhookEvents.EnqueueAsync(conn, "source.changed", new
        {
          targetId = pe.TargetId,
          url = pe.Url,
          change = pe.Change,
          citingCards = pe.CitingCards,
          missingQuoteCardIds = pe.MissingQuoteCardIds,
          recheck = new { state = outcome.State, runIds = outcome.RunIds },
          queueItemIds = pe.QueueItemIds,
          mode = mode.Effective,
          consoleUrl = EmailTemplates.AutomationUrl(Notifications.ConsoleBaseUrl(), $"tab=watch&targetId={pe.TargetId.ToString(CultureInfo.InvariantCulture)}"),
        });
        if (pe.Change == "gone")
        {
          await Notifications.RaiseExceptionAsync(conn, "source_gone", $"exception:source_gone:{pe.TargetId}:{pe.EventId}", new Dictionary<string, string>
          {
            ["targetId"] = pe.TargetId.ToString(CultureInfo.InvariantCulture),
            ["eventId"] = pe.EventId.ToString(CultureInfo.InvariantCulture),
            ["url"] = pe.Url,
            ["citingCards"] = pe.CitingCards.ToString(CultureInfo.InvariantCulture),
          });
        }
      }
      foreach (var (eventId, targetId, url, errorCode) in failingEvents)
      {
        var raised = await Notifications.RaiseExceptionAsync(conn, "watch_failing", $"exception:watch_failing:{targetId}:{eventId}", new Dictionary<string, string>
        {
          ["targetId"] = targetId.ToString(CultureInfo.InvariantCulture),
          ["eventId"] = eventId.ToString(CultureInfo.InvariantCulture),
          ["url"] = url,
          ["errorCode"] = errorCode ?? "unknown",
        });
        if (raised is not null) await LinkNotificationAsync(conn, eventId, raised.NotificationId);
      }
      // R20 V07: the possibly affected cards of each new release-notes item (full-text search; never edits a card).
      await ChangeImpact.RecordFeedItemsAsync(conn, feedImpacts);
      if (counts.Applied > 0) await RecordLedgerAsync(conn, watchRunId, observations, counts);

      Log.Event("info", new
      {
        tag = "source_watch", outcome = "report", watchRunId, mode = mode.Effective, observations = observations.Count, applied = counts.Applied,
        changed = counts.Changed, gone = counts.Gone, failed = counts.Failed, queued = counts.Queued, rechecks = counts.Rechecks,
        superseded = counts.Superseded,
      });
      return Answer(res, watchRunId, counts);
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static APIGatewayProxyResponse Answer(Res res, Guid watchRunId, ReportCounts c) =>
    res.Ok(new { watchRunId, applied = c.Applied, changed = c.Changed, queued = c.Queued, rechecks = c.Rechecks });

  /// <summary>One observation against its locked target row: the A00 §10.5 table.</summary>
  private static async Task ApplyAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid watchRunId, Observation o, Dictionary<string, object?> t,
    ReportCounts counts, List<PageEvent> pageEvents, List<ChangeImpact.FeedItemImpact> feedImpacts, List<(long, long, string, string?)> failingEvents)
  {
    counts.Applied++;
    var kind = (string)t["kind"]!;
    var url = (string)t["url"]!;
    var storedHash = t["content_sha256"] as string;
    var storedNormalizer = t["normalizer"] as string;
    var previousStatus = t["last_status"] as string;
    var previousFailures = Convert.ToInt32(t["consecutive_failures"], CultureInfo.InvariantCulture);

    if (kind == "page" && o.HasFeedItems)
    {
      Log.Event("warn", new { tag = "source_watch", reason = "feed_items_on_page", watchRunId, targetId = o.TargetId });
    }
    if (kind == "feed" && o.MissingQuoteCardIds.Length > 0)
    {
      Log.Event("warn", new { tag = "source_watch", reason = "missing_quotes_on_feed", watchRunId, targetId = o.TargetId });
    }

    var failures = o.Status == "failed" ? previousFailures + 1 : 0;
    string lastStatus = o.Status;
    var hash = storedHash;
    var normalizer = storedNormalizer;
    var changedAt = false;
    string? eventKind = null;

    switch (o.Status)
    {
      case "ok" when storedHash is null || storedNormalizer != Normalizer:
        lastStatus = "baseline";
        hash = o.ContentSha256;
        normalizer = o.Normalizer;
        eventKind = "baseline";
        break;
      case "ok" when storedHash == o.ContentSha256:
        lastStatus = "unchanged";
        break;
      case "ok":
        lastStatus = "changed";
        hash = o.ContentSha256;
        normalizer = o.Normalizer;
        changedAt = true;
        counts.Changed++;
        if (kind == "page") eventKind = "changed";
        break;
      case "gone":
        counts.Gone++;
        if (previousStatus != "gone") eventKind = "gone";
        break;
      case "unsupported":
        if (previousStatus != "unsupported") eventKind = "unsupported";
        break;
      case "failed":
        counts.Failed++;
        break;
    }
    if (o.Status is "ok" or "not_modified") counts.Checks++;

    await DbUtil.ExecuteAsync(conn, tx,
      """
      update source_watch_targets set
        last_checked_at = $2, last_http_status = $3::int, etag = $4::text, last_modified = $5::text, leased_until = null,
        last_status = $6, consecutive_failures = $7, content_sha256 = $8::text, normalizer = $9::text,
        last_changed_at = case when $10 then $2 else last_changed_at end, updated_at = now()
      where id = $1
      """, [o.TargetId, o.FetchedAt.UtcDateTime, o.HttpStatus, o.Etag, o.LastModified, lastStatus, failures, hash, normalizer, changedAt]);

    // Failure episodes: one `failing` event when the count reaches the threshold, one `recovered` on the next success.
    if (o.Status == "failed" && failures == FailingThreshold)
    {
      var failingId = await InsertEventAsync(conn, tx, o.TargetId, watchRunId, "failing", storedHash, null,
        new { consecutiveFailures = failures, errorCode = o.ErrorCode, httpStatus = o.HttpStatus });
      failingEvents.Add((failingId, o.TargetId, url, o.ErrorCode));
    }
    if (o.Status != "failed" && previousFailures >= FailingThreshold)
    {
      await InsertEventAsync(conn, tx, o.TargetId, watchRunId, "recovered", storedHash, hash, new { previousFailures });
    }

    if (kind == "feed")
    {
      if (eventKind is "gone" or "unsupported")
      {
        await InsertEventAsync(conn, tx, o.TargetId, watchRunId, eventKind, storedHash, null, null);
        return;
      }
      if (o.Status != "ok") return;
      var baseline = lastStatus == "baseline";
      if (baseline)
      {
        await InsertEventAsync(conn, tx, o.TargetId, watchRunId, "baseline", storedHash, hash, new { items = o.FeedItems.Length });
      }
      var fresh = await RecordFeedItemsAsync(conn, tx, watchRunId, o, t);
      if (baseline || fresh.Count == 0) return;
      var feedDeckId = t["deck_id"] is null ? (long?)null : RunnerRoutes.Long(t["deck_id"]);
      var summaries = o.FeedItems.GroupBy(i => ItemKey(i.Url)).ToDictionary(g => g.Key, g => g.First().Summary, StringComparer.Ordinal);
      feedImpacts.AddRange(fresh.Select(i => new ChangeImpact.FeedItemImpact(o.TargetId, i.ItemKey, i.Title,
        summaries.GetValueOrDefault(i.ItemKey), feedDeckId)));

      long? feedEventId = null;
      if (lastStatus == "changed")
      {
        feedEventId = await InsertEventAsync(conn, tx, o.TargetId, watchRunId, "feed_items", storedHash, hash, new { items = fresh.Count });
      }
      var queued = await QueueFeedItemsAsync(conn, tx, o.TargetId, t, fresh, feedEventId);
      counts.Queued += queued.Count;
      counts.FeedItemsQueued += queued.Count;
      counts.Detections += queued.Count;
      if (feedEventId is { } fe)
      {
        await DbUtil.ExecuteAsync(conn, tx,
          "update source_watch_events set details = $2::jsonb, updated_at = now() where id = $1",
          [fe, JsonSerializer.Serialize(new { items = fresh.Count, queueItemIds = queued })]);
      }
      return;
    }

    // Pages.
    if (eventKind is "baseline" or "unsupported")
    {
      await InsertEventAsync(conn, tx, o.TargetId, watchRunId, eventKind, storedHash, hash, null);
      return;
    }
    if (eventKind is not ("changed" or "gone")) return;
    counts.Detections++;

    var citing = await DbUtil.QueryAsync(conn, tx,
      """
      select c.id, c.deck_id from cards c join decks d on d.id = c.deck_id
      where c.is_deleted = 0 and d.is_deleted = 0 and c.source->>'url' = $1
      order by c.id
      """, [url]);
    var byDeck = citing.GroupBy(r => RunnerRoutes.Long(r["deck_id"])).OrderBy(g => g.Key)
      .ToDictionary(g => g.Key, g => g.Select(r => RunnerRoutes.Long(r["id"])).ToList());
    var citingIds = citing.Select(r => RunnerRoutes.Long(r["id"])).ToHashSet();
    var missing = o.MissingQuoteCardIds.Distinct().Take(MaxQuotes).ToArray();
    // R20 V07: the affected cards by exact URL; needsHumanReview is settled once the re-check outcome is known.
    var affected = await ChangeImpact.AffectedCardsAsync(conn, tx, url, o.MissingQuoteCardIds.ToHashSet());

    var newSha = eventKind == "gone" ? null : o.ContentSha256;
    var eventId = await InsertEventAsync(conn, tx, o.TargetId, watchRunId, eventKind, storedHash, newSha, null,
      byDeck.Count > 0 ? "waiting" : "not_needed");

    var queueItemIds = new List<long>();
    foreach (var (deckId, cardIds) in byDeck)
    {
      var missingInDeck = o.MissingQuoteCardIds.Distinct().Count(id => cardIds.Contains(id));
      var dedupe = $"source_changed:{o.TargetId}:{newSha ?? "gone"}:{deckId}";
      var inserted = await DbUtil.ExecuteScalarAsync(conn, tx,
        """
        insert into authoring_queue_items (kind, url, deck_id, title, note, dedupe_key, source_target_id, source_event_id, created_by)
        values ('source_changed', $1, $2, 'Source changed', $3, $4, $5, $6, 'watcher')
        on conflict (dedupe_key) do nothing
        returning id
        """, [url, deckId, $"missing quotes: {missingInDeck.ToString(CultureInfo.InvariantCulture)}", dedupe, o.TargetId, eventId]);
      if (inserted is null) continue;
      var itemId = RunnerRoutes.Long(inserted);
      queueItemIds.Add(itemId);

      // R28 review F4: the dedupe key carries the new hash, so a page that changes again while its earlier item still
      // waits (the daily claim cap holds source-watch items) would queue a second item for the same page and deck, and
      // the runner would author that page twice. The newest item replaces every older one still queued; a claimed one
      // (a run in progress) is left alone.
      counts.Superseded += await DbUtil.ExecuteAsync(conn, tx,
        """
        update authoring_queue_items
        set status = 'skipped', last_error = $4, finished_at = now(), updated_at = now()
        where kind = 'source_changed' and status = 'queued' and source_target_id = $1 and deck_id = $2 and id <> $3
        """, [o.TargetId, deckId, itemId,
          $"{SupersededError}: the page changed again; queue item {itemId.ToString(CultureInfo.InvariantCulture)} replaces this one"]);
    }
    counts.Queued += queueItemIds.Count;

    var deckIds = byDeck.Keys.ToList();
    await DbUtil.ExecuteAsync(conn, tx,
      "update source_watch_events set details = $2::jsonb, updated_at = now() where id = $1",
      [eventId, JsonSerializer.Serialize(new
      {
        citingCards = citingIds.Count,
        byDeck = byDeck.ToDictionary(kv => kv.Key.ToString(CultureInfo.InvariantCulture), kv => kv.Value.Count),
        missingQuoteCardIds = missing,
        queueItemIds,
        recheckPendingDeckIds = deckIds,
        affectedCards = affected.Select(ChangeImpact.ToJson),
        needsHumanReview = false,
      })]);
    pageEvents.Add(new PageEvent(eventId, o.TargetId, url, eventKind, citingIds.Count, missing, queueItemIds, deckIds));
  }

  private static async Task<long> InsertEventAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long targetId, Guid watchRunId, string kind,
    string? oldSha, string? newSha, object? details, string recheckState = "not_needed") =>
    RunnerRoutes.Long(await DbUtil.ExecuteScalarAsync(conn, tx,
      """
      insert into source_watch_events (target_id, watch_run_id, kind, old_sha256, new_sha256, details, recheck_state)
      values ($1, $2, $3, $4::text, $5::text, $6::jsonb, $7)
      returning id
      """, [targetId, watchRunId, kind, oldSha, newSha, details is null ? null : JsonSerializer.Serialize(details), recheckState]));

  private sealed record FreshItem(string ItemKey, string Url, string? Title);

  /// <summary>
  /// Records every usable item (https, ≤ 2048 chars) with <c>on conflict do nothing</c>; returns the newly inserted
  /// items that match the target's title pattern (evaluated by PostgreSQL). A pattern PostgreSQL rejects matches nothing.
  /// </summary>
  private static async Task<List<FreshItem>> RecordFeedItemsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid watchRunId, Observation o,
    Dictionary<string, object?> t)
  {
    var items = new Dictionary<string, FeedItem>(StringComparer.Ordinal);
    var skipped = 0;
    foreach (var item in o.FeedItems)
    {
      if (!item.Url.StartsWith("https://", StringComparison.Ordinal) || item.Url.Length > MaxUrlLength)
      {
        skipped++;
        continue;
      }
      items.TryAdd(ItemKey(item.Url), item);
    }
    if (skipped > 0) Log.Event("warn", new { tag = "source_watch", reason = "feed_item_url_skipped", watchRunId, targetId = o.TargetId, skipped });
    if (items.Count == 0) return [];

    var pattern = t["item_title_pattern"] as string;
    if (pattern is not null && !await PatternValidAsync(conn, tx, pattern))
    {
      Log.Event("warn", new { tag = "source_watch", reason = "watch_pattern_invalid", watchRunId, targetId = o.TargetId });
      pattern = null;
    }
    var patternUsable = t["item_title_pattern"] is null || pattern is not null;

    var keys = items.Keys.ToArray();
    var rows = await DbUtil.QueryAsync(conn, tx,
      """
      insert into source_watch_feed_items (target_id, item_key, url, title, published_at, matched)
      select $1, x.k, x.u, x.t, x.p::timestamptz, $6 and ($2::text is null or coalesce(x.t, '') ~* $2::text)
      from unnest($3::text[], $4::text[], $5::text[], $7::text[]) as x(k, u, t, p)
      on conflict do nothing
      returning item_key, url, title, matched
      """,
      [o.TargetId, pattern, keys, keys.Select(k => items[k].Url).ToArray(), keys.Select(k => items[k].Title).ToArray(), patternUsable,
       keys.Select(k => items[k].PublishedAt).ToArray()]);
    return rows.Where(r => r["matched"] is true)
      .Select(r => new FreshItem((string)r["item_key"]!, (string)r["url"]!, r["title"] as string))
      .OrderBy(i => Array.IndexOf(keys, i.ItemKey))
      .ToList();
  }

  private static async Task<List<long>> QueueFeedItemsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long targetId, Dictionary<string, object?> t,
    List<FreshItem> fresh, long? eventId)
  {
    var deckId = t["deck_id"] is null ? (long?)null : RunnerRoutes.Long(t["deck_id"]);
    var headings = (t["feed_format"] as string) == "html-headings";
    var queued = new List<long>();
    foreach (var item in fresh)
    {
      var title = Cap(item.Title);
      var id = await DbUtil.ExecuteScalarAsync(conn, tx,
        """
        insert into authoring_queue_items (kind, url, deck_id, title, section_hint, dedupe_key, source_target_id, source_event_id, created_by)
        values ('feed_item', $1, $2::bigint, $3::text, $4::text, $5, $6, $7::bigint, 'watcher')
        on conflict (dedupe_key) do nothing
        returning id
        """, [item.Url, deckId, title, headings ? title : null, $"feed_item:{targetId}:{item.ItemKey}", targetId, eventId]);
      if (id is null) continue;
      var itemId = RunnerRoutes.Long(id);
      queued.Add(itemId);
      await DbUtil.ExecuteAsync(conn, tx,
        "update source_watch_feed_items set queue_item_id = $3 where target_id = $1 and item_key = $2", [targetId, item.ItemKey, itemId]);
    }
    return queued;
  }

  private static async Task<bool> PatternValidAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string pattern)
  {
    await tx.SaveAsync("watch_pattern");
    try
    {
      await DbUtil.ExecuteScalarAsync(conn, tx, "select '' ~* $1::text", [pattern]);
      await tx.ReleaseAsync("watch_pattern");
      return true;
    }
    catch (PostgresException pg) when (pg.SqlState == "2201B")
    {
      await tx.RollbackAsync("watch_pattern");
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // re-checks (report, and tick step 8)
  // ---------------------------------------------------------------------------------------------

  private sealed record RecheckOutcome(string State, List<Guid> RunIds, int Started);

  /// <summary>
  /// Starts one <c>scope=cards</c> re-check (profile <c>automation</c>) per deck in <paramref name="pendingDeckIds"/> over
  /// the live cards of that deck citing <paramref name="url"/> (≤ <see cref="MaxRecheckCards"/>, by id), then stores the
  /// aggregated state on the event: <c>queued</c> ⇒ the run id is appended and the deck leaves the pending list;
  /// <c>in_progress</c>, <c>AI_QA_DAILY_CAP</c>, <c>ENQUEUE_FAILED</c>, <c>INTERNAL_ERROR</c> ⇒ the deck stays pending;
  /// QA disabled or any other code ⇒ the deck is dropped. The state is <c>waiting</c> while a deck is pending, else
  /// <c>started</c> when any run started, else <c>unavailable</c>. With <paramref name="giveUp"/> every pending deck is
  /// dropped without a try. Never throws.
  /// </summary>
  private static async Task<RecheckOutcome> StartRechecksAsync(NpgsqlConnection conn, long eventId, string url, IReadOnlyList<long> pendingDeckIds,
    IReadOnlyList<Guid> existingRunIds, bool giveUp)
  {
    var runIds = existingRunIds.ToList();
    var pending = new List<long>();
    var started = 0;
    try
    {
      IReadOnlyList<long> toTry = giveUp ? [] : pendingDeckIds;
      foreach (var deckId in toTry)
      {
        var cardIds = (await DbUtil.QueryAsync(conn, null,
          $"""
          select c.id from cards c join decks d on d.id = c.deck_id
          where c.is_deleted = 0 and d.is_deleted = 0 and c.deck_id = $1 and c.source->>'url' = $2
          order by c.id limit {MaxRecheckCards}
          """, [deckId, url])).Select(r => RunnerRoutes.Long(r["id"])).ToArray();
        if (cardIds.Length == 0) continue;

        var run = await QaRuns.StartCardsRunAsync(conn, deckId, cardIds, "automation", "source_changed", "automation");
        if (run is { Status: "queued", RunId: { } runId })
        {
          runIds.Add(runId);
          started++;
        }
        else if (run is not null && (run.Status == "in_progress" || run.Code is "AI_QA_DAILY_CAP" or "ENQUEUE_FAILED" or "INTERNAL_ERROR"))
        {
          pending.Add(deckId);
        }
        Log.Event("info", new { tag = "source_watch", outcome = "recheck", eventId, deckId, cards = cardIds.Length, status = run?.Status ?? "disabled", code = run?.Code });
      }

      var state = pending.Count > 0 ? "waiting" : runIds.Count > 0 ? "started" : "unavailable";
      await DbUtil.ExecuteAsync(conn, null,
        """
        update source_watch_events set recheck_state = $2, recheck_run_ids = $3,
          details = coalesce(details, '{}'::jsonb) || jsonb_build_object('recheckPendingDeckIds', $4::jsonb,
            'needsHumanReview', $2 = 'unavailable' and jsonb_typeof(details -> 'affectedCards') = 'array'
              and jsonb_array_length(details -> 'affectedCards') > 0),
          updated_at = now()
        where id = $1
        """, [eventId, state, runIds.ToArray(), JsonSerializer.Serialize(pending)]);
      return new RecheckOutcome(state, runIds, started);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "source_watch", reason = "recheck_failed", eventId, error = ex.Message });
      return new RecheckOutcome("waiting", runIds, started);
    }
  }

  /// <summary>
  /// Tick step 8 (A00 §12.6): <c>waiting</c> events, oldest first, at most <paramref name="max"/>, retry the re-check of
  /// every deck still pending (card ids re-derived from the live citing cards); an event older than
  /// <see cref="RecheckGiveUpHours"/> hours drops its pending decks instead. Returns the number of runs started.
  /// </summary>
  internal static async Task<int> RetryWaitingRechecksAsync(NpgsqlConnection conn, int max, CancellationToken ct = default)
  {
    var events = await DbUtil.QueryAsync(conn, null,
      $"""
      select e.id, e.recheck_run_ids, e.details::text as details, e.created_at < now() - interval '{RecheckGiveUpHours} hours' as expired, t.url
      from source_watch_events e join source_watch_targets t on t.id = e.target_id
      where e.recheck_state = 'waiting'
      order by e.id
      limit $1
      """, [max]);

    var started = 0;
    foreach (var ev in events)
    {
      if (ct.IsCancellationRequested) break;
      var pending = new List<long>();
      if (ev["details"] is string json)
      {
        using var details = JsonDocument.Parse(json);
        if (details.RootElement.ValueKind == JsonValueKind.Object
            && details.RootElement.TryGetProperty("recheckPendingDeckIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
        {
          pending.AddRange(ids.EnumerateArray().Where(i => i.ValueKind == JsonValueKind.Number && i.TryGetInt64(out _)).Select(i => i.GetInt64()));
        }
      }
      var outcome = await StartRechecksAsync(conn, RunnerRoutes.Long(ev["id"]), (string)ev["url"]!, pending,
        ev["recheck_run_ids"] as Guid[] ?? [], ev["expired"] is true);
      started += outcome.Started;
    }
    return started;
  }

  // ---------------------------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------------------------

  private static async Task LinkNotificationAsync(NpgsqlConnection conn, long eventId, Guid notificationId)
  {
    try
    {
      await DbUtil.ExecuteAsync(conn, null,
        "update source_watch_events set notification_id = $2, updated_at = now() where id = $1 and notification_id is null", [eventId, notificationId]);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "source_watch", reason = "notification_link_failed", eventId, error = ex.Message });
    }
  }

  /// <summary>
  /// The <c>source_watch</c> ledger row of one report (A00 §14), written in dry_run and live. Its units are detections
  /// only (R18B automation-9): a cited page found changed or newly gone, and a new feed item queued for authoring. Those
  /// replace work a person did before automation (noticing the change and acting on it). The routine checks of
  /// unchanged pages and feed polls replace nothing (nobody re-read every cited page weekly or the feeds every two
  /// hours), so they earn no minutes; their count stays in the row's details as <c>checks</c> for the digest.
  /// </summary>
  private static Task RecordLedgerAsync(NpgsqlConnection conn, Guid watchRunId, List<Observation> observations, ReportCounts c)
  {
    var sortedIds = string.Join(",", observations.Select(o => o.TargetId).Distinct().Order().Select(i => i.ToString(CultureInfo.InvariantCulture)));
    var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sortedIds))).ToLowerInvariant()[..16];
    var outcome = c.Failed == c.Applied ? "failure" : c.Failed > 0 ? "partial" : "success";
    return AutomationLedger.RecordAsync(conn, new AutomationEvent("source_watch", c.Detections, outcome, Ref: watchRunId.ToString("D"),
      DedupeKey: $"watch:{watchRunId:D}:{digest}",
      Details: new { changed = c.Changed, gone = c.Gone, failed = c.Failed, feedItemsQueued = c.FeedItemsQueued, checks = c.Checks }));
  }

  private static async Task<bool> ReadyAsync(NpgsqlConnection conn) =>
    await DbUtil.ExecuteScalarAsync(conn, null,
      "select to_regclass('public.source_watch_targets') is not null and to_regclass('public.authoring_queue_items') is not null", []) is true;

  internal static string ItemKey(string url) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url))).ToLowerInvariant();

  private static string? Cap(string? s) => s is { Length: > MaxQueueTextLength } ? s[..MaxQueueTextLength] : s;

  private static void RequireVersion(JsonElement body)
  {
    if (!body.TryGetProperty("v", out var ver) || ver.ValueKind != JsonValueKind.Number || !ver.TryGetInt32(out var version) || version != 1)
    {
      throw new ValidationError("v must be 1", "v");
    }
  }

  private static List<Observation> ParseObservations(JsonElement body)
  {
    if (!body.TryGetProperty("observations", out var arr) || arr.ValueKind != JsonValueKind.Array || arr.GetArrayLength() > MaxObservations)
    {
      throw new ValidationError($"observations must be an array of at most {MaxObservations} objects", "observations");
    }
    var list = new List<Observation>();
    foreach (var el in arr.EnumerateArray())
    {
      var o = el.ValueKind == JsonValueKind.Object ? el : throw new ValidationError("each observation must be an object", "observations");
      var targetId = AutomationBody.RequiredLong(o, "targetId");
      var url = AutomationBody.RequiredString(o, "url", MaxUrlLength);
      var status = AutomationBody.RequiredEnum(o, "status", Statuses);
      var httpStatus = AutomationBody.OptionalInt(o, "httpStatus", int.MinValue, int.MaxValue);
      var sha = AutomationBody.OptionalString(o, "contentSha256", 64);
      if (sha is not null && !Sha256Regex.IsMatch(sha)) throw new ValidationError("contentSha256 must be 64 lowercase hex characters or null", "contentSha256");
      if (status == "ok" && sha is null) throw new ValidationError("contentSha256 is required when status is ok", "contentSha256");
      var normalizer = AutomationBody.OptionalString(o, "normalizer", 40);
      var etag = AutomationBody.OptionalString(o, "etag", int.MaxValue);
      var lastModified = AutomationBody.OptionalString(o, "lastModified", int.MaxValue);
      AutomationBody.OptionalInt(o, "bytes", 0, int.MaxValue);
      AutomationBody.OptionalInt(o, "latencyMs", 0, int.MaxValue);
      var fetchedAt = AutomationBody.OptionalTimestamp(o, "fetchedAt") ?? throw new ValidationError("fetchedAt must be an ISO-8601 timestamp", "fetchedAt");
      var errorCode = AutomationBody.OptionalEnum(o, "errorCode", ErrorCodes);

      var missing = new List<long>();
      if (o.TryGetProperty("missingQuoteCardIds", out var m) && m.ValueKind != JsonValueKind.Null)
      {
        if (m.ValueKind != JsonValueKind.Array || m.GetArrayLength() > MaxRecheckCards)
        {
          throw new ValidationError($"missingQuoteCardIds must be an array of at most {MaxRecheckCards} integers", "missingQuoteCardIds");
        }
        foreach (var id in m.EnumerateArray())
        {
          if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var n)) throw new ValidationError("missingQuoteCardIds must be integers", "missingQuoteCardIds");
          missing.Add(n);
        }
      }

      var items = new List<FeedItem>();
      var hasItems = false;
      if (o.TryGetProperty("feedItems", out var fi) && fi.ValueKind != JsonValueKind.Null)
      {
        if (fi.ValueKind != JsonValueKind.Array || fi.GetArrayLength() > MaxFeedItems)
        {
          throw new ValidationError($"feedItems must be an array of at most {MaxFeedItems} objects", "feedItems");
        }
        hasItems = fi.GetArrayLength() > 0;
        foreach (var item in fi.EnumerateArray())
        {
          if (item.ValueKind != JsonValueKind.Object) throw new ValidationError("each feed item must be an object", "feedItems");
          var itemUrl = AutomationBody.RequiredString(item, "url", int.MaxValue);
          var title = AutomationBody.OptionalString(item, "title", int.MaxValue);
          // summary (optional, R20 V07): release-note text for the full-text query only, capped, never stored or logged.
          // The current watcher (services/source-watcher, feeds.py) sends url, title and publishedAt only, so in production
          // the query is the title alone until it sends a summary (contract R20-00 §10.4).
          var summary = AutomationBody.OptionalString(item, "summary", int.MaxValue);
          if (summary is { Length: > ChangeImpact.MaxQueryTextLength }) summary = summary[..ChangeImpact.MaxQueryTextLength];
          // publishedAt is informational: a value that is not a timestamp (an RSS pubDate PostgreSQL cannot read) is stored as null.
          string? published = null;
          if (item.TryGetProperty("publishedAt", out var p) && p.ValueKind != JsonValueKind.Null)
          {
            if (p.ValueKind != JsonValueKind.String) throw new ValidationError("publishedAt must be a string or null", "feedItems");
            if (DateTimeOffset.TryParse(p.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at))
            {
              published = at.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
            }
          }
          items.Add(new FeedItem(itemUrl, title, published, summary));
        }
      }

      list.Add(new Observation(targetId, url, status, httpStatus, sha, normalizer, etag, lastModified, fetchedAt, errorCode, [.. missing], [.. items], hasItems));
    }
    return list;
  }
}
