using System.Security.Cryptography;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// A forged bearer token meets a real route. Every request below goes through
/// <see cref="VpcFunction.Handler"/> exactly as API Gateway sends it -- no authorizer context,
/// because the deployed HTTP API has none -- so a green test here is a statement about what
/// the deployed Lambda answers, not about a helper.
///
/// The route is GET /api/v1/authoring/cards, a RequireAdmin route, and the token claims
/// super_admin. Before this change that request returned 200 with every card in the database
/// for anyone who could base64-encode a JSON object.
/// </summary>
/// <remarks>
/// In the postgres collection for two reasons: the genuine-token case reads the cards table,
/// and <see cref="Auth.Configure"/> is process-global state that must not flip underneath the
/// other classes that call <see cref="Auth.GetAuthContextAsync"/> (they use the authorizer
/// path, which never consults the verifier, but the collection is serial and that is the
/// cheaper guarantee). The fixture is not injected: nothing here needs the container handle.
/// </remarks>
[Collection(PostgresCollection.Name)]
public sealed class AuthBearerTests : IDisposable
{
  private const string CardsPath = "/api/v1/authoring/cards";
  private const string Kid = "cognito-kid-1";

  private readonly RSA _cognito = TestJwt.NewKey();
  private readonly RSA _attacker = TestJwt.NewKey();
  private readonly StubJwks _jwks;

  public AuthBearerTests()
  {
    _jwks = new StubJwks(TestJwt.Jwks((Kid, _cognito)));
    Auth.Configure(AuthOptions.Parse(null, null, "production"), _jwks);
  }

  public void Dispose()
  {
    Auth.ResetToEnvironment();
    _cognito.Dispose();
    _attacker.Dispose();
  }

  private static JsonElement Event(string method, string path, string? bearer)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (bearer is not null) headers["authorization"] = "Bearer " + bearer;
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
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static Task<APIGatewayProxyResponse> CallAsync(string bearer, string path = CardsPath) =>
    new VpcFunction().Handler(Event("GET", path, bearer));

  private static string ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString()!;

  private static void AssertUnauthorized(APIGatewayProxyResponse response)
  {
    Assert.Equal(401, response.StatusCode);
    using var doc = JsonDocument.Parse(response.Body!);
    var root = doc.RootElement;
    // The same envelope as every other 401 this API emits: success:false, error.code, traceId.
    Assert.False(root.GetProperty("success").GetBoolean());
    Assert.Equal("UNAUTHORIZED", root.GetProperty("error").GetProperty("code").GetString());
    Assert.Equal(JsonValueKind.Null, root.GetProperty("data").ValueKind);
    Assert.True(root.TryGetProperty("traceId", out _));
    Assert.Equal("application/json", response.Headers["content-type"]);
  }

  // ------------------------------------------------------------- the forgeries

  [Fact]
  public async Task ForgedSuperAdmin_SignedWithTheWrongKey_Is401()
  {
    // Everything about this token is right except who signed it: real issuer, real kid,
    // super_admin in cognito:groups, an hour of validity.
    var token = TestJwt.ResignedWith(_attacker, Kid, TestJwt.Payload(groups: ["super_admin"]));

    AssertUnauthorized(await CallAsync(token));
  }

  [Fact]
  public async Task ForgedSuperAdmin_AlgNone_Is401()
  {
    // The exact token the old fallback accepted: base64(header).base64(payload). with no
    // signature at all.
    var token = TestJwt.Unsigned(Kid, TestJwt.Payload(groups: ["super_admin"]));

    AssertUnauthorized(await CallAsync(token));
    Assert.Equal(0, _jwks.Calls);
  }

  [Fact]
  public async Task ForgedSuperAdmin_FromAnUntrustedPool_Is401()
  {
    var token = TestJwt.Sign(_attacker, Kid, TestJwt.Payload(
      issuer: "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_attacker",
      groups: ["super_admin"]));

    AssertUnauthorized(await CallAsync(token));
    Assert.Equal(0, _jwks.Calls);
  }

  [Fact]
  public async Task GenuineButExpiredSuperAdmin_Is401()
  {
    var token = TestJwt.Sign(_cognito, Kid, TestJwt.Payload(groups: ["super_admin"], exp: TestJwt.Now() - 600));

    AssertUnauthorized(await CallAsync(token));
  }

  [Fact]
  public async Task GenuineSuperAdmin_WhileTheJwksIsUnreachable_Is401()
  {
    // Fail closed: a Cognito outage locks the door, it does not remove it.
    _jwks.Fail(new HttpRequestException("timeout"));
    var token = TestJwt.Sign(_cognito, Kid, TestJwt.Payload(groups: ["super_admin"]));

    AssertUnauthorized(await CallAsync(token));
  }

