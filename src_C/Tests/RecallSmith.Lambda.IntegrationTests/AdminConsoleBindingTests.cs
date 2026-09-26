using System.Security.Cryptography;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The console binding (F05, CBE-07): the admin role flags are granted only to claims that came
/// from the console pool and, when AUTH_CONSOLE_CLIENT_IDS is configured, from a console app
/// client. A token that verifies but fails the binding keeps its identity (so RequireUser still
/// passes) and loses its roles, so RequireAdmin answers 403 "Requires a console token".
///
/// Every request below goes through <see cref="VpcFunction.Handler"/> on GET
/// /api/v1/authoring/cards (a RequireAdmin route), exactly as API Gateway sends it, so a green
/// test here is a statement about the deployed Lambda.
/// </summary>
/// <remarks>
/// In the postgres collection because the 200 case reads the cards table and
/// <see cref="Auth.Configure"/> is process-global state that must stay serial with the other
/// classes that call <see cref="Auth.GetAuthContextAsync"/>.
/// </remarks>
[Collection(PostgresCollection.Name)]
public sealed class AdminConsoleBindingTests : IDisposable
{
  private const string CardsPath = "/api/v1/authoring/cards";
  private const string Kid = "cognito-kid-1";
  private const string ConsoleClient = "console-client-test";
  private const string OtherClient = "other-client-test";

  private readonly RSA _key = TestJwt.NewKey();
  private readonly StubJwks _jwks;

  public AdminConsoleBindingTests()
  {
    // One key served for every issuer, so the console and mobile pools both verify; the binding,
    // not the signature, is what these tests are about.
    _jwks = new StubJwks(TestJwt.Jwks((Kid, _key)));
    Auth.Configure(AuthOptions.Parse(null, null, "production", null, ConsoleClient), _jwks);
  }

  public void Dispose()
  {
    Auth.ResetToEnvironment();
    _key.Dispose();
  }

  // ------------------------------------------------------------- helpers

