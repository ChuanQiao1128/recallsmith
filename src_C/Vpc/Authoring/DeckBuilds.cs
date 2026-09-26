using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// GET /api/v1/admin/decks/{deckId}/builds (super-admin): lists the deck's SUCCESS builds, newest
/// first, and reports which one is live. Read-only companion to <see cref="DeckRollback"/>: it is
/// what the console rollback picker reads before spending a typed confirmation to move the pointer.
/// </summary>
public static class DeckBuilds
{
  /// <summary>
  /// "/api/v1/admin/decks/{id}/builds" → id (tolerant of a stage prefix like "/dev/…"). null unless
  /// the single segment between the marker and "/builds" parses as a positive long. Mirrors
  /// <see cref="DeckRollback.ParseDeckId"/> with the "/builds" suffix.
  /// </summary>
  public static long? ParseDeckId(string path)
  {
    if (string.IsNullOrEmpty(path)) return null;
    const string marker = "/api/v1/admin/decks/";
    var idx = path.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
    if (idx < 0) return null;
    var rest = path.Substring(idx + marker.Length);
    const string suffix = "/builds";
    if (!rest.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return null;
    var seg = rest.Substring(0, rest.Length - suffix.Length);
    if (seg.Length == 0 || seg.Contains('/')) return null;
    if (!long.TryParse(seg, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)) return null;
    return id > 0 ? id : null;
  }

  public static async Task<APIGatewayProxyResponse> HandleDeckBuilds(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed("Method not allowed");

    var deckId = ParseDeckId(req.Path.TrimEnd('/'));
    if (deckId is null) return res.BadRequest("VALIDATION_ERROR", "deckId must be a positive integer");

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

      var deckRows = await DbUtil.QueryAsync(conn, null,
        "select id, slug, live_build_id from decks where id = $1 and is_deleted = 0", [deckId.Value]);
      if (deckRows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", $"Deck {deckId.Value} not found");

      var slug = Convert.ToString(deckRows[0]["slug"], CultureInfo.InvariantCulture) ?? string.Empty;
      var live = deckRows[0].TryGetValue("live_build_id", out var lv) ? lv : null;
      var liveBuildId = live is null ? null : Convert.ToString(live, CultureInfo.InvariantCulture);

      var buildRows = await DbUtil.QueryAsync(conn, null,
        """
        select build_id as "buildId", job_id as "jobId", note, created_at as "createdAt"
        from deck_publishes
        where deck_id = $1 and status = 'SUCCESS'
        order by created_at desc, id desc
        limit 50
        """,
        [deckId.Value]);

      var builds = new List<object>(buildRows.Count);
      foreach (var row in buildRows)
      {
        var buildId = row.TryGetValue("buildId", out var bv) ? bv : null;
        var buildIdStr = buildId is null ? null : Convert.ToString(buildId, CultureInfo.InvariantCulture);
        var isLive = liveBuildId is not null && string.Equals(buildIdStr, liveBuildId, StringComparison.Ordinal);
        builds.Add(new
        {
          buildId,
          jobId = row.TryGetValue("jobId", out var jv) ? jv : null,
          note = row.TryGetValue("note", out var nv) ? nv : null,
          createdAt = row.TryGetValue("createdAt", out var cv) ? cv : null,
          isLive,
        });
      }

      return res.Ok(new { deckId = deckId.Value, slug, liveBuildId, builds });
    }
    catch (Exception ex)
    {
      return res.Error500(ex);
    }
  }
}
