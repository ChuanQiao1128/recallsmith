using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class ProgressGet
{
  public static async Task<APIGatewayProxyResponse> HandleProgressGet(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var userSub = auth.UserSub!;
    var deckSlug = req.Query.TryGetValue("deckSlug", out var ds) ? ds.Trim() : null;

    var sinceMs = Validation.ParseOptionalMs(req.Query.TryGetValue("sinceMs", out var sm) ? sm : null);
    var limitRaw = Validation.ParseOptionalInteger(req.Query.TryGetValue("limit", out var lr) ? lr : null, "limit");
    var limit = (int)Math.Max(1, Math.Min(limitRaw ?? 5000, 5000));

    // Optional keyset cursor (takes precedence over legacy sinceMs when both present).
    var cursorRaw = req.Query.TryGetValue("cursor", out var cr) ? cr : null;
    SyncPullCursor? cursor = null;
    if (!string.IsNullOrWhiteSpace(cursorRaw))
    {
      cursor = SyncPullCursor.TryDecode(cursorRaw);
      if (cursor is null) return res.BadRequest("VALIDATION_ERROR", "cursor is malformed");
    }

    // "__cursorUs" (exact epoch microseconds — timestamptz precision) is a
    // server-internal field used to build nextCursor and is stripped from items
    // before responding. The rounded-ms "updatedAtMs" cannot be used for the
    // cursor: a bound that differs from the stored timestamp by even 1us either
    // re-delivers a whole same-timestamp batch (push batches share one
    // transaction-stable now()) or skips rows across the page boundary.
    var sql = """
      select
        deck_slug as "deckSlug",
        stable_uid as "stableUid",
        status,
        review_count as "reviewCount",
        last_rating as "lastRating",
        (extract(epoch from last_reviewed_at) * 1000)::bigint as "lastReviewedAtMs",
        (extract(epoch from due_at) * 1000)::bigint as "nextReviewAtMs",
        last_seen_revision as "lastSeenRevision",
        -- Nullable by design: null marks a row merged before the server stored
        -- stage, and the client falls back to inferring it from the interval
        -- for exactly those rows. Sending 0 instead would be a lie a client
        -- cannot detect (0 is a real rung).
        srs_stage as "srsStage",
        (extract(epoch from updated_at) * 1000)::bigint as "updatedAtMs",
        floor(extract(epoch from updated_at) * 1000000)::bigint as "__cursorUs"
      from user_progress
      where user_sub = $1
      """;

    var parameters = new List<object?> { userSub };
    var idx = 2;

    if (!string.IsNullOrEmpty(deckSlug))
    {
      sql += $" and deck_slug = ${idx++}";
      parameters.Add(deckSlug);
    }

    if (cursor is not null)
    {
      // Sargable keyset row comparison on the full sort tuple; served by
      // idx_progress_user_keyset (user_sub, updated_at, deck_slug, stable_uid).
      // Unlike the legacy sinceMs strict '>', rows sharing one updated_at
      // (whole push batches — now() is transaction-stable) paginate correctly
      // via the (deck_slug, stable_uid) tie-breakers. The bound is exact:
      // TotalMicros() rebuilds the stored microsecond timestamp, and float64
      // error at current epochs (< 0.5us) vanishes in to_timestamp's rounding
      // to timestamptz's own microsecond precision.
      sql += $" and (updated_at, deck_slug, stable_uid) > (to_timestamp(${idx++} / 1000000.0), ${idx++}, ${idx++})";
      parameters.Add(cursor.TotalMicros());
      parameters.Add(cursor.DeckSlug);
      parameters.Add(cursor.StableUid);
    }
    else if (sinceMs is not null)
    {
      // Legacy predicate kept byte-for-byte: deployed App Store clients depend on
      // its exact (rounded-ms, strict '>') semantics. Rewriting it as
      // `updated_at > to_timestamp(sinceMs / 1000.0)` would NOT be equivalent —
      // ::bigint rounds half-up, so rows within 0.5ms of the boundary would
      // change sides. New clients should use `cursor` instead.
      sql += $" and (extract(epoch from updated_at) * 1000)::bigint > ${idx++}";
      parameters.Add(sinceMs.Value);
    }

    sql += $" order by updated_at asc, deck_slug asc, stable_uid asc limit ${idx++}";
    parameters.Add(limit);

    var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);

    // Additive pagination fields (returned in both cursor and legacy modes so
    // deployed sinceMs clients can upgrade to cursor draining mid-stream).
    // nextCursor is built for ANY non-empty page — including the final one:
    // clients persist it across syncs, so the next sync resumes from the exact
    // keyset tuple instead of a rounded-ms strict '>' — that cross-sync boundary
    // is precisely where same-timestamp rows used to be skipped.
    var hasMore = rows.Count == limit;
    string? nextCursor = null;
    if (rows.Count > 0)
    {
      var last = rows[^1];
      nextCursor = SyncPullCursor.FromTotalMicros(
        Convert.ToInt64(last["__cursorUs"], CultureInfo.InvariantCulture),
        Convert.ToString(last["deckSlug"], CultureInfo.InvariantCulture) ?? string.Empty,
        Convert.ToString(last["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty).Encode();
    }

    foreach (var row in rows) row.Remove("__cursorUs");

    return res.Ok(new
    {
      serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      sinceMs,
      items = rows,
      nextCursor,
      hasMore,
    });
  }
}

