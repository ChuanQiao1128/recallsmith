using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Internal;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// POST /api/internal/webhooks/deliveries/report (R18 J03, contract §6.5.3) against a real Postgres:
/// the dispatcher's per-attempt report, HMAC-signed exactly as §4.3 says (the test vector goes through
/// the same signing helper as the live requests), the status mapping, the never-backwards rule for a
/// delivered row, the stop flag, and the 403/404/400 answers. The shared secret is the fake
/// <c>test-secret</c>, set per test and restored in finally.
/// </summary>
[Collection(PostgresCollection.Name)]
public class WebhookDeliveryReportTests
{
  private readonly PostgresFixture _db;
  public WebhookDeliveryReportTests(PostgresFixture db) => _db = db;

  private const string ReportPath = "/api/internal/webhooks/deliveries/report";
  private const string FakeSecret = "test-secret";

  // ---------------------------------------------------------------- helpers

  /// <summary>The §4.3 signature: <c>v1=</c> + lowercase hex HMAC-SHA256(secret, "{ts}.{body}").</summary>
  private static string Sign(string secret, long timestampMs, string body)
  {
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var hash = mac.ComputeHash(Encoding.UTF8.GetBytes($"{timestampMs.ToString(CultureInfo.InvariantCulture)}.{body}"));
    return "v1=" + Convert.ToHexString(hash).ToLowerInvariant();
  }

