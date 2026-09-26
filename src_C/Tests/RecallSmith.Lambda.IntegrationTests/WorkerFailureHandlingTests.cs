using System.Globalization;
using Amazon.Lambda.SQSEvents;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// F03 (CBE-04 / CBE-17). A system error writes a readable error_message on every attempt; on the
/// last receive (ApproximateReceiveCount >= MaxReceiveCount) the row is marked FAILED and the item
/// is still reported so SQS sends it to the DLQ. FAILED is terminal: acquisition takes only PENDING
/// or stale PROCESSING, FailJobAsync/CompleteJobAsync are status-guarded, and a reaped job's
/// redelivered message is acknowledged and dropped. The handler-shape tests are pure; the rest run
/// against a real Postgres.
/// </summary>
[Collection(PostgresCollection.Name)]
public class WorkerFailureHandlingTests
{
  private readonly PostgresFixture _db;
  public WorkerFailureHandlingTests(PostgresFixture db) => _db = db;

  // ---- in-file fakes -------------------------------------------------------------------------

  private sealed class RecordingProcessor : IPublishJobProcessor
  {
    public readonly List<(string JobId, string Message)> Failed = new();
    public readonly List<(string JobId, string Message)> AttemptErrors = new();

    /// Returns the exception to throw for a given jobId in ProcessAsync, or null to succeed.
    public Func<string, Exception?>? ThrowFor;

    /// When true, FailAsync throws a system error (the "could not persist FAILED" path).
    public bool FailThrows;

    public Task ProcessAsync(string jobId, int receiveCount = 1)
    {
      var ex = ThrowFor?.Invoke(jobId);
      if (ex is not null) throw ex;
      return Task.CompletedTask;
    }

    public Task FailAsync(string jobId, string errorMessage)
    {
      if (FailThrows) throw new InvalidOperationException("cannot persist FAILED");
      Failed.Add((jobId, errorMessage));
      return Task.CompletedTask;
    }

    public Task RecordAttemptErrorAsync(string jobId, string errorMessage)
    {
      AttemptErrors.Add((jobId, errorMessage));
      return Task.CompletedTask;
    }
  }

  private sealed class StatusRepository : IJobRepository
  {
    public string Status = "PROCESSING";

    public Task<bool> TryAcquireJobAsync(string jobId, int receiveCount = 1) => Task.FromResult(false);
    public Task<JobInfo?> GetJobAsync(string jobId) => Task.FromResult<JobInfo?>(new JobInfo { JobId = jobId, Status = Status });
    public Task CompleteJobAsync(string jobId, int? exportedCardCount = null) => Task.CompletedTask;
    public Task FailJobAsync(string jobId, string errorMessage) => Task.CompletedTask;
    public Task RecordAttemptErrorAsync(string jobId, string errorMessage) => Task.CompletedTask;
  }

