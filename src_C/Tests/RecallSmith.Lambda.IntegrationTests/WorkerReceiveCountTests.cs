using System.Globalization;
using Amazon.Lambda.SQSEvents;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Pure tests (no database, no fixture) for the worker's SQS partial-batch contract and its
/// redelivery take-over rule. The handler must never rethrow: every failure becomes a
/// BatchItemFailure (ReportBatchItemFailures) except a BusinessException, which is acked after
/// FailAsync. ManifestCoversJob is the debounce proof, tested as a table.
/// </summary>
public class WorkerReceiveCountTests
{
  // ---- in-file fakes (no mocking library) --------------------------------------------------

  private sealed class FakeProcessor : IPublishJobProcessor
  {
    public readonly List<(string JobId, int ReceiveCount)> Processed = new();
    public readonly List<string> Failed = new();

    /// Returns the exception to throw for a given jobId, or null to succeed.
    public Func<string, Exception?>? ThrowFor;

    public Task ProcessAsync(string jobId, int receiveCount = 1)
    {
      Processed.Add((jobId, receiveCount));
      var ex = ThrowFor?.Invoke(jobId);
      if (ex is not null) throw ex;
      return Task.CompletedTask;
    }

    public Task FailAsync(string jobId, string errorMessage)
    {
      Failed.Add(jobId);
      return Task.CompletedTask;
    }
  }

  private sealed class FakeJobRepository : IJobRepository
  {
    public bool AcquireResult;
    public JobInfo? Job;

    public Task<bool> TryAcquireJobAsync(string jobId, int receiveCount = 1) => Task.FromResult(AcquireResult);
    public Task<JobInfo?> GetJobAsync(string jobId) => Task.FromResult(Job);
    public Task CompleteJobAsync(string jobId) => Task.CompletedTask;
    public Task FailJobAsync(string jobId, string errorMessage) => Task.CompletedTask;
  }

