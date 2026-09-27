using Npgsql;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Worker.Repositories;

public class JobRepository : IJobRepository
{
  /// <summary>
  /// Step 2: 乐观锁抢占任务
  /// UPDATE deck_publishes SET status = 'PROCESSING'
  /// WHERE job_id = @jobId AND (PENDING OR stale PROCESSING).
  /// FAILED is terminal: a reaped or failed job is never re-acquired.
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
          status = 'PENDING'
          OR (status = 'PROCESSING' AND (($2 > 1 AND updated_at < now() - interval '11 minutes') OR updated_at < now() - interval '15 minutes'))
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
  /// In the same transaction as the SUCCESS transition, stages the <c>deck.published</c> delivery rows
  /// (the outbox, automation-1): a crash after the commit leaves rows that the replay or the sweep sends,
  /// never a finished publish without its event. The processor sends them after this returns
  /// (<see cref="WebhookEvents.SendStagedAsync"/>). A job that is not PROCESSING changes nothing and
  /// stages nothing.
  /// </summary>
  public async Task CompleteJobAsync(string jobId, int? exportedCardCount = null)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    // 021+: mark SUCCESS, move the deck's live pointer to this build, and set total_cards to the
    // exported card count (null leaves it untouched) in one atomic statement.
    const string sql = """
      with done as (
        update deck_publishes
        set status = 'SUCCESS', error_message = null, updated_at = now()
        where job_id = $1 and status = 'PROCESSING'
        returning deck_id, deck_slug, build_id
      ), live as (
        update decks d
        set live_build_id = done.build_id,
            total_cards = coalesce($2::int, d.total_cards)
        from done
        where d.id = done.deck_id
      )
      select deck_id as "deckId", deck_slug as "deckSlug", build_id as "buildId" from done
      """;

    await using var tx = await conn.BeginTransactionAsync();
    List<Dictionary<string, object?>> done;
    await tx.SaveAsync("complete");
    try
    {
      done = await DbUtil.QueryAsync(conn, tx, sql, [jobId, exportedCardCount]);
    }
    catch (PostgresException pg) when (pg.SqlState == "42703")
    {
      // Pre-021 window (code shipped, console Migrate not yet clicked): no live_build_id column.
      await tx.RollbackAsync("complete");
      const string legacySql = """
        UPDATE deck_publishes
        SET status = 'SUCCESS',
            error_message = NULL,
            updated_at = now()
        WHERE job_id = $1 AND status = 'PROCESSING'
        RETURNING deck_id as "deckId", deck_slug as "deckSlug", build_id as "buildId"
        """;
      done = await DbUtil.QueryAsync(conn, tx, legacySql, [jobId]);
    }

    if (done.Count > 0)
    {
      var row = done[0];
      var now = DateTimeOffset.UtcNow;
      await WebhookEvents.StageAsync(conn, tx, "deck.published", PublishedEventId(jobId), now, new
      {
        deckId = Convert.ToInt64(row["deckId"]),
        deckSlug = Convert.ToString(row["deckSlug"]) ?? string.Empty,
        buildId = Convert.ToString(row["buildId"]) ?? string.Empty,
        jobId,
        cardCount = exportedCardCount,
        publishedAt = WebhookEvents.FormatTimestamp(now),
      });
    }

    await tx.CommitAsync();
  }

  /// <summary>The <c>deck.published</c> event id of a publish job: one event per job, whoever emits it.</summary>
  public static Guid PublishedEventId(string jobId) => WebhookEvents.DerivedEventId($"deck.published:{jobId}");

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
      WHERE job_id = $1 AND status IN ('PENDING', 'PROCESSING')
      """;

    await DbUtil.ExecuteAsync(conn, null, sql, [jobId, errorMessage]);
  }

  /// <summary>
  /// Sets error_message on a PROCESSING row; status and updated_at (the take-over clock) are untouched.
  /// </summary>
  public async Task RecordAttemptErrorAsync(string jobId, string errorMessage)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      UPDATE deck_publishes
      SET error_message = $2
      WHERE job_id = $1 AND status = 'PROCESSING'
      """;

    await DbUtil.ExecuteAsync(conn, null, sql, [jobId, errorMessage]);
  }
}
