using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The 1 MiB request-body cap in VpcFunction.DispatchAsync. It is the first statement inside the
/// try, so it precedes routing and auth (a huge unauthenticated webhook body is a 413, not a
/// 401), it bounds the DECODED body (base64 is decoded first), and it sits below the OPTIONS
/// preflight so a preflight is never capped. Everything goes through the real Handler.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class BodyCapTests
{
  private const int Cap = 1_048_576;

  private static JsonElement Event(string method, string path, string body, bool isBase64Encoded = false)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded,
    });
  }

  private static Task<APIGatewayProxyResponse> CallAsync(JsonElement evt) =>
    new VpcFunction().Handler(evt);

  [Fact]
  public async Task OverCap_Is413_BeforeRouting()
  {
    var response = await CallAsync(Event("GET", "/health", new string('a', Cap + 1)));
    Assert.Equal(413, response.StatusCode);

    using var doc = JsonDocument.Parse(response.Body!);
    var root = doc.RootElement;
    Assert.False(root.GetProperty("success").GetBoolean());
    Assert.Equal("PAYLOAD_TOO_LARGE", root.GetProperty("error").GetProperty("code").GetString());
  }

  [Fact]
  public async Task AtCap_IsNot413()
  {
    // Exactly at the cap is allowed; /health ignores the body and answers 200.
    var response = await CallAsync(Event("GET", "/health", new string('a', Cap)));
    Assert.Equal(200, response.StatusCode);
  }

  [Fact]
  public async Task OverCap_Base64Decoded_Is413()
  {
    // The bound is on the decoded body: Cap+1 raw bytes, base64-encoded on the wire.
    var encoded = Convert.ToBase64String(new byte[Cap + 1]);
    var response = await CallAsync(Event("GET", "/health", encoded, isBase64Encoded: true));
    Assert.Equal(413, response.StatusCode);
  }

  [Fact]
  public async Task OverCap_OnWebhookPath_Is413_BeforeAuth()
  {
    // No authorization header and a body over the cap: the cap wins, so it is a 413, not a 401.
    var response = await CallAsync(Event("POST", "/webhooks/revenuecat/development", new string('a', Cap + 1)));
    Assert.Equal(413, response.StatusCode);
  }

  [Fact]
  public async Task Options_IsNeverCapped()
  {
    // The OPTIONS preflight answer precedes the try, so an over-cap preflight is still 200.
    var response = await CallAsync(Event("OPTIONS", "/api/v1/sync/push", new string('a', Cap + 1)));
    Assert.Equal(200, response.StatusCode);
  }
}