  private static JsonElement Event(string body, string? signature = null, long? timestampMs = null, string method = "POST", string path = ReportPath)
  {
    var ts = timestampMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      },
      headers = new Dictionary<string, string>
      {
        ["content-type"] = "application/json",
        ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
        ["x-internal-signature"] = signature ?? Sign(FakeSecret, ts, body),
      },
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<T> WithSecretAsync<T>(Func<Task<T>> body)
  {
    var saved = Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET");
    try
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", FakeSecret);
      return await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", saved);
    }
  }

  private static Task<APIGatewayProxyResponse> ReportAsync(string body, string? signature = null, string method = "POST") =>
    WithSecretAsync(() =>
    {
      var req = new LambdaRequest(Event(body, signature, method: method));
      return WebhookDeliveryReport.HandleReport(req, new Res(req.TraceId));
    });

  private static string Body(Guid deliveryId, int attempt, string outcome, int? statusCode, string? error, int durationMs = 120) =>
    JsonSerializer.Serialize(new { attempt, deliveryId, durationMs, error, outcome, statusCode });

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private async Task<(long SubscriptionId, Guid DeliveryId)> SeedAsync(bool active = true)
  {
    var rows = await _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, $4) returning id",
      "it-j03-report", $"https://hooks.example.com/report/{Guid.NewGuid():N}", new[] { "deck.published" }, active);
    var subscriptionId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
    var deliveryId = Guid.NewGuid();
    await _db.ScalarAsync(
      "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, body) values ($1, $2, $3, $4, 'queued', $5)",
      deliveryId, Guid.NewGuid(), "deck.published", subscriptionId, "{\"event\":\"deck.published\"}");
    return (subscriptionId, deliveryId);
  }

  private async Task<Dictionary<string, object?>> RowAsync(Guid deliveryId) =>
    (await _db.QueryAsync(
      "select status, attempts, last_status_code, last_error, delivered_at, updated_at from webhook_deliveries where delivery_id = $1",
      deliveryId)).Single();

  // ---------------------------------------------------------------- tests

  [Fact]
  public void InternalSignature_TestVector_MatchesContract()
  {
    Assert.Equal(
      "v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85",
      Sign("test-secret", 1790000000000, "{\"a\":1}"));
  }

  [Fact]
  public async Task Report_Retry_UpdatesAttemptsStatusAndError()
  {
    var (_, deliveryId) = await SeedAsync();

    var resp = await ReportAsync(Body(deliveryId, 1, "retry", 503, "HTTP 503"));
    Assert.True(resp.StatusCode == 200, resp.Body);
    var data = Data(resp);
    Assert.Equal(new[] { "deliveryId", "status", "stop" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(deliveryId, data.GetProperty("deliveryId").GetGuid());
    Assert.Equal("retrying", data.GetProperty("status").GetString());
    Assert.False(data.GetProperty("stop").GetBoolean());

    var row = await RowAsync(deliveryId);
    Assert.Equal("retrying", (string)row["status"]!);
    Assert.Equal(1, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
    Assert.Equal(503, Convert.ToInt32(row["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Equal("HTTP 503", (string)row["last_error"]!);
    Assert.Null(row["delivered_at"]);

    // A timeout: no status code; a long error is truncated to 500, not rejected.
    var longError = new string('e', 900);
    var second = await ReportAsync(Body(deliveryId, 3, "retry", null, longError));
    Assert.Equal(200, second.StatusCode);
    row = await RowAsync(deliveryId);
    Assert.Equal(3, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
    Assert.Null(row["last_status_code"]);
    Assert.Equal(500, ((string)row["last_error"]!).Length);

    // attempts never shrinks on an out-of-order report.
    await ReportAsync(Body(deliveryId, 2, "retry", 502, "late"));
    row = await RowAsync(deliveryId);
    Assert.Equal(3, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));

    var dead = await ReportAsync(Body(deliveryId, 5, "dead", 500, "HTTP 500"));
    Assert.Equal("dead", Data(dead).GetProperty("status").GetString());
    // 'dead' is terminal (backend-design-8), so a failed outcome is checked on a fresh delivery.
    var (_, otherDelivery) = await SeedAsync();
    var failed = await ReportAsync(Body(otherDelivery, 5, "failed", 404, "HTTP 404"));
    Assert.Equal("failed", Data(failed).GetProperty("status").GetString());
  }

  [Fact]
  public async Task Report_TerminalStates_AreSticky_AndStaleAttemptsIgnored()
  {
    // backend-design-8 / automation-9: a stale or duplicate report never regresses a terminal row.
    var (_, deadDelivery) = await SeedAsync();
    Assert.Equal(200, (await ReportAsync(Body(deadDelivery, 5, "dead", 500, "HTTP 500"))).StatusCode);
    var late = await ReportAsync(Body(deadDelivery, 4, "retry", 503, "late retry"));
    Assert.Equal(200, late.StatusCode);
    Assert.Equal("dead", Data(late).GetProperty("status").GetString());
    var dup = await ReportAsync(Body(deadDelivery, 5, "retry", 503, "duplicate"));
    Assert.Equal("dead", Data(dup).GetProperty("status").GetString());
    var dead = await RowAsync(deadDelivery);
    Assert.Equal("dead", (string)dead["status"]!);
    Assert.Equal(5, Convert.ToInt32(dead["attempts"], CultureInfo.InvariantCulture));
    Assert.Equal(500, Convert.ToInt32(dead["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Equal("HTTP 500", (string)dead["last_error"]!);

    var (_, failedDelivery) = await SeedAsync();
    Assert.Equal(200, (await ReportAsync(Body(failedDelivery, 3, "failed", 404, "HTTP 404"))).StatusCode);
    foreach (var outcome in new[] { "retry", "dead", "delivered" })
    {
      var resp = await ReportAsync(Body(failedDelivery, 2, outcome, 200, "stale"));
      Assert.Equal("failed", Data(resp).GetProperty("status").GetString());
    }
    var failed = await RowAsync(failedDelivery);
    Assert.Equal("failed", (string)failed["status"]!);
    Assert.Equal(3, Convert.ToInt32(failed["attempts"], CultureInfo.InvariantCulture));
    Assert.Equal(404, Convert.ToInt32(failed["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Equal("HTTP 404", (string)failed["last_error"]!);
    Assert.Null(failed["delivered_at"]);

    // A stale retry on a non-terminal row keeps the newer attempt's code and error.
    var (_, retrying) = await SeedAsync();
    await ReportAsync(Body(retrying, 3, "retry", 503, "attempt 3"));
    var stale = await ReportAsync(Body(retrying, 2, "retry", 502, "attempt 2"));
    Assert.Equal("retrying", Data(stale).GetProperty("status").GetString());
    var row = await RowAsync(retrying);
    Assert.Equal(503, Convert.ToInt32(row["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Equal("attempt 3", (string)row["last_error"]!);
  }

  [Fact]
  public async Task Report_DeadThenDelivered_AfterRedrive_IsDelivered_AndCountsOnce()
  {
    // automation-12: the dispatcher README's DLQ redrive sends a dead message back to the source queue,
    // where its attempt count starts again. Its later success must win over 'dead' and count once.
    var (subscriptionId, deliveryId) = await SeedAsync();
    var eventId = (Guid)(await _db.QueryAsync("select event_id from webhook_deliveries where delivery_id = $1", deliveryId)).Single()["event_id"]!;

    Assert.Equal("dead", Data(await ReportAsync(Body(deliveryId, 5, "dead", 502, "HTTP 502"))).GetProperty("status").GetString());

    var redriven = await ReportAsync(Body(deliveryId, 1, "delivered", 200, null));
    Assert.Equal(200, redriven.StatusCode);
    Assert.Equal("delivered", Data(redriven).GetProperty("status").GetString());
    var row = await RowAsync(deliveryId);
    Assert.Equal("delivered", (string)row["status"]!);
    Assert.NotNull(row["delivered_at"]);
    Assert.Equal(200, Convert.ToInt32(row["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Null(row["last_error"]);
    Assert.Equal(5, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));

    // A second success (the redriven message run twice) keeps the first delivered_at and adds no unit.
    Assert.Equal("delivered", Data(await ReportAsync(Body(deliveryId, 6, "delivered", 200, null))).GetProperty("status").GetString());
    var again = await RowAsync(deliveryId);
    Assert.Equal(row["delivered_at"], again["delivered_at"]);

    var key = $"webhook:{eventId:D}:{subscriptionId.ToString(CultureInfo.InvariantCulture)}";
    var units = await _db.QueryAsync("select units from automation_events where dedupe_key = $1", key);
    Assert.Equal(1, Convert.ToInt32(Assert.Single(units)["units"], CultureInfo.InvariantCulture));

    // Dead still holds against a later retry or failure.
    var (_, other) = await SeedAsync();
    await ReportAsync(Body(other, 5, "dead", 500, "HTTP 500"));
    foreach (var outcome in new[] { "retry", "failed" })
    {
      Assert.Equal("dead", Data(await ReportAsync(Body(other, 1, outcome, 503, "redriven"))).GetProperty("status").GetString());
    }
  }

  [Fact]
  public async Task Report_Delivered_IsNeverMovedBackwards()
  {
    var (_, deliveryId) = await SeedAsync();

    var delivered = await ReportAsync(Body(deliveryId, 2, "delivered", 200, null));
    Assert.Equal(200, delivered.StatusCode);
    Assert.Equal("delivered", Data(delivered).GetProperty("status").GetString());
    var first = await RowAsync(deliveryId);
    Assert.Equal("delivered", (string)first["status"]!);
    Assert.NotNull(first["delivered_at"]);
    Assert.Equal(200, Convert.ToInt32(first["last_status_code"], CultureInfo.InvariantCulture));

    foreach (var outcome in new[] { "retry", "failed", "dead", "delivered" })
    {
      var resp = await ReportAsync(Body(deliveryId, 4, outcome, 500, "late report"));
      Assert.Equal(200, resp.StatusCode);
      Assert.Equal("delivered", Data(resp).GetProperty("status").GetString());
    }

    var after = await RowAsync(deliveryId);
    Assert.Equal("delivered", (string)after["status"]!);
    Assert.Equal(4, Convert.ToInt32(after["attempts"], CultureInfo.InvariantCulture));
    Assert.Equal(first["delivered_at"], after["delivered_at"]);
    Assert.Equal(200, Convert.ToInt32(after["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Null(after["last_error"]);
  }

  [Fact]
  public async Task Report_InactiveSubscription_ReturnsStop()
  {
    var (inactiveSub, inactiveDelivery) = await SeedAsync(active: false);
    var resp = await ReportAsync(Body(inactiveDelivery, 1, "retry", 500, "HTTP 500"));
    Assert.Equal(200, resp.StatusCode);
    Assert.True(Data(resp).GetProperty("stop").GetBoolean());

    var (deletedSub, deletedDelivery) = await SeedAsync();
    await _db.ScalarAsync("update webhook_subscriptions set deleted_at = now(), is_active = false where id = $1", deletedSub);
    var deleted = await ReportAsync(Body(deletedDelivery, 1, "retry", 500, "HTTP 500"));
    Assert.True(Data(deleted).GetProperty("stop").GetBoolean());

    // backend-design-3: the dispatcher acks on stop, so the row must be terminal, not 'retrying'.
    foreach (var (delivery, reported) in new[] { (inactiveDelivery, resp), (deletedDelivery, deleted) })
    {
      Assert.Equal("failed", Data(reported).GetProperty("status").GetString());
      var row = await RowAsync(delivery);
      Assert.Equal("failed", (string)row["status"]!);
      Assert.Equal(WebhookDeliveryReport.SubscriptionInactiveError, (string)row["last_error"]!);
      Assert.Equal(1, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
    }

    // Other outcomes for an inactive subscription are recorded as reported.
    var (_, inactiveDead) = await SeedAsync(active: false);
    var deadResp = await ReportAsync(Body(inactiveDead, 5, "dead", 500, "HTTP 500"));
    Assert.Equal("dead", Data(deadResp).GetProperty("status").GetString());
    Assert.Equal("HTTP 500", (string)(await RowAsync(inactiveDead))["last_error"]!);

    Assert.NotEqual(inactiveSub, deletedSub);
  }

  [Fact]
  public async Task Report_BadSignature_Is403()
  {
    var (_, deliveryId) = await SeedAsync();
    var body = Body(deliveryId, 1, "delivered", 200, null);
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    foreach (var signature in new[] { Sign("wrong-secret", ts, body), Sign(FakeSecret, ts, body + " "), "v1=00", "" })
    {
      var resp = await ReportAsync(body, signature);
      Assert.Equal(403, resp.StatusCode);
      Assert.Equal("FORBIDDEN", ErrorCode(resp));
    }

    // Outside the ±5 min window.
    var stale = await WithSecretAsync(() =>
    {
      var oldTs = DateTimeOffset.UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds();
      var req = new LambdaRequest(Event(body, Sign(FakeSecret, oldTs, body), oldTs));
      return WebhookDeliveryReport.HandleReport(req, new Res(req.TraceId));
    });
    Assert.Equal(403, stale.StatusCode);

    var row = await RowAsync(deliveryId);
    Assert.Equal("queued", (string)row["status"]!);
    Assert.Equal(0, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));

    var wrongMethod = await ReportAsync(body, method: "GET");
    Assert.Equal(405, wrongMethod.StatusCode);
  }

  [Fact]
  public async Task Report_UnknownDelivery_Is404()
  {
    var resp = await ReportAsync(Body(Guid.NewGuid(), 1, "delivered", 200, null));
    Assert.Equal(404, resp.StatusCode);
    Assert.Equal("DELIVERY_NOT_FOUND", ErrorCode(resp));
  }

  [Fact]
  public async Task Report_InvalidBody_Is400()
  {
    var (_, deliveryId) = await SeedAsync();
    var id = deliveryId.ToString();

    var bodies = new[]
    {
      "[]",
      JsonSerializer.Serialize(new { deliveryId = "nope", attempt = 1, outcome = "retry", statusCode = 500, durationMs = 1, error = "x" }),
      JsonSerializer.Serialize(new { attempt = 1, outcome = "retry", statusCode = 500, durationMs = 1, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 0, outcome = "retry", statusCode = 500, durationMs = 1, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = "1", outcome = "retry", statusCode = 500, durationMs = 1, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 1, outcome = "retrying", statusCode = 500, durationMs = 1, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 1, outcome = "retry", statusCode = "500", durationMs = 1, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 1, outcome = "retry", statusCode = 500, durationMs = -1, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 1, outcome = "retry", statusCode = 500, error = "x" }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 1, outcome = "retry", statusCode = 500, durationMs = 1, error = 5 }),
      JsonSerializer.Serialize(new { deliveryId = id, attempt = 1.5, outcome = "retry", statusCode = 500, durationMs = 1, error = "x" }),
    };

    foreach (var body in bodies)
    {
      var resp = await ReportAsync(body);
      Assert.True(resp.StatusCode == 400, $"{body} returned {resp.StatusCode}: {resp.Body}");
      Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    }

    var notJson = await ReportAsync("{not json");
    Assert.Equal(400, notJson.StatusCode);

    // Unknown keys are ignored.
    var extra = await ReportAsync(JsonSerializer.Serialize(new { deliveryId = id, attempt = 1, outcome = "retry", statusCode = 500, durationMs = 1, error = "x", region = "ap-southeast-2" }));
    Assert.Equal(200, extra.StatusCode);
  }

  [Fact]
  public async Task Report_IsRoutedByVpcFunction()
  {
    var (_, deliveryId) = await SeedAsync();
    var body = Body(deliveryId, 1, "delivered", 204, null);

    var resp = await WithSecretAsync(() => new RecallSmith.Lambda.VpcFunction().Handler(Event(body)));
    Assert.True(resp.StatusCode == 200, resp.Body);
    Assert.Equal("delivered", Data(resp).GetProperty("status").GetString());

    var unsigned = await WithSecretAsync(() => new RecallSmith.Lambda.VpcFunction().Handler(Event(body, signature: "v1=bad")));
    Assert.Equal(403, unsigned.StatusCode);

    var get = await WithSecretAsync(() => new RecallSmith.Lambda.VpcFunction().Handler(Event(body, method: "GET")));
    Assert.Equal(405, get.StatusCode);
  }

  [Fact]
  public async Task InternalRoutes_MatchExactPathsOnly()
  {
    // cloud-security-resilience-2: a validly signed request whose path merely ENDS with an internal route
    // (for example one sent through the unauthenticated /api/internal/webhooks/{proxy+} gateway route)
    // must not reach that handler.
    var (_, deliveryId) = await SeedAsync();
    var body = Body(deliveryId, 1, "delivered", 204, null);

    foreach (var path in new[]
    {
      "/api/internal/webhooks/x/api/internal/ai-qa/results",
      "/api/internal/webhooks/x/api/internal/entitlements/apply",
      "/api/internal/webhooks/x/api/internal/subscriptions/upsert",
      "/api/internal/ai-qa/x/api/internal/webhooks/deliveries/report",
      "/api/internal/webhooks/deliveries/report/extra",
      "/api/internal/ai-qa/results/x",
    })
    {
      var resp = await WithSecretAsync(() => new RecallSmith.Lambda.VpcFunction().Handler(Event(body, path: path)));
      Assert.True(resp.StatusCode == 404, $"{path} returned {resp.StatusCode}: {resp.Body}");
      Assert.Equal(RouteMetrics.UnmatchedRoute, RouteMetrics.RouteFor(path));
    }

    // Nothing was applied by the rejected paths.
    Assert.Equal("queued", (string)(await RowAsync(deliveryId))["status"]!);

    // The exact paths still route, and keep their own metric labels.
    var exact = await WithSecretAsync(() => new RecallSmith.Lambda.VpcFunction().Handler(Event(body)));
    Assert.True(exact.StatusCode == 200, exact.Body);
    foreach (var route in new[] { ReportPath, "/api/internal/ai-qa/results", "/api/internal/entitlements/apply", "/api/internal/subscriptions/upsert" })
    {
      Assert.Equal(route, RouteMetrics.RouteFor(route));
    }
  }

  // ---------------------------------------------------------------- transition table (backend-design-23)

  private static readonly string[] RowStatuses = ["queued", "enqueue_failed", "retrying", "delivered", "failed", "dead"];
  private static readonly string[] Outcomes = ["delivered", "retry", "failed", "dead"];
  private const int SeededAttempts = 2;
  private const int SeededStatusCode = 418;
  private const string SeededError = "seeded error";
  private static readonly DateTime SeededDeliveredAt = new(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);

  /// <summary>Every (row status, outcome, attempt relative to the stored one, subscription live) combination: 144.</summary>
  public static TheoryData<string, string, int, bool> TransitionCases()
  {
    var data = new TheoryData<string, string, int, bool>();
    foreach (var status in RowStatuses)
    foreach (var outcome in Outcomes)
    foreach (var delta in new[] { -1, 0, 1 })
    foreach (var live in new[] { true, false })
      data.Add(status, outcome, delta, live);
    return data;
  }

  private sealed record Expected(string Status, int Attempts, int? StatusCode, string? Error, bool DeliveredAtSet, bool DeliveredAtChanged, bool Stop);

  /// <summary>
  /// The report transition stated as a plain table, independent of the SQL: delivered and failed rows are terminal;
  /// a dead row yields only to a success (DLQ redrive, any attempt); any other row ignores a stale (lower) attempt;
  /// a retry for an inactive subscription is recorded as failed; attempts only grow.
  /// </summary>
  private static Expected Reference(string rowStatus, bool rowDelivered, string outcome, int attempt, bool live)
  {
    var reported = outcome == "retry" ? "retrying" : outcome;
    var terminal = rowStatus is "delivered" or "failed";
    var deadKeeps = rowStatus == "dead" && reported != "delivered";
    var stale = attempt < SeededAttempts && !(rowStatus == "dead" && reported == "delivered");
    var keep = terminal || deadKeeps || stale;
    var attempts = Math.Max(SeededAttempts, attempt);
    if (keep) return new Expected(rowStatus, attempts, SeededStatusCode, SeededError, rowDelivered, false, !live);

    var stoppedRetry = reported == "retrying" && !live;
    var status = stoppedRetry ? "failed" : reported;
    var error = stoppedRetry ? WebhookDeliveryReport.SubscriptionInactiveError : $"reported {outcome}";
    var delivered = reported == "delivered";
    return new Expected(status, attempts, 299, error, delivered || rowDelivered, delivered, !live);
  }

  [Theory]
  [MemberData(nameof(TransitionCases))]
  public async Task Report_TransitionTable_MatchesReference(string rowStatus, string outcome, int attemptDelta, bool live)
  {
    var (_, deliveryId) = await SeedAsync(active: live);
    var rowDelivered = rowStatus == "delivered";
    await _db.QueryAsync(
      """
      update webhook_deliveries set status = $2, attempts = $3, last_status_code = $4, last_error = $5,
        delivered_at = case when $6 then $7::timestamptz else null end
      where delivery_id = $1
      """,
      deliveryId, rowStatus, SeededAttempts, SeededStatusCode, SeededError, rowDelivered, SeededDeliveredAt);

    var attempt = SeededAttempts + attemptDelta;
    var resp = await ReportAsync(Body(deliveryId, attempt, outcome, 299, $"reported {outcome}"));
    Assert.True(resp.StatusCode == 200, resp.Body);

    var expected = Reference(rowStatus, rowDelivered, outcome, attempt, live);
    var data = Data(resp);
    Assert.Equal(expected.Status, data.GetProperty("status").GetString());
    Assert.Equal(expected.Stop, data.GetProperty("stop").GetBoolean());

    var row = await RowAsync(deliveryId);
    Assert.Equal(expected.Status, (string)row["status"]!);
    Assert.Equal(expected.Attempts, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
    Assert.Equal(expected.StatusCode, row["last_status_code"] is null ? null : Convert.ToInt32(row["last_status_code"], CultureInfo.InvariantCulture));
    Assert.Equal(expected.Error, (string?)row["last_error"]);
    Assert.Equal(expected.DeliveredAtSet, row["delivered_at"] is not null);
    if (row["delivered_at"] is not null)
    {
      var deliveredAt = Convert.ToDateTime(row["delivered_at"], CultureInfo.InvariantCulture).ToUniversalTime();
      Assert.Equal(expected.DeliveredAtChanged, deliveredAt != SeededDeliveredAt);
    }
  }
}
