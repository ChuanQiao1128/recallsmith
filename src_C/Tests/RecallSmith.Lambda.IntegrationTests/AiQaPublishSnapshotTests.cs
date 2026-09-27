using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The build is bound to what the AI QA publish gate passed (R18 Y02, backend-design-16): a gated publish stores the
/// digest of the gated cards on its deck_publishes row, and the Worker refuses (AI_QA_STALE, a business failure)
/// to build cards that no longer match it. Publishing with the gate off is unchanged. Publish runs through
/// <see cref="Publish.TestEnqueueSeam"/>, the Worker with a capturing uploader; no AWS client is built.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AiQaPublishSnapshotTests
{
  private readonly PostgresFixture _db;
  public AiQaPublishSnapshotTests(PostgresFixture db) => _db = db;

  private const string SeamQueueUrl = "https://sqs.test/000000000000/y02-snapshot";
  private const string SeamBucket = "it-y02-snapshot";

  private sealed class CapturingUploader : IS3DeckUploader
  {
    public DeckExportData? Captured;
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data)
    {
      Captured = data;
      return Task.FromResult(new S3UploadResult());
    }
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) => Task.FromResult(new S3UploadResult());
    public Task<string> DownloadJsonAsync(string s3Key) => Task.FromResult("{}");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  private static async Task<T> WithGateAsync<T>(string enabled, string required, Func<Task<T>> body)
  {
    var savedEnabled = Environment.GetEnvironmentVariable(QaGate.EnabledEnv);
    var savedRequired = Environment.GetEnvironmentVariable(QaGate.RequiredEnv);
    var savedSeam = Publish.TestEnqueueSeam;
    try
    {
      Environment.SetEnvironmentVariable(QaGate.EnabledEnv, enabled);
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, required);
      Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, _ => Task.CompletedTask);
      return await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable(QaGate.EnabledEnv, savedEnabled);
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, savedRequired);
      Publish.TestEnqueueSeam = savedSeam;
    }
  }

  private static async Task<APIGatewayProxyResponse> PublishAsync(long deckId)
  {
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/authoring/publish",
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = $"it-y02-super-{Guid.NewGuid():N}",
              ["cognito:groups"] = new[] { "super_admin" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body = JsonSerializer.Serialize(new { deckId }),
      isBase64Encoded = false,
    }));
    return await Publish.HandleAuthoringPublish(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
  }

  private static string JobId(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"publish returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").GetProperty("jobId").GetString()!;
  }

  /// <summary>A free deck with plain cards, each reviewed (done) at its current hash.</summary>
  private async Task<(long DeckId, List<long> CardIds)> SeedReviewedDeckAsync(string tag, int count)
  {
    var deckId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author, deck_type) values ($1, $2, 'tests', 1) returning id",
      $"it-y02-{tag}-{Guid.NewGuid():N}", $"deck y02 {tag}"), CultureInfo.InvariantCulture);
    var cardIds = new List<long>();
    for (var i = 1; i <= count; i++)
    {
      cardIds.Add(Convert.ToInt64(await _db.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, $3, 'Synthetic explanation.', 2, $4) returning id",
        deckId, $"y02-{tag}-{i}", $"Synthetic question {i}?", i), CultureInfo.InvariantCulture));
    }

    var runId = Guid.NewGuid();
    await _db.QueryAsync(
      """
      insert into ai_qa_runs (id, deck_id, scope, status, requested_by_sub, card_count, chunk_count, cards_done, finished_at)
      values ($1, $2, 'changed', 'done', 'it-y02-seed', $3, 1, $3, now())
      """,
      runId, deckId, count);
    foreach (var cardId in cardIds)
    {
      var row = (await _db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", cardId))[0];
      await _db.QueryAsync(
        "insert into ai_qa_items (run_id, card_id, stable_uid, content_sha256, status) values ($1, $2, $3, $4, 'done')",
        runId, cardId, (string)row["stableUid"]!, CardContentHash.Compute(row));
    }
    return (deckId, cardIds);
  }

  private async Task<string?> SnapshotAsync(string jobId) =>
    await _db.ScalarAsync("select qa_snapshot_sha256 from deck_publishes where job_id = $1", jobId) as string;

  [Fact]
  public async Task GatedPublish_BuildsTheCardsTheGatePassed()
  {
    var deck = await SeedReviewedDeckAsync("snapok", 2);
    var jobId = JobId(await WithGateAsync("1", "1", () => PublishAsync(deck.DeckId)));

    var snapshot = await SnapshotAsync(jobId);
    Assert.NotNull(snapshot);
    Assert.Matches("^[0-9a-f]{64}$", snapshot!);

    var uploader = new CapturingUploader();
    await new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()).ProcessAsync(jobId, 1);
    Assert.Equal(2, uploader.Captured!.Cards.Count);
    Assert.Equal("SUCCESS", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId));
  }

  [Fact]
  public async Task GatedPublish_CardEditedBeforeTheBuild_FailsAiQaStale()
  {
    var deck = await SeedReviewedDeckAsync("snapstale", 2);
    var jobId = JobId(await WithGateAsync("1", "1", () => PublishAsync(deck.DeckId)));

    // A privileged editor changes a card between the gate and the build.
    await _db.QueryAsync("update cards set explanation = 'Synthetic unreviewed edit.', updated_at = now() where id = $1", deck.CardIds[1]);

    var uploader = new CapturingUploader();
    var ex = await Assert.ThrowsAsync<BusinessException>(() =>
      new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()).ProcessAsync(jobId, 1));
    Assert.StartsWith($"{PublishSnapshot.StaleErrorCode}:", ex.Message);
    Assert.Null(uploader.Captured);
    Assert.NotEqual("SUCCESS", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId));
  }

  [Fact]
  public async Task GatedPublish_StaleBuild_EmitsAiQaStaleGauge()
  {
    // backend-design-20: an AI_QA_STALE refusal is a metric, not only a FAILED job and an info log.
    var deck = await SeedReviewedDeckAsync("snapstalemetric", 2);
    var jobId = JobId(await WithGateAsync("1", "1", () => PublishAsync(deck.DeckId)));
    await _db.QueryAsync("update cards set explanation = 'Synthetic unreviewed edit.', updated_at = now() where id = $1", deck.CardIds[0]);

    var stdout = await EmfCapture.StdoutAsync(async () =>
      await Assert.ThrowsAsync<BusinessException>(() =>
        new PublishJobProcessor(new JobRepository(), new CapturingUploader(), new NoopArtifacts()).ProcessAsync(jobId, 1)));
    Assert.Equal("AiQaStale", PublishSnapshot.StaleMetric);
    Assert.Equal(1, EmfCapture.GaugeSum(stdout, PublishSnapshot.StaleMetric));
  }

  [Fact]
  public async Task UngatedPublish_StoresNoSnapshot_AndBuildsLiveCards()
  {
    var deck = await SeedReviewedDeckAsync("snapoff", 1);
    var jobId = JobId(await WithGateAsync("0", "0", () => PublishAsync(deck.DeckId)));
    Assert.Null(await SnapshotAsync(jobId));

    await _db.QueryAsync("update cards set explanation = 'Synthetic later edit.', updated_at = now() where id = $1", deck.CardIds[0]);
    var uploader = new CapturingUploader();
    await new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts()).ProcessAsync(jobId, 1);
    Assert.Equal("Synthetic later edit.", Assert.Single(uploader.Captured!.Cards).Explanation);
  }

  [Fact]
  public async Task Digest_IsTheSameOverThePublishRowsAndTheWorkerCards()
  {
    // Both sides of the binding read the same export columns: every nullable column, jsonb MCQ and source included.
    var deckId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author) values ($1, 'deck y02 digest', 'tests') returning id", $"it-y02-digest-{Guid.NewGuid():N}"),
      CultureInfo.InvariantCulture);
    await _db.QueryAsync(
      """
      insert into cards (deck_id, stable_uid, question, explanation, code_snippet, code_language, real_world_usage, difficulty, order_in_deck, topic, mcq, source)
      values
        ($1, 'digest-full', 'Which service buffers a burst?', 'Synthetic explanation.', 'print(1)', 'python', 'Synthetic usage.', 3, 1, 'Synthetic topic',
         '{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no","text":"resize","correct":false}],"shuffle":true,"qualifier":null}'::jsonb,
         '{"url":"https://docs.aws.amazon.com/synthetic","quote":"Synthetic quote."}'::jsonb),
        ($1, 'digest-bare', 'Synthetic bare question?', null, null, null, null, 2, 2, null, null, null)
      """,
      deckId);

    var rows = await _db.QueryAsync(Publish.CardsSql, deckId);
    await using var conn = new NpgsqlConnection(_db.ConnectionString);
    await conn.OpenAsync();
    var cards = await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId);

    var gated = PublishSnapshot.Digest(rows.Select(PublishSnapshot.FromRow));
    Assert.Equal(gated, PublishJobProcessor.SnapshotDigest(cards));

    await _db.QueryAsync("update cards set mcq = jsonb_set(mcq, '{shuffle}', 'false') where deck_id = $1 and stable_uid = 'digest-full'", deckId);
    Assert.NotEqual(gated, PublishJobProcessor.SnapshotDigest(await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId)));
  }
}
