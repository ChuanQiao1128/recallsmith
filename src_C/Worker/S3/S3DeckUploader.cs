using System.Text.Json;
using Amazon;
using Amazon.S3;
using Amazon.S3.Model;

namespace RecallSmith.Lambda.Worker.S3;

public class S3DeckUploader : IS3DeckUploader
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string? PremiumBucket = Environment.GetEnvironmentVariable("PREMIUM_BUCKET");

  private static AmazonS3Client? _s3;
  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  // Used by SnapStart runtime hooks
  public static void Reset()
  {
    var s3Client = _s3;
    _s3 = null;
    if (s3Client is not null) try { s3Client.Dispose(); } catch { /* best-effort */ }
  }

  public async Task UploadAsync(string s3Key, DeckExportData data)
  {
    // 根据 s3Key 前缀判断使用哪个 bucket
    var prefix = s3Key.Split('/')[0];
    var bucket = prefix switch
    {
      "premium" => PremiumBucket,
      _ => ContentBucket
    };

    if (string.IsNullOrEmpty(bucket))
    {
      throw new InvalidOperationException($"Missing bucket config for prefix: {prefix}");
    }

    var json = JsonSerializer.Serialize(data, new JsonSerializerOptions
    {
      PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
      WriteIndented = false
    });

    var putRequest = new PutObjectRequest
    {
      BucketName = bucket,
      Key = s3Key,
      ContentBody = json,
      ContentType = "application/json; charset=utf-8",
    };

    // 设置缓存头
    putRequest.Headers.CacheControl = "public, max-age=300, s-maxage=300";

    await S3().PutObjectAsync(putRequest);
  }
}
