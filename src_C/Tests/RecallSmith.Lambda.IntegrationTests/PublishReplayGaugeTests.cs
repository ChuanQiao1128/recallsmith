using Amazon.Lambda.SQSEvents;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R18I Q4 (backend-tracing-1): a replayed SQS message for a job that is already terminal (FAILED or
/// SUCCESS) or absent is acknowledged without a publish gauge, so a DLQ redrive of failed jobs no longer
/// adds good events to the publish-success SLO. Joins the serial Postgres collection because it redirects
/// Console; no database row is touched (in-file fakes only).
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishReplayGaugeTests
{
  private const string Succeeded = "PublishJobsSucceeded";
  private const string Failed = "PublishJobsFailed";

  // ---- in-file fakes (no mocking library) --------------------------------------------------

  private sealed class ReplayingProcessor : IPublishJobProcessor, IReplayOutcome
  {
    public bool Replay;
    public bool LastCallWasTerminalReplay { get; private set; }

    public Task ProcessAsync(string jobId, int receiveCount = 1)
    {
      LastCallWasTerminalReplay = Replay;
      return Task.CompletedTask;
    }

    public Task FailAsync(string jobId, string errorMessage) => Task.CompletedTask;
    public Task RecordAttemptErrorAsync(string jobId, string errorMessage) => Task.CompletedTask;
  }

  /// Never acquires; GetJobAsync returns a row with <see cref="Status"/>, or no row when it is null.
  private sealed class RowRepository : IJobRepository
  {
    public string? Status;

    public Task<bool> TryAcquireJobAsync(string jobId, int receiveCount = 1) => Task.FromResult(false);
    public Task<JobInfo?> GetJobAsync(string jobId) =>
      Task.FromResult(Status is null ? null : new JobInfo { JobId = jobId, Status = Status });
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

  private static SQSEvent One(string jobId, string receiveCount) => new()
  {
    Records =
    [
      new SQSEvent.SQSMessage
      {
        MessageId = "m1",
        Body = $"{{\"jobId\":\"{jobId}\"}}",
        Attributes = new Dictionary<string, string> { ["ApproximateReceiveCount"] = receiveCount },
      },
    ],
  };

  private static async Task<(SQSBatchResponse Response, string Stdout)> RunAsync(WorkerFunction fn, SQSEvent ev)
  {
    var oldNs = Environment.GetEnvironmentVariable("METRICS_NAMESPACE");
    var oldDisabled = Environment.GetEnvironmentVariable("METRICS_DISABLED");
    try
    {
      Environment.SetEnvironmentVariable("METRICS_NAMESPACE", null);
      Environment.SetEnvironmentVariable("METRICS_DISABLED", null);
      SQSBatchResponse? resp = null;
      var stdout = await EmfCapture.StdoutAsync(async () => resp = await fn.FunctionHandler(ev, null!));
      return (resp!, stdout);
    }
    finally
    {
      Environment.SetEnvironmentVariable("METRICS_NAMESPACE", oldNs);
      Environment.SetEnvironmentVariable("METRICS_DISABLED", oldDisabled);
    }
  }

  private static void AssertCounts(string stdout, int succeeded, int failed)
  {
    Assert.Equal(succeeded, EmfCapture.GaugeSum(stdout, Succeeded));
    Assert.Equal(failed, EmfCapture.GaugeSum(stdout, Failed));
  }

  // ---- worker: the optional IReplayOutcome ---------------------------------------------------

  [Fact]
  public async Task TerminalReplay_EmitsNoGauge_AndAcknowledges()
  {
    var p = new ReplayingProcessor { Replay = true };
    var rebuilds = 0;
    var fn = new WorkerFunction(p, _ => { rebuilds++; return Task.CompletedTask; });
    var (resp, stdout) = await RunAsync(fn, One("j1", "1"));

    Assert.Empty(resp.BatchItemFailures);
    Assert.Equal(1, rebuilds);
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  [Fact]
  public async Task NotAReplay_StillEmitsOneSucceededGauge()
  {
    var p = new ReplayingProcessor { Replay = false };
    var (resp, stdout) = await RunAsync(new WorkerFunction(p, _ => Task.CompletedTask), One("j1", "1"));

    Assert.Empty(resp.BatchItemFailures);
    AssertCounts(stdout, succeeded: 1, failed: 0);
  }

  // ---- worker + the real PublishJobProcessor -------------------------------------------------

  [Theory]
  [InlineData("FAILED", "1")]
  [InlineData("FAILED", "4")]
  [InlineData(null, "1")]
  public async Task RedriveOfFailedOrAbsentJob_EmitsNoGauge(string? status, string receiveCount)
  {
    var uploader = new CountingUploader();
    var processor = new PublishJobProcessor(new RowRepository { Status = status }, uploader, new NoopArtifacts());
    var (resp, stdout) = await RunAsync(new WorkerFunction(processor, _ => Task.CompletedTask), One("j1", receiveCount));

    Assert.Empty(resp.BatchItemFailures);
    Assert.False(uploader.Touched);
    Assert.True(processor.LastCallWasTerminalReplay);
    Assert.Contains("acknowledging replay", stdout, StringComparison.Ordinal);
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  [Fact]
  public async Task ReplayFlag_IsResetOnEveryCall()
  {
    var repo = new RowRepository { Status = "FAILED" };
    var processor = new PublishJobProcessor(repo, new CountingUploader(), new NoopArtifacts());

    await EmfCapture.StdoutAsync(() => processor.ProcessAsync("j1"));
    Assert.True(processor.LastCallWasTerminalReplay);

    repo.Status = "PROCESSING";
    await EmfCapture.StdoutAsync(() => Assert.ThrowsAsync<JobNotAcquiredException>(() => processor.ProcessAsync("j1")));
    Assert.False(processor.LastCallWasTerminalReplay);
  }
}
