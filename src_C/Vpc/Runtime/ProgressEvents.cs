using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;

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
    string? DeckVersion);

  public static async Task<APIGatewayProxyResponse> HandleProgressEvents(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
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

        // Phase3: nextReviewAtMs (also supports progressAfter.nextReviewAt)
        long? nextReviewAtMs =
          OptionalMs(e.TryGetProperty("nextReviewAtMs", out var nrm) ? nrm : (JsonElement?)null) ??
          OptionalMs(DeepGet(e, "progressAfter", "nextReviewAt")) ??
          null;

        if (nextReviewAtMs is not null && nextReviewAtMs < eventTimeMs)
        {
          nextReviewAtMs = eventTimeMs;
        }

        var lastSeenRevision =
          OptionalInt(e.TryGetProperty("lastSeenRevision", out var lsr) ? lsr : (JsonElement?)null) ??
          OptionalInt(DeepGet(e, "progressAfter", "lastSeenRevision")) ??
          null;

        var deckVersion = e.TryGetProperty("deckVersion", out var dv) ? dv.ToString().Trim() : string.Empty;
        deckVersion = string.IsNullOrEmpty(deckVersion) ? null : deckVersion;

        normalized.Add(new NormalizedEvent(
          EventId: eventId,
          DeckSlug: deckSlug,
          StableUid: stableUid,
          Rating: rating,
          EventTimeMs: eventTimeMs,
          NextReviewAtMs: nextReviewAtMs,
          LastSeenRevision: lastSeenRevision,
          DeckVersion: deckVersion));
      }

      var allEventIds = normalized.Select(x => x.EventId).ToList();

      await using var tx = await conn.BeginTransactionAsync();
      try
      {
        const string upsertUser = """
          insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)
          values ($1, $2, now(), $3, $4, $5)
          on conflict (user_sub)
          do update set
            email = coalesce(excluded.email, users.email),
            last_seen_at = now(),
            last_platform = coalesce(excluded.last_platform, users.last_platform),
            last_version = coalesce(excluded.last_version, users.last_version),
            last_device_id = coalesce(excluded.last_device_id, users.last_device_id)
          """;

        await DbUtil.ExecuteAsync(conn, tx, upsertUser, [userSub, email, clientPlatform, clientVersion, deviceId]);

        var values = new List<string>();
        var parameters = new List<object?>();
        var idx = 1;

        static string P(ref int i) => "$" + i++;

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
        }

        var sql = $"""
          with ins as (
            insert into user_progress_events (
              event_id, user_sub, deck_slug, stable_uid, rating, event_time, device_id, client_version,
              next_review_at, last_seen_revision, deck_version
            )
            values {string.Join(", ", values)}
            on conflict (event_id) do nothing
            returning
              event_id, user_sub, deck_slug, stable_uid,
              rating, event_time,
              next_review_at, last_seen_revision, deck_version
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
            select distinct on (user_sub, deck_slug, stable_uid)
              user_sub, deck_slug, stable_uid,
              rating as last_rating,
              event_time as last_reviewed_at,
              coalesce(next_review_at, event_time) as next_review_at,
              last_seen_revision,
              deck_version
            from ins
            order by user_sub, deck_slug, stable_uid, event_time desc
          ),
          merged as (
            select
              a.user_sub, a.deck_slug, a.stable_uid,
              a.inc,
              l.last_rating,
              l.last_reviewed_at,
              l.next_review_at,
              l.last_seen_revision,
              l.deck_version
            from agg a
            join last_row l using (user_sub, deck_slug, stable_uid)
          ),
          upsert as (
            insert into user_progress (
              user_sub, deck_slug, stable_uid,
              status, last_rating, last_reviewed_at,
              review_count, due_at,
              last_seen_revision,
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

        var rows = await DbUtil.QueryAsync(conn, tx, sql, parameters);
        await tx.CommitAsync();

        var insertedIds = rows.Count > 0
          ? ParseStringArrayFromJson(rows[0].TryGetValue("inserted_event_ids", out var iev) ? iev : null)
          : [];

        var acceptedSet = new HashSet<string>(insertedIds, StringComparer.Ordinal);
        var duplicateEventIds = allEventIds.Where(id => !acceptedSet.Contains(id)).ToList();

        return res.Ok(new
        {
          serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
          receivedCount = allEventIds.Count,
          acceptedCount = insertedIds.Count,
          acceptedEventIds = insertedIds,
          duplicateEventIds,
        });
      }
      catch
      {
        try { await tx.RollbackAsync(); } catch { /* ignore */ }
        throw;
      }
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

