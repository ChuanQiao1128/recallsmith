using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Analytics;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// Freshness (R20 V08, contract R20-00 §7): how long a documentation change takes to reach a published card. Each item is
/// a <c>changed</c>/<c>gone</c> page event (<c>kind "page"</c>, refId = the event id) or a matched release-notes feed item
/// (<c>kind "feed"</c>, refId = <c>targetId:itemKey</c>) detected in the window, walked through the chain
/// source event/feed item → queue item(s) → runner run(s) → draft decision(s) → deck publish:
/// <c>detectedAt</c> the event's <c>created_at</c> / the item's <c>first_seen_at</c>; <c>queuedAt</c> the earliest linked
/// queue item's <c>created_at</c>; <c>draftedAt</c> the earliest submit (<c>ai_drafts.created_at</c>) of a draft with a
/// decision in a run of those queue items; <c>decidedAt</c> the earliest final decision of such a draft (an auto-accept's
/// <c>decided_at</c>, or a person's decision); <c>publishedAt</c> the earliest successful <c>deck_publishes</c> row of the
/// draft's deck whose <c>card_ids</c> hold the accepted card. A missing link leaves that stage and every later one null.
/// Each median is over the items that reached the stage, in minutes since <c>detectedAt</c> (2 decimals), null when none.
/// </summary>
public static class Freshness
{
  public const int DefaultDays = 30;
  public const int MaxDays = 90;

  /// <summary>The most items the route lists (newest first); the medians and <c>n</c> cover the whole window.</summary>
  public const int MaxItems = 200;

  public sealed record Item(string Kind, string RefId, string? Title, DateTime DetectedAt, DateTime? QueuedAt, DateTime? DraftedAt,
    DateTime? DecidedAt, DateTime? PublishedAt);

  public sealed record Summary(IReadOnlyList<Item> Items, decimal? MinutesToDraft, decimal? MinutesToDecision, decimal? MinutesToPublish)
  {
    public int PublishedN => Items.Count(i => i.PublishedAt is not null);
  }

  public static async Task<APIGatewayProxyResponse> HandleFreshness(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      var days = UsageAnalytics.DaysParam(req, DefaultDays, MaxDays);
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var s = await LoadAsync(conn, days);
      return res.Ok(new
      {
        items = s.Items.Take(MaxItems).Select(i => new
        {
          kind = i.Kind,
          refId = i.RefId,
          title = i.Title,
          detectedAt = RunnerRoutes.Timestamp(i.DetectedAt),
          queuedAt = RunnerRoutes.Timestamp(i.QueuedAt),
          draftedAt = RunnerRoutes.Timestamp(i.DraftedAt),
          decidedAt = RunnerRoutes.Timestamp(i.DecidedAt),
          publishedAt = RunnerRoutes.Timestamp(i.PublishedAt),
        }).ToList(),
        medians = new
        {
          minutesToDraft = s.MinutesToDraft,
          minutesToDecision = s.MinutesToDecision,
          minutesToPublish = s.MinutesToPublish,
        },
        n = s.Items.Count,
      });
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      return Helpers.ErrorEnvelope(res, 503, "NOT_READY", "Run the database migration (034_automation)");
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  /// <summary>Every item detected in the last <paramref name="days"/> days, newest first, and the medians.</summary>
  public static async Task<Summary> LoadAsync(NpgsqlConnection conn, int days)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      """
      with src as (
        select 'page'::text as kind, e.id::text as ref_id, t.url as title, e.created_at as detected_at,
          coalesce(array(select q.id from authoring_queue_items q where q.source_event_id = e.id), '{}'::bigint[]) as queue_ids
        from source_watch_events e
        join source_watch_targets t on t.id = e.target_id
        where e.kind in ('changed', 'gone') and e.created_at >= now() - make_interval(days => $1)
        union all
        select 'feed'::text, f.target_id::text || ':' || f.item_key, coalesce(f.title, f.url), f.first_seen_at,
          case when f.queue_item_id is null then '{}'::bigint[] else array[f.queue_item_id] end
        from source_watch_feed_items f
        where f.matched and f.first_seen_at >= now() - make_interval(days => $1)
      ),
      drafts as (
        select s.kind, s.ref_id, a.created_at as drafted_at,
          least(dd.human_decided_at, a.decided_at, case when dd.state = 'auto_accepted' then dd.decided_at end) as decided_at,
          (select min(dp.created_at) from deck_publishes dp
           where dp.deck_id = a.deck_id and dp.status = 'SUCCESS'
             and dp.card_ids @> array[coalesce(dd.accepted_card_id, a.accepted_card_id)]) as published_at
        from src s
        join automation_runs r on r.queue_item_id = any(s.queue_ids)
        join automation_draft_decisions dd on dd.run_id = r.run_id
        join ai_drafts a on a.id = dd.draft_id
      )
      select s.kind, s.ref_id, s.title, s.detected_at,
        (select min(q.created_at) from authoring_queue_items q where q.id = any(s.queue_ids)) as queued_at,
        (select min(d.drafted_at) from drafts d where d.kind = s.kind and d.ref_id = s.ref_id) as drafted_at,
        (select min(d.decided_at) from drafts d where d.kind = s.kind and d.ref_id = s.ref_id) as decided_at,
        (select min(d.published_at) from drafts d where d.kind = s.kind and d.ref_id = s.ref_id) as published_at
      from src s
      order by s.detected_at desc, s.kind, s.ref_id
      """, [days]);

    var items = rows.Select(r => new Item(
      (string)r["kind"]!,
      (string)r["ref_id"]!,
      r["title"] as string,
      (DateTime)r["detected_at"]!,
      r["queued_at"] as DateTime?,
      r["drafted_at"] as DateTime?,
      r["decided_at"] as DateTime?,
      r["published_at"] as DateTime?)).ToList();

    return new Summary(items,
      MedianMinutes(items, i => i.DraftedAt),
      MedianMinutes(items, i => i.DecidedAt),
      MedianMinutes(items, i => i.PublishedAt));
  }

  /// <summary>The median of (stage − detectedAt) in minutes over the items that reached the stage; null when none did.</summary>
  private static decimal? MedianMinutes(IEnumerable<Item> items, Func<Item, DateTime?> stage) =>
    Median(items.Where(i => stage(i) is not null).Select(i => (decimal)(stage(i)!.Value - i.DetectedAt).TotalMinutes).ToList());

  /// <summary>The median (the mean of the middle two for an even count), 2 decimals; null for an empty list.</summary>
  internal static decimal? Median(IReadOnlyList<decimal> values)
  {
    if (values.Count == 0) return null;
    var sorted = values.Order().ToList();
    var mid = sorted.Count / 2;
    var median = sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return Math.Round(median, 2, MidpointRounding.AwayFromZero);
  }

  /// <summary>The status block: the median minutes to publish over the default window and how many items it rests on.</summary>
  internal static async Task<object> StatusAsync(NpgsqlConnection conn)
  {
    var s = await LoadAsync(conn, DefaultDays);
    return new { medianMinutesToPublish = s.MinutesToPublish, n = s.PublishedN };
  }
}
