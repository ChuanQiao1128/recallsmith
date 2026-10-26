using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.SQSEvents;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// Real handlers, PostgreSQL, worker, artifacts and manifest; only external transports are replaced.
[Collection(PostgresCollection.Name)]
public class PublishJourneyTests
{
  private readonly PostgresFixture _db;
  public PublishJourneyTests(PostgresFixture db) => _db = db;
  private const string Bucket = "isolated-publish-journey";
  private const string Question = "Which service buffers the edited order burst?";
  private const string Explanation = "Synthetic edited answer: SQS buffers orders while consumers scale.";
  private const string Uid = "journey-order-buffer";
  private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

  // shortcut: S3DeckUploader has a private static concrete SDK client; this transport adapter shares its
  // serialization options and hashes the stored bytes. It does not exercise uploader temp files or AWS SDK IO.
  private sealed class ObjectStore : AmazonS3Client, IS3DeckUploader
  {
    public Dictionary<string, string> Objects { get; } = new(StringComparer.Ordinal);
    public int DeckUploads;
    public ObjectStore() : base(new AnonymousAWSCredentials(), new AmazonS3Config { ServiceURL = "https://s3.invalid" }) { }
    public Task<S3UploadResult> UploadAsync(string key, DeckExportData data)
    {
      DeckUploads++;
      return UploadJsonAsync(key, JsonSerializer.Serialize(data, ContentJson.Options), S3DeckUploader.ImmutableCacheControl);
    }
    public Task<S3UploadResult> UploadJsonAsync(string key, string json, string cacheControl)
    {
      Assert.Equal(S3DeckUploader.ImmutableCacheControl, cacheControl);
      Objects[key] = json;
      var bytes = Encoding.UTF8.GetBytes(json);
      return Task.FromResult(new S3UploadResult { Sha256 = Sha(bytes), Bytes = bytes.LongLength });
    }
    public Task<string> DownloadJsonAsync(string key) => Task.FromResult(Objects[key]);
    public override Task<GetObjectMetadataResponse> GetObjectMetadataAsync(GetObjectMetadataRequest request, CancellationToken cancellationToken = default)
    {
      Assert.Equal(Bucket, request.BucketName);
      if (!Objects.TryGetValue(request.Key, out var json))
        throw new AmazonS3Exception("isolated object absent") { StatusCode = HttpStatusCode.NotFound };
      return Task.FromResult(new GetObjectMetadataResponse { ETag = Sha(Encoding.UTF8.GetBytes(json)) });
    }
    public override Task<PutObjectResponse> PutObjectAsync(PutObjectRequest request, CancellationToken cancellationToken = default)
    {
      Assert.Equal(Bucket, request.BucketName);
      Assert.Equal("content/manifest.json", request.Key);
      Assert.Equal("application/json; charset=utf-8", request.ContentType);
      Assert.Equal("public, max-age=60, s-maxage=60", request.Headers.CacheControl);
      Assert.False(string.IsNullOrEmpty(request.Metadata[ManifestBuilder.GeneratedAtMetadataKey]));
      if (Objects.TryGetValue(request.Key, out var previous))
        Assert.Equal(Sha(Encoding.UTF8.GetBytes(previous)), request.IfMatch);
      else Assert.Equal("*", request.IfNoneMatch);
      Objects[request.Key] = request.ContentBody;
      return Task.FromResult(new PutObjectResponse { ETag = Sha(Encoding.UTF8.GetBytes(request.ContentBody)) });
    }
  }

