using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The outbound-webhook enqueue helper (R18 J03, contract §6.2–§6.4) against a real Postgres: the §6.6
/// URL rule as a generated table, one delivery row + one SQS message per live subscription with the
/// §6.4 shape, the enqueue_failed path, tolerance of a pre-027 schema, the §6.3 body and signature
/// vector, and the two wired emission sites (deck.published from the Worker, import.failed from
/// cards/import). Every send goes through <see cref="WebhookEvents.TestSendSeam"/>; no SQS client is
/// ever built. Tests that count deliveries first deactivate every live subscription (the collection
/// runs serially), then create their own.
/// </summary>
[Collection(PostgresCollection.Name)]
public class WebhookEventsTests
{
  private readonly PostgresFixture _db;
  public WebhookEventsTests(PostgresFixture db) => _db = db;

  private const string FakeQueueUrl = "https://sqs.invalid.example/000000000000/developercards-webhook-events-test";
  private const string ImportPath = "/api/v1/authoring/cards/import";

  // ---------------------------------------------------------------- helpers

  private sealed class Capture
  {
    private readonly object _gate = new();
    public List<SendMessageRequest> Sent { get; } = new();

    public Task Send(SendMessageRequest request)
    {
      lock (_gate) Sent.Add(request);
      return Task.CompletedTask;
    }

    public List<JsonElement> MessagesFor(long subscriptionId) =>
      Sent.Select(r => JsonDocument.Parse(r.MessageBody).RootElement.Clone())
        .Where(m => m.GetProperty("subscriptionId").GetInt64() == subscriptionId)
        .ToList();
  }

