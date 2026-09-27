using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Integrations;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The super_admin webhooks console API (R18 J03, contract §6.6) end to end against a real Postgres:
/// subscription CRUD with its validation codes, soft delete, the test event, the keyset-paginated
/// delivery log, redelivery, the super_admin gate, routing through VpcFunction, 503 on a pre-027
/// schema and audit rows that never carry the URL. Sends go through
/// <see cref="WebhookEvents.TestSendSeam"/> only.
/// </summary>
[Collection(PostgresCollection.Name)]
public class WebhookAdminRoutesTests
{
  private readonly PostgresFixture _db;
  public WebhookAdminRoutesTests(PostgresFixture db) => _db = db;

  private const string FakeQueueUrl = "https://sqs.invalid.example/000000000000/developercards-webhook-events-test";
  private const string SubscriptionsPath = "/api/v1/admin/webhooks/subscriptions";
  private const string DeliveriesPath = "/api/v1/admin/webhooks/deliveries";

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-j03-adm-{Guid.NewGuid():N}";

  private static string HookUrl() => $"https://hooks.example.com/services/it-j03/{Guid.NewGuid():N}";

  private sealed class Capture
  {
    private readonly object _gate = new();
    public List<SendMessageRequest> Sent { get; } = new();

    public Task Send(SendMessageRequest request)
    {
      lock (_gate) Sent.Add(request);
      return Task.CompletedTask;
    }

    public List<JsonElement> Messages() =>
      Sent.Select(r => JsonDocument.Parse(r.MessageBody).RootElement.Clone()).ToList();
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