  private sealed class CountingUploader : IS3DeckUploader
  {
    public bool Touched;
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data) { Touched = true; return Task.FromResult(new S3UploadResult()); }
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) { Touched = true; return Task.FromResult(new S3UploadResult()); }
    public Task<string> DownloadJsonAsync(string s3Key) { Touched = true; return Task.FromResult("{}"); }
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  // ---- SQS record helpers (shape of WorkerReceiveCountTests) ---------------------------------

  private static SQSEvent.SQSMessage Record(string messageId, string body, string? receiveCount = null)
  {
    var msg = new SQSEvent.SQSMessage
    {
      MessageId = messageId,
      Body = body,
      Attributes = new Dictionary<string, string>(),
    };
    if (receiveCount is not null) msg.Attributes["ApproximateReceiveCount"] = receiveCount;
    return msg;
  }

  private static SQSEvent Batch(params SQSEvent.SQSMessage[] records) => new() { Records = records.ToList() };

  private static Func<long, Task> NoopHook() => _ => Task.CompletedTask;

  private static string Msg(string jobId) => $"{{\"jobId\":\"{jobId}\"}}";

  // ---- DB seed helpers -----------------------------------------------------------------------

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug, int? totalCards = null, string? liveBuildId = null)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author, total_cards, live_build_id) values ($1,$2,$3,$4,$5) returning id",
      [slug, "deck f03", "tests", totalCards, liveBuildId]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static async Task<string> SeedJobAsync(
    NpgsqlConnection conn, long deckId, string slug, string status,
    string? buildId = null, int? updatedMinutesAgo = null, string? errorMessage = null)
  {
    var jobId = Guid.NewGuid().ToString();
    var build = buildId ?? $"b-{jobId[..8]}";
    var updatedExpr = updatedMinutesAgo is null ? "now()" : $"now() - interval '{updatedMinutesAgo} minutes'";
    var sql = $"""
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, updated_at, error_message)
      values ($1, $2, $3, $4, $5, $6, {updatedExpr}, $7)
      """;
    await DbUtil.ExecuteAsync(conn, null, sql, [deckId, slug, build, $"content/{build}", jobId, status, errorMessage]);
    return jobId;
  }

  private static async Task<string> StatusOfAsync(NpgsqlConnection conn, string jobId) =>
    Convert.ToString(await DbUtil.ExecuteScalarAsync(conn, null, "select status from deck_publishes where job_id = $1", [jobId]), CultureInfo.InvariantCulture) ?? string.Empty;

  private static async Task<string?> ErrorMessageOfAsync(NpgsqlConnection conn, string jobId)
  {
    var v = await DbUtil.ExecuteScalarAsync(conn, null, "select error_message from deck_publishes where job_id = $1", [jobId]);
    return v is null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
  }

  private static string NewSlug() => $"it-f03-{Guid.NewGuid():N}";

  // ---- 1-5: WorkerFunction system-error routing ----------------------------------------------

  [Fact]
  public async Task SystemError_BeforeLastReceive_RecordsReasonAndReportsItemFailure()
  {
    var proc = new RecordingProcessor { ThrowFor = _ => new InvalidOperationException("boom") };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "1")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    var attempt = Assert.Single(proc.AttemptErrors);
    Assert.Equal("j1", attempt.JobId);
    Assert.StartsWith("system error on attempt 1/3: InvalidOperationException: boom", attempt.Message);
    Assert.Empty(proc.Failed);
  }

  [Fact]
  public async Task SystemError_OnLastReceive_MarksFailedAndStillReportsItemFailure()
  {
    var proc = new RecordingProcessor { ThrowFor = _ => new InvalidOperationException("boom") };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "3")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    var failed = Assert.Single(proc.Failed);
    Assert.Equal("j1", failed.JobId);
    Assert.StartsWith("system error on attempt 3/3:", failed.Message);
    Assert.Empty(proc.AttemptErrors);
  }

  [Fact]
  public async Task SystemError_AfterMaxReceive_AlsoMarksFailed()
  {
    var proc = new RecordingProcessor { ThrowFor = _ => new InvalidOperationException("boom") };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "5")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    var failed = Assert.Single(proc.Failed);
    Assert.Equal("j1", failed.JobId);
    Assert.Empty(proc.AttemptErrors);
  }

  [Fact]
  public async Task LastReceive_FailAsyncThrows_StillReportsItemFailure()
  {
    var proc = new RecordingProcessor { ThrowFor = _ => new InvalidOperationException("boom"), FailThrows = true };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "3")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
  }

  [Fact]
  public void SystemErrorMessage_IsBounded()
  {
    var ex = new InvalidOperationException(new string('x', 2000));

    var msg = WorkerFunction.SystemErrorMessage(2, ex);

    const string prefix = "system error on attempt 2/3: InvalidOperationException: ";
    Assert.StartsWith(prefix, msg);
    Assert.True(msg.Length <= prefix.Length + WorkerFunction.MaxErrorDetailChars);
  }

  // ---- 6: replay of a FAILED job is acknowledged ---------------------------------------------

  [Fact]
  public async Task ProcessAsync_NotAcquiredAfterFailed_ReturnsQuietly()
  {
    var repo = new StatusRepository { Status = "FAILED" };
    var uploader = new CountingUploader();
    var proc = new PublishJobProcessor(repo, uploader, new NoopArtifacts());

    await proc.ProcessAsync("j", 2);

    Assert.False(uploader.Touched);
  }

  // ---- 7-11: repository status guards --------------------------------------------------------

  [Fact]
  public async Task TryAcquire_FailedRowIsNotReacquired()
  {
    await using var conn = await _db.OpenAsync();
    var slug = NewSlug();
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = await SeedJobAsync(conn, deckId, slug, "FAILED");

    var acquired = await new JobRepository().TryAcquireJobAsync(jobId, 2);

    Assert.False(acquired);
    Assert.Equal("FAILED", await StatusOfAsync(conn, jobId));
  }

  [Fact]
  public async Task FailJob_DoesNotOverwriteSuccess()
  {
    await using var conn = await _db.OpenAsync();
    var slug = NewSlug();
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = await SeedJobAsync(conn, deckId, slug, "SUCCESS");

    await new JobRepository().FailJobAsync(jobId, "x");

    Assert.Equal("SUCCESS", await StatusOfAsync(conn, jobId));
    Assert.Null(await ErrorMessageOfAsync(conn, jobId));
  }

  [Fact]
  public async Task RecordAttemptError_KeepsProcessingAndTakeOverClock()
  {
    await using var conn = await _db.OpenAsync();
    var slug = NewSlug();
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = await SeedJobAsync(conn, deckId, slug, "PROCESSING", updatedMinutesAgo: 20);

    await new JobRepository().RecordAttemptErrorAsync(jobId, "reason-1");

    Assert.Equal("PROCESSING", await StatusOfAsync(conn, jobId));
    Assert.Equal("reason-1", await ErrorMessageOfAsync(conn, jobId));
    var clockUntouched = await DbUtil.ExecuteScalarAsync(conn, null,
      "select updated_at < now() - interval '19 minutes' from deck_publishes where job_id = $1", [jobId]);
    Assert.True(Convert.ToBoolean(clockUntouched, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task CompleteJob_OnFailedRow_DoesNotMovePointer()
  {
    await using var conn = await _db.OpenAsync();
    var slug = NewSlug();
    var deckId = await SeedDeckAsync(conn, slug, totalCards: 3, liveBuildId: "b-f03-old");
    var jobId = await SeedJobAsync(conn, deckId, slug, "FAILED", buildId: "b-f03-new");

    await new JobRepository().CompleteJobAsync(jobId, 9);

    Assert.Equal("FAILED", await StatusOfAsync(conn, jobId));
    var pointer = await DbUtil.ExecuteScalarAsync(conn, null, "select live_build_id from decks where id = $1", [deckId]);
    Assert.Equal("b-f03-old", Convert.ToString(pointer, CultureInfo.InvariantCulture));
    var total = await DbUtil.ExecuteScalarAsync(conn, null, "select total_cards from decks where id = $1", [deckId]);
    Assert.Equal(3, Convert.ToInt32(total, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task CompleteJob_ClearsAttemptError()
  {
    await using var conn = await _db.OpenAsync();
    var slug = NewSlug();
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = await SeedJobAsync(conn, deckId, slug, "PROCESSING", errorMessage: "earlier attempt");

    await new JobRepository().CompleteJobAsync(jobId, 1);

    Assert.Equal("SUCCESS", await StatusOfAsync(conn, jobId));
    Assert.Null(await ErrorMessageOfAsync(conn, jobId));
  }

  // ---- 12: CBE-17 end to end -----------------------------------------------------------------

  [Fact]
  public async Task ReapedJobRedelivery_IsAcknowledgedWithoutWork()
  {
    await using var conn = await _db.OpenAsync();
    var slug = NewSlug();
    var deckId = await SeedDeckAsync(conn, slug, liveBuildId: "b-f03-newer");
    var jobId = await SeedJobAsync(conn, deckId, slug, "PROCESSING", buildId: "b-f03-older", updatedMinutesAgo: 31);

    await PublishReaper.ReapOrphansAsync(conn);

    var uploader = new CountingUploader();
    await new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()).ProcessAsync(jobId, 2);

    Assert.False(uploader.Touched);
    Assert.Equal("FAILED", await StatusOfAsync(conn, jobId));
    var pointer = await DbUtil.ExecuteScalarAsync(conn, null, "select live_build_id from decks where id = $1", [deckId]);
    Assert.Equal("b-f03-newer", Convert.ToString(pointer, CultureInfo.InvariantCulture));
  }
}