  /// <summary>Sets the seam first, then the fake queue URL; restores both in finally.</summary>
  private static async Task WithQueueAsync(Func<SendMessageRequest, Task> send, Func<Task> body)
  {
    var savedSeam = WebhookEvents.TestSendSeam;
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    try
    {
      WebhookEvents.TestSendSeam = send;
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, FakeQueueUrl);
      await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
      WebhookEvents.TestSendSeam = savedSeam;
    }
  }

  private Task DeactivateAllAsync() =>
    _db.ScalarAsync("update webhook_subscriptions set is_active = false where deleted_at is null");

  private async Task<long> NewSubscriptionAsync(string[] events, bool active = true, bool deleted = false)
  {
    var rows = await _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events, is_active, deleted_at) values ($1, $2, $3, $4, case when $5 then now() else null end) returning id",
      $"it-j03-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-j03/{Guid.NewGuid():N}", events, active, deleted);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static JsonElement Event(string method, string path, string sub, string[] groups, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = sub,
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> ImportAsync(long deckId, object[] cards)
  {
    var body = JsonSerializer.Serialize(new { deckId, cards });
    var req = new LambdaRequest(Event("POST", ImportPath, $"it-j03-{Guid.NewGuid():N}", ["super_admin"], body));
    var res = new Res(req.TraceId);
    return await CardsImport.HandleCardsImport(req, res, await Auth.GetAuthContextAsync(req));
  }

  private async Task<(long Id, string Slug)> NewDeckAsync()
  {
    var slug = $"it-j03-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, "deck j03", "tests");
    return (Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture), slug);
  }

  private static string HmacHex(string secret, string message)
  {
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    return Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes(message))).ToLowerInvariant();
  }

  // ---------------------------------------------------------------- URL rule (generated)

  public static IEnumerable<object?[]> UrlCases()
  {
    var cases = new List<(string? Url, bool Valid)>();

    // Schemes: only a literal https:// prefix passes.
    foreach (var scheme in new[] { "http", "ftp", "HTTPS", "Https", "wss", "file" })
    {
      cases.Add(($"{scheme}://hooks.example.com/x", false));
    }
    cases.Add(("https://hooks.example.com/services/T000/B000/abc", true));
    cases.Add(("https://example.com", true));
    cases.Add(("https://example.com:8443/path?q=1#frag", true));
    cases.Add(("https://sub.domain.example.org/a/b", true));
    cases.Add(("https://localhost.example.com/", true));
    cases.Add(("https://my-localhost/", true));

    // Userinfo.
    cases.Add(("https://user:pass@example.com/", false));
    cases.Add(("https://user@example.com/", false));
    cases.Add(("https://:pass@example.com/", false));

    // localhost variants.
    foreach (var host in new[] { "localhost", "LOCALHOST", "LocalHost", "localhost.", "foo.localhost", "a.b.LOCALHOST", "localhost:8080" })
    {
      cases.Add(($"https://{host}/hook", false));
    }

    // Blocked IPv4 ranges: first, an inside address and last address of each; and the neighbours outside.
    var blocked = new (string First, string Inside, string Last, string OutsideBelow, string OutsideAbove)[]
    {
      ("0.0.0.0", "0.1.2.3", "0.255.255.255", "", "1.0.0.0"),
      ("10.0.0.0", "10.1.2.3", "10.255.255.255", "9.255.255.255", "11.0.0.0"),
      ("100.64.0.0", "100.100.1.1", "100.127.255.255", "100.63.255.255", "100.128.0.0"),
      ("127.0.0.0", "127.0.0.1", "127.255.255.255", "126.255.255.255", "128.0.0.0"),
      ("169.254.0.0", "169.254.169.254", "169.254.255.255", "169.253.255.255", "169.255.0.0"),
      ("172.16.0.0", "172.20.1.1", "172.31.255.255", "172.15.255.255", "172.32.0.0"),
      ("192.168.0.0", "192.168.1.1", "192.168.255.255", "192.167.255.255", "192.169.0.0"),
    };
    foreach (var b in blocked)
    {
      cases.Add(($"https://{b.First}/hook", false));
      cases.Add(($"https://{b.Inside}/hook", false));
      cases.Add(($"https://{b.Last}/hook", false));
      cases.Add(($"https://[::ffff:{b.Inside}]/hook", false));
      if (b.OutsideBelow.Length > 0) cases.Add(($"https://{b.OutsideBelow}/hook", true));
      cases.Add(($"https://{b.OutsideAbove}/hook", true));
    }

    // Blocked IPv6.
    foreach (var host in new[] { "::", "::1", "fc00::1", "fd12:3456:789a::1", "fdff:ffff::1", "fe80::1", "febf:ffff::1", "0:0:0:0:0:0:0:1" })
    {
      cases.Add(($"https://[{host}]/hook", false));
    }

    // Public IPs and public IPv6, including IPv4-mapped public.
    foreach (var host in new[] { "8.8.8.8", "1.1.1.1", "203.0.113.10", "52.95.110.1" })
    {
      cases.Add(($"https://{host}/hook", true));
    }
    foreach (var host in new[] { "2001:4860:4860::8888", "2606:4700:4700::1111", "fec0::1", "fe7f::1", "::ffff:8.8.8.8" })
    {
      cases.Add(($"https://[{host}]/hook", true));
    }

    // Whitespace anywhere.
    cases.Add(("https://example.com/a b", false));
    cases.Add((" https://example.com/", false));
    cases.Add(("https://example.com/\t", false));
    cases.Add(("https://example.com/\n", false));
    cases.Add(("https://exa mple.com/", false));

    // Length: exactly 2048 passes, 2049 does not.
    const string prefix = "https://example.com/";
    cases.Add((prefix + new string('a', 2048 - prefix.Length), true));
    cases.Add((prefix + new string('a', 2049 - prefix.Length), false));

    // Not a URL at all.
    cases.Add((null, false));
    cases.Add(("", false));
    cases.Add(("https://", false));
    cases.Add(("https:///path", false));
    cases.Add(("not a url", false));
    cases.Add(("example.com", false));

    return cases.Select(c => new object?[] { c.Url, c.Valid });
  }

  [Fact]
  public void SubscriptionUrl_GeneratedCases_AreAtLeastFifty() => Assert.True(UrlCases().Count() >= 50);

  [Theory]
  [MemberData(nameof(UrlCases))]
  public void SubscriptionUrl_GeneratedCases_MatchRule(string? url, bool expected)
  {
    Assert.Equal(expected, WebhookEvents.IsValidSubscriptionUrl(url));
  }

  // ---------------------------------------------------------------- EnqueueAsync

  [Fact]
  public async Task Enqueue_NoQueueUrl_ReturnsZeroAndWritesNothing()
  {
    await DeactivateAllAsync();
    await NewSubscriptionAsync(["deck.published"]);

    var capture = new Capture();
    var savedSeam = WebhookEvents.TestSendSeam;
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    try
    {
      WebhookEvents.TestSendSeam = capture.Send;
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, null);

      await using var conn = await _db.OpenAsync();
      var result = await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 1 });

      Assert.NotEqual(Guid.Empty, result.EventId);
      Assert.Equal(0, result.Deliveries);
      Assert.Equal(0, result.EnqueueFailures);
      Assert.Empty(capture.Sent);
      var rows = await _db.ScalarAsync("select count(*) from webhook_deliveries where event_id = $1", result.EventId);
      Assert.Equal(0L, Convert.ToInt64(rows, CultureInfo.InvariantCulture));
    }
    finally
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
      WebhookEvents.TestSendSeam = savedSeam;
    }
  }

  [Fact]
  public async Task Enqueue_OneMessagePerLiveSubscription_WithContractShape()
  {
    await DeactivateAllAsync();
    var a = await NewSubscriptionAsync(["deck.published"]);
    var b = await NewSubscriptionAsync(["import.failed", "deck.published"]);

    var capture = new Capture();
    WebhookEnqueueResult? result = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      await using var conn = await _db.OpenAsync();
      result = await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 7, deckSlug = "d7" });
    });

    Assert.NotNull(result);
    Assert.Equal(2, result!.Deliveries);
    Assert.Equal(0, result.EnqueueFailures);
    Assert.Equal(2, capture.Sent.Count);

    var expectedKeys = new[] { "v", "deliveryId", "eventId", "event", "subscriptionId", "url", "occurredAt", "body" };
    var seenSubs = new List<long>();
    foreach (var request in capture.Sent)
    {
      Assert.Equal(FakeQueueUrl, request.QueueUrl);
      Assert.True(request.MessageAttributes is null || request.MessageAttributes.Count == 0);

      using var doc = JsonDocument.Parse(request.MessageBody);
      var m = doc.RootElement;
      Assert.Equal(expectedKeys, m.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(1, m.GetProperty("v").GetInt32());
      Assert.Equal(result.EventId, m.GetProperty("eventId").GetGuid());
      Assert.Equal("deck.published", m.GetProperty("event").GetString());
      var subId = m.GetProperty("subscriptionId").GetInt64();
      seenSubs.Add(subId);

      var deliveryId = m.GetProperty("deliveryId").GetGuid();
      var rows = await _db.QueryAsync(
        "select status, body, subscription_id, event_id, url from webhook_deliveries d join webhook_subscriptions s on s.id = d.subscription_id where delivery_id = $1",
        deliveryId);
      var row = Assert.Single(rows);
      Assert.Equal("queued", (string)row["status"]!);
      Assert.Equal(m.GetProperty("body").GetString(), (string)row["body"]!);
      Assert.Equal(subId, Convert.ToInt64(row["subscription_id"], CultureInfo.InvariantCulture));
      Assert.Equal(result.EventId, (Guid)row["event_id"]!);
      Assert.Equal((string)row["url"]!, m.GetProperty("url").GetString());

      using var body = JsonDocument.Parse(m.GetProperty("body").GetString()!);
      Assert.Equal(m.GetProperty("occurredAt").GetString(), body.RootElement.GetProperty("occurredAt").GetString());
      Assert.Equal(7, body.RootElement.GetProperty("data").GetProperty("deckId").GetInt32());
    }

    Assert.Equal(new[] { a, b }.OrderBy(x => x), seenSubs.OrderBy(x => x));
    var bodies = capture.Sent.Select(r => JsonDocument.Parse(r.MessageBody).RootElement.GetProperty("body").GetString()).Distinct().ToList();
    Assert.Single(bodies);
  }

  [Fact]
  public async Task Enqueue_SkipsInactiveDeletedAndUnsubscribed()
  {
    await DeactivateAllAsync();
    var live = await NewSubscriptionAsync(["import.failed"]);
    var inactive = await NewSubscriptionAsync(["import.failed"], active: false);
    var deleted = await NewSubscriptionAsync(["import.failed"], deleted: true);
    var other = await NewSubscriptionAsync(["deck.published"]);

    var capture = new Capture();
    WebhookEnqueueResult? result = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      await using var conn = await _db.OpenAsync();
      result = await WebhookEvents.EnqueueAsync(conn, "import.failed", new { deckId = 1 });
    });

    Assert.Equal(1, result!.Deliveries);
    Assert.Single(capture.MessagesFor(live));
    Assert.Empty(capture.MessagesFor(inactive));
    Assert.Empty(capture.MessagesFor(deleted));
    Assert.Empty(capture.MessagesFor(other));

    var rows = await _db.QueryAsync("select subscription_id from webhook_deliveries where event_id = $1", result.EventId);
    var row = Assert.Single(rows);
    Assert.Equal(live, Convert.ToInt64(row["subscription_id"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Enqueue_UnknownOrUntargetedTestEvent_SendsNothing()
  {
    await DeactivateAllAsync();
    await NewSubscriptionAsync(["deck.published"]);

    var capture = new Capture();
    await WithQueueAsync(capture.Send, async () =>
    {
      await using var conn = await _db.OpenAsync();
      var unknown = await WebhookEvents.EnqueueAsync(conn, "deck.deleted", new { });
      var untargeted = await WebhookEvents.EnqueueAsync(conn, WebhookEvents.TestEvent, new { });
      Assert.Equal(0, unknown.Deliveries);
      Assert.Equal(0, untargeted.Deliveries);
    });
    Assert.Empty(capture.Sent);
  }

  [Fact]
  public async Task Enqueue_SendFailure_MarksEnqueueFailedAndCounts()
  {
    await DeactivateAllAsync();
    var sub = await NewSubscriptionAsync(["card.flagged"]);

    WebhookEnqueueResult? result = null;
    await WithQueueAsync(_ => throw new InvalidOperationException("queue is unavailable"), async () =>
    {
      await using var conn = await _db.OpenAsync();
      result = await WebhookEvents.EnqueueAsync(conn, "card.flagged", new { deckId = 1 });
    });

    Assert.Equal(1, result!.Deliveries);
    Assert.Equal(1, result.EnqueueFailures);

    var rows = await _db.QueryAsync(
      "select status, last_error, subscription_id from webhook_deliveries where event_id = $1", result.EventId);
    var row = Assert.Single(rows);
    Assert.Equal("enqueue_failed", (string)row["status"]!);
    Assert.Equal("queue is unavailable", (string)row["last_error"]!);
    Assert.Equal(sub, Convert.ToInt64(row["subscription_id"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Enqueue_MissingTables_DoesNotThrow()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("j03_pre027_enqueue");
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 26);

    var capture = new Capture();
    WebhookEnqueueResult? result = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      result = await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 1 });
    });

    Assert.NotNull(result);
    Assert.NotEqual(Guid.Empty, result!.EventId);
    Assert.Equal(0, result.Deliveries);
    Assert.Equal(0, result.EnqueueFailures);
    Assert.Empty(capture.Sent);
  }

  // ---------------------------------------------------------------- body + signature

  [Fact]
  public void RenderBody_IsAsciiWithContractKeyOrder()
  {
    var eventId = Guid.NewGuid();
    var at = new DateTimeOffset(2026, 10, 1, 13, 4, 5, 678, TimeSpan.FromHours(10));
    var body = WebhookEvents.RenderBody(eventId, "import.failed", at, new { message = "Café ✓ 卡片" });

    Assert.All(body, c => Assert.True(c < 128, $"non-ASCII char U+{(int)c:X4} in body"));
    Assert.Contains("\\u00E9", body, StringComparison.OrdinalIgnoreCase);

    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;
    // automation-7: schemaVersion is appended last, so the first five keys keep their contract order.
    Assert.Equal(new[] { "data", "environment", "event", "eventId", "occurredAt", "schemaVersion" }, root.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
    Assert.Equal("prod", root.GetProperty("environment").GetString());
    Assert.Equal("import.failed", root.GetProperty("event").GetString());
    Assert.Equal(eventId.ToString("D"), root.GetProperty("eventId").GetString());
    Assert.Equal("2026-10-01T03:04:05.678Z", root.GetProperty("occurredAt").GetString());
    Assert.Equal("Café ✓ 卡片", root.GetProperty("data").GetProperty("message").GetString());
  }

  [Fact]
  public void DeliverySignature_TestVector_MatchesContract()
  {
    // Contract §6.3: what a receiver computes over "<timestamp>.<body>" with the signing secret.
    var signature = HmacHex("whsec-test", "1790000000.{\"event\":\"webhook.test\"}");
    Assert.Equal("c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef", signature);
  }

  // ---------------------------------------------------------------- emission sites

  private sealed class NullUploader : IS3DeckUploader
  {
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data) => Task.FromResult(new S3UploadResult());
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) => Task.FromResult(new S3UploadResult());
    public Task<string> DownloadJsonAsync(string s3Key) => Task.FromResult("{}");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  [Fact]
  public async Task Publish_Success_EmitsDeckPublished()
  {
    await DeactivateAllAsync();
    var sub = await NewSubscriptionAsync(["deck.published"]);

    var (deckId, slug) = await NewDeckAsync();
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,0)",
      deckId, "uid-1", "q1", 5);
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,0)",
      deckId, "uid-2", "q2", 10);
    var build = $"b-j03-{Guid.NewGuid():N}"[..20];
    var jobId = Guid.NewGuid().ToString();
    await _db.ScalarAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,$6)",
      deckId, slug, build, $"content/{build}/deck.json", jobId, "PENDING");

    var capture = new Capture();
    await WithQueueAsync(capture.Send, () =>
      new PublishJobProcessor(new JobRepository(), new NullUploader(), new NoopArtifacts()).ProcessAsync(jobId, 1));

    var status = await _db.ScalarAsync("select status from deck_publishes where job_id = $1", jobId);
    Assert.Equal("SUCCESS", Convert.ToString(status, CultureInfo.InvariantCulture));

    var message = Assert.Single(capture.MessagesFor(sub));
    Assert.Equal("deck.published", message.GetProperty("event").GetString());
    using var body = JsonDocument.Parse(message.GetProperty("body").GetString()!);
    var data = body.RootElement.GetProperty("data");
    Assert.Equal(new[] { "deckId", "deckSlug", "buildId", "jobId", "cardCount", "publishedAt" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(deckId, data.GetProperty("deckId").GetInt64());
    Assert.Equal(slug, data.GetProperty("deckSlug").GetString());
    Assert.Equal(build, data.GetProperty("buildId").GetString());
    Assert.Equal(jobId, data.GetProperty("jobId").GetString());
    Assert.Equal(2, data.GetProperty("cardCount").GetInt32());
    Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", data.GetProperty("publishedAt").GetString()!);
  }

  private async Task<(long DeckId, string JobId)> SeedProcessingJobAsync()
  {
    var (deckId, slug) = await NewDeckAsync();
    await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1,$2,$3,$4,0)",
      deckId, "uid-1", "q1", 5);
    var build = $"b-y01-{Guid.NewGuid():N}"[..20];
    var jobId = Guid.NewGuid().ToString();
    await _db.ScalarAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PROCESSING')",
      deckId, slug, build, $"content/{build}/deck.json", jobId);
    return (deckId, jobId);
  }

  [Fact]
  public async Task Publish_CrashAfterCompletion_ReplaySendsTheStagedEventOnce()
  {
    // automation-1: the deck.published rows are staged in the SUCCESS transaction (an outbox), so a worker
    // crash between CompleteJobAsync and the side effects no longer loses the event or the ledger row.
    await DeactivateAllAsync();
    var sub = await NewSubscriptionAsync(["deck.published"]);
    var (deckId, jobId) = await SeedProcessingJobAsync();
    var eventId = JobRepository.PublishedEventId(jobId);

    var capture = new Capture();
    // The crash: the job completes, then the process dies before AfterPublishSucceededAsync.
    await WithQueueAsync(capture.Send, () => new JobRepository().CompleteJobAsync(jobId, 1));
    Assert.Empty(capture.Sent);
    var staged = Assert.Single(await _db.QueryAsync(
      "select delivery_id, status, attempts, enqueued_at, body from webhook_deliveries where event_id = $1", eventId));
    Assert.Equal("queued", (string)staged["status"]!);
    Assert.Null(staged["enqueued_at"]);
    Assert.Empty(await _db.QueryAsync("select 1 from automation_events where dedupe_key = $1", $"publish:{jobId}"));

    // SQS redelivers the unacknowledged job message: the replay branch runs the side effects.
    var processor = new PublishJobProcessor(new JobRepository(), new NullUploader(), new NoopArtifacts());
    await WithQueueAsync(capture.Send, () => processor.ProcessAsync(jobId, 2));
    var message = Assert.Single(capture.MessagesFor(sub));
    Assert.Equal((Guid)staged["delivery_id"]!, message.GetProperty("deliveryId").GetGuid());
    Assert.Equal(eventId, message.GetProperty("eventId").GetGuid());
    using (var body = JsonDocument.Parse(message.GetProperty("body").GetString()!))
    {
      var data = body.RootElement.GetProperty("data");
      Assert.Equal(new[] { "deckId", "deckSlug", "buildId", "jobId", "cardCount", "publishedAt" }, data.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(deckId, data.GetProperty("deckId").GetInt64());
      Assert.Equal(jobId, data.GetProperty("jobId").GetString());
      Assert.Equal(1, data.GetProperty("cardCount").GetInt32());
    }
    Assert.NotNull(await _db.ScalarAsync("select enqueued_at from webhook_deliveries where event_id = $1", eventId));
    Assert.Single(await _db.QueryAsync("select 1 from automation_events where dedupe_key = $1", $"publish:{jobId}"));

    // A second replay sends nothing more and stages nothing more.
    await WithQueueAsync(capture.Send, () => processor.ProcessAsync(jobId, 3));
    Assert.Single(capture.Sent);
    Assert.Single(await _db.QueryAsync("select 1 from webhook_deliveries where event_id = $1", eventId));
  }

  [Fact]
  public async Task Publish_CompletionOfAFinishedJob_StagesNothing()
  {
    // Only the PROCESSING → SUCCESS transition stages the event; completing it again is a no-op.
    await DeactivateAllAsync();
    await NewSubscriptionAsync(["deck.published"]);
    var (_, jobId) = await SeedProcessingJobAsync();

    var capture = new Capture();
    await WithQueueAsync(capture.Send, async () =>
    {
      await new JobRepository().CompleteJobAsync(jobId, 1);
      await new JobRepository().CompleteJobAsync(jobId, 1);
    });
    Assert.Single(await _db.QueryAsync("select 1 from webhook_deliveries where event_id = $1", JobRepository.PublishedEventId(jobId)));
    Assert.Empty(capture.Sent);
  }

  [Fact]
  public void DerivedEventId_IsStableAndVersion8()
  {
    var a = WebhookEvents.DerivedEventId("deck.published:job-1");
    Assert.Equal(a, WebhookEvents.DerivedEventId("deck.published:job-1"));
    Assert.NotEqual(a, WebhookEvents.DerivedEventId("deck.published:job-2"));
    var text = a.ToString("D");
    Assert.Equal('8', text[14]);
    Assert.Contains(text[19], "89ab");
  }

  [Fact]
  public async Task CardsImport_Failure_EmitsImportFailed()
  {
    await DeactivateAllAsync();
    var sub = await NewSubscriptionAsync(["import.failed"]);
    var (deckId, slug) = await NewDeckAsync();

    var capture = new Capture();
    APIGatewayProxyResponse? resp = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      resp = await ImportAsync(deckId,
      [
        new { stableUid = "a", question = "q", explanation = "a", orderInDeck = 1, difficulty = 2 },
        new { stableUid = "b", explanation = "missing question", orderInDeck = 2, difficulty = 2 },
        new { stableUid = "c", question = "q", explanation = "a", orderInDeck = 3, difficulty = 2 },
      ]);
    });

    Assert.Equal(400, resp!.StatusCode);
    var message = Assert.Single(capture.MessagesFor(sub));
    Assert.Equal("import.failed", message.GetProperty("event").GetString());
    using var body = JsonDocument.Parse(message.GetProperty("body").GetString()!);
    var data = body.RootElement.GetProperty("data");
    Assert.Equal(deckId, data.GetProperty("deckId").GetInt64());
    Assert.Equal(slug, data.GetProperty("deckSlug").GetString());
    Assert.Equal("VALIDATION_ERROR", data.GetProperty("errorCode").GetString());
    Assert.Contains("question", data.GetProperty("message").GetString(), StringComparison.Ordinal);
    Assert.Equal(3, data.GetProperty("cardCount").GetInt32());
  }

  [Fact]
  public async Task CardsImport_Success_EmitsNothing()
  {
    await DeactivateAllAsync();
    var sub = await NewSubscriptionAsync(["import.failed", "deck.published"]);
    var (deckId, _) = await NewDeckAsync();

    var capture = new Capture();
    APIGatewayProxyResponse? resp = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      resp = await ImportAsync(deckId,
      [
        new { stableUid = "a", question = "q", explanation = "a", orderInDeck = 1, difficulty = 2 },
      ]);
    });

    Assert.Equal(200, resp!.StatusCode);
    Assert.Empty(capture.MessagesFor(sub));
    Assert.Empty(capture.Sent);
  }

  [Fact]
  public async Task CardsImport_UnknownDeck_EmitsNothing()
  {
    await DeactivateAllAsync();
    var sub = await NewSubscriptionAsync(["import.failed"]);

    var capture = new Capture();
    APIGatewayProxyResponse? resp = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      resp = await ImportAsync(long.MaxValue - 7,
      [
        new { stableUid = "a", question = "q", explanation = "a", orderInDeck = 1, difficulty = 2 },
      ]);
    });

    // Deck resolution did not pass (super_admin reaches the in-transaction 404): no event.
    Assert.Equal(404, resp!.StatusCode);
    Assert.Empty(capture.MessagesFor(sub));
  }

  // ---------------------------------------------------------------- migration

  [Fact]
  public async Task Migration027_IsIdempotent()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("j03_twice");
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 27);

    var path = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "027_webhooks.sql");
    var sql = await File.ReadAllTextAsync(path);
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    var tables = await DbUtil.QueryAsync(conn, null,
      """select to_regclass('public.webhook_subscriptions') is not null as "subs", to_regclass('public.webhook_deliveries') is not null as "dels" """,
      []);
    Assert.True((bool)tables[0]["subs"]!);
    Assert.True((bool)tables[0]["dels"]!);

    var indexes = await DbUtil.ExecuteScalarAsync(conn, null,
      "select count(*) from pg_indexes where indexname in ('idx_webhook_subscriptions_live','idx_webhook_deliveries_sub_created','idx_webhook_deliveries_status_created','idx_webhook_deliveries_event')",
      []);
    Assert.Equal(4L, Convert.ToInt64(indexes, CultureInfo.InvariantCulture));
  }
}
