using System.Globalization;
using Amazon.Lambda.SQSEvents;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// Real job persistence with local uploader/manifest failures; no cloud calls.
[Collection(PostgresCollection.Name)]
public class PublishMetricRecoveryTests
{
  private readonly PostgresFixture _db;
  public PublishMetricRecoveryTests(PostgresFixture db) => _db = db;

  private sealed class CountingUploader : IS3DeckUploader
  {
    public int Uploads;
    public Task<S3UploadResult> UploadAsync(string key, DeckExportData data)
    {
      Uploads++;
      return Task.FromResult(new S3UploadResult());
    }
    public Task<S3UploadResult> UploadJsonAsync(string key, string json, string cacheControl) =>
      throw new InvalidOperationException("Unexpected artifact upload");
    public Task<string> DownloadJsonAsync(string key) =>
      throw new InvalidOperationException("Unexpected download");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData data, S3UploadResult upload) => Task.CompletedTask;
  }

  private async Task<(long DeckId, string JobId, string BuildId)> SeedAsync(string? status)
  {
    var jobId = Guid.NewGuid().ToString();
    var slug = $"it-metric-{jobId}";
    var buildId = $"b-{jobId}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author, live_build_id, total_cards) values ($1,'metric recovery','tests','old-build',0) returning id",
      slug);
    var deckId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,'uid-1','q1',1,0)", deckId);
    if (status is not null)
      await _db.ScalarAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,$6)",
        deckId, slug, buildId, $"content/{buildId}/deck.json", jobId, status);
    return (deckId, jobId, buildId);
  }

  private static async Task<(SQSBatchResponse Response, string Stdout)> RunAsync(WorkerFunction worker, string jobId, int receive)
  {
    var oldNamespace = Environment.GetEnvironmentVariable("METRICS_NAMESPACE");
    var oldDisabled = Environment.GetEnvironmentVariable("METRICS_DISABLED");
    try
    {
      Environment.SetEnvironmentVariable("METRICS_NAMESPACE", null);
      Environment.SetEnvironmentVariable("METRICS_DISABLED", null);
      SQSBatchResponse? response = null;
      var stdout = await EmfCapture.StdoutAsync(async () => response = await worker.FunctionHandler(new SQSEvent
      {
        Records = [new SQSEvent.SQSMessage
        {
          MessageId = "m1", Body = $"{{\"jobId\":\"{jobId}\"}}",
          Attributes = new Dictionary<string, string> { ["ApproximateReceiveCount"] = receive.ToString(CultureInfo.InvariantCulture) },
        }],
      }, null!));
      return (response!, stdout);
    }
    finally
    {
      Environment.SetEnvironmentVariable("METRICS_NAMESPACE", oldNamespace);
      Environment.SetEnvironmentVariable("METRICS_DISABLED", oldDisabled);
    }
  }

  private static void AssertCounts(string stdout, int succeeded, int failed)
  {
    Assert.Equal(succeeded, EmfCapture.GaugeSum(stdout, WorkerFunction.PublishSucceededMetric));
    Assert.Equal(failed, EmfCapture.GaugeSum(stdout, WorkerFunction.PublishFailedMetric));
  }

  [Theory]
  [InlineData("SUCCESS", false, 1)]
  [InlineData("FAILED", false, 1)]
  [InlineData(null, false, 1)]
  [InlineData("SUCCESS", false, 3)]
  [InlineData("FAILED", false, 3)]
  [InlineData(null, false, 3)]
  [InlineData("SUCCESS", true, 1)]
  [InlineData("FAILED", true, 1)]
  [InlineData(null, true, 1)]
  [InlineData("SUCCESS", true, 3)]
  [InlineData("FAILED", true, 3)]
  [InlineData(null, true, 3)]
  [InlineData("SUCCESS", true, 5)]
  [InlineData("FAILED", true, 5)]
  [InlineData(null, true, 5)]
  public async Task TerminalReplay_ManifestHealth_DoesNotInventPublishOutcomes(string? status, bool manifestFails, int receive)
  {
    var job = await SeedAsync(status);
    var uploader = new CountingUploader();
    var processor = new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts());
    var rebuilds = 0;
    var worker = new WorkerFunction(processor, _ =>
    {
      rebuilds++;
      return manifestFails ? Task.FromException(new InvalidOperationException("manifest unavailable")) : Task.CompletedTask;
    });

    var (response, stdout) = await RunAsync(worker, job.JobId, receive);

    Assert.Equal(manifestFails ? 1 : 0, response.BatchItemFailures.Count);
    if (manifestFails) Assert.Equal("m1", Assert.Single(response.BatchItemFailures).ItemIdentifier);
    Assert.Equal(1, rebuilds);
    Assert.Equal(0, uploader.Uploads);
    Assert.Equal(status == "SUCCESS" ? PublishReplayOutcome.Succeeded : PublishReplayOutcome.FailedOrAbsent,
      processor.LastCallReplayOutcome);
    Assert.Equal(status, await _db.ScalarAsync("select status from deck_publishes where job_id = $1", job.JobId));
    Assert.Equal("old-build", await _db.ScalarAsync("select live_build_id from decks where id = $1", job.DeckId));
    // H02's conservative SUCCESS + stale manifest bad event is retained, even for a terminal replay.
    AssertCounts(stdout, succeeded: 0, failed: status == "SUCCESS" && manifestFails && receive >= 3 ? 1 : 0);
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task CommittedSuccess_ManifestFailuresThenReplay_PreservesStateAndMetricBias(bool failsThroughFinalReceive)
  {
    var job = await SeedAsync("PENDING");
    var uploader = new CountingUploader();
    var rebuilds = 0;
    var worker = new WorkerFunction(new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()), _ =>
    {
      rebuilds++;
      return rebuilds == 1 || failsThroughFinalReceive
        ? Task.FromException(new InvalidOperationException("manifest unavailable")) : Task.CompletedTask;
    });

    var first = await RunAsync(worker, job.JobId, 1);
    Assert.Equal("m1", Assert.Single(first.Response.BatchItemFailures).ItemIdentifier);
    AssertCounts(first.Stdout, succeeded: 0, failed: 0);
    Assert.Equal("SUCCESS", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", job.JobId));
    Assert.Equal(job.BuildId, await _db.ScalarAsync("select live_build_id from decks where id = $1", job.DeckId));

    var replay = await RunAsync(worker, job.JobId, 2);
    Assert.Equal(failsThroughFinalReceive ? 1 : 0, replay.Response.BatchItemFailures.Count);
    AssertCounts(replay.Stdout, succeeded: 0, failed: 0);

    var final = await RunAsync(worker, job.JobId, 3);
    Assert.Equal(failsThroughFinalReceive ? 1 : 0, final.Response.BatchItemFailures.Count);
    AssertCounts(final.Stdout, succeeded: 0, failed: failsThroughFinalReceive ? 1 : 0);
    Assert.Equal(3, rebuilds);
    Assert.Equal(1, uploader.Uploads);
    Assert.Equal("SUCCESS", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", job.JobId));
    Assert.Equal(job.BuildId, await _db.ScalarAsync("select live_build_id from decks where id = $1", job.DeckId));
    Assert.Equal(1, Convert.ToInt32(await _db.ScalarAsync("select total_cards from decks where id = $1", job.DeckId), CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task InitialSuccess_ThenHealthyReplay_EmitsOnlyInitialGoodEvent()
  {
    var job = await SeedAsync("PENDING");
    var uploader = new CountingUploader();
    var worker = new WorkerFunction(new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()), _ => Task.CompletedTask);

    var first = await RunAsync(worker, job.JobId, 1);
    var replay = await RunAsync(worker, job.JobId, 2);

    Assert.Empty(first.Response.BatchItemFailures);
    Assert.Empty(replay.Response.BatchItemFailures);
    AssertCounts(first.Stdout, succeeded: 1, failed: 0);
    AssertCounts(replay.Stdout, succeeded: 0, failed: 0);
    Assert.Equal(1, uploader.Uploads);
    Assert.Equal("SUCCESS", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", job.JobId));
  }
}