  private static JsonElement Event(string method, string path, string sub, string[] groups, IDictionary<string, string>? query, string? body)
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
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  /// <summary>Through the deployed entry point: VpcFunction routes, the handler answers.</summary>
  private static Task<APIGatewayProxyResponse> CallAsync(
    string method, string path, object? body = null, IDictionary<string, string>? query = null, string[]? groups = null, string? sub = null)
  {
    var raw = body is null ? null : body as string ?? JsonSerializer.Serialize(body);
    var evt = Event(method, path, sub ?? NewSub(), groups ?? ["super_admin"], query, raw);
    return new RecallSmith.Lambda.VpcFunction().Handler(evt);
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static async Task<JsonElement> CreateAsync(object body)
  {
    var resp = await CallAsync("POST", SubscriptionsPath, body);
    Assert.True(resp.StatusCode == 200, resp.Body);
    return Data(resp);
  }

  private async Task<long> InsertSubscriptionAsync(string[] events, bool active = true)
  {
    var rows = await _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, $4) returning id",
      "it-j03-seed", HookUrl(), events, active);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<Guid> InsertDeliveryAsync(long subscriptionId, DateTimeOffset createdAt, string status = "queued", string eventType = "deck.published")
  {
    var id = Guid.NewGuid();
    await _db.ScalarAsync(
      "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, body, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      id, Guid.NewGuid(), eventType, subscriptionId, status, "{\"event\":\"x\"}", createdAt);
    return id;
  }

  private static string Id(long id) => id.ToString(CultureInfo.InvariantCulture);

  // ---------------------------------------------------------------- subscriptions

  [Fact]
  public async Task CreateSubscription_ReturnsSubscription()
  {
    var sub = NewSub();
    var url = HookUrl();
    var resp = await CallAsync("POST", SubscriptionsPath,
      new { name = "  Release hook  ", url = $"  {url}  ", events = new[] { "deck.published", "import.failed", "deck.published" }, extra = 1 },
      sub: sub);

    Assert.True(resp.StatusCode == 200, resp.Body);
    var data = Data(resp);
    Assert.Equal(new[] { "id", "name", "url", "events", "isActive", "createdAt", "updatedAt" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    var id = data.GetProperty("id").GetInt64();
    Assert.True(id > 0);
    Assert.Equal("Release hook", data.GetProperty("name").GetString());
    Assert.Equal(url, data.GetProperty("url").GetString());
    Assert.Equal(new[] { "deck.published", "import.failed" }, data.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ToArray());
    Assert.True(data.GetProperty("isActive").GetBoolean());

    var inactive = await CreateAsync(new { name = "off", url = HookUrl(), events = new[] { "card.flagged" }, isActive = false });
    Assert.False(inactive.GetProperty("isActive").GetBoolean());

    var createdBy = await _db.ScalarAsync("select created_by_sub from webhook_subscriptions where id = $1", id);
    Assert.Equal(sub, createdBy as string);

    var badName = await CallAsync("POST", SubscriptionsPath, new { name = new string('n', 81), url = HookUrl(), events = new[] { "deck.published" } });
    Assert.Equal(400, badName.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(badName));

    var blankName = await CallAsync("POST", SubscriptionsPath, new { name = "   ", url = HookUrl(), events = new[] { "deck.published" } });
    Assert.Equal("VALIDATION_ERROR", ErrorCode(blankName));

    var badActive = await CallAsync("POST", SubscriptionsPath, new { name = "x", url = HookUrl(), events = new[] { "deck.published" }, isActive = "yes" });
    Assert.Equal("VALIDATION_ERROR", ErrorCode(badActive));
  }

  [Fact]
  public async Task CreateSubscription_InvalidUrl_Is400WebhookUrlInvalid()
  {
    var name = $"it-j03-bad-{Guid.NewGuid():N}"[..30];
    foreach (var url in new object?[] { "http://hooks.example.com/x", "https://127.0.0.1/x", "https://user:pw@hooks.example.com/", "https://localhost/x", "https://[::1]/", null, 42 })
    {
      var resp = await CallAsync("POST", SubscriptionsPath, new { name, url, events = new[] { "deck.published" } });
      Assert.Equal(400, resp.StatusCode);
      Assert.Equal("WEBHOOK_URL_INVALID", ErrorCode(resp));
    }

    var count = await _db.ScalarAsync("select count(*) from webhook_subscriptions where name = $1", name);
    Assert.Equal(0L, Convert.ToInt64(count, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task CreateSubscription_UnknownEvent_Is400WebhookEventUnknown()
  {
    foreach (var events in new[] { new[] { "deck.published", "webhook.test" }, new[] { "deck.deleted" }, new[] { "Deck.Published" } })
    {
      var resp = await CallAsync("POST", SubscriptionsPath, new { name = "x", url = HookUrl(), events });
      Assert.Equal(400, resp.StatusCode);
      Assert.Equal("WEBHOOK_EVENT_UNKNOWN", ErrorCode(resp));
    }

    foreach (var events in new object[] { Array.Empty<string>(), new[] { "a", "b", "c", "d", "e" }, "deck.published", new object[] { 1 } })
    {
      var resp = await CallAsync("POST", SubscriptionsPath, new { name = "x", url = HookUrl(), events });
      Assert.Equal(400, resp.StatusCode);
      Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    }
  }

  [Fact]
  public async Task ListSubscriptions_ReturnsEventsAndSsmName()
  {
    var kept = (await CreateAsync(new { name = "kept", url = HookUrl(), events = new[] { "review.queued" } })).GetProperty("id").GetInt64();
    var gone = (await CreateAsync(new { name = "gone", url = HookUrl(), events = new[] { "review.queued" } })).GetProperty("id").GetInt64();
    Assert.Equal(200, (await CallAsync("DELETE", $"{SubscriptionsPath}/{Id(gone)}")).StatusCode);

    var resp = await CallAsync("GET", SubscriptionsPath);
    Assert.Equal(200, resp.StatusCode);
    var data = Data(resp);

    Assert.Equal(new[] { "deck.published", "import.failed", "card.flagged", "review.queued" },
      data.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ToArray());
    Assert.Equal("/developercards/prod/webhook-signing-secret", data.GetProperty("signingSecretSsmName").GetString());

    var ids = data.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).ToList();
    Assert.Contains(kept, ids);
    Assert.DoesNotContain(gone, ids);
    Assert.Equal(ids.OrderBy(i => i), ids);
  }

  [Fact]
  public async Task UpdateSubscription_PartialUpdate()
  {
    var url = HookUrl();
    var created = await CreateAsync(new { name = "before", url, events = new[] { "deck.published" } });
    var id = created.GetProperty("id").GetInt64();
    var path = $"{SubscriptionsPath}/{Id(id)}";

    var off = await CallAsync("PUT", path, new { isActive = false });
    Assert.True(off.StatusCode == 200, off.Body);
    var offData = Data(off);
    Assert.False(offData.GetProperty("isActive").GetBoolean());
    Assert.Equal("before", offData.GetProperty("name").GetString());
    Assert.Equal(url, offData.GetProperty("url").GetString());
    Assert.Equal(new[] { "deck.published" }, offData.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ToArray());
    Assert.True(offData.GetProperty("updatedAt").GetDateTime() >= created.GetProperty("updatedAt").GetDateTime());

    var renamed = await CallAsync("PUT", path, new { name = " after ", events = new[] { "card.flagged", "review.queued" } });
    Assert.Equal(200, renamed.StatusCode);
    var renamedData = Data(renamed);
    Assert.Equal("after", renamedData.GetProperty("name").GetString());
    Assert.Equal(new[] { "card.flagged", "review.queued" }, renamedData.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ToArray());
    Assert.False(renamedData.GetProperty("isActive").GetBoolean());
    Assert.Equal(url, renamedData.GetProperty("url").GetString());

    var badUrl = await CallAsync("PUT", path, new { url = "https://10.0.0.1/x" });
    Assert.Equal("WEBHOOK_URL_INVALID", ErrorCode(badUrl));
    var badEvent = await CallAsync("PUT", path, new { events = new[] { "webhook.test" } });
    Assert.Equal("WEBHOOK_EVENT_UNKNOWN", ErrorCode(badEvent));
    var badName = await CallAsync("PUT", path, new { name = 5 });
    Assert.Equal("VALIDATION_ERROR", ErrorCode(badName));

    var stored = await _db.QueryAsync("select name, url from webhook_subscriptions where id = $1", id);
    Assert.Equal("after", (string)stored[0]["name"]!);
    Assert.Equal(url, (string)stored[0]["url"]!);
  }

  [Fact]
  public async Task UpdateSubscription_Unknown_Is404()
  {
    var unknown = await CallAsync("PUT", $"{SubscriptionsPath}/987654321012", new { name = "x" });
    Assert.Equal(404, unknown.StatusCode);
    Assert.Equal("SUBSCRIPTION_NOT_FOUND", ErrorCode(unknown));

    var id = (await CreateAsync(new { name = "doomed", url = HookUrl(), events = new[] { "deck.published" } })).GetProperty("id").GetInt64();
    Assert.Equal(200, (await CallAsync("DELETE", $"{SubscriptionsPath}/{Id(id)}")).StatusCode);
    var deleted = await CallAsync("PUT", $"{SubscriptionsPath}/{Id(id)}", new { name = "x" });
    Assert.Equal(404, deleted.StatusCode);
    Assert.Equal("SUBSCRIPTION_NOT_FOUND", ErrorCode(deleted));

    foreach (var bad in new[] { "abc", "0", "-3", "1.5" })
    {
      var resp = await CallAsync("PUT", $"{SubscriptionsPath}/{bad}", new { name = "x" });
      Assert.Equal(400, resp.StatusCode);
      Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    }
  }

  [Fact]
  public async Task DeleteSubscription_SoftDeletes()
  {
    var id = (await CreateAsync(new { name = "soft", url = HookUrl(), events = new[] { "deck.published" } })).GetProperty("id").GetInt64();

    var resp = await CallAsync("DELETE", $"{SubscriptionsPath}/{Id(id)}");
    Assert.Equal(200, resp.StatusCode);
    var data = Data(resp);
    Assert.Equal(id, data.GetProperty("id").GetInt64());
    Assert.True(data.GetProperty("deleted").GetBoolean());

    var rows = await _db.QueryAsync("select deleted_at, is_active from webhook_subscriptions where id = $1", id);
    var row = Assert.Single(rows);
    Assert.NotNull(row["deleted_at"]);
    Assert.False((bool)row["is_active"]!);

    var again = await CallAsync("DELETE", $"{SubscriptionsPath}/{Id(id)}");
    Assert.Equal(404, again.StatusCode);
    Assert.Equal("SUBSCRIPTION_NOT_FOUND", ErrorCode(again));
  }

  // ---------------------------------------------------------------- test event

  [Fact]
  public async Task TestRoute_EnqueuesOnlyToThatSubscription()
  {
    await DeactivateAllAsync();
    var target = await InsertSubscriptionAsync(["deck.published"], active: false);
    var bystander = await InsertSubscriptionAsync(["deck.published"]);

    var capture = new Capture();
    APIGatewayProxyResponse? resp = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      resp = await CallAsync("POST", $"{SubscriptionsPath}/{Id(target)}/test");
    });

    Assert.True(resp!.StatusCode == 200, resp.Body);
    var data = Data(resp);
    var eventId = data.GetProperty("eventId").GetGuid();
    var deliveryId = data.GetProperty("deliveryId").GetGuid();

    var message = Assert.Single(capture.Messages());
    Assert.Equal(target, message.GetProperty("subscriptionId").GetInt64());
    Assert.NotEqual(bystander, message.GetProperty("subscriptionId").GetInt64());
    Assert.Equal("webhook.test", message.GetProperty("event").GetString());
    Assert.Equal(deliveryId, message.GetProperty("deliveryId").GetGuid());
    Assert.Equal(eventId, message.GetProperty("eventId").GetGuid());

    using var body = JsonDocument.Parse(message.GetProperty("body").GetString()!);
    var payload = body.RootElement.GetProperty("data");
    Assert.Equal(target, payload.GetProperty("subscriptionId").GetInt64());
    Assert.Equal("DeveloperCards test event", payload.GetProperty("message").GetString());

    var rows = await _db.QueryAsync("select subscription_id, event, status from webhook_deliveries where event_id = $1", eventId);
    var row = Assert.Single(rows);
    Assert.Equal(target, Convert.ToInt64(row["subscription_id"], CultureInfo.InvariantCulture));
    Assert.Equal("webhook.test", (string)row["event"]!);
    Assert.Equal("queued", (string)row["status"]!);
  }

  [Fact]
  public async Task TestRoute_NoQueueUrl_Is503()
  {
    var id = await InsertSubscriptionAsync(["deck.published"]);
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    try
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, null);

      var resp = await CallAsync("POST", $"{SubscriptionsPath}/{Id(id)}/test");
      Assert.Equal(503, resp.StatusCode);
      Assert.Equal("WEBHOOKS_NOT_CONFIGURED", ErrorCode(resp));

      // Existence is checked first.
      var unknown = await CallAsync("POST", $"{SubscriptionsPath}/987654321013/test");
      Assert.Equal(404, unknown.StatusCode);
      Assert.Equal("SUBSCRIPTION_NOT_FOUND", ErrorCode(unknown));
    }
    finally
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
    }

    var count = await _db.ScalarAsync("select count(*) from webhook_deliveries where subscription_id = $1", id);
    Assert.Equal(0L, Convert.ToInt64(count, CultureInfo.InvariantCulture));
  }

