using System.Globalization;
using System.Net;
using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker.Models;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace RecallSmith.Lambda.Worker;

/// <summary>
/// SQS Worker Lambda 入口。从 SQS 接收发布任务消息，执行 5-Step 流水线。
/// Returns an <see cref="SQSBatchResponse"/> so partial-batch failures are reported
/// (ReportBatchItemFailures); it never rethrows. A failed item redelivers only after the
/// queue's visibility timeout, which infra sets to 3700 s ≥ 6 × the worker's 615 s timeout
/// (infra/modules/worker/queue.tf) so a still-running job is never redelivered.
/// </summary>
public class WorkerFunction
{
  private readonly IPublishJobProcessor _processor;
  private readonly Func<long, Task> _rebuildManifest;

  /// <summary>
  /// 无参构造函数（Lambda 运行时调用）
  /// </summary>
  public WorkerFunction() : this(
    new PublishJobProcessor(
      new JobRepository(),
      new S3DeckUploader()),
    RebuildManifestAfterAsync)
  {
    SnapStartHooks.RegisterOnce();
  }

  /// <summary>
  /// 依赖注入构造函数（便于测试）。rebuildManifest 接收 completedAtMs。
  /// </summary>
  public WorkerFunction(IPublishJobProcessor processor, Func<long, Task> rebuildManifest)
  {
    _processor = processor;
    _rebuildManifest = rebuildManifest;
  }

  /// <summary>
  /// The publish queue's redrive maxReceiveCount (infra/modules/worker/queue.tf). A system error on this
  /// receive (or later, e.g. a DLQ redrive) is the job's last chance: the row is marked FAILED so the deck
  /// is not left 409-blocked, and the item is still reported so SQS moves the message to the DLQ.
  /// </summary>
  public const int MaxReceiveCount = 3;

  /// <summary>Upper bound on the exception text copied into deck_publishes.error_message.</summary>
  public const int MaxErrorDetailChars = 400;

  /// <summary>"system error on attempt {n}/{MaxReceiveCount}: {ExceptionType}: {message ≤ MaxErrorDetailChars}".</summary>
  public static string SystemErrorMessage(int receiveCount, Exception ex)
  {
    var detail = ex.Message.Length > MaxErrorDetailChars ? ex.Message[..MaxErrorDetailChars] : ex.Message;
    return $"system error on attempt {receiveCount}/{MaxReceiveCount}: {ex.GetType().Name}: {detail}";
  }

  /// <summary>
  /// Lambda 入口方法
  /// </summary>
  public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
  {
    var failures = new List<SQSBatchResponse.BatchItemFailure>();

    foreach (var record in sqsEvent.Records)
    {
      var receiveCount = record.Attributes is not null
        && record.Attributes.TryGetValue("ApproximateReceiveCount", out var rc)
        && int.TryParse(rc, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n > 0
          ? n
          : 1;

      string jobId;
      try
      {
        jobId = ParseMessage(record.Body).JobId;
      }
      catch (Exception ex)
      {
        // 毒消息：无法解析的消息体。报告为 item failure，而不是让整批崩溃。
        Console.WriteLine($"Malformed message {record.MessageId}: {ex.Message}");
        failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        continue;
      }

      // 所有日志带 JobId 前缀，便于追踪
      LogWithJobId(jobId, $"Processing message {record.MessageId} (receiveCount={receiveCount})");

      try
      {
        // 执行 5-Step 流水线
        await _processor.ProcessAsync(jobId, receiveCount);

        // Step 6: 发布成功后在进程内重建 Manifest（completedAtMs 用于 metadata 证据判定）
        var completedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        LogWithJobId(jobId, "Triggering manifest rebuild");
        await _rebuildManifest(completedAtMs);

        LogWithJobId(jobId, "Processing completed successfully");
      }
      catch (BusinessException ex)
      {
        // 路线 A: 业务级死胡同 —— 标记 FAILED 并确认。FailAsync 内部抛出属系统错误，转为 item failure。
        LogWithJobId(jobId, $"Business error: {ex.Message}");
        try
        {
          await _processor.FailAsync(jobId, ex.Message);
          LogWithJobId(jobId, "Job marked as FAILED");
        }
        catch (Exception failEx)
        {
          LogWithJobId(jobId, $"System error while failing job: {failEx.Message}");
          failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
        }
      }
      catch (JobNotAcquiredException ex)
      {
        // 重投递碰上另一个容器可能仍在运行的任务：报告 item failure，让 SQS 保留消息。
        LogWithJobId(jobId, ex.Message);
        failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
      }
      catch (Exception ex)
      {
        // Route B: system error. Record why, and on the last receive fail the row so the deck is not
        // 409-blocked behind a message that is about to go to the DLQ. Always report the item.
        var reason = SystemErrorMessage(receiveCount, ex);
        LogWithJobId(jobId, reason);
        if (receiveCount >= MaxReceiveCount)
        {
          try
          {
            await _processor.FailAsync(jobId, reason);
            LogWithJobId(jobId, "Last receive: job marked as FAILED");
          }
          catch (Exception failEx)
          {
            LogWithJobId(jobId, $"System error while failing job: {failEx.Message}");
          }
        }
        else
        {
          try
          {
            await _processor.RecordAttemptErrorAsync(jobId, reason);
          }
          catch (Exception recordEx)
          {
            LogWithJobId(jobId, $"Could not record attempt error: {recordEx.Message}");
          }
        }
        failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId });
      }
    }

