using System.Globalization;
using Amazon.Lambda.SQSEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The worker's final-receive path (F03, CBE-15) against the real fixture DB and the real
/// PublishJobProcessor/JobRepository, with an S3 uploader that throws so the pipeline hits a system
/// error. On the last receive (ApproximateReceiveCount == MaxReceiveCount) the row is marked FAILED
/// and the item is still reported so SQS moves it to the DLQ; below the max it stays PROCESSING and
/// the item is reported so SQS retries.
/// </summary>
[Collection(PostgresCollection.Name)]
public class WorkerFinalReceiveTests
{
  private readonly PostgresFixture _db;
  public WorkerFinalReceiveTests(PostgresFixture db) => _db = db;

  private static string Slug(string tag) => $"it-f14-{tag}-{Guid.NewGuid():N}";

  /// <summary>An S3 uploader whose UploadAsync throws — a system error, not a BusinessException.</summary>
  private sealed class ThrowingUploader : IS3DeckUploader
  {
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data) => throw new InvalidOperationException("s3 down");
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) => throw new InvalidOperationException("s3 down");
    public Task<string> DownloadJsonAsync(string s3Key) => throw new InvalidOperationException("s3 down");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  /// <summary>Seeds a deck with one card and one PENDING deck_publishes row; returns (jobId, messageId).</summary>
  private async Task<string> SeedPendingJobAsync(string tag)
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug(tag);
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author, deck_type) values ($1,$2,$3,1) returning id",
      [slug, "f14 deck", "tests"]);
    var deckId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);

    await DbUtil.ExecuteAsync(conn, null,
      "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck) values ($1,$2,$3,$4,$5)",
      [deckId, $"uid-{Guid.NewGuid():N}", "q", "a", 1]);

    var jobId = Guid.NewGuid().ToString();
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PENDING')",
      [deckId, slug, $"b-{jobId[..8]}", $"content/{jobId}", jobId]);
    return jobId;
  }

  private static SQSEvent OneMessage(string messageId, string jobId, string receiveCount)
  {
    var msg = new SQSEvent.SQSMessage
    {
      MessageId = messageId,
      Body = $"{{\"jobId\":\"{jobId}\"}}",
      Attributes = new Dictionary<string, string> { ["ApproximateReceiveCount"] = receiveCount },
    };
    return new SQSEvent { Records = new List<SQSEvent.SQSMessage> { msg } };
  }

  private static WorkerFunction NewWorker() =>
    new(new PublishJobProcessor(new JobRepository(), new ThrowingUploader(), new NoopArtifacts()), _ => Task.CompletedTask);

  private async Task<(string Status, string? ErrorMessage)> RowAsync(string jobId)
  {
    var rows = await _db.QueryAsync("select status, error_message from deck_publishes where job_id = $1", jobId);
    return (Convert.ToString(rows[0]["status"], CultureInfo.InvariantCulture) ?? string.Empty,
            rows[0]["error_message"] as string);
  }

  [Fact]
  public async Task SystemError_OnFinalReceive_MarksJobFailed()
  {
    var jobId = await SeedPendingJobAsync("wfinal");
    var messageId = Guid.NewGuid().ToString();

    var resp = await NewWorker().FunctionHandler(
      OneMessage(messageId, jobId, WorkerFunction.MaxReceiveCount.ToString(CultureInfo.InvariantCulture)),
      null!);

    var (status, errorMessage) = await RowAsync(jobId);
    Assert.Equal("FAILED", status);
    Assert.False(string.IsNullOrEmpty(errorMessage));
    Assert.Contains(resp.BatchItemFailures, f => f.ItemIdentifier == messageId);
  }

  [Fact]
  public async Task SystemError_BeforeFinalReceive_LeavesJobProcessing()
  {
    var jobId = await SeedPendingJobAsync("wproc");
    var messageId = Guid.NewGuid().ToString();

    var resp = await NewWorker().FunctionHandler(OneMessage(messageId, jobId, "1"), null!);

    var (status, _) = await RowAsync(jobId);
    Assert.Equal("PROCESSING", status);
    Assert.Contains(resp.BatchItemFailures, f => f.ItemIdentifier == messageId);
  }
}
