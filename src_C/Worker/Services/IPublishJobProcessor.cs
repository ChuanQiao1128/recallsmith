namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// 发布任务处理器接口
/// </summary>
public interface IPublishJobProcessor
{
  /// <summary>
  /// 处理发布任务 (执行 5-Step 流水线)
  /// </summary>
  Task ProcessAsync(string jobId);

  /// <summary>
  /// 标记任务为失败
  /// </summary>
  Task FailAsync(string jobId, string errorMessage);
}
