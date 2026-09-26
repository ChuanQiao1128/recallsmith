using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Webhooks;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The RevenueCat webhook end to end against a real Postgres. The rules under test are the ones
/// that decide whether a paid event is honestly recorded: a constant-time bearer compare that
/// answers a four-key 401, a `raw jsonb` insert that actually lands (the ::jsonb cast — before
/// this the insert threw 42804 on every call and the audit table stayed empty), a `returning 1`
/// that lets a replay read back as replayed:true, and a DB that is down answering 503 +
/// retry-after so RevenueCat retries rather than marking the event delivered.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class RevenuecatWebhookTests : IDisposable
{
  private readonly PostgresFixture _db;

  private const string DevPath = "/webhooks/revenuecat/development";
  private const string Monthly = "developercards_premium_monthly";

  private readonly string? _savedAuth;
  private readonly string? _savedHost;
  private readonly string? _savedDatabase;

  public RevenuecatWebhookTests(PostgresFixture db)
  {
    _db = db;
    _savedAuth = Environment.GetEnvironmentVariable("RC_WEBHOOK_AUTH_DEVELOPMENT");
    _savedHost = Environment.GetEnvironmentVariable("PGHOST");
    _savedDatabase = Environment.GetEnvironmentVariable("PGDATABASE");
    // A placeholder, never a real token; the value and its env-var name are separate arguments.
    Environment.SetEnvironmentVariable("RC_WEBHOOK_AUTH_DEVELOPMENT", "test-secret-dev");
  }

  public void Dispose()
  {
    Environment.SetEnvironmentVariable("RC_WEBHOOK_AUTH_DEVELOPMENT", _savedAuth);
    Environment.SetEnvironmentVariable("PGHOST", _savedHost);
    Environment.SetEnvironmentVariable("PGDATABASE", _savedDatabase);
    Pg.Reset();
  }

  // ---------------------------------------------------------------- helpers

  private static JsonElement Event(string method, string path, string? authorization, string? body)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (authorization is not null) headers["authorization"] = authorization;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      },
      headers,
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static Task<APIGatewayProxyResponse> CallAsync(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    return RevenuecatWebhook.HandleRevenuecatWebhook(req, new Res(req.TraceId));
  }

  private static string Payload(
    string id,
    string type = "INITIAL_PURCHASE",
    string environment = "SANDBOX",
    string? appUserId = null,
    string productId = Monthly,
    long? expirationAtMs = null)
  {
    var ev = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id,
      ["type"] = type,
      ["environment"] = environment,
      ["app_user_id"] = appUserId,
      ["product_id"] = productId,
      ["event_timestamp_ms"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
      ["expiration_at_ms"] = expirationAtMs,
    };
    return JsonSerializer.Serialize(new Dictionary<string, object?>(StringComparer.Ordinal) { ["event"] = ev });
  }

  private static string NewId(string tag) => $"e07-{tag}-{Guid.NewGuid():N}";

  private static List<string> Keys(APIGatewayProxyResponse response)
  {
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.EnumerateObject().Select(p => p.Name).ToList();
  }

  private static JsonElement Root(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.Clone();

  private async Task<int> RcCountAsync(string eventId)
  {
    var n = await _db.ScalarAsync("select count(*) from rc_webhook_events where event_id = $1", eventId);
    return Convert.ToInt32(n, CultureInfo.InvariantCulture);
  }

  private async Task<int> PremiumCountForEventAsync(string eventId)
  {
    var n = await _db.ScalarAsync("select count(*) from user_premium_state where last_event_id = $1", eventId);
    return Convert.ToInt32(n, CultureInfo.InvariantCulture);
  }

  // ------------------------------------------------------------------ auth

  [Fact]
  public async Task Post_WrongTokenSameLength_Is401WithFourKeysOnly()
  {
    // "test-secret-dex" is one byte off "test-secret-dev" at the same length: the constant-time
    // compare must still reject it, and the body must not leak length/prefix/hash to the caller.
    var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dex", Payload(NewId("wrong"))));
    Assert.Equal(401, response.StatusCode);

    Assert.Equal(new List<string> { "ok", "error", "mode", "impl" }, Keys(response));
    var root = Root(response);
    Assert.False(root.GetProperty("ok").GetBoolean());
    Assert.Equal("Unauthorized", root.GetProperty("error").GetString());
    Assert.Equal("development", root.GetProperty("mode").GetString());

    var text = response.Body!;
    foreach (var leaked in new[] { "expectedLen", "expectedHash8", "gotHash8", "expectedHasBearer", "gotLen", "gotBearer" })
    {
      Assert.DoesNotContain(leaked, text, StringComparison.Ordinal);
    }
  }

  [Fact]
  public async Task Post_MissingAuthorization_Is401()
  {
    var response = await CallAsync(Event("POST", DevPath, null, Payload(NewId("noauth"))));
    Assert.Equal(401, response.StatusCode);
    Assert.Equal(new List<string> { "ok", "error", "mode", "impl" }, Keys(response));
  }

  [Fact]
  public async Task Get_Is405()
  {
    var response = await CallAsync(Event("GET", DevPath, "Bearer test-secret-dev", null));
    Assert.Equal(405, response.StatusCode);
  }

  [Fact]
  public async Task Post_BadJson_Is400()
  {
    var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", "{not json"));
    Assert.Equal(400, response.StatusCode);
    Assert.Equal("Invalid JSON body", Root(response).GetProperty("error").GetString());
  }

  // -------------------------------------------------------------------- DB

  [Fact]
  public async Task Post_TestEvent_Is200_AndRowIsRecorded()
  {
    var id = NewId("test");
    var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", Payload(id, type: "TEST")));
    Assert.True(response.StatusCode == 200, $"expected 200, got {response.StatusCode}: {response.Body}");

    var root = Root(response);
    Assert.True(root.GetProperty("ok").GetBoolean());
    Assert.True(root.GetProperty("accepted").GetBoolean());

    // This is the assertion that fails on today's SQL: the uncast text parameter throws 42804,
    // the Log.Warn catch swallows it, and the table stays empty. With ::jsonb the row lands.
    Assert.Equal(1, await RcCountAsync(id));
    Assert.Equal(0, await PremiumCountForEventAsync(id));
  }

  [Fact]
  public async Task Post_Purchase_Is200_UpsertsPremium_ReplayKeepsOneRow()
  {
    var id = NewId("purchase");
    var appUserId = NewId("user");
    var body = Payload(id, type: "INITIAL_PURCHASE", environment: "SANDBOX", appUserId: appUserId, productId: Monthly);

    var first = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", body));
    Assert.True(first.StatusCode == 200, $"expected 200, got {first.StatusCode}: {first.Body}");
    Assert.True(Root(first).GetProperty("accepted").GetBoolean());

    var rows = await _db.QueryAsync(
      "select premium_active, premium_env, last_event_id from user_premium_state where app_user_id = $1",
      appUserId);
    Assert.Single(rows);
    Assert.True(Convert.ToBoolean(rows[0]["premium_active"], CultureInfo.InvariantCulture));
    Assert.Equal("sandbox", rows[0]["premium_env"] as string);
    Assert.Equal(id, rows[0]["last_event_id"] as string);

    // The replay must read back as replayed:true (the `returning 1` on the audit insert) and must
    // not create a second audit row. The log line, not the response body, carries `replayed`.
    var originalOut = Console.Out;
    var originalErr = Console.Error;
    var capture = new StringWriter();
    APIGatewayProxyResponse replay;
    try
    {
      Console.SetOut(capture);
      Console.SetError(capture);
      replay = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", body));
    }
    finally
    {
      Console.SetOut(originalOut);
      Console.SetError(originalErr);
    }

    Assert.True(replay.StatusCode == 200, $"expected 200, got {replay.StatusCode}: {replay.Body}");
    Assert.True(Root(replay).GetProperty("accepted").GetBoolean());
    Assert.Equal(1, await RcCountAsync(id));
    Assert.Matches("\"replayed\"\\s*:\\s*true", capture.ToString());
  }

  [Fact]
  public async Task Post_EnvMismatch_Is200NotAccepted()
  {
    var id = NewId("envmm");
    var appUserId = NewId("user");
    // PRODUCTION environment on the development path: expected env is SANDBOX, so 200 accepted:false.
    var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev",
      Payload(id, type: "INITIAL_PURCHASE", environment: "PRODUCTION", appUserId: appUserId)));
    Assert.True(response.StatusCode == 200, $"expected 200, got {response.StatusCode}: {response.Body}");

    var root = Root(response);
    Assert.False(root.GetProperty("accepted").GetBoolean());
    Assert.Equal("env_mismatch", root.GetProperty("reason").GetString());
    Assert.Equal(0, await PremiumCountForEventAsync(id));
  }

  [Fact]
  public async Task Post_ProductMismatch_Is200NotAccepted()
  {
    var id = NewId("prodmm");
    var appUserId = NewId("user");
    var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev",
      Payload(id, type: "INITIAL_PURCHASE", environment: "SANDBOX", appUserId: appUserId, productId: "some_other_product")));
    Assert.True(response.StatusCode == 200, $"expected 200, got {response.StatusCode}: {response.Body}");

    var root = Root(response);
    Assert.False(root.GetProperty("accepted").GetBoolean());
    Assert.Equal("product_mismatch", root.GetProperty("reason").GetString());
    Assert.Equal(0, await PremiumCountForEventAsync(id));
  }

  [Fact]
  public async Task Post_NoPgEnv_Is503WithRetryAfter()
  {
    var saved = Environment.GetEnvironmentVariable("PGHOST");
    try
    {
      Environment.SetEnvironmentVariable("PGHOST", null);
      Pg.Reset();

      var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", Payload(NewId("nopg"))));
      Assert.Equal(503, response.StatusCode);
      Assert.Equal("60", response.Headers["retry-after"]);

      var root = Root(response);
      Assert.False(root.GetProperty("ok").GetBoolean());
      Assert.Equal("DB_UNAVAILABLE", root.GetProperty("error").GetString());
      Assert.Equal("development", root.GetProperty("mode").GetString());
      Assert.True(root.TryGetProperty("impl", out _));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGHOST", saved);
      Pg.Reset();
    }
  }

  [Fact]
  public async Task Post_DbOpenFails_Is503WithRetryAfter()
  {
    var saved = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", "e07_missing_db");
      Pg.Reset();

      var response = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", Payload(NewId("openfail"))));
      Assert.Equal(503, response.StatusCode);
      Assert.Equal("60", response.Headers["retry-after"]);
      Assert.Equal("DB_UNAVAILABLE", Root(response).GetProperty("error").GetString());
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", saved);
      Pg.Reset();
    }
  }

  [Fact]
  public async Task Post_UpsertFails_Is503_ThenRetrySucceeds()
  {
    var scratchConn = await _db.CreateScratchDatabaseAsync("e07_rc_partial");
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      // maxVersion 2: rc_webhook_events exists (migration 002) but user_premium_state does not
      // (migration 003), so the audit insert lands and the premium upsert throws 42P01 → 503.
      await using (var conn = new NpgsqlConnection(scratchConn))
      {
        await conn.OpenAsync();
        await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 2);
      }

      Environment.SetEnvironmentVariable("PGDATABASE", "e07_rc_partial");
      Pg.Reset();

      var id = NewId("partial");
      var appUserId = NewId("user");
      var body = Payload(id, type: "INITIAL_PURCHASE", environment: "SANDBOX", appUserId: appUserId, productId: Monthly);

      var failed = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", body));
      Assert.Equal(503, failed.StatusCode);
      Assert.Equal("60", failed.Headers["retry-after"]);
      Assert.Equal("DB_UNAVAILABLE", Root(failed).GetProperty("error").GetString());

      // The audit row survives the failed upsert.
      await using (var conn = new NpgsqlConnection(scratchConn))
      {
        await conn.OpenAsync();
        var n = await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from rc_webhook_events where event_id = $1", [id]);
        Assert.Equal(1, Convert.ToInt32(n, CultureInfo.InvariantCulture));

        // Bring the schema up to 006 (001–006 are idempotent) so the upsert can succeed on retry.
        await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 6);
      }
      Pg.Reset();

      var ok = await CallAsync(Event("POST", DevPath, "Bearer test-secret-dev", body));
      Assert.True(ok.StatusCode == 200, $"expected 200, got {ok.StatusCode}: {ok.Body}");
      Assert.True(Root(ok).GetProperty("accepted").GetBoolean());

      await using (var conn = new NpgsqlConnection(scratchConn))
      {
        await conn.OpenAsync();
        var rows = await DbUtil.QueryAsync(conn, null,
          "select premium_active from user_premium_state where app_user_id = $1", [appUserId]);
        Assert.Single(rows);
        Assert.True(Convert.ToBoolean(rows[0]["premium_active"], CultureInfo.InvariantCulture));

        var n = await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from rc_webhook_events where event_id = $1", [id]);
        Assert.Equal(1, Convert.ToInt32(n, CultureInfo.InvariantCulture));
      }
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Pg.Reset();
    }
  }
}
