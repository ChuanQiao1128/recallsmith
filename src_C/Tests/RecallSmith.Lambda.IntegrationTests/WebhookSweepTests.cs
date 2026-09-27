using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Hardening of the outbound-webhook enqueue (R18 X01) against a real Postgres: the super_admin sweep that
/// re-sends deliveries stranded before the dispatcher ever saw them (automation-1), and the deadline that
/// keeps a hanging SQS send from holding the originating request (backend-design-4). Every send goes
/// through <see cref="WebhookEvents.TestSendSeam"/>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class WebhookSweepTests
{
  private readonly PostgresFixture _db;
  public WebhookSweepTests(PostgresFixture db) => _db = db;

  private const string SweepPath = "/api/v1/admin/webhooks/deliveries/sweep";
  private const string FakeQueueUrl = "https://sqs.invalid.example/000000000000/developercards-webhook-events-x01";

  // ---------------------------------------------------------------- helpers

  private static async Task<T> WithQueueAsync<T>(Func<SendMessageRequest, Task> send, Func<Task<T>> body, string? queueUrl = FakeQueueUrl)
  {
    var savedSeam = WebhookEvents.TestSendSeam;
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    try
    {
      WebhookEvents.TestSendSeam = send;
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, queueUrl);
      return await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
      WebhookEvents.TestSendSeam = savedSeam;
    }
  }

  private static Task<APIGatewayProxyResponse> SweepAsync(string? body = null, string[]? groups = null, string method = "POST") =>
    new RecallSmith.Lambda.VpcFunction().Handler(JsonSerializer.SerializeToElement(new
    {
      rawPath = SweepPath,
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
              ["sub"] = $"it-x01-sweep-{Guid.NewGuid():N}",
              ["cognito:groups"] = groups ?? ["super_admin"],
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    }));

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    return JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();
  }

  private async Task<long> NewSubscriptionAsync(bool active = true, bool deleted = false)
  {
    var rows = await _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events, is_active, deleted_at) values ($1, $2, $3, $4, case when $5 then now() else null end) returning id",
      $"it-x01-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-x01/{Guid.NewGuid():N}", new[] { "deck.published" }, active, deleted);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  /// <summary>A delivery row last touched <paramref name="minutesAgo"/> minutes ago.</summary>
  private async Task<(Guid DeliveryId, Guid EventId)> SeedDeliveryAsync(long subscriptionId, string status, int attempts, int minutesAgo)
  {
    var deliveryId = Guid.NewGuid();
    var eventId = Guid.NewGuid();
    var body = JsonSerializer.Serialize(new { data = new { }, environment = "prod", @event = "deck.published", eventId = eventId.ToString("D"), occurredAt = "2026-01-02T03:04:05.678Z" });
    await _db.ScalarAsync(
      """
      insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, attempts, last_error, body, created_at, updated_at)
      values ($1, $2, 'deck.published', $3, $4, $5, case when $4 = 'enqueue_failed' then 'sqs down' else null end, $6,
              now() - make_interval(mins => $7), now() - make_interval(mins => $7))
      """,
      deliveryId, eventId, subscriptionId, status, attempts, body, minutesAgo);
    return (deliveryId, eventId);
  }

  private async Task<string> StatusAsync(Guid deliveryId) =>
    (string)(await _db.ScalarAsync("select status from webhook_deliveries where delivery_id = $1", deliveryId))!;

  // ---------------------------------------------------------------- sweep

  [Fact]
  public async Task Sweep_ResendsOnlyStrandedDeliveries_WithTheSameIds()
  {
    var live = await NewSubscriptionAsync();
    var inactive = await NewSubscriptionAsync(active: false);
    var deleted = await NewSubscriptionAsync(active: false, deleted: true);

    var enqueueFailed = await SeedDeliveryAsync(live, "enqueue_failed", 0, 30);
    var orphanQueued = await SeedDeliveryAsync(live, "queued", 0, 11);
    var freshQueued = await SeedDeliveryAsync(live, "queued", 0, 2);
    var freshFailed = await SeedDeliveryAsync(live, "enqueue_failed", 0, 5);
    var retrying = await SeedDeliveryAsync(live, "retrying", 2, 60);
    var inFlight = await SeedDeliveryAsync(live, "queued", 1, 60);
    var delivered = await SeedDeliveryAsync(live, "delivered", 1, 60);
    var inactiveRow = await SeedDeliveryAsync(inactive, "enqueue_failed", 0, 60);
    var deletedRow = await SeedDeliveryAsync(deleted, "queued", 0, 60);

    var sent = new List<SendMessageRequest>();
    var data = await WithQueueAsync(r => { lock (sent) sent.Add(r); return Task.CompletedTask; }, async () => Data(await SweepAsync()));

    Assert.Equal(new[] { "swept", "resent", "enqueueFailures", "deliveryIds" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(2, data.GetProperty("swept").GetInt32());
    Assert.Equal(2, data.GetProperty("resent").GetInt32());
    Assert.Equal(0, data.GetProperty("enqueueFailures").GetInt32());
    var expected = new[] { enqueueFailed.DeliveryId, orphanQueued.DeliveryId }.OrderBy(g => g).ToArray();
    Assert.Equal(expected, data.GetProperty("deliveryIds").EnumerateArray().Select(e => e.GetGuid()).OrderBy(g => g).ToArray());

    // Same delivery_id and eventId on the wire, so the dispatcher and the receiver dedupe as before.
    Assert.Equal(2, sent.Count);
    foreach (var (deliveryId, eventId) in new[] { enqueueFailed, orphanQueued })
    {
      var message = sent.Select(r => JsonDocument.Parse(r.MessageBody).RootElement)
        .Single(m => m.GetProperty("deliveryId").GetGuid() == deliveryId);
      Assert.Equal(eventId, message.GetProperty("eventId").GetGuid());
      Assert.Equal(live, message.GetProperty("subscriptionId").GetInt64());
      Assert.Equal("2026-01-02T03:04:05.678Z", message.GetProperty("occurredAt").GetString());
      Assert.Equal("queued", await StatusAsync(deliveryId));
      Assert.Null(await _db.ScalarAsync("select last_error from webhook_deliveries where delivery_id = $1", deliveryId));
    }
    Assert.All(sent, r => Assert.Equal(FakeQueueUrl, r.QueueUrl));

    // Everything else is untouched.
    Assert.Equal("queued", await StatusAsync(freshQueued.DeliveryId));
    Assert.Equal("enqueue_failed", await StatusAsync(freshFailed.DeliveryId));
    Assert.Equal("retrying", await StatusAsync(retrying.DeliveryId));
    Assert.Equal("queued", await StatusAsync(inFlight.DeliveryId));
    Assert.Equal("delivered", await StatusAsync(delivered.DeliveryId));
    Assert.Equal("enqueue_failed", await StatusAsync(inactiveRow.DeliveryId));
    Assert.Equal("queued", await StatusAsync(deletedRow.DeliveryId));

    // Idempotent: a second sweep right away finds nothing (the swept rows are fresh again).
    var again = await WithQueueAsync(r => { lock (sent) sent.Add(r); return Task.CompletedTask; }, async () => Data(await SweepAsync()));
    Assert.Equal(0, again.GetProperty("swept").GetInt32());
    Assert.Equal(2, sent.Count);

    // Audited.
    var audit = await _db.QueryAsync(
      "select after_state::text as after from admin_audit where action = 'webhook.deliveries.sweep' order by id desc limit 2");
    Assert.Equal(2, audit.Count);
    using var first = JsonDocument.Parse((string)audit[1]["after"]!);
    Assert.Equal(2, first.RootElement.GetProperty("swept").GetInt32());
  }

  [Fact]
  public async Task Sweep_SkipsARowSentButNeverReported()
  {
    // backend-design-13: SQS accepted the message (enqueued_at is set) but the dispatcher's report never
    // arrived, or the message still waits in a backed-up queue. The receiver may already have it, so the
    // sweep must not send it again, however old the row is.
    await _db.ScalarAsync("update webhook_subscriptions set is_active = false where deleted_at is null");
    var live = await NewSubscriptionAsync();
    var result = await WithQueueAsync(_ => Task.CompletedTask, async () =>
    {
      await using var conn = await _db.OpenAsync();
      return await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 1 });
    });
    Assert.Equal(1, result.Deliveries);
    Assert.Equal(0, result.EnqueueFailures);
    var sentRow = (Guid)(await _db.ScalarAsync("select delivery_id from webhook_deliveries where event_id = $1", result.EventId))!;
    Assert.NotNull(await _db.ScalarAsync("select enqueued_at from webhook_deliveries where delivery_id = $1", sentRow));
    await _db.ScalarAsync("update webhook_deliveries set updated_at = now() - interval '2 hours' where delivery_id = $1", sentRow);

    // Next to it, a row that never reached SQS is still swept.
    var neverSent = await SeedDeliveryAsync(live, "queued", 0, 30);

    var sent = new List<SendMessageRequest>();
    var data = await WithQueueAsync(r => { lock (sent) sent.Add(r); return Task.CompletedTask; }, async () => Data(await SweepAsync()));
    Assert.Equal(new[] { neverSent.DeliveryId }, data.GetProperty("deliveryIds").EnumerateArray().Select(e => e.GetGuid()).ToArray());
    Assert.DoesNotContain(sent, r => JsonDocument.Parse(r.MessageBody).RootElement.GetProperty("deliveryId").GetGuid() == sentRow);
    Assert.Equal("queued", await StatusAsync(sentRow));
    // The swept row now carries its hand-off marker too.
    Assert.NotNull(await _db.ScalarAsync("select enqueued_at from webhook_deliveries where delivery_id = $1", neverSent.DeliveryId));

    await _db.ScalarAsync("update webhook_subscriptions set is_active = false where id = $1", live);
  }

  [Fact]
  public async Task FailedSend_NeverRegressesAReportedRow()
  {
    // backend-design-14: the send fails (a late deadline, or a sweep re-send racing the original message)
    // after the dispatcher already delivered and reported the row: it must stay delivered.
    await _db.ScalarAsync("update webhook_subscriptions set is_active = false where deleted_at is null");
    var live = await NewSubscriptionAsync();

    var savedSecret = Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET");
    Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", "test-secret");
    try
    {
      var result = await WithQueueAsync(async r =>
      {
        var deliveryId = JsonDocument.Parse(r.MessageBody).RootElement.GetProperty("deliveryId").GetGuid();
        var report = await ReportDeliveredAsync(deliveryId);
        Assert.Equal(200, report.StatusCode);
        throw new InvalidOperationException("send timed out after SQS accepted it");
      }, async () =>
      {
        await using var conn = await _db.OpenAsync();
        return await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 1 });
      });

      Assert.Equal(1, result.EnqueueFailures);
      var row = (await _db.QueryAsync("select status, last_error, delivered_at from webhook_deliveries where event_id = $1", result.EventId)).Single();
      Assert.Equal("delivered", (string)row["status"]!);
      Assert.Null(row["last_error"]);
      Assert.NotNull(row["delivered_at"]);
    }
    finally
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", savedSecret);
      await _db.ScalarAsync("update webhook_subscriptions set is_active = false where id = $1", live);
    }
  }

  /// <summary>A signed §6.5.3 'delivered' report at attempt 1, through the report route.</summary>
  private static Task<APIGatewayProxyResponse> ReportDeliveredAsync(Guid deliveryId)
  {
    var body = JsonSerializer.Serialize(new { attempt = 1, deliveryId, durationMs = 10, error = (string?)null, outcome = "delivered", statusCode = 200 });
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);
    using var mac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes("test-secret"));
    var signature = "v1=" + Convert.ToHexString(mac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{ts}.{body}"))).ToLowerInvariant();
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/internal/webhooks/deliveries/report",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
      headers = new Dictionary<string, string>
      {
        ["content-type"] = "application/json",
        ["x-internal-timestamp"] = ts,
        ["x-internal-signature"] = signature,
      },
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    }));
    return RecallSmith.Lambda.Vpc.Internal.WebhookDeliveryReport.HandleReport(req, new Res(req.TraceId));
  }

  [Fact]
  public async Task Sweep_IsBoundedAndMarksFailedSendsAgain()
  {
    var live = await NewSubscriptionAsync();
    var rows = new List<Guid>();
    for (var i = 0; i < 3; i++) rows.Add((await SeedDeliveryAsync(live, "enqueue_failed", 0, 20 + i)).DeliveryId);

    var data = await WithQueueAsync(_ => throw new InvalidOperationException("sqs still down"), async () => Data(await SweepAsync("{\"limit\":2}")));
    Assert.Equal(2, data.GetProperty("swept").GetInt32());
    Assert.Equal(0, data.GetProperty("resent").GetInt32());
    Assert.Equal(2, data.GetProperty("enqueueFailures").GetInt32());

    // The oldest two were claimed (oldest first); a failed send leaves them enqueue_failed with the error.
    var swept = data.GetProperty("deliveryIds").EnumerateArray().Select(e => e.GetGuid()).ToHashSet();
    Assert.Equal(new[] { rows[1], rows[2] }.ToHashSet(), swept);
    foreach (var id in rows) Assert.Equal("enqueue_failed", await StatusAsync(id));
    Assert.Equal("sqs still down", await _db.ScalarAsync("select last_error from webhook_deliveries where delivery_id = $1", rows[2]));

    // The unclaimed row is still stranded; resolve it so no other sweep in this run counts it.
    await _db.ScalarAsync("update webhook_deliveries set status = 'failed' where delivery_id = $1", rows[0]);
  }

  [Fact]
  public async Task Sweep_RequiresSuperAdmin_ValidLimit_AndAQueue()
  {
    foreach (var groups in new[] { new[] { "admin" }, new[] { "editor" }, Array.Empty<string>() })
    {
      var resp = await WithQueueAsync(_ => Task.CompletedTask, () => SweepAsync(groups: groups));
      Assert.True(resp.StatusCode is 401 or 403, $"[{string.Join(",", groups)}]: {resp.StatusCode} {resp.Body}");
    }

    foreach (var bad in new[] { "{\"limit\":0}", "{\"limit\":101}", "{\"limit\":\"5\"}", "[]" })
    {
      var resp = await WithQueueAsync(_ => Task.CompletedTask, () => SweepAsync(bad));
      Assert.True(resp.StatusCode == 400, $"{bad}: {resp.StatusCode} {resp.Body}");
    }

    var get = await WithQueueAsync(_ => Task.CompletedTask, () => SweepAsync(method: "GET"));
    Assert.Equal(405, get.StatusCode);

    var noQueue = await WithQueueAsync(_ => Task.CompletedTask, () => SweepAsync(), queueUrl: null);
    Assert.Equal(503, noQueue.StatusCode);

    Assert.Equal(SweepPath, RouteMetrics.RouteFor(SweepPath));
  }

  // ---------------------------------------------------------------- deadline

  [Fact]
  public async Task Enqueue_HangingSend_ReturnsWithinTheDeadline()
  {
    // backend-design-4: a send that never completes must not hold the request; the rows become
    // enqueue_failed (and are therefore sweepable).
    await _db.ScalarAsync("update webhook_subscriptions set is_active = false where deleted_at is null");
    var subs = new List<long>();
    for (var i = 0; i < 3; i++) subs.Add(await NewSubscriptionAsync());

    var savedDeadline = WebhookEvents.SendDeadline;
    try
    {
      WebhookEvents.SendDeadline = TimeSpan.FromMilliseconds(300);
      var sw = Stopwatch.StartNew();
      var result = await WithQueueAsync(_ => Task.Delay(TimeSpan.FromSeconds(30)), async () =>
      {
        await using var conn = await _db.OpenAsync();
        return await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 1 });
      });
      sw.Stop();

      Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"enqueue took {sw.Elapsed}");
      Assert.Equal(3, result.Deliveries);
      Assert.Equal(3, result.EnqueueFailures);
      var statuses = await _db.QueryAsync(
        "select status, last_error from webhook_deliveries where event_id = $1", result.EventId);
      Assert.Equal(3, statuses.Count);
      Assert.All(statuses, r =>
      {
        Assert.Equal("enqueue_failed", (string)r["status"]!);
        Assert.StartsWith("enqueue deadline exceeded", (string)r["last_error"]!);
      });
    }
    finally
    {
      WebhookEvents.SendDeadline = savedDeadline;
      foreach (var id in subs) await _db.ScalarAsync("update webhook_subscriptions set is_active = false where id = $1", id);
    }
  }

  [Fact]
  public void SqsClientConfig_IsBounded()
  {
    var config = WebhookEvents.BoundedSqsConfig();
    Assert.Equal(TimeSpan.FromSeconds(3), config.Timeout);
    Assert.Equal(1, config.MaxErrorRetry);
    Assert.True(WebhookEvents.SendDeadline <= TimeSpan.FromSeconds(10));
  }
}
