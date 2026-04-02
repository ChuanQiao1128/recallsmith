namespace RecallSmith.Lambda.Worker.Repositories;

/// <summary>
/// deck_publishes 表数据访问接口
/// </summary>
public interface IJobRepository
{
  /// <summary>
  /// Step 2: 乐观锁抢占任务
  /// </summary>
  Task<bool> TryAcquireJobAsync(string jobId);

  /// <summary>
  /// 获取任务信息
  /// </summary>
  Task<JobInfo?> GetJobAsync(string jobId);

  /// <summary>
  /// Step 5: 标记任务成功
  /// </summary>
  Task CompleteJobAsync(string jobId);

  /// <summary>
  /// 路线 A: 标记任务失败
  /// </summary>
  Task FailJobAsync(string jobId, string errorMessage);
}

/// <summary>
/// 任务信息
/// </summary>
public class JobInfo
{
  public string JobId { get; set; } = string.Empty;
  public string BuildId { get; set; } = string.Empty;
  public string S3Key { get; set; } = string.Empty;
  public int DeckId { get; set; }
  public string DeckSlug { get; set; } = string.Empty;
  public string Status { get; set; } = string.Empty;
}
