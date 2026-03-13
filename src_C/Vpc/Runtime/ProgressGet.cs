using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;

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
        (extract(epoch from updated_at) * 1000)::bigint as "updatedAtMs"
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

    if (sinceMs is not null)
    {
      sql += $" and (extract(epoch from updated_at) * 1000)::bigint > ${idx++}";
      parameters.Add(sinceMs.Value);
    }

    sql += $" order by updated_at asc, deck_slug asc, stable_uid asc limit ${idx++}";
    parameters.Add(limit);

    var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);

    return res.Ok(new
    {
      serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      sinceMs,
      items = rows,
    });
  }
}

