using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class ManifestRebuild
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string ContentPrefix = ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
  private static readonly string PremiumPrefix = ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");

  public static async Task<APIGatewayProxyResponse> HandleManifestRebuild(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");
    if (string.IsNullOrEmpty(ContentBucket)) return res.BadRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    var r = await ManifestBuilder.RebuildAsync(conn, ManifestBuilder.S3(), ContentBucket, ContentPrefix, PremiumPrefix);

    return res.Ok(new { ok = true, manifestKey = r.Key, generatedAtMs = r.GeneratedAtMs, deckCount = r.DeckCount });
  }
}
