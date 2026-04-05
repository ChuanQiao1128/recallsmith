using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.SQSEvents;
using RecallSmith.Lambda.Worker.Manifest;
using RecallSmith.Lambda.Worker.Models;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace RecallSmith.Lambda.Worker;

/// <summary>
/// SQS Worker Lambda 入口
/// 从 SQS 接收发布任务消息，执行 5-Step 流水线
/// </summary>
public class WorkerFunction
{
  private readonly IPublishJobProcessor _processor;
  private readonly IManifestService _manifestService;

  /// <summary>
  /// 无参构造函数（Lambda 运行时调用）
  /// </summary>
  public WorkerFunction() : this(
    new PublishJobProcessor(
      new JobRepository(),
      new S3DeckUploader()),
    new ManifestService())
  {
    SnapStartHooks.RegisterOnce();
  }

  /// <summary>
  /// 依赖注入构造函数（便于测试）
  /// </summary>
  public WorkerFunction(
    IPublishJobProcessor processor,
    IManifestService manifestService)
  {
    _processor = processor;
    _manifestService = manifestService;
  }

  /// <summary>
  /// Lambda 入口方法
  /// </summary>
  public async Task FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)
  {
    foreach (var record in sqsEvent.Records)
    {
      var message = ParseMessage(record.Body);
      var jobId = message.JobId;

      // 所有日志带 JobId 前缀，便于追踪
      LogWithJobId(jobId, $"Processing message {record.MessageId}");

      try
      {
        // 执行 5-Step 流水线
        await _processor.ProcessAsync(jobId);

        // Step 6: 触发 Manifest 重建
        LogWithJobId(jobId, "Triggering manifest rebuild");
        await _manifestService.RebuildAsync();

        LogWithJobId(jobId, "Processing completed successfully");
      }
      catch (BusinessException ex)
      {
        // 路线 A: 业务级死胡同
        LogWithJobId(jobId, $"Business error: {ex.Message}");
        await _processor.FailAsync(jobId, ex.Message);
        LogWithJobId(jobId, "Job marked as FAILED");
        // 正常结束，SQS 删除消息
      }
      catch (Exception ex)
      {
        // 路线 B: 系统级崩溃，交给 AWS SQS 自动重试
        // ⚠️ 基础设施注意: AWS 官方建议将 SQS Visibility Timeout 设置为 Lambda Timeout 的 6 倍以上
        // 避免因处理大卡组耗时过长，导致 SQS 误判超时并将同一条消息再次派发 (浪费算力并引发不必要的并发锁争抢)
        LogWithJobId(jobId, $"System error: {ex.Message}");
        throw;
      }
    }
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
