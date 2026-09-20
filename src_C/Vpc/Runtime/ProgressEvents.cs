using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class ProgressEvents
{
  private static readonly Regex UuidRegex =
    new("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      RegexOptions.IgnoreCase | RegexOptions.Compiled);

  private sealed record NormalizedEvent(
    string EventId,
    string DeckSlug,
    string StableUid,
    int? Rating,
    long EventTimeMs,
    long? NextReviewAtMs,
    int? LastSeenRevision,
    string? DeckVersion,
    int SchemaVersion,
    string EventType,
    string? SessionId,
    long? OfflineQueueDelayMs,
    long? DwellTimeMs,
    string? ReviewStage,
    int? ReviewCountForCard,
    int? CardRevision,
    int? StatedDifficulty,
    int? SrsStage,
    string? SchedulerVersion);

  // The ladder in mobile/src/review/model.ts has 7 buckets (INTERVALS_DAYS),
  // so a valid stage is 0..6. The client clamps with clampStage() before it
  // ever writes progress; clamping again here keeps a rebuilt or tampered
  // client from writing a rung that no scheduler can interpret.
  private const int MaxSrsStage = 6;

  // Upper bound on how far ahead one review may schedule the next one.
  //
  // The ladder in mobile/src/review/model.ts (INTERVALS_DAYS) tops out at 60
  // days, so 90 is deliberately NOT "the algorithm's range plus slack": it is a
  // physically impossible value, the kind only a corrupt clock, a unit mix-up
  // (seconds read as milliseconds) or a tampered client produces. An invariant
  // written against the impossible survives a ladder change; one written against
  // the current maximum has to be edited every time the product tunes it, and
  // the edit that gets forgotten is the one that starts rejecting real reviews.
  //
  // The client clamps the same horizon in mergeRemoteIntoLocalProgress
  // (mobile/src/sync/progressSync.ts) for rows an older server already stored.
  private const long MaxNextReviewHorizonMs = 90L * 24 * 60 * 60 * 1000;

  // Latency instrumentation for the ingest, which is the only write path a user
  // waits on. The phases are split because they fail for different reasons and
  // are fixed in different places: connection acquisition is a cold-container /
  // pool problem, parse is CPU that grows with batch size, SQL is the network
  // round trip to Postgres. A single total would hide which one moved.
  //
  // Stopwatch is a monotonic tick counter, so it cannot go backwards the way a
  // wall clock can, and reading it is a few nanoseconds against the milliseconds
  // being measured, which keeps the instrument off the scale it measures.
  private const string ProgressEventsImpl = "progressEvents-v1";

  public static async Task<APIGatewayProxyResponse> HandleProgressEvents(LambdaRequest req, Res res, AuthContext auth)
  {
    var swTotal = Stopwatch.StartNew();

    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var beforeConnMs = swTotal.Elapsed.TotalMilliseconds;
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    var connMs = swTotal.Elapsed.TotalMilliseconds - beforeConnMs;
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var swParse = Stopwatch.StartNew();

      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var body = doc.RootElement;

      var deviceId = body.TryGetProperty("deviceId", out var d) ? d.ToString().Trim() : null;
      var clientVersion = body.TryGetProperty("clientVersion", out var cv) ? cv.ToString().Trim() : null;
      var clientPlatform = body.TryGetProperty("clientPlatform", out var cp) ? cp.ToString().Trim() : null;

      if (!body.TryGetProperty("events", out var eventsEl) || eventsEl.ValueKind != JsonValueKind.Array)
      {
        return res.BadRequest("VALIDATION_ERROR", "events must be a non-empty array");
      }

      var events = eventsEl.EnumerateArray().ToList();
      if (events.Count == 0) return res.BadRequest("VALIDATION_ERROR", "events must be a non-empty array");
      if (events.Count > 200) return res.BadRequest("VALIDATION_ERROR", "events too many (max 200)");

      var userSub = auth.UserSub!;
      var email = GetClaimString(auth.Claims, "email") ?? GetClaimString(auth.Claims, "cognito:email");
      var userIdHash = HashUserId(userSub);

      var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

      var normalized = new List<NormalizedEvent>();
      for (var i = 0; i < events.Count; i++)
      {
        var e = events[i];
        if (e.ValueKind != JsonValueKind.Object)
        {
          throw new ValidationError($"events[{i}] must be an object", $"events[{i}]");
        }

        var eventId = RequireString(e, "eventId", $"events[{i}].eventId");
        if (!UuidRegex.IsMatch(eventId))
        {
          throw new ValidationError($"events[{i}].eventId must be a UUID", $"events[{i}].eventId");
        }

        var deckSlug = RequireString(e, "deckSlug", $"events[{i}].deckSlug");
        var stableUid = RequireString(e, "stableUid", $"events[{i}].stableUid");

        var rating = OptionalInt(e.TryGetProperty("rating", out var r) ? r : (JsonElement?)null);

        // eventTimeMs / reviewedAtMs compatibility
        var eventTimeMs =
          OptionalMs(e.TryGetProperty("eventTimeMs", out var etm) ? etm : (JsonElement?)null) ??
          OptionalMs(e.TryGetProperty("reviewedAtMs", out var ram) ? ram : (JsonElement?)null) ??
          nowMs;

        if (eventTimeMs <= 0) throw new ValidationError($"events[{i}].eventTimeMs invalid", $"events[{i}].eventTimeMs");

        // Upper bound on a client-supplied clock. greatest() is monotonic and
        // has no undo path; a device with a 2030 clock would permanently poison
        // this user's merge -- last_reviewed_at would sit in the future forever,
        // and every later real review would lose the LWW comparison against it.
        // 5 minutes of slack absorbs honest clock skew; anything beyond that is
        // clamped rather than rejected, because the review itself did happen and
        // dropping the event would cost the user real work.
        var eventTimeUpperBoundMs = nowMs + 5 * 60 * 1000;
        if (eventTimeMs > eventTimeUpperBoundMs) eventTimeMs = eventTimeUpperBoundMs;

        // Phase3: nextReviewAtMs (also supports progressAfter.nextReviewAt)
        long? nextReviewAtMs =
          OptionalMs(e.TryGetProperty("nextReviewAtMs", out var nrm) ? nrm : (JsonElement?)null) ??
          OptionalMs(DeepGet(e, "progressAfter", "nextReviewAt")) ??
          null;

        if (nextReviewAtMs is not null && nextReviewAtMs < eventTimeMs)
        {
          nextReviewAtMs = eventTimeMs;
        }

        // The bound that was missing. Without it a due date of year 2500 was
        // stored, echoed back on every pull and adopted by every device, and the
        // card was gone: it is never due, so the user never rates it, so no
        // later event can ever correct it. Nothing anywhere reports this. Push,
        // merge and pull all succeed, the card simply stops existing for the
        // user. Clamping (not rejecting) keeps the review itself, which is a
        // fact the user earned, and bounds only the schedule derived from it.
        // Already-poisoned rows are repaired once by migration 015; this clamp
        // only guards the ingest path.
        if (nextReviewAtMs is not null && nextReviewAtMs > eventTimeMs + MaxNextReviewHorizonMs)
        {
          nextReviewAtMs = eventTimeMs + MaxNextReviewHorizonMs;
        }

        var lastSeenRevision =
          OptionalInt(e.TryGetProperty("lastSeenRevision", out var lsr) ? lsr : (JsonElement?)null) ??
          OptionalInt(DeepGet(e, "progressAfter", "lastSeenRevision")) ??
          null;

        var deckVersion = e.TryGetProperty("deckVersion", out var dv) ? dv.ToString().Trim() : string.Empty;
        deckVersion = string.IsNullOrEmpty(deckVersion) ? null : deckVersion;

        var schemaVersion = OptionalInt(e.TryGetProperty("schemaVersion", out var sv) ? sv : (JsonElement?)null) ?? 1;
        if (schemaVersion <= 0) schemaVersion = 1;

        var rawEventType =
          OptionalString(e.TryGetProperty("eventType", out var et) ? et : (JsonElement?)null) ??
          OptionalString(e.TryGetProperty("type", out var typ) ? typ : (JsonElement?)null) ??
          "card_reviewed";
        var eventType = rawEventType.Equals("review", StringComparison.OrdinalIgnoreCase)
          ? "card_reviewed"
          : rawEventType;

        var sessionId = OptionalString(e.TryGetProperty("sessionId", out var sid) ? sid : (JsonElement?)null);
        var offlineQueueDelayMs =
          OptionalNonNegativeLong(e.TryGetProperty("offlineQueueDelayMs", out var oqd) ? oqd : (JsonElement?)null) ??
          (eventTimeMs > 0 && nowMs >= eventTimeMs ? nowMs - eventTimeMs : (long?)null);
        var dwellTimeMs = OptionalNonNegativeLong(e.TryGetProperty("dwellTimeMs", out var dtm) ? dtm : (JsonElement?)null);
        var reviewStage = OptionalString(e.TryGetProperty("reviewStage", out var rs) ? rs : (JsonElement?)null);
        var reviewCountForCard = OptionalInt(e.TryGetProperty("reviewCountForCard", out var rcfc) ? rcfc : (JsonElement?)null);
        var cardRevision =
          OptionalInt(e.TryGetProperty("cardRevision", out var cr) ? cr : (JsonElement?)null) ??
          lastSeenRevision;
        var statedDifficulty = OptionalInt(e.TryGetProperty("statedDifficulty", out var sd) ? sd : (JsonElement?)null);

        // progressAfter has always carried the full CardProgress, stage
        // included; the ingest simply threw the field away and every device
        // had to guess the stage back out of the interval. Reading it is not a
        // protocol change, it is the server stopping the loss.
        var srsStage = OptionalInt(DeepGet(e, "progressAfter", "stage"));
        if (srsStage is not null) srsStage = Math.Clamp(srsStage.Value, 0, MaxSrsStage);

        // Stored, never interpreted: scheduling stays entirely on the client,
        // so this is provenance for the day the ladder changes shape.
        var schedulerVersion = OptionalString(e.TryGetProperty("schedulerVersion", out var scv) ? scv : (JsonElement?)null);

        normalized.Add(new NormalizedEvent(
          EventId: eventId,
          DeckSlug: deckSlug,
          StableUid: stableUid,
          Rating: rating,
          EventTimeMs: eventTimeMs,
          NextReviewAtMs: nextReviewAtMs,
          LastSeenRevision: lastSeenRevision,
          DeckVersion: deckVersion,
          SchemaVersion: schemaVersion,
          EventType: eventType,
          SessionId: sessionId,
          OfflineQueueDelayMs: offlineQueueDelayMs,
          DwellTimeMs: dwellTimeMs,
          ReviewStage: reviewStage,
          ReviewCountForCard: reviewCountForCard,
          CardRevision: cardRevision,
          StatedDifficulty: statedDifficulty,
          SrsStage: srsStage,
          SchedulerVersion: schedulerVersion));
      }

      // Parse phase ends here: JSON decode plus per-event validation and
      // normalization. Everything after this point is statement assembly and
      // database round trips.
      var parseMs = swParse.Elapsed.TotalMilliseconds;

      var allEventIds = normalized.Select(x => x.EventId).ToList();

      var swSql = Stopwatch.StartNew();
      var values = new List<string>();
      var parameters = new List<object?>();
      var idx = 1;

      static string P(ref int i) => "$" + i++;

      // The users upsert used to be a statement of its own, wrapped together
      // with the event insert in an explicit transaction. Measured on the
      // production ingest (128MB arm64, batch=1, p50): the CTE statement cost
      // 19.9ms and the shell around it -- BEGIN, this upsert, COMMIT -- cost
      // 30.6ms. The wrapper was more expensive than the work it wrapped,
      // because each of those three is a full round trip across the VPC and
      // the work is one.
      //
      // So the upsert moves inside as a CTE and the explicit transaction goes
      // away: a single statement is already atomic. BEGIN/COMMIT was never
      // what made "all of it or none of it" true here, it only made it true
      // across more round trips.
      //
      // Ordering looks like a hazard and is not. user_progress_events.user_sub
      // is `references users(user_sub)`, CTEs have no defined execution order,
      // and this one is not referenced by the main query at all, so "will the
      // parent row exist yet?" is a fair question. What answers it is WHEN the
      // constraint is checked, not the order: a foreign key is an AFTER ROW
      // trigger that fires at the end of the statement, and a data-modifying
      // CTE always runs to completion whether or not anything reads it.
      // Checked against postgres:16-alpine with the users CTE written last and
      // unreferenced, on a user_sub that did not exist: the insert succeeds.
      var userSubParam = P(ref idx);
      parameters.Add(userSub);
      var emailParam = P(ref idx);
      parameters.Add(email);
      var platformParam = P(ref idx);
      parameters.Add(clientPlatform);
      var versionParam = P(ref idx);
      parameters.Add(clientVersion);
      var deviceIdParam = P(ref idx);
      parameters.Add(deviceId);

      foreach (var ev in normalized)
      {
        values.Add($"""
          (
            {P(ref idx)}::uuid,
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            to_timestamp({P(ref idx)}/1000.0),
            {P(ref idx)},
            {P(ref idx)},
            to_timestamp({P(ref idx)}/1000.0),
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            to_timestamp({P(ref idx)}/1000.0),
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)},
            {P(ref idx)}
          )
          """);

        parameters.Add(ev.EventId);
        parameters.Add(userSub);
        parameters.Add(ev.DeckSlug);
        parameters.Add(ev.StableUid);
        parameters.Add(ev.Rating);
        parameters.Add(ev.EventTimeMs);
        parameters.Add(deviceId);
        parameters.Add(clientVersion);
        parameters.Add(ev.NextReviewAtMs);
        parameters.Add(ev.LastSeenRevision);
        parameters.Add(ev.DeckVersion);
        parameters.Add(ev.SchemaVersion);
        parameters.Add(ev.EventType);
        parameters.Add(ev.SessionId);
        parameters.Add(clientPlatform);
        parameters.Add(ev.EventTimeMs);
        parameters.Add(ev.OfflineQueueDelayMs);
        parameters.Add(ev.DwellTimeMs);
        parameters.Add(ev.ReviewStage);
        parameters.Add(ev.ReviewCountForCard);
        parameters.Add(ev.CardRevision);
        parameters.Add(ev.StatedDifficulty);
        parameters.Add(ev.SchedulerVersion);
      }

      // srs_stage rides alongside the batch as an inline VALUES list joined
      // on event_id, instead of becoming a column of user_progress_events.
      // The events table records what the client REPORTED about a review;
      // the ladder position is state, and its home is user_progress. Joining
      // here keeps the ingest one statement (the merge stays atomic with the
      // event insert) without adding a seventh CTE.
      //
      // Deduped on event_id because the join must be a function of it: a
      // batch that repeats one eventId inserts a single row (ON CONFLICT DO
      // NOTHING), and a VALUES side listing that id twice would fan that row
      // out and let `distinct on` pick between two stages at random.
      var stageRows = new List<string>();
      var stageSeen = new HashSet<string>(StringComparer.Ordinal);
      foreach (var ev in normalized)
      {
        if (!stageSeen.Add(ev.EventId)) continue;
        stageRows.Add($"({P(ref idx)}::uuid, {P(ref idx)}::smallint)");
        parameters.Add(ev.EventId);
        parameters.Add(ev.SrsStage);
      }

      var userHashParam = P(ref idx);
      parameters.Add(userIdHash);

      // The outbox tag `card_format` reads cards.mcq (migration 019). Until that
      // migration has run on a database, Postgres answers 42703 for this text;
      // withCardFormat=false is then today's statement, re-run as is. One text
      // per shape, so auto-prepare (Pg.cs) keeps one plan per shape.
      string BuildIngestSql(bool withCardFormat)
      {
        var cardFormatKey = withCardFormat
          ? ",\n              'card_format', case when c.mcq is not null then 'mcq' else 'qa' end"
          : "";
        var cardFormatJoin = withCardFormat
          ? "\n          left join decks d on d.slug = ins.deck_slug and d.is_deleted = 0"
            + "\n          left join cards c on c.deck_id = d.id and c.stable_uid = ins.stable_uid and c.is_deleted = 0"
          : "";
        return $"""
        with ensure_user as (
          insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)
          values ({userSubParam}, {emailParam}, now(), {platformParam}, {versionParam}, {deviceIdParam})
          on conflict (user_sub)
          do update set
            email = coalesce(excluded.email, users.email),
            last_seen_at = now(),
            last_platform = coalesce(excluded.last_platform, users.last_platform),
            last_version = coalesce(excluded.last_version, users.last_version),
            last_device_id = coalesce(excluded.last_device_id, users.last_device_id)
          returning 1
        ),
        ins as (
          insert into user_progress_events (
            event_id, user_sub, deck_slug, stable_uid, rating, event_time, device_id, client_version,
            next_review_at, last_seen_revision, deck_version,
            schema_version, event_type, session_id, client_platform, client_event_time,
            offline_queue_delay_ms, dwell_time_ms, review_stage, review_count_for_card,
            card_revision, stated_difficulty, scheduler_version
          )
          values {string.Join(", ", values)}
          on conflict (event_id) do nothing
          returning
            event_id, user_sub, deck_slug, stable_uid,
            rating, event_time,
            next_review_at, last_seen_revision, deck_version,
            schema_version, event_type, session_id, device_id, client_version, client_platform,
            client_event_time, server_received_at, offline_queue_delay_ms, dwell_time_ms,
            review_stage, review_count_for_card, card_revision, stated_difficulty,
            scheduler_version
        ),
        outbox as (
          insert into analytics_event_outbox (
            event_id, event_type, aggregate_type, aggregate_id, payload
          )
          select
            event_id,
            event_type,
            'card',
            deck_slug || ':' || ins.stable_uid,
            jsonb_strip_nulls(jsonb_build_object(
              'event_id', event_id::text,
              'schema_version', schema_version,
              'event_type', event_type,
              'user_id_hash', {userHashParam},
              'deck_slug', deck_slug,
              'card_stable_uid', ins.stable_uid,
              'card_revision', card_revision,
              'stated_difficulty', stated_difficulty,
              'rating', case rating
                when 1 then 'again'
                when 2 then 'hard'
                when 3 then 'good'
                when 4 then 'easy'
                else null
              end,
              'rating_value', rating,
              'response_score', case rating
                when 1 then 4
                when 2 then 3
                when 3 then 1
                when 4 then 0
                else null
              end,
              'session_id', session_id,
              'review_stage', review_stage,
              'review_count_for_card', review_count_for_card,
              'dwell_time_ms', dwell_time_ms,
              'client_event_ts', client_event_time,
              'server_received_ts', server_received_at,
              'device_id', device_id,
              'platform', client_platform,
              'app_version', client_version,
              'offline_queue_delay_ms', offline_queue_delay_ms,
              'deck_version', deck_version{cardFormatKey}
            ))
          from ins{cardFormatJoin}
          on conflict (event_id) do nothing
          returning 1
        ),
        agg as (
          select
            user_sub, deck_slug, stable_uid,
            count(*)::int as inc,
            max(event_time) as last_reviewed_at
          from ins
          group by user_sub, deck_slug, stable_uid
        ),
        last_row as (
          select distinct on (i.user_sub, i.deck_slug, i.stable_uid)
            i.user_sub, i.deck_slug, i.stable_uid,
            i.rating as last_rating,
            i.event_time as last_reviewed_at,
            coalesce(i.next_review_at, i.event_time) as next_review_at,
            i.last_seen_revision,
            i.deck_version,
            s.srs_stage,
            i.scheduler_version
          from ins i
          join (values {string.Join(", ", stageRows)}) as s(event_id, srs_stage)
            on s.event_id = i.event_id
          -- event_id is the last-resort tiebreak, and it is not decoration.
          -- `distinct on` returns an UNSPECIFIED row among ties, so with
          -- event_time alone two events on one card in the same millisecond
          -- let the plan (parallel scan, index choice, row order) decide which
          -- rating, due date and rung the user ends up with. Ties are not
          -- exotic either: the eventTimeMs clamp above maps every event from a
          -- skewed clock onto the SAME bound, which turns a rare collision
          -- into a systematic one. Any total order beats none; event_id is
          -- already unique, already indexed as the primary key, and does not
          -- vary with the plan.
          --
          -- The TS replica in mobile/tests/unit/multiDeviceSync.sim.test.ts
          -- mirrors this exact rule. That replica can only prove the rule is
          -- consistent with itself: whether Postgres really honours it here
          -- needs a live database, so the SQL-side proof waits on
          -- Testcontainers.
          order by i.user_sub, i.deck_slug, i.stable_uid, i.event_time desc, i.event_id desc
        ),
        merged as (
          select
            a.user_sub, a.deck_slug, a.stable_uid,
            a.inc,
            l.last_rating,
            l.last_reviewed_at,
            l.next_review_at,
            l.last_seen_revision,
            l.deck_version,
            l.srs_stage,
            l.scheduler_version
          from agg a
          join last_row l using (user_sub, deck_slug, stable_uid)
        ),
        upsert as (
          insert into user_progress (
            user_sub, deck_slug, stable_uid,
            status, last_rating, last_reviewed_at,
            review_count, due_at,
            last_seen_revision,
            srs_stage, last_scheduler_version,
            updated_at
          )
          select
            user_sub, deck_slug, stable_uid,
            1 as status,
            last_rating,
            last_reviewed_at,
            inc as review_count,
            next_review_at as due_at,
            last_seen_revision,
            srs_stage,
            scheduler_version as last_scheduler_version,
            now() as updated_at
          from merged
          on conflict (user_sub, deck_slug, stable_uid)
          do update set
            status = greatest(user_progress.status, excluded.status),
            review_count = user_progress.review_count + excluded.review_count,

            last_reviewed_at = greatest(
              coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz),
              excluded.last_reviewed_at
            ),

            last_rating = case
              when excluded.last_reviewed_at >= coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz)
                then excluded.last_rating
              else user_progress.last_rating
            end,

            due_at = case
              when excluded.last_reviewed_at >= coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz)
                then excluded.due_at
              else user_progress.due_at
            end,

            -- srs_stage and last_scheduler_version join last_rating/due_at
            -- under the SAME predicate on purpose: those four columns are one
            -- atomic verdict, "the state as of the most recent review". Any
            -- per-column choice here (greatest, coalesce) would let stage come
            -- from device A while due_at came from device B, and that stitched
            -- pair describes a review that nobody ever did.
            --
            -- Not greatest(): stage is "which rung the last review left the
            -- card on", not "the highest rung ever reached". The day `again`
            -- demotes a card, a monotonic merge would make the demotion
            -- permanently unable to propagate.
            --
            -- The winner writing null (an old client that sends no stage)
            -- is deliberate: null means "unknown, infer it from the interval",
            -- which is honest, while keeping the previous stage next to a new
            -- due_at is exactly the stitched state above.
            srs_stage = case
              when excluded.last_reviewed_at >= coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz)
                then excluded.srs_stage
              else user_progress.srs_stage
            end,

            last_scheduler_version = case
              when excluded.last_reviewed_at >= coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz)
                then excluded.last_scheduler_version
              else user_progress.last_scheduler_version
            end,

            last_seen_revision = greatest(
              coalesce(user_progress.last_seen_revision, 0),
              coalesce(excluded.last_seen_revision, 0)
            ),

            updated_at = now()
          returning 1
        )
        select
          coalesce(json_agg(ins.event_id::text), '[]'::json) as inserted_event_ids,
          count(*)::int as inserted_count
        from ins;
        """;
      }

      // Timed on its own because this is the claim the design rests on: the
      // whole ingest (users upsert, event insert, outbox, aggregate,
      // last-writer-wins merge) is ONE statement, so it is one round trip.
      // The 42703 fallback below is a second statement only on a database that
      // has not run migration 019.
      //
      // sql_ms now brackets nothing but this statement and the string building
      // in front of it, so the two numbers should sit on top of each other in
      // production. A gap opening between them is the shell growing back, and
      // that is the whole reason both are still emitted.
      var swStatement = Stopwatch.StartNew();
      List<Dictionary<string, object?>> rows;
      try
      {
        rows = await DbUtil.QueryAsync(conn, null, BuildIngestSql(withCardFormat: true), parameters);
      }
      catch (PostgresException pg) when (pg.SqlState == "42703")
      {
        // cards.mcq is not there yet: the failed statement wrote nothing (one
        // statement, no shell), so today's text is run in its place. Logged so a
        // production database that has not had migration 019 is visible.
        Log.Warn(JsonSerializer.Serialize(new
        {
          traceId = req.TraceId,
          impl = ProgressEventsImpl,
          step = "ingest_card_format_fallback",
          sqlState = pg.SqlState,
        }));
        rows = await DbUtil.QueryAsync(conn, null, BuildIngestSql(withCardFormat: false), parameters);
      }
      var statementMs = swStatement.Elapsed.TotalMilliseconds;

      var sqlMs = swSql.Elapsed.TotalMilliseconds;

      var insertedIds = rows.Count > 0
        ? ParseStringArrayFromJson(rows[0].TryGetValue("inserted_event_ids", out var iev) ? iev : null)
        : [];

      var acceptedSet = new HashSet<string>(insertedIds, StringComparer.Ordinal);
      var duplicateEventIds = allEventIds.Where(id => !acceptedSet.Contains(id)).ToList();

      // One line, emitted only on the success path, so the numbers all
      // describe the same complete ingest. total_ms stops before response
      // serialization because that is the last thing the handler does and it
      // cannot be measured from inside itself; the gap between total_ms and
      // the sum of the phases is the handler's own overhead, and leaving it
      // visible is the point.
      Log.Info(JsonSerializer.Serialize(new
      {
        traceId = req.TraceId,
        impl = ProgressEventsImpl,
        step = "ingest_timing",
        batchSize = allEventIds.Count,
        acceptedCount = insertedIds.Count,
        connMs = Math.Round(connMs, 3),
        parseMs = Math.Round(parseMs, 3),
        statementMs = Math.Round(statementMs, 3),
        sqlMs = Math.Round(sqlMs, 3),
        totalMs = Math.Round(swTotal.Elapsed.TotalMilliseconds, 3),
      }));

      return res.Ok(new
      {
        serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        receivedCount = allEventIds.Count,
        acceptedCount = insertedIds.Count,
        acceptedEventIds = insertedIds,
        duplicateEventIds,
      });
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      return res.Error500(ex);
    }
  }

  private static string RequireString(JsonElement obj, string prop, string fieldName)
  {
    if (!obj.TryGetProperty(prop, out var el) || el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined)
    {
      throw new ValidationError($"{fieldName} is required", fieldName);
    }

    var s = el.ToString().Trim();
    if (s.Length == 0) throw new ValidationError($"{fieldName} is required", fieldName);
    return s;
  }

  private static int? OptionalInt(JsonElement? v)
  {
    if (v is null) return null;
    var el = v.Value;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;

    if (el.ValueKind == JsonValueKind.Number)
    {
      if (el.TryGetInt32(out var n)) return n;
      return null;
    }

    var s = el.ToString().Trim();
    return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : null;
  }

  private static long? OptionalMs(JsonElement? v)
  {
    if (v is null) return null;
    var el = v.Value;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;

    if (el.ValueKind == JsonValueKind.Number)
    {
      if (el.TryGetInt64(out var n) && n > 0) return n;
      if (el.TryGetDouble(out var d) && d > 0) return (long)Math.Floor(d);
      return null;
    }

    var s = el.ToString().Trim();
    if (long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ms) && ms > 0) return ms;
    return null;
  }

  private static long? OptionalNonNegativeLong(JsonElement? v)
  {
    if (v is null) return null;
    var el = v.Value;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;

    if (el.ValueKind == JsonValueKind.Number)
    {
      if (el.TryGetInt64(out var n) && n >= 0) return n;
      if (el.TryGetDouble(out var d) && d >= 0) return (long)Math.Floor(d);
      return null;
    }

    var s = el.ToString().Trim();
    return long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) && i >= 0 ? i : null;
  }

  private static string? OptionalString(JsonElement? v)
  {
    if (v is null) return null;
    var el = v.Value;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;
    var s = el.ToString().Trim();
    return s.Length == 0 ? null : s;
  }

  private static JsonElement? DeepGet(JsonElement obj, string p1, string p2)
  {
    if (obj.ValueKind != JsonValueKind.Object) return null;
    if (!obj.TryGetProperty(p1, out var a) || a.ValueKind != JsonValueKind.Object) return null;
    return a.TryGetProperty(p2, out var b) ? b : null;
  }

  private static string? GetClaimString(IReadOnlyDictionary<string, JsonElement> claims, string key)
  {
    if (!claims.TryGetValue(key, out var el)) return null;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;
    return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
  }

  private static string HashUserId(string userSub)
  {
    var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(userSub));
    return Convert.ToHexString(bytes).ToLowerInvariant();
  }

  private static List<string> ParseStringArrayFromJson(object? value)
  {
    if (value is null) return [];

    try
    {
      switch (value)
      {
        case string s:
          return JsonSerializer.Deserialize<List<string>>(s) ?? [];
        case JsonDocument doc:
          return doc.RootElement.ValueKind == JsonValueKind.Array
            ? doc.RootElement.EnumerateArray().Select(x => x.ToString()).ToList()
            : [];
        case JsonElement el:
          return el.ValueKind == JsonValueKind.Array
            ? el.EnumerateArray().Select(x => x.ToString()).ToList()
            : [];
      }
    }
    catch
    {
      // ignore
    }

    return [];
  }
}
