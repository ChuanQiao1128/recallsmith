using System.Text.Json;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class AdminManifest
{
  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
  }

  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string ContentPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
  private static readonly string ManifestKey = $"{ContentPrefix}/manifest.json";

  private static AmazonS3Client? _s3;
  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    var c = _s3;
    _s3 = null;
    if (c is null) return;
    try { c.Dispose(); } catch { /* best-effort */ }
  }

  public static async Task<APIGatewayProxyResponse> HandleAdminManifest(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed("Method not allowed");
    if (string.IsNullOrEmpty(ContentBucket)) return res.BadRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

    try
    {
      Log.Info(JsonSerializer.Serialize(new
      {
        impl = "adminManifest-v1",
        step = "s3_get_start",
        bucket = ContentBucket,
        key = ManifestKey,
      }));

      using var obj = await S3().GetObjectAsync(new GetObjectRequest { BucketName = ContentBucket, Key = ManifestKey });
      string text;
      using var sr = new StreamReader(obj.ResponseStream);
      text = await sr.ReadToEndAsync();

      using var jsonDoc = JsonDocument.Parse(text);

      Log.Info(JsonSerializer.Serialize(new { impl = "adminManifest-v1", step = "s3_get_done", bytes = text.Length }));

      return res.Ok(new
      {
        manifestKey = ManifestKey,
        bucket = ContentBucket,
        manifest = jsonDoc.RootElement.Clone(),
      });
    }
    catch (Exception ex)
    {
      Log.Error("[adminManifest] failed:", ex);
      return res.Error500(ex);
    }
  }
}