  // ---------------------------------------------------------------- deliveries

  [Fact]
  public async Task ListDeliveries_ReturnsEnqueuedAt()
  {
    // backend-design-21: the console tells a stranded queued row (never handed to SQS) from one in flight by
    // enqueued_at, the field the sweep's predicate keys on.
    var sub = await InsertSubscriptionAsync(["deck.published"]);
    var stranded = await InsertDeliveryAsync(sub, DateTimeOffset.UtcNow.AddMinutes(-20));
    var inFlight = await InsertDeliveryAsync(sub, DateTimeOffset.UtcNow.AddMinutes(-19));
    await _db.QueryAsync("update webhook_deliveries set enqueued_at = now() - interval '19 minutes' where delivery_id = $1", inFlight);

    var items = Data(await CallAsync("GET", DeliveriesPath, query: new Dictionary<string, string> { ["subscriptionId"] = Id(sub) }))
      .GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("deliveryId").GetGuid());
    Assert.Equal(JsonValueKind.Null, items[stranded].GetProperty("enqueuedAt").ValueKind);
    Assert.Equal(JsonValueKind.String, items[inFlight].GetProperty("enqueuedAt").ValueKind);
    Assert.True(items[inFlight].GetProperty("enqueuedAt").GetDateTimeOffset() < DateTimeOffset.UtcNow.AddMinutes(-18));
  }

