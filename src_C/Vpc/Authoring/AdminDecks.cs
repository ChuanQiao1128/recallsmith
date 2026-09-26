using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// GET /api/v1/admin/decks — keyset-paginated deck list for the publishing console.
/// Unlike GET /api/v1/authoring/decks (whole catalog in one response) and
/// GET /api/v1/admin/manifest (whole manifest.json proxied through Lambda),
/// this endpoint pages by (updated_at DESC, slug DESC) so console responses stay
/// far below the Lambda/API Gateway response cap at enterprise catalog sizes.
/// Auth matches AdminManifest (super_admin) — the console deck list already
/// requires the manifest endpoint at that level today.
/// </summary>
public static class AdminDecks
{
  private const int DefaultLimit = 50;
  private const int MaxLimit = 200;

  // Escape ILIKE metacharacters so user input matches literally inside '%...%'.
  // Backslash must be escaped first so it does not double-escape the others.
  public static string EscapeLikePattern(string raw) =>
    raw
      .Replace(@"\", @"\\")
      .Replace("%", @"\%")
      .Replace("_", @"\_");

  public static async Task<APIGatewayProxyResponse> HandleAdminDecks(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var limitRaw = Validation.ParseOptionalInteger(req.Query.TryGetValue("limit", out var lr) ? lr : null, "limit");
      var limit = (int)Math.Max(1, Math.Min(limitRaw ?? DefaultLimit, MaxLimit));

      var cursorRaw = req.Query.TryGetValue("cursor", out var cr) ? cr : null;
      AdminDecksCursor? cursor = null;
      if (!string.IsNullOrWhiteSpace(cursorRaw))
      {
        cursor = AdminDecksCursor.TryDecode(cursorRaw);
        if (cursor is null) return res.BadRequest("VALIDATION_ERROR", "cursor is malformed");
      }

      var q = req.Query.TryGetValue("q", out var rq) ? rq.Trim() : null;
      if (string.IsNullOrEmpty(q)) q = null;

      // "__cursorUs" (exact epoch microseconds — timestamptz precision) is
      // server-internal and stripped from items before responding. The rounded-ms
      // "updatedAtMs" cannot be the cursor bound: with a DESC keyset, a bound
      // above the stored timestamp re-delivers every row sharing that timestamp
      // (bulk updates share one transaction-stable now()) and a bound below it
      // skips rows across the page boundary.
      var sql = """
        select
          d.id,
          d.slug,
          d.title,
          d.tier,
          d.availability,
          d.deck_type as "deckType",
          d.total_cards as "totalCards",
          d.version,
          (extract(epoch from d.updated_at) * 1000)::bigint as "updatedAtMs",
          floor(extract(epoch from d.updated_at) * 1000000)::bigint as "__cursorUs",
          lp.build_id as "latestBuildId"
        from decks d
        left join lateral (
          select p.build_id
          from deck_publishes p
          where p.deck_id = d.id and p.status = 'SUCCESS'
          order by p.created_at desc, p.id desc
          limit 1
        ) lp on true
        where d.is_deleted = 0
        """;

      var parameters = new List<object?>();

      if (q is not null)
      {
        // Parameterized ILIKE; q is escaped so % _ \ in user input match literally.
        // No trigram index exists (the migration runner is transactional and
        // installing pg_trgm may need superuser); a scan is acceptable at
        // console-admin data sizes.
        parameters.Add("%" + EscapeLikePattern(q) + "%");
        sql += $" and (d.slug ilike ${parameters.Count} or d.title ilike ${parameters.Count})";
      }

      if (cursor is not null)
      {
        // Sargable keyset row comparison, served by
        // idx_decks_updated_at_slug (updated_at DESC, slug DESC). The bound is
        // exact: TotalMicros() rebuilds the stored microsecond timestamp (see
        // KeysetCursors.cs), so the slug tie-breaker engages precisely at the
        // boundary row — no skips, no re-delivery.
        parameters.Add(cursor.TotalMicros());
        var uIdx = parameters.Count;
        parameters.Add(cursor.Slug);
        var sIdx = parameters.Count;
        sql += $" and (d.updated_at, d.slug) < (to_timestamp(${uIdx} / 1000000.0), ${sIdx})";
      }

      parameters.Add(limit);
      sql += $" order by d.updated_at desc, d.slug desc limit ${parameters.Count}";

      var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);

      var hasMore = rows.Count == limit;
      string? nextCursor = null;
      if (hasMore && rows.Count > 0)
      {
        var last = rows[^1];
        nextCursor = AdminDecksCursor.FromTotalMicros(
          Convert.ToInt64(last["__cursorUs"], CultureInfo.InvariantCulture),
          Convert.ToString(last["slug"], CultureInfo.InvariantCulture) ?? string.Empty).Encode();
      }

      foreach (var row in rows) row.Remove("__cursorUs");

      return res.Ok(new
      {
        items = rows,
        nextCursor,
        hasMore,
      });
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      var handled = Helpers.HandlePgError(ex, res);
      if (handled is not null) return handled;
      return res.Error500(ex);
    }
  }
}