    return new SQSBatchResponse { BatchItemFailures = failures };
  }

  /// <summary>
  /// True when the manifest already reflects this job's commit, so a rebuild would be redundant:
  /// the object exists, was written in the last 10 s, AND carries a generated-at stamp that started
  /// after this job committed (completedAtMs + 1000 ms, 1 s absorbing clock skew). A 404, a manifest
  /// without the stamp, or an older stamp all return false → rebuild.
  /// </summary>
  public static bool ManifestCoversJob(DateTime? lastModifiedUtc, string? generatedAtMsMeta, long completedAtMs, DateTime utcNow)
  {
    if (lastModifiedUtc is null) return false;
    if (lastModifiedUtc.Value <= utcNow - TimeSpan.FromSeconds(10)) return false;
    if (!long.TryParse(generatedAtMsMeta, NumberStyles.Integer, CultureInfo.InvariantCulture, out var generatedAtMs)) return false;
    return generatedAtMs >= completedAtMs + 1000;
  }

  /// <summary>
  /// The default in-process rebuild hook. Debounces on the manifest's LastModified + generated-at
  /// metadata (see <see cref="ManifestCoversJob"/>); when it does not already cover this job, rebuilds
  /// through the shared <see cref="ManifestBuilder"/>.
  /// </summary>
  private static async Task RebuildManifestAfterAsync(long completedAtMs)
  {
    var bucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    if (string.IsNullOrEmpty(bucket)) throw new InvalidOperationException("Missing env CONTENT_BUCKET");

    var contentPrefix = ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
    var premiumPrefix = ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");
    var key = ManifestBuilder.ManifestKey(contentPrefix);

    var s3 = ManifestBuilder.S3();
    GetObjectMetadataResponse? head;
    try
    {
      head = await s3.GetObjectMetadataAsync(new GetObjectMetadataRequest { BucketName = bucket, Key = key });
    }
    catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
    {
      head = null;
    }

    var meta = head is not null && head.Metadata.Keys.Contains("x-amz-meta-generated-at-ms")
      ? head.Metadata["generated-at-ms"]
      : null;

    if (ManifestCoversJob(head?.LastModified?.ToUniversalTime(), meta, completedAtMs, DateTime.UtcNow))
    {
      Console.WriteLine("manifest already covers this job; skipping rebuild");
      return;
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Missing PG env vars");

    var r = await ManifestBuilder.RebuildAsync(conn, s3, bucket, contentPrefix, premiumPrefix);
    Console.WriteLine($"manifest rebuilt: deckCount={r.DeckCount}, generatedAtMs={r.GeneratedAtMs}");
  }

  /// <summary>
  /// 解析 SQS 消息体
  /// </summary>
  private static PublishJobMessage ParseMessage(string body)
  {
    try
    {
      var message = JsonSerializer.Deserialize<PublishJobMessage>(body);
      if (message?.JobId is null)
      {
        throw new ArgumentException("Missing jobId in message body");
      }
      return message;
    }
    catch (JsonException ex)
    {
      throw new ArgumentException($"Invalid JSON message body: {ex.Message}");
    }
  }

  /// <summary>
  /// 带 JobId 的日志输出
  /// </summary>
  private static void LogWithJobId(string jobId, string message)
  {
    Console.WriteLine($"[JobId={jobId}] {message}");
  }
}
