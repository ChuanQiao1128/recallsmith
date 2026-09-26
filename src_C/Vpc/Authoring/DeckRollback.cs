using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// POST /api/v1/admin/decks/{deckId}/rollback (super-admin): moves decks.live_build_id to a prior
/// SUCCESS build and rebuilds manifest.json in-process. Body { "buildId": "&lt;build_id&gt;" }.
/// </summary>
public static class DeckRollback
{
  public delegate Task<ManifestBuildResult> ManifestRebuildFn(NpgsqlConnection conn);

  private static readonly string? CONTENT_BUCKET = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string? CONTENT_PREFIX = Environment.GetEnvironmentVariable("CONTENT_PREFIX");
  private static readonly string? PREMIUM_PREFIX = Environment.GetEnvironmentVariable("PREMIUM_PREFIX");

  /// <summary>
  /// "/api/v1/admin/decks/{id}/rollback" → id (tolerant of a stage prefix like "/dev/…"). null unless
  /// the single segment between the marker and "/rollback" parses as a positive long.
  /// </summary>
  public static long? ParseDeckId(string path)
  {
    if (string.IsNullOrEmpty(path)) return null;
    const string marker = "/api/v1/admin/decks/";
    var idx = path.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
    if (idx < 0) return null;
    var rest = path.Substring(idx + marker.Length);
    const string suffix = "/rollback";
    if (!rest.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return null;
    var seg = rest.Substring(0, rest.Length - suffix.Length);
    if (seg.Length == 0 || seg.Contains('/')) return null;
    if (!long.TryParse(seg, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)) return null;
    return id > 0 ? id : null;
  }

  public static Task<APIGatewayProxyResponse> HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth) =>
    HandleDeckRollback(req, res, auth, DefaultRebuildAsync);

  public static async Task<APIGatewayProxyResponse> HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth, ManifestRebuildFn rebuild)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var deckId = ParseDeckId(req.Path.TrimEnd('/'));
    if (deckId is null) return res.BadRequest("VALIDATION_ERROR", "deckId must be a positive integer");

    string? buildId = null;
    using (var body = Validation.ParseJsonBody(req))
    {
      if (body is not null && body.RootElement.ValueKind == JsonValueKind.Object &&
          body.RootElement.TryGetProperty("buildId", out var bidEl) && bidEl.ValueKind == JsonValueKind.String)
      {
        buildId = bidEl.GetString();
      }
    }
    if (string.IsNullOrEmpty(buildId)) return res.BadRequest("VALIDATION_ERROR", "buildId is required");

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars");

      var deckRows = await DbUtil.QueryAsync(conn, null,
        "select id, slug, live_build_id from decks where id = $1 and is_deleted = 0", [deckId.Value]);
      if (deckRows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", $"Deck {deckId.Value} not found");

      var slug = Convert.ToString(deckRows[0]["slug"], CultureInfo.InvariantCulture) ?? string.Empty;
      var prev = deckRows[0].TryGetValue("live_build_id", out var pv) ? pv : null;
      var previousBuildId = prev is null ? null : Convert.ToString(prev, CultureInfo.InvariantCulture);

      var buildRows = await DbUtil.QueryAsync(conn, null,
        "select 1 as ok from deck_publishes where deck_id = $1 and build_id = $2 and status = 'SUCCESS' limit 1",
        [deckId.Value, buildId]);
      if (buildRows.Count == 0) return res.BadRequest("VALIDATION_ERROR", $"No SUCCESS build {buildId} for deck {deckId.Value}");

      await DbUtil.ExecuteAsync(conn, null, "update decks set live_build_id = $2 where id = $1", [deckId.Value, buildId]);

      await rebuild(conn);

      return res.Ok(new
      {
        deckId = deckId.Value,
        slug,
        liveBuildId = buildId,
        previousBuildId,
        manifestRebuilt = true,
      });
    }
    catch (Exception ex)
    {
      return res.Error500(ex);
    }
  }

  private static Task<ManifestBuildResult> DefaultRebuildAsync(NpgsqlConnection conn)
  {
    if (string.IsNullOrEmpty(CONTENT_BUCKET)) throw new InvalidOperationException("Missing env CONTENT_BUCKET");
    return ManifestBuilder.RebuildAsync(
      conn,
      ManifestBuilder.S3(),
      CONTENT_BUCKET,
      ManifestBuilder.NormalizePrefix(CONTENT_PREFIX, "content"),
      ManifestBuilder.NormalizePrefix(PREMIUM_PREFIX, "premium"));
  }
}