  [Fact]
  public async Task ListDeliveries_FiltersAndPaginates()
  {
    var sub = await InsertSubscriptionAsync(["deck.published", "import.failed"]);
    var t0 = DateTimeOffset.UtcNow.AddMinutes(-30);
    var shared = t0.AddSeconds(10);
    var inserted = new List<Guid>
    {
      await InsertDeliveryAsync(sub, t0),
      await InsertDeliveryAsync(sub, shared, "failed"),
      await InsertDeliveryAsync(sub, shared, "delivered"),
      await InsertDeliveryAsync(sub, shared),
      await InsertDeliveryAsync(sub, t0.AddSeconds(20), "failed", "import.failed"),
      await InsertDeliveryAsync(sub, t0.AddSeconds(30).AddTicks(7), "dead"),
      await InsertDeliveryAsync(sub, t0.AddSeconds(40)),
    };

    var expected = (await _db.QueryAsync(
        "select delivery_id from webhook_deliveries where subscription_id = $1 order by created_at desc, delivery_id desc", sub))
      .Select(r => (Guid)r["delivery_id"]!).ToList();
    Assert.Equal(inserted.OrderBy(g => g), expected.OrderBy(g => g));

    var seen = new List<Guid>();
    string? cursor = null;
    var pages = 0;
    do
    {
      var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["subscriptionId"] = Id(sub), ["limit"] = "2" };
      if (cursor is not null) query["cursor"] = cursor;
      var resp = await CallAsync("GET", DeliveriesPath, query: query);
      Assert.True(resp.StatusCode == 200, resp.Body);
      var data = Data(resp);
      var items = data.GetProperty("items").EnumerateArray().ToList();
      foreach (var item in items)
      {
        Assert.Equal(
          new[] { "deliveryId", "eventId", "event", "subscriptionId", "status", "attempts", "lastStatusCode", "lastError", "createdAt", "updatedAt", "deliveredAt", "enqueuedAt" },
          item.EnumerateObject().Select(p => p.Name).ToArray());
        seen.Add(item.GetProperty("deliveryId").GetGuid());
      }
      cursor = data.GetProperty("nextCursor").ValueKind == JsonValueKind.Null ? null : data.GetProperty("nextCursor").GetString();
      if (items.Count < 2) Assert.Null(cursor);
      pages++;
      Assert.True(pages < 10, "pagination did not terminate");
    }
    while (cursor is not null);

