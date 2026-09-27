namespace RecallSmith.Lambda.Worker.Repositories;

/// <summary>
/// deck_publishes 表数据访问接口
/// </summary>
public interface IJobRepository
{
  /// <summary>
  /// Step 2: 乐观锁抢占任务
  /// </summary>
  Task<bool> TryAcquireJobAsync(string jobId, int receiveCount = 1);

  /// <summary>
  /// 获取任务信息
  /// </summary>
  Task<JobInfo?> GetJobAsync(string jobId);

  /// <summary>
  /// Step 5: 标记任务成功
  /// </summary>
  /// <param name="exportedCardCount">The number of cards written to deck.json; null leaves decks.total_cards untouched.</param>
  Task CompleteJobAsync(string jobId, int? exportedCardCount = null);

  /// <summary>
  /// 路线 A: 标记任务失败
  /// </summary>
  Task FailJobAsync(string jobId, string errorMessage);

  /// <summary>Sets error_message on a PROCESSING row; status and updated_at (the take-over clock) are untouched.</summary>
  Task RecordAttemptErrorAsync(string jobId, string errorMessage);
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

  /// <summary>
  /// Digest of the cards the AI QA publish gate passed (deck_publishes.qa_snapshot_sha256, migration 033), or null
  /// when the gate was off. The processor refuses to build other cards (backend-design-16).
  /// </summary>
  public string? QaSnapshotSha256 { get; set; }
}
