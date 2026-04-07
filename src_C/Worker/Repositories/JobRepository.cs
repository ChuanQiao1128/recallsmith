using Npgsql;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Worker.Repositories;

public class JobRepository : IJobRepository
{
  /// <summary>
  /// Step 2: 乐观锁抢占任务
  /// UPDATE deck_publishes SET status = 'PROCESSING' 
  /// WHERE job_id = @jobId AND status IN ('PENDING', 'FAILED')
  /// </summary>
  public async Task<bool> TryAcquireJobAsync(string jobId, int receiveCount = 1)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      UPDATE deck_publishes 
      SET status = 'PROCESSING',
          updated_at = now()
      WHERE job_id = $1 
        AND (
          status IN ('PENDING', 'FAILED')
          OR (status = 'PROCESSING' AND ($2 > 1 OR updated_at < now() - interval '15 minutes'))
        )
      """;

    var rowsAffected = await DbUtil.ExecuteAsync(conn, null, sql, [jobId, receiveCount]);
    return rowsAffected > 0;
  }

  /// <summary>
  /// 获取任务信息
  /// </summary>
  public async Task<JobInfo?> GetJobAsync(string jobId)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      SELECT 
        job_id as "jobId",
        build_id as "buildId",
        s3_key as "s3Key",
        deck_id as "deckId",
        deck_slug as "deckSlug",
        status
      FROM deck_publishes
      WHERE job_id = $1
      LIMIT 1
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [jobId]);
    if (rows.Count == 0) return null;

    var row = rows[0];
    return new JobInfo
    {
      JobId = Convert.ToString(row["jobId"]) ?? string.Empty,
      BuildId = Convert.ToString(row["buildId"]) ?? string.Empty,
      S3Key = Convert.ToString(row["s3Key"]) ?? string.Empty,
      DeckId = Convert.ToInt32(row["deckId"]),
      DeckSlug = Convert.ToString(row["deckSlug"]) ?? string.Empty,
      Status = Convert.ToString(row["status"]) ?? string.Empty
    };
  }

  /// <summary>
  /// Step 5: 标记任务成功
  /// </summary>
  public async Task CompleteJobAsync(string jobId)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      UPDATE deck_publishes 
      SET status = 'SUCCESS',
          updated_at = now()
      WHERE job_id = $1
      """;

    await DbUtil.ExecuteAsync(conn, null, sql, [jobId]);
  }

  /// <summary>
  /// 路线 A: 标记任务失败
  /// </summary>
  public async Task FailJobAsync(string jobId, string errorMessage)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      UPDATE deck_publishes 
      SET status = 'FAILED',
          error_message = $2,
          updated_at = now()
      WHERE job_id = $1
      """;

    await DbUtil.ExecuteAsync(conn, null, sql, [jobId, errorMessage]);
  }
}