  private static JsonElement Event(string path, string? bearer)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (bearer is not null) headers["authorization"] = "Bearer " + bearer;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
      },
      headers,
      queryStringParameters = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static JsonElement GatewayEvent(string path, Dictionary<string, object?> claims)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
        authorizer = new { jwt = new { claims } },
      },
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      queryStringParameters = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private string Token(Dictionary<string, object?> payload) => TestJwt.Sign(_key, Kid, payload);

  private static Task<APIGatewayProxyResponse> CallAsync(JsonElement evt) => new VpcFunction().Handler(evt);

  private static string ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString()!;

  private static IReadOnlyDictionary<string, JsonElement> ToClaims(Dictionary<string, object?> obj)
  {
    using var doc = JsonDocument.Parse(JsonSerializer.Serialize(obj));
    var dict = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
    foreach (var p in doc.RootElement.EnumerateObject()) dict[p.Name] = p.Value.Clone();
    return dict;
  }

  // ------------------------------------------------------------- route tests

  [Fact]
  public async Task MobilePoolSuperAdmin_IsForbidden_OnConsoleRoutes()
  {
    // A genuine super_admin grant in the mobile pool: it verifies, but the issuer is not the
    // console pool, so the role is stripped and the admin gate answers 403.
    var payload = TestJwt.Payload(issuer: TestJwt.MobileIssuer, groups: ["super_admin"]);
    payload["client_id"] = ConsoleClient;

    var response = await CallAsync(Event(CardsPath, Token(payload)));

    Assert.Equal(403, response.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(response));
  }

  [Fact]
  public async Task ConsolePoolToken_FromAnotherClient_IsForbidden()
  {
    // Right pool, wrong app client: the client check strips the role.
    var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, groups: ["super_admin"]);
    payload["client_id"] = OtherClient;

    var response = await CallAsync(Event(CardsPath, Token(payload)));

    Assert.Equal(403, response.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(response));
  }

  [Fact]
  public async Task ConsolePoolAccessToken_FromTheConsoleClient_Is200()
  {
    // The genuine console admin: console pool, console client, super_admin.
    var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, groups: ["super_admin"]);
    payload["client_id"] = ConsoleClient;

    var response = await CallAsync(Event(CardsPath, Token(payload)));

    Assert.Equal(200, response.StatusCode);
  }

  [Fact]
  public async Task ConsolePoolIdToken_WithConsoleAudience_Is200()
  {
    // An id token carries aud, not client_id; the binding reads aud when client_id is absent.
    var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, tokenUse: "id", groups: ["super_admin"]);
    payload["aud"] = ConsoleClient;

    var response = await CallAsync(Event(CardsPath, Token(payload)));

    Assert.Equal(200, response.StatusCode);
  }

  [Fact]
  public async Task GatewayClaims_FromTheMobilePool_AreForbidden()
  {
    // Even on the trusted gateway path, a present iss is checked: mobile pool loses the role.
    var claims = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["sub"] = "gateway-sub",
      ["cognito:groups"] = "[super_admin]",
      ["iss"] = TestJwt.MobileIssuer,
      ["client_id"] = ConsoleClient,
    };

    var response = await CallAsync(GatewayEvent(CardsPath, claims));

    Assert.Equal(403, response.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(response));
  }

  [Fact]
  public async Task GatewayClaims_WithoutIssuer_KeepTheirRole()
  {
    // The invoke-as-admin.sh shape: gateway-verified claims with no iss and no client claim stay
    // trusted by design, so the role survives.
    var claims = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["sub"] = "gateway-sub",
      ["cognito:groups"] = "[super_admin]",
    };

    var response = await CallAsync(GatewayEvent(CardsPath, claims));

    Assert.Equal(200, response.StatusCode);
  }

  [Fact]
  public async Task ClientBinding_IsOff_WhenNoClientIdsAreConfigured()
  {
    // With AUTH_CONSOLE_CLIENT_IDS unset only the issuer is enforced: any console-client token
    // passes, but a mobile-pool token is still denied.
    Auth.Configure(AuthOptions.Parse(null, null, "production"), _jwks);

    var consolePayload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, groups: ["super_admin"]);
    consolePayload["client_id"] = "anything-test";
    var consoleResponse = await CallAsync(Event(CardsPath, Token(consolePayload)));
    Assert.Equal(200, consoleResponse.StatusCode);

    var mobileResponse = await CallAsync(Event(CardsPath, Token(
      TestJwt.Payload(issuer: TestJwt.MobileIssuer, groups: ["super_admin"]))));
    Assert.Equal(403, mobileResponse.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(mobileResponse));
  }

  [Fact]
  public async Task MobilePoolUser_StillPassesRequireUser()
  {
    // Binding the admin flags never touches identity: a mobile user (no groups) keeps its sub,
    // has no admin-deny reason, and passes RequireUser.
    var evt = Event(CardsPath, Token(
      TestJwt.Payload(issuer: TestJwt.MobileIssuer, sub: "mobile-sub-1")));

    var ctx = await Auth.GetAuthContextAsync(new LambdaRequest(evt));

    Assert.Null(Auth.RequireUser(ctx, new Res("t")));
    Assert.Null(ctx.AdminDenyReason);
    Assert.Equal("mobile-sub-1", ctx.UserSub);
  }

  // ------------------------------------------------------------- pure

  [Fact]
  public void Parse_ReadsConsoleIssuerAndClientIds()
  {
    var withIds = AuthOptions.Parse(null, null, "production", null, " a , b ,a");
    Assert.Equal(TestJwt.ConsoleIssuer, withIds.ConsoleIssuer);
    Assert.Equal(["a", "b"], withIds.ConsoleClientIds);

    var withIssuer = AuthOptions.Parse(null, null, "production", "ap-southeast-2_x", null);
    Assert.Equal("https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x", withIssuer.ConsoleIssuer);
  }

  [Theory]
  // console iss + matching client -> null
  [InlineData("console", ConsoleClient, null, true, false, null)]
  // mobile iss -> admin_issuer
  [InlineData("mobile", null, null, true, false, "admin_issuer")]
  // no iss, not gateway-verified -> admin_issuer
  [InlineData("none", null, null, true, false, "admin_issuer")]
  // no iss, gateway-verified -> null
  [InlineData("none", null, null, true, true, null)]
  // console iss + no client claim with ids configured, not gateway-verified -> admin_client
  [InlineData("console", null, null, true, false, "admin_client")]
  // console iss + aud array containing the id -> null
  [InlineData("console", null, "x,console-client-test", true, false, null)]
  public void ConsoleBindingFailure_Table(string issKind, string? clientId, string? audCsv, bool idsConfigured, bool gatewayVerified, string? expected)
  {
    var obj = new Dictionary<string, object?>(StringComparer.Ordinal);
    if (issKind == "console") obj["iss"] = TestJwt.ConsoleIssuer;
    else if (issKind == "mobile") obj["iss"] = TestJwt.MobileIssuer;
    if (clientId is not null) obj["client_id"] = clientId;
    if (audCsv is not null) obj["aud"] = audCsv.Split(',');

    var options = AuthOptions.Parse(null, null, "production", null, idsConfigured ? ConsoleClient : null);

    var result = Auth.ConsoleBindingFailure(ToClaims(obj), options, gatewayVerified);

    Assert.Equal(expected, result);
  }
}