    Assert.True(pages >= 3);
    Assert.Equal(expected, seen);

    var failed = Data(await CallAsync("GET", DeliveriesPath, query: new Dictionary<string, string> { ["subscriptionId"] = Id(sub), ["status"] = "failed" }));
    Assert.Equal(2, failed.GetProperty("items").GetArrayLength());
    Assert.True(failed.GetProperty("nextCursor").ValueKind == JsonValueKind.Null);

    var imports = Data(await CallAsync("GET", DeliveriesPath, query: new Dictionary<string, string> { ["subscriptionId"] = Id(sub), ["event"] = "import.failed" }));
    Assert.Single(imports.GetProperty("items").EnumerateArray());

    foreach (var (key, value) in new[]
    {
      ("limit", "0"), ("limit", "101"), ("limit", "x"), ("status", "sent"), ("event", "deck.deleted"),
      ("subscriptionId", "abc"), ("cursor", "!!!"), ("cursor", "eyJ2IjoyfQ"),
    })
    {
      var resp = await CallAsync("GET", DeliveriesPath, query: new Dictionary<string, string> { [key] = value });
      Assert.Equal(400, resp.StatusCode);
      Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    }

    Assert.DoesNotContain("\"body\"", (await CallAsync("GET", DeliveriesPath)).Body, StringComparison.Ordinal);
  }

  [Fact]
  public async Task Redeliver_CopiesBodyWithNewDeliveryId()
  {
    await DeactivateAllAsync();
    var sub = await InsertSubscriptionAsync(["deck.published"]);

    var capture = new Capture();
    Guid original = Guid.Empty;
    Guid eventId = Guid.Empty;
    APIGatewayProxyResponse? resp = null;
    await WithQueueAsync(capture.Send, async () =>
    {
      await using (var conn = await _db.OpenAsync())
      {
        var result = await WebhookEvents.EnqueueAsync(conn, "deck.published", new { deckId = 3 });
        eventId = result.EventId;
      }
      original = (Guid)(await _db.ScalarAsync("select delivery_id from webhook_deliveries where event_id = $1", eventId))!;
      await _db.ScalarAsync("update webhook_deliveries set status = 'dead', attempts = 5, last_error = 'HTTP 500' where delivery_id = $1", original);

      resp = await CallAsync("POST", $"{DeliveriesPath}/{original}/redeliver");
    });

    Assert.True(resp!.StatusCode == 200, resp.Body);
    var data = Data(resp);
    var copy = data.GetProperty("deliveryId").GetGuid();
    Assert.NotEqual(original, copy);
    Assert.Equal(eventId, data.GetProperty("eventId").GetGuid());

    var rows = await _db.QueryAsync(
      "select delivery_id, event_id, event, subscription_id, status, attempts, body, last_error from webhook_deliveries where event_id = $1 order by created_at", eventId);
    Assert.Equal(2, rows.Count);
    var src = rows.Single(r => (Guid)r["delivery_id"]! == original);
    var dup = rows.Single(r => (Guid)r["delivery_id"]! == copy);
    Assert.Equal((string)src["body"]!, (string)dup["body"]!);
    Assert.Equal((string)src["event"]!, (string)dup["event"]!);
    Assert.Equal(sub, Convert.ToInt64(dup["subscription_id"], CultureInfo.InvariantCulture));
    Assert.Equal("queued", (string)dup["status"]!);
    Assert.Equal(0, Convert.ToInt32(dup["attempts"], CultureInfo.InvariantCulture));
    Assert.Null(dup["last_error"]);
    Assert.Equal("dead", (string)src["status"]!);

    Assert.Equal(2, capture.Sent.Count);
    var resent = capture.Messages()[1];
    Assert.Equal(copy, resent.GetProperty("deliveryId").GetGuid());
    Assert.Equal(eventId, resent.GetProperty("eventId").GetGuid());
    Assert.Equal((string)src["body"]!, resent.GetProperty("body").GetString());
    Assert.Equal(capture.Messages()[0].GetProperty("occurredAt").GetString(), resent.GetProperty("occurredAt").GetString());

    var notUuid = await CallAsync("POST", $"{DeliveriesPath}/not-a-uuid/redeliver");
    Assert.Equal(400, notUuid.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(notUuid));

    var unknown = await CallAsync("POST", $"{DeliveriesPath}/{Guid.NewGuid()}/redeliver");
    Assert.Equal(404, unknown.StatusCode);
    Assert.Equal("DELIVERY_NOT_FOUND", ErrorCode(unknown));
  }

  [Fact]
  public async Task Redeliver_InactiveSubscription_Is409()
  {
    var inactive = await InsertSubscriptionAsync(["deck.published"]);
    var d1 = await InsertDeliveryAsync(inactive, DateTimeOffset.UtcNow, "failed");
    await _db.ScalarAsync("update webhook_subscriptions set is_active = false where id = $1", inactive);

    var deleted = await InsertSubscriptionAsync(["deck.published"]);
    var d2 = await InsertDeliveryAsync(deleted, DateTimeOffset.UtcNow, "failed");
    await _db.ScalarAsync("update webhook_subscriptions set deleted_at = now(), is_active = false where id = $1", deleted);

    var capture = new Capture();
    await WithQueueAsync(capture.Send, async () =>
    {
      foreach (var d in new[] { d1, d2 })
      {
        var resp = await CallAsync("POST", $"{DeliveriesPath}/{d}/redeliver");
        Assert.Equal(409, resp.StatusCode);
        Assert.Equal("SUBSCRIPTION_INACTIVE", ErrorCode(resp));
      }
    });

    Assert.Empty(capture.Sent);
    var count = await _db.ScalarAsync("select count(*) from webhook_deliveries where subscription_id = any($1)", new[] { inactive, deleted });
    Assert.Equal(2L, Convert.ToInt64(count, CultureInfo.InvariantCulture));
  }

  // ---------------------------------------------------------------- gate, routing, schema, audit

  private static IEnumerable<(string Method, string Path)> AllRoutes(long subscriptionId, Guid deliveryId) =>
  [
    ("GET", SubscriptionsPath),
    ("POST", SubscriptionsPath),
    ("PUT", $"{SubscriptionsPath}/{Id(subscriptionId)}"),
    ("DELETE", $"{SubscriptionsPath}/{Id(subscriptionId)}"),
    ("POST", $"{SubscriptionsPath}/{Id(subscriptionId)}/test"),
    ("GET", DeliveriesPath),
    ("POST", $"{DeliveriesPath}/{deliveryId}/redeliver"),
  ];

  [Fact]
  public async Task WebhookRoutes_RequireSuperAdmin()
  {
    var sub = await InsertSubscriptionAsync(["deck.published"]);
    var delivery = await InsertDeliveryAsync(sub, DateTimeOffset.UtcNow);

    foreach (var (method, path) in AllRoutes(sub, delivery))
    {
      var body = method is "POST" or "PUT" ? new { name = "x", url = HookUrl(), events = new[] { "deck.published" } } : null;
      var resp = await CallAsync(method, path, body, groups: ["editor"]);
      Assert.True(resp.StatusCode == 403, $"{method} {path} as editor returned {resp.StatusCode}: {resp.Body}");
    }

    var stillThere = await _db.QueryAsync("select deleted_at, name from webhook_subscriptions where id = $1", sub);
    Assert.Null(stillThere[0]["deleted_at"]);
    Assert.Equal("it-j03-seed", (string)stillThere[0]["name"]!);
  }

  [Fact]
  public async Task WebhookRoutes_AreRoutedByVpcFunction()
  {
    Assert.Equal(200, (await CallAsync("GET", SubscriptionsPath)).StatusCode);
    Assert.Equal(200, (await CallAsync("GET", DeliveriesPath)).StatusCode);
    Assert.Equal(405, (await CallAsync("PATCH", SubscriptionsPath)).StatusCode);
    Assert.Equal(405, (await CallAsync("POST", DeliveriesPath)).StatusCode);
    Assert.Equal(405, (await CallAsync("GET", $"{SubscriptionsPath}/1")).StatusCode);
    Assert.Equal(405, (await CallAsync("GET", $"{SubscriptionsPath}/1/test")).StatusCode);
    Assert.Equal(405, (await CallAsync("GET", $"{DeliveriesPath}/{Guid.NewGuid()}/redeliver")).StatusCode);

    var put = await CallAsync("PUT", $"{SubscriptionsPath}/abc", new { name = "x" });
    Assert.Equal("VALIDATION_ERROR", ErrorCode(put));
    var test = await CallAsync("POST", $"{SubscriptionsPath}/987654321014/test");
    Assert.Equal("SUBSCRIPTION_NOT_FOUND", ErrorCode(test));
    var redeliver = await CallAsync("POST", $"{DeliveriesPath}/{Guid.NewGuid()}/redeliver");
    Assert.Equal("DELIVERY_NOT_FOUND", ErrorCode(redeliver));

    // A trailing slash is stripped by the dispatcher.
    Assert.Equal(200, (await CallAsync("GET", SubscriptionsPath + "/")).StatusCode);
  }

  [Fact]
  public async Task WebhookRoutes_MissingTables_Is503()
  {
    const string scratchName = "j03_pre027_routes";
    var scratch = await _db.CreateScratchDatabaseAsync(scratchName);
    await using (var conn = new NpgsqlConnection(scratch))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 26);
    }

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    var savedSeam = WebhookEvents.TestSendSeam;
    var capture = new Capture();
    try
    {
      WebhookEvents.TestSendSeam = capture.Send;
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, FakeQueueUrl);
      Environment.SetEnvironmentVariable("PGDATABASE", scratchName);
      Pg.Reset();

      foreach (var (method, path) in AllRoutes(1, Guid.NewGuid()))
      {
        var body = method is "POST" or "PUT" ? new { name = "x", url = HookUrl(), events = new[] { "deck.published" } } : null;
        var resp = await CallAsync(method, path, body);
        Assert.True(resp.StatusCode == 503, $"{method} {path} returned {resp.StatusCode}: {resp.Body}");
        Assert.Equal("SERVER_NOT_READY_WEBHOOKS", ErrorCode(resp));
      }
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
      WebhookEvents.TestSendSeam = savedSeam;
      Pg.Reset();
    }

    Assert.Empty(capture.Sent);
  }

  [Fact]
  public async Task SubscriptionMutations_WriteAuditRowsWithoutUrl()
  {
    var secretPath1 = $"/services/T0/B0/{Guid.NewGuid():N}";
    var secretPath2 = $"/workflows/{Guid.NewGuid():N}";
    var actor = NewSub();

    var created = await CallAsync("POST", SubscriptionsPath,
      new { name = "audited", url = "https://hooks.slack.example.com" + secretPath1, events = new[] { "deck.published" } }, sub: actor);
    Assert.Equal(200, created.StatusCode);
    var id = Data(created).GetProperty("id").GetInt64();
    var path = $"{SubscriptionsPath}/{Id(id)}";

    Assert.Equal(200, (await CallAsync("PUT", path, new { name = "audited 2", url = "https://teams.example.org" + secretPath2 }, sub: actor)).StatusCode);
    Assert.Equal(200, (await CallAsync("DELETE", path, sub: actor)).StatusCode);

    var rows = await _db.QueryAsync(
      "select action, actor_sub, before_state::text as before, after_state::text as after from admin_audit where target = $1 order by id",
      $"webhook_subscription:{Id(id)}");
    Assert.Equal(new[] { "webhook.subscription.create", "webhook.subscription.update", "webhook.subscription.delete" },
      rows.Select(r => (string)r["action"]!).ToArray());
    Assert.All(rows, r => Assert.Equal(actor, r["actor_sub"] as string));

    foreach (var r in rows)
    {
      foreach (var state in new[] { r["before"] as string, r["after"] as string })
      {
        if (state is null) continue;
        Assert.DoesNotContain(secretPath1, state, StringComparison.Ordinal);
        Assert.DoesNotContain(secretPath2, state, StringComparison.Ordinal);
        Assert.DoesNotContain("\"url\"", state, StringComparison.Ordinal);
      }
    }

    Assert.Null(rows[0]["before"]);
    Assert.Contains("hooks.slack.example.com", (string)rows[0]["after"]!, StringComparison.Ordinal);
    Assert.Contains("teams.example.org", (string)rows[1]["after"]!, StringComparison.Ordinal);
    using var deletedAfter = JsonDocument.Parse((string)rows[2]["after"]!);
    Assert.False(deletedAfter.RootElement.GetProperty("isActive").GetBoolean());
  }
}
