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

  private static JsonElement Event(string body, string? signature = null, long? timestampMs = null, string method = "POST")
  {
    var ts = timestampMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = ReportPath,
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
    var failed = await ReportAsync(Body(deliveryId, 5, "failed", 404, "HTTP 404"));
    Assert.Equal("failed", Data(failed).GetProperty("status").GetString());
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
}
