using System.IO;
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

    // 💡 核心优化：利用 /tmp 临时文件实现极低内存占用的流式序列化和上传
    var tmpPath = Path.Combine("/tmp", $"{Guid.NewGuid()}.json");
    
    try 
    {
      // 1. 流式将 JSON 写入磁盘，避免在内存中拼接巨大的 JSON 字符串
      await using (var fs = new FileStream(tmpPath, FileMode.Create, FileAccess.Write))
      {
        var options = new JsonSerializerOptions
        {
          PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
          WriteIndented = false
        };
        await JsonSerializer.SerializeAsync(fs, data, options);
      }

      // 2. 调用 SDK 的 FilePath 上传 (SDK 自动按 8MB 分块上传，极低内存消耗)
      var putRequest = new PutObjectRequest
      {
        BucketName = bucket,
        Key = s3Key,
        FilePath = tmpPath,
        ContentType = "application/json; charset=utf-8",
      };

      putRequest.Headers.CacheControl = "public, max-age=300, s-maxage=300";

      await S3().PutObjectAsync(putRequest);
    }
    finally
    {
      // 3. 清理现场，防止 Lambda 实例复用导致磁盘爆满
      if (File.Exists(tmpPath))
      {
        File.Delete(tmpPath);
      }
    }
  }
}
