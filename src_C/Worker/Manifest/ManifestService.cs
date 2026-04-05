using Amazon;
using Amazon.SQS;
using Amazon.SQS.Model;

namespace RecallSmith.Lambda.Worker.Manifest;

/// <summary>
/// Manifest 重建服务
/// 已重构为防惊群效应 (Anti-Thundering Herd) 架构：
/// 不再同步执行耗时的全表扫描和 S3 覆盖，而是向 SQS 队列发送解耦消息，由专门的 Builder 聚合处理。
/// </summary>
public class ManifestService : IManifestService
{
  private static readonly string? ManifestQueueUrl = Environment.GetEnvironmentVariable("MANIFEST_QUEUE_URL");

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS()
  {
    if (_sqs is not null) return _sqs;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _sqs = new AmazonSQSClient(RegionEndpoint.GetBySystemName(region));
    return _sqs;
  }

  // Used by SnapStart runtime hooks
  public static void Reset()
  {
    var c = _sqs;
    _sqs = null;
    if (c is null) return;
    try { c.Dispose(); } catch { /* best-effort */ }
  }

  public async Task RebuildAsync()
  {
    if (string.IsNullOrEmpty(ManifestQueueUrl))
    {
      // 降级保护：如果没有配置队列环境变量，打印警告并跳过
      Console.WriteLine("⚠️ WARNING: MANIFEST_QUEUE_URL is not set. Skipping manifest rebuild event.");
      return;
    }

    var request = new SendMessageRequest
    {
      QueueUrl = ManifestQueueUrl,
      MessageBody = "{\"action\": \"rebuild_manifest\", \"timestamp\": \"" + DateTime.UtcNow.ToString("O") + "\"}"
    };

    await SQS().SendMessageAsync(request);
    Console.WriteLine($"[ManifestService] Sent rebuild event to queue: {ManifestQueueUrl}");
  }
}