  [Fact]
  public async Task RejectedToken_Is401_OnEveryGate()
  {
    // Not just the admin gate. A super_admin route, an editor route and a plain user route
    // all answer 401 to a bad token, and none of them says 403 -- a client holding an
    // expired token needs "sign in again", not "you lack a role".
    var token = TestJwt.ResignedWith(_attacker, Kid, TestJwt.Payload(groups: ["super_admin"]));

    AssertUnauthorized(await CallAsync(token, "/api/v1/admin/permissions"));
    AssertUnauthorized(await CallAsync(token, "/api/v1/authoring/dashboard"));
    AssertUnauthorized(await CallAsync(token, "/api/v1/me"));
    AssertUnauthorized(await CallAsync(token, "/api/v1/admin/users"));
  }

  // ------------------------------------------------------------- the genuine

  [Fact]
  public async Task GenuineSuperAdmin_Is200()
  {
    // The control: the same route, the same claims, signed by the key the JWKS publishes.
    // Without this the five rejections above could be a verifier that rejects everything.
    var token = TestJwt.Sign(_cognito, Kid, TestJwt.Payload(groups: ["super_admin"]));

    var response = await CallAsync(token);

    Assert.Equal(200, response.StatusCode);
    using var doc = JsonDocument.Parse(response.Body!);
    Assert.True(doc.RootElement.GetProperty("success").GetBoolean());
    Assert.Equal(JsonValueKind.Array, doc.RootElement.GetProperty("data").ValueKind);
    Assert.Equal(1, _jwks.Calls);
  }

  [Fact]
  public async Task GenuineUser_WithoutTheGroup_IsStill403()
  {
    // Authentication and authorization stay separate: a real token from a real user who is
    // not an editor gets the same 403 it always got, not a 401.
    var token = TestJwt.Sign(_cognito, Kid, TestJwt.Payload(groups: null));

    var response = await CallAsync(token);

    Assert.Equal(403, response.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(response));
  }

  [Fact]
  public async Task NoBearerAtAll_IsStill403()
  {
    // Unchanged behaviour for the anonymous caller: no token was presented, so nothing was
    // rejected, and the role gate answers as before.
    var response = await new VpcFunction().Handler(Event("GET", CardsPath, bearer: null));

    Assert.Equal(403, response.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(response));
  }

  [Fact]
  public async Task AuthorizerClaims_StillWin_AndSkipTheVerifier()
  {
    // The gateway path is first choice and untouched: when requestContext.authorizer.jwt is
    // present the bearer header is not even looked at, so once the gateway authorizers land
    // this code costs nothing per request.
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = CardsPath,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = "gateway-sub",
              ["cognito:groups"] = "[super_admin]",
            },
          },
        },
      },
      headers = new Dictionary<string, string> { ["authorization"] = "Bearer garbage" },
      queryStringParameters = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });

    var response = await new VpcFunction().Handler(evt);

    Assert.Equal(200, response.StatusCode);
    Assert.Equal(0, _jwks.Calls);
  }

  [Fact]
  public async Task AuthlessRoute_IgnoresABadBearer()
  {
    // /health and the webhooks carry Authorization headers that are not JWTs (RevenueCat's is
    // a shared secret). Verification failing must not turn into a 401 for routes that never
    // asked for a user.
    var response = await CallAsync("not-a-jwt-at-all", "/health");

    Assert.Equal(200, response.StatusCode);
  }

  // ------------------------------------------------------------- the dev flag

  [Fact]
  public async Task UnverifiedMode_AcceptsTheForgery_OutsideProduction()
  {
    // What AUTH_ALLOW_UNVERIFIED=1 buys a developer with no gateway: the old behaviour, on
    // purpose, and only where AuthOptions.Parse lets it through (see JwtVerifierTests for the
    // production=never matrix).
    Auth.Configure(AuthOptions.Parse(null, "1", "dev"), _jwks);
    var token = TestJwt.Unsigned(Kid, TestJwt.Payload(groups: ["super_admin"]));

    var response = await CallAsync(token);

    Assert.Equal(200, response.StatusCode);
    Assert.Equal(0, _jwks.Calls);
  }

  [Fact]
  public async Task UnverifiedMode_IsInert_InProduction()
  {
    // The same flag, API_ENV=production: parsed to false, and the forgery is back to 401.
    Auth.Configure(AuthOptions.Parse(null, "1", "production"), _jwks);
    var token = TestJwt.Unsigned(Kid, TestJwt.Payload(groups: ["super_admin"]));

    AssertUnauthorized(await CallAsync(token));
  }
}