  private sealed class FakeUploader : IS3DeckUploader
  {
    public bool Touched;
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data) { Touched = true; return Task.FromResult(new S3UploadResult()); }
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) { Touched = true; return Task.FromResult(new S3UploadResult()); }
    public Task<string> DownloadJsonAsync(string s3Key) { Touched = true; return Task.FromResult("{}"); }
  }

  private sealed class FakeArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

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

  private static SQSEvent Batch(params SQSEvent.SQSMessage[] records) =>
    new() { Records = records.ToList() };

  private static Func<long, Task> NoopHook() => _ => Task.CompletedTask;

  private static string Msg(string jobId) => $"{{\"jobId\":\"{jobId}\"}}";

  // ---- FunctionHandler -----------------------------------------------------------------------

  [Fact]
  public async Task FunctionHandler_PassesApproximateReceiveCount()
  {
    var proc = new FakeProcessor();
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "3")), null!);

    Assert.Empty(resp.BatchItemFailures);
    Assert.Equal(("j1", 3), Assert.Single(proc.Processed));
  }

  [Fact]
  public async Task FunctionHandler_MissingAttribute_DefaultsToOne()
  {
    var proc = new FakeProcessor();
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"))), null!);

    Assert.Empty(resp.BatchItemFailures);
    Assert.Equal(("j1", 1), Assert.Single(proc.Processed));
  }

  [Fact]
  public async Task FunctionHandler_MalformedBody_ReportsItemFailure()
  {
    var proc = new FakeProcessor();
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", "not json", "1")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    Assert.Empty(proc.Processed);
  }

  [Fact]
  public async Task FunctionHandler_JobNotAcquired_ReportsItemFailureWithoutFailing()
  {
    var proc = new FakeProcessor { ThrowFor = _ => new JobNotAcquiredException("j1") };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "2")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    Assert.Empty(proc.Failed);
    // Not a BusinessException: that is what makes SQS redeliver instead of acking.
    Assert.False(typeof(JobNotAcquiredException).IsSubclassOf(typeof(BusinessException)));
  }

  [Fact]
  public async Task FunctionHandler_BusinessException_MarksFailedAndAcks()
  {
    var proc = new FakeProcessor { ThrowFor = _ => new BusinessException("no cards") };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "1")), null!);

    Assert.Empty(resp.BatchItemFailures);
    Assert.Equal("j1", Assert.Single(proc.Failed));
  }

  [Fact]
  public async Task FunctionHandler_SystemException_ReportsItemFailureWithoutFailing()
  {
    var proc = new FakeProcessor { ThrowFor = _ => new InvalidOperationException("boom") };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "1")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    Assert.Empty(proc.Failed);
  }

  [Fact]
  public async Task FunctionHandler_Success_RunsManifestHookOnce()
  {
    var proc = new FakeProcessor();
    var hookCalls = 0;
    var fn = new WorkerFunction(proc, _ => { hookCalls++; return Task.CompletedTask; });

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "1")), null!);

    Assert.Empty(resp.BatchItemFailures);
    Assert.Equal(1, hookCalls);
  }

  [Fact]
  public async Task FunctionHandler_ManifestHookThrows_ReportsItemFailure()
  {
    var proc = new FakeProcessor();
    var fn = new WorkerFunction(proc, _ => throw new InvalidOperationException("s3 down"));

    var resp = await fn.FunctionHandler(Batch(Record("m1", Msg("j1"), "1")), null!);

    Assert.Equal("m1", Assert.Single(resp.BatchItemFailures).ItemIdentifier);
    Assert.Empty(proc.Failed);
  }

  [Fact]
  public async Task FunctionHandler_MixedBatch_ReportsOnlyFailedMessageIds()
  {
    // m1 ok, m2 malformed, m3 throws a system error.
    var proc = new FakeProcessor { ThrowFor = jobId => jobId == "j3" ? new InvalidOperationException("boom") : null };
    var fn = new WorkerFunction(proc, NoopHook());

    var resp = await fn.FunctionHandler(
      Batch(Record("m1", Msg("j1"), "1"), Record("m2", "not json", "1"), Record("m3", Msg("j3"), "1")),
      null!);

    var ids = resp.BatchItemFailures.Select(f => f.ItemIdentifier).OrderBy(x => x).ToArray();
    Assert.Equal(new[] { "m2", "m3" }, ids);
  }

  // ---- ManifestCoversJob ---------------------------------------------------------------------

  public static IEnumerable<object[]> ManifestCoversJobRows()
  {
    var now = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    const long completed = 1_700_000_000_000L;
    string Stamp(long v) => v.ToString(CultureInfo.InvariantCulture);

    // null head → false
    yield return new object[] { null!, Stamp(completed + 1000), completed, now, false };
    // fresh + stamp >= completed + 1000 → true
    yield return new object[] { now.AddSeconds(-2), Stamp(completed + 1000), completed, now, true };
    // fresh + no stamp → false
    yield return new object[] { now.AddSeconds(-2), null!, completed, now, false };
    // fresh + stamp = completed + 999 → false
    yield return new object[] { now.AddSeconds(-2), Stamp(completed + 999), completed, now, false };
    // stamp fine but LastModified 11 s old → false
    yield return new object[] { now.AddSeconds(-11), Stamp(completed + 1000), completed, now, false };
  }

  [Theory]
  [MemberData(nameof(ManifestCoversJobRows))]
  public void ManifestCoversJob_Table(DateTime? lastModifiedUtc, string? meta, long completedAtMs, DateTime utcNow, bool expected)
  {
    Assert.Equal(expected, WorkerFunction.ManifestCoversJob(lastModifiedUtc, meta, completedAtMs, utcNow));
  }

  // ---- ProcessAsync take-over ---------------------------------------------------------------

  [Fact]
  public async Task ProcessAsync_NotAcquiredWhileProcessing_Throws()
  {
    var repo = new FakeJobRepository { AcquireResult = false, Job = new JobInfo { JobId = "j", Status = "PROCESSING" } };
    var uploader = new FakeUploader();
    var proc = new PublishJobProcessor(repo, uploader, new FakeArtifacts());

    await Assert.ThrowsAsync<JobNotAcquiredException>(() => proc.ProcessAsync("j", 2));
    Assert.False(uploader.Touched);
  }

  [Fact]
  public async Task ProcessAsync_NotAcquiredAfterSuccess_ReturnsQuietly()
  {
    var repo = new FakeJobRepository { AcquireResult = false, Job = new JobInfo { JobId = "j", Status = "SUCCESS" } };
    var uploader = new FakeUploader();
    var proc = new PublishJobProcessor(repo, uploader, new FakeArtifacts());

    await proc.ProcessAsync("j", 1);
    Assert.False(uploader.Touched);
  }

  [Fact]
  public async Task ProcessAsync_NotAcquiredAndAbsent_ReturnsQuietly()
  {
    var repo = new FakeJobRepository { AcquireResult = false, Job = null };
    var uploader = new FakeUploader();
    var proc = new PublishJobProcessor(repo, uploader, new FakeArtifacts());

    await proc.ProcessAsync("j", 1);
    Assert.False(uploader.Touched);
  }
}