  private sealed class DownloadTransport(ObjectStore store) : HttpMessageHandler
  {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
      Assert.Equal("cdn.invalid", request.RequestUri!.Host);
      var key = request.RequestUri.AbsolutePath.TrimStart('/');
      var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(store.Objects[key])) };
      response.Content.Headers.ContentType = new("application/json");
      return Task.FromResult(response);
    }
  }

  private static async Task<JsonElement> InvokeAsync(string method, string path, object body,
    Func<LambdaRequest, Res, AuthContext, Task<APIGatewayProxyResponse>> handler)
  {
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(), http = new { method },
        authorizer = new { jwt = new { claims = new Dictionary<string, object>
          { ["sub"] = "isolated-journey-admin", ["cognito:groups"] = new[] { "super_admin" } } } },
      },
      headers = new Dictionary<string, string>(), queryStringParameters = new Dictionary<string, string>(),
      body = JsonSerializer.Serialize(body), isBase64Encoded = false,
    }));
    var response = await handler(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
    Assert.True(response.StatusCode == 200, $"{method} {path}: {response.StatusCode} {response.Body}");
    using var json = JsonDocument.Parse(response.Body!);
    return json.RootElement.GetProperty("data").Clone();
  }

  [Fact]
  public async Task AuthorEdit_Publish_Worker_Manifest_Download_AndReplay()
  {
    var artifactPath = Environment.GetEnvironmentVariable("RECALLSMITH_JOURNEY_ARTIFACT");
    if (!string.IsNullOrEmpty(artifactPath)) File.Delete(artifactPath);
    var names = new[] { QaGate.EnabledEnv, QaGate.RequiredEnv, WebhookEvents.QueueUrlEnv };
    var saved = names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    var oldEnqueue = Publish.TestEnqueueSeam;
    var oldWebhook = WebhookEvents.TestSendSeam;
    try
    {
      Environment.SetEnvironmentVariable(QaGate.EnabledEnv, "0");
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, "0");
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, null);
      WebhookEvents.TestSendSeam = _ => throw new InvalidOperationException("Journey must not send webhooks");
      var sent = new List<SendMessageRequest>();
      Publish.TestEnqueueSeam = new("https://sqs.invalid/journey", Bucket, r => { sent.Add(r); return Task.CompletedTask; });

      var slug = $"it-journey-{Guid.NewGuid():N}";
      var deck = await InvokeAsync("POST", "/api/v1/authoring/decks", new { slug, title = "Synthetic publish journey", author = "isolated test", deckType = 1 },
        (req, res, auth) => Decks.HandleAuthoringDecks(req, res, auth));
      var deckId = deck.GetProperty("id").GetInt64();
      var created = await InvokeAsync("POST", "/api/v1/authoring/cards", new
      {
        deckId, stableUid = Uid, question = "Synthetic original question?", explanation = "Synthetic original explanation.", difficulty = 2, orderInDeck = 1,
      }, Cards.HandleAuthoringCards);
      var cardId = created.GetProperty("id").GetInt64();
      var edited = await InvokeAsync("PUT", "/api/v1/authoring/cards", new
      {
        id = cardId, expectedVersion = created.GetProperty("version").GetInt32(), question = Question, explanation = Explanation, topic = "Messaging",
      }, Cards.HandleAuthoringCards);
      Assert.Equal(2, edited.GetProperty("version").GetInt32());
      // Read immediately: a later publish must not accidentally save an unpersisted author edit.
      Assert.Equal(Explanation, await _db.ScalarAsync("select explanation from cards where id = $1", cardId));
      var published = await InvokeAsync("POST", "/api/v1/authoring/publish", new { deckId }, Publish.HandleAuthoringPublish);
      var jobId = published.GetProperty("jobId").GetString()!;
      var queued = Assert.Single(sent);
      Assert.Equal("https://sqs.invalid/journey", queued.QueueUrl);
      using (var message = JsonDocument.Parse(queued.MessageBody)) Assert.Equal(jobId, message.RootElement.GetProperty("jobId").GetString());
      Assert.Equal("PENDING", await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId));

      using var store = new ObjectStore();
      var processor = new PublishJobProcessor(new JobRepository(), store);
      var rebuilds = 0;
      var worker = new WorkerFunction(processor, async _ =>
      {
        await using var conn = await _db.OpenAsync();
        await ManifestBuilder.RebuildAsync(conn, store, Bucket, "content", "premium");
        rebuilds++;
      });
      var sqs = new SQSEvent { Records = [new SQSEvent.SQSMessage
      {
        MessageId = "journey-message", Body = queued.MessageBody,
        Attributes = new() { ["ApproximateReceiveCount"] = "1" },
      }] };
      Assert.Empty((await worker.FunctionHandler(sqs, null!)).BatchItemFailures);
      var row = Assert.Single(await _db.QueryAsync("select status, build_id, s3_key, content_sha256, content_bytes, package_key from deck_publishes where job_id = $1", jobId));
      var buildId = (string)row["build_id"]!;
      Assert.Equal("SUCCESS", row["status"]);
      Assert.Equal(buildId, await _db.ScalarAsync("select live_build_id from decks where id = $1", deckId));
      Assert.Equal(1, Convert.ToInt32(await _db.ScalarAsync("select total_cards from decks where id = $1", deckId), CultureInfo.InvariantCulture));
      Assert.Equal(1, store.DeckUploads);
      Assert.Equal(1, rebuilds);

      using var http = new HttpClient(new DownloadTransport(store));
      using var manifest = JsonDocument.Parse(await http.GetByteArrayAsync("https://cdn.invalid/content/manifest.json"));
      var entry = Assert.Single(manifest.RootElement.GetProperty("decks").EnumerateArray().Where(d => d.GetProperty("slug").GetString() == slug));
      Assert.Equal(buildId, entry.GetProperty("version").GetString());
      Assert.Equal(buildId, entry.GetProperty("buildId").GetString());
      var key = $"content/{entry.GetProperty("path").GetString()}";
      Assert.Equal(row["s3_key"], key);
      var downloaded = await http.GetByteArrayAsync($"https://cdn.invalid/{key}");
      Assert.Equal(row["content_sha256"], Sha(downloaded));
      Assert.Equal(row["content_sha256"], entry.GetProperty("sha256").GetString());
      Assert.Equal(Convert.ToInt64(row["content_bytes"], CultureInfo.InvariantCulture), downloaded.LongLength);
      Assert.Equal(row["package_key"], entry.GetProperty("packagePath").GetString());
      Assert.False(string.IsNullOrEmpty(entry.GetProperty("packagePath").GetString()));
      using var content = JsonDocument.Parse(downloaded);
      Assert.Equal(buildId, content.RootElement.GetProperty("version").GetString());
      var card = Assert.Single(content.RootElement.GetProperty("cards").EnumerateArray());
      Assert.Equal(Uid, card.GetProperty("stableUid").GetString());
      Assert.Equal(Question, card.GetProperty("question").GetString());
      Assert.Equal(Explanation, card.GetProperty("explanation").GetString());
      Assert.Equal("Messaging", card.GetProperty("topic").GetString());

      var immutable = store.Objects.Where(o => o.Key != "content/manifest.json").ToDictionary();
      sqs.Records[0].Attributes["ApproximateReceiveCount"] = "2";
      Assert.Empty((await worker.FunctionHandler(sqs, null!)).BatchItemFailures);
      Assert.Equal(PublishReplayOutcome.Succeeded, processor.LastCallReplayOutcome);
      Assert.Equal(1, store.DeckUploads);
      Assert.Equal(2, rebuilds);
      foreach (var item in immutable) Assert.Equal(item.Value, store.Objects[item.Key]);
      Assert.Equal(1L, await _db.ScalarAsync("select count(*) from deck_publishes where deck_id = $1 and status = 'SUCCESS'", deckId));
      Assert.Equal(buildId, await _db.ScalarAsync("select live_build_id from decks where id = $1", deckId));

      // Publish the handoff only after every producer assertion and replay passes.
      if (!string.IsNullOrEmpty(artifactPath))
      {
        await File.WriteAllTextAsync(artifactPath, JsonSerializer.Serialize(new
        {
          slug, buildId, jobId, question = Question, explanation = Explanation, stableUid = Uid,
          objects = store.Objects,
        }));
      }
      Console.WriteLine($"JOURNEY_OK slug={slug} jobId={jobId} buildId={buildId} sha256={Sha(downloaded)} bytes={downloaded.Length} replay=acknowledged objects={store.Objects.Count}");
    }
    finally
    {
      foreach (var n in names) Environment.SetEnvironmentVariable(n, saved[n]);
      Publish.TestEnqueueSeam = oldEnqueue;
      WebhookEvents.TestSendSeam = oldWebhook;
    }
  }
}
