namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// 发布任务处理器接口
/// </summary>
public interface IPublishJobProcessor
{
  /// <summary>
  /// 处理发布任务 (执行 5-Step 流水线)。
  /// receiveCount = SQS ApproximateReceiveCount; 1 on first delivery.
  /// </summary>
  Task ProcessAsync(string jobId, int receiveCount = 1);

  /// <summary>
  /// 标记任务为失败
  /// </summary>
  Task FailAsync(string jobId, string errorMessage);
}

/// A redelivery found the row PROCESSING and not yet stale: another container may still be
/// running it. Not a BusinessException on purpose — the batch item fails and SQS redelivers.
public sealed class JobNotAcquiredException : Exception
{
  public JobNotAcquiredException(string jobId) : base($"Job {jobId} is PROCESSING and not stale; leaving it for the running worker") { }
}
