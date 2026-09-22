using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Raw JOSE minting for the attacks below: any header JSON, any payload JSON (including
/// duplicated keys, which no serializer will emit), signed with RSA, with HMAC, or not at all.
/// </summary>
internal static class RawJose
{
  public const string ThirdPoolIssuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_IVLnBIGO4";

  public static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
  public static string B64(string s) => B64(Encoding.UTF8.GetBytes(s));

  public static string Rs256(string headerJson, string payloadJson, RSA signer)
  {
    var input = B64(headerJson) + "." + B64(payloadJson);
    var sig = signer.SignData(Encoding.ASCII.GetBytes(input), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    return input + "." + B64(sig);
  }

  public static string Unsigned(string headerJson, string payloadJson) => B64(headerJson) + "." + B64(payloadJson) + ".";

  public static string Hmac(string headerJson, string payloadJson, byte[] secret)
  {
    var input = B64(headerJson) + "." + B64(payloadJson);
    using var mac = new HMACSHA256(secret);
    return input + "." + B64(mac.ComputeHash(Encoding.ASCII.GetBytes(input)));
  }

  public static string Header(string kid, string alg = "RS256", params (string Name, object Value)[] extra)
  {
    var h = new Dictionary<string, object?> { ["alg"] = alg, ["kid"] = kid };
    foreach (var (name, value) in extra) h[name] = value;
    return JsonSerializer.Serialize(h);
  }

  public static object Jwk(RSA key, string kid)
  {
    var p = key.ExportParameters(false);
    return new { kty = "RSA", use = "sig", alg = "RS256", kid, n = B64(p.Modulus!), e = B64(p.Exponent!) };
  }

  public static string Payload(Dictionary<string, object?> p) => JsonSerializer.Serialize(p);
}

/// <summary>
/// The verifier against the attacks a JWT library is usually broken by, not just the ones
/// the RFC lists. Each is a token that a naive verifier accepts: key confusion (RS256 key
/// reused as an HMAC secret), a signing key smuggled in the header (jwk/jku/x5u/x5c), a key
/// from one trusted pool presented under another's issuer, duplicated claims that make the
/// validator and the consumer read different values, and a token from a third pool in the
/// same AWS account. Also the positive control that matters in production: tokens shaped
/// exactly like the ones Cognito mints for the console (access, client_id, no aud) and the
/// mobile app (id with aud; access without groups).
/// </summary>
public class JwtVerifierAdversarialTests
{
  private const string Kid = "kid-A";

  private static CognitoJwtVerifier Verifier(StubJwks jwks) => new(jwks, [TestJwt.ConsoleIssuer, TestJwt.MobileIssuer]);

  private static string SuperAdminPayload() => RawJose.Payload(TestJwt.Payload(groups: ["super_admin"]));

  [Fact]
  public async Task KeyConfusion_Hs256WithThePublicKeyAsSecret_IsRejectedBeforeAnyKeyLookup()
  {
    // The classic: alg switched to HS256 and the RSA public key (in each spelling an attacker
    // would try) used as the HMAC secret. A verifier that lets the token pick the algorithm
    // hands its own public key to the MAC and accepts.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var pub = key.ExportParameters(false);
    var secrets = new[]
    {
      Encoding.ASCII.GetBytes(RawJose.B64(pub.Modulus!)),
      pub.Modulus!,
      Encoding.ASCII.GetBytes(key.ExportSubjectPublicKeyInfoPem()),
      key.ExportSubjectPublicKeyInfo(),
      Encoding.UTF8.GetBytes(TestJwt.Jwks((Kid, key))),
    };

    foreach (var alg in new[] { "HS256", "hs256", "HS384", "HS512" })
    foreach (var secret in secrets)
    {
      var result = await Verifier(jwks).VerifyAsync(RawJose.Hmac(RawJose.Header(Kid, alg), SuperAdminPayload(), secret));
      Assert.False(result.Ok);
      Assert.Equal("alg", result.Reason);
    }
    Assert.Equal(0, jwks.Calls);
  }

  [Theory]
  [InlineData("None")]
  [InlineData("NONE")]
  [InlineData("rs256")]
  [InlineData("RS256 ")]
  [InlineData("PS256")]
  [InlineData("RS512")]
  [InlineData("")]
  public async Task AlgorithmIsExactlyRS256_EveryOtherSpelling_IsRejected(string alg)
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));

    var result = await Verifier(jwks).VerifyAsync(RawJose.Unsigned(RawJose.Header(Kid, alg), SuperAdminPayload()));

    Assert.False(result.Ok);
    Assert.Equal(0, jwks.Calls);
  }

  [Fact]
  public async Task SigningKeySmuggledInTheHeader_JwkJkuX5uX5c_IsIgnored()
  {
    using var cognito = TestJwt.NewKey();
    using var attacker = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, cognito)));
    var verifier = Verifier(jwks);
    var payload = SuperAdminPayload();

    // Real kid, attacker's public key embedded as `jwk`, attacker's signature: the key in the
    // JWKS must be the only one consulted, so this is a bad signature and not a pass.
    var jwk = RawJose.Rs256(RawJose.Header(Kid, extra: ("jwk", RawJose.Jwk(attacker, Kid))), payload, attacker);
    Assert.Equal("signature", (await verifier.VerifyAsync(jwk)).Reason);

    // Attacker's own kid plus its `jwk`: unknown to the JWKS, exactly one refresh, still no.
    var before = jwks.Calls;
    var ownKid = RawJose.Rs256(RawJose.Header("attacker-kid", extra: ("jwk", RawJose.Jwk(attacker, "attacker-kid"))), payload, attacker);
    Assert.Equal("unknown_kid", (await verifier.VerifyAsync(ownKid)).Reason);
    Assert.Equal(1, jwks.Calls - before);

    // Remote key URLs: never fetched. The stub records every issuer it is asked for.
    var remote = RawJose.Rs256(RawJose.Header(Kid, "RS256", ("jku", "https://attacker.example/jwks.json"), ("x5u", "https://attacker.example/cert.pem")), payload, attacker);
    Assert.Equal("signature", (await verifier.VerifyAsync(remote)).Reason);
    Assert.All(jwks.Issuers, issuer => Assert.Contains(issuer, new[] { TestJwt.ConsoleIssuer, TestJwt.MobileIssuer }));

    // A self-signed certificate chain for the attacker key in `x5c`.
    var request = new CertificateRequest("CN=attacker", attacker, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    using var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
    var x5c = RawJose.Rs256(RawJose.Header(Kid, "RS256", ("x5c", new[] { Convert.ToBase64String(cert.RawData) }), ("x5t", RawJose.B64(cert.GetCertHash()))), payload, attacker);
    Assert.False((await verifier.VerifyAsync(x5c)).Ok);

    // Control: the same header extras on a genuinely signed token are ignored, not fatal.
    var genuine = RawJose.Rs256(RawJose.Header(Kid, extra: ("jku", "https://attacker.example/jwks.json")), payload, cognito);
    Assert.True((await verifier.VerifyAsync(genuine)).Ok);
  }

  [Fact]
  public async Task KeyFromOneTrustedPool_PresentedUnderTheOtherPoolsIssuer_IsRejected()
  {
    // Keys are bound to their issuer: a token signed with the console pool's key, claiming
    // the mobile pool's iss, must be looked up in the mobile JWKS (where it is not) and the
    // console JWKS must not be consulted for it.
    using var consoleKey = TestJwt.NewKey();
    using var mobileKey = TestJwt.NewKey();
    var jwks = new StubJwks(issuer => issuer == TestJwt.ConsoleIssuer
      ? TestJwt.Jwks(("console-kid", consoleKey))
      : TestJwt.Jwks(("mobile-kid", mobileKey)));

    var token = TestJwt.Sign(consoleKey, "console-kid", TestJwt.Payload(issuer: TestJwt.MobileIssuer, groups: ["super_admin"]));
    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.Equal("unknown_kid", result.Reason);
    Assert.Equal([TestJwt.MobileIssuer], jwks.Issuers);
  }

  [Fact]
  public async Task ThirdPoolInTheSameAccount_IsRejected_EvenWhenSignedByATrustedKey()
  {
    // ap-southeast-2_IVLnBIGO4 exists in the account and is not a client of this API. The
    // issuer set is the trust boundary, checked before the key: the signer does not matter.
    using var cognito = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, cognito)));

    var result = await Verifier(jwks).VerifyAsync(TestJwt.Sign(cognito, Kid, TestJwt.Payload(issuer: RawJose.ThirdPoolIssuer, groups: ["super_admin"])));

    Assert.Equal("issuer", result.Reason);
    Assert.Equal(0, jwks.Calls);
  }

  [Fact]
  public async Task TokenUse_EditedInASignedToken_BreaksTheSignature()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var genuine = TestJwt.Sign(key, Kid, TestJwt.Payload(tokenUse: "access", groups: ["super_admin"]));
    var parts = genuine.Split('.');
    var payload = Encoding.UTF8.GetString(Microsoft.IdentityModel.Tokens.Base64UrlEncoder.DecodeBytes(parts[1]));
    var edited = parts[0] + "." + RawJose.B64(payload.Replace("\"access\"", "\"id\"")) + "." + parts[2];

    Assert.Equal("signature", (await Verifier(jwks).VerifyAsync(edited)).Reason);
  }

  [Fact]
  public async Task ClockSkew_IsExactlySixtySeconds()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var verifier = Verifier(jwks);
    var now = TestJwt.Now();

    Assert.True((await verifier.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(exp: now)))).Ok);
    Assert.True((await verifier.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(exp: now - 59)))).Ok);
    Assert.Equal("expired", (await verifier.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(exp: now - 61)))).Reason);
    Assert.True((await verifier.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(nbf: now + 59)))).Ok);
    Assert.Equal("not_yet_valid", (await verifier.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(nbf: now + 61)))).Reason);
  }

  [Fact]
  public async Task DuplicatedClaims_ValidatorAndConsumerReadTheSameCopy_AndOnlyUnderAGenuineSignature()
  {
    // JSON allows a key twice. The danger is a split brain: the validator checks one copy
    // (say the first `iss`, trusted) while the claims handed to Auth carry the other. Both the
    // token handler and the claims re-read are last-wins, so the copy that was validated is
    // the copy that is consumed; and none of it matters unless the signature is genuine.
    using var cognito = TestJwt.NewKey();
    using var attacker = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, cognito)));
    var verifier = Verifier(jwks);
    var header = RawJose.Header(Kid);
    var now = TestJwt.Now();
    string Body(string iss1, string iss2, string groups1, string groups2) =>
      "{\"iss\":\"" + iss1 + "\",\"iss\":\"" + iss2 + "\",\"sub\":\"s\",\"token_use\":\"access\",\"exp\":" + (now + 3600) +
      ",\"cognito:groups\":" + groups1 + ",\"cognito:groups\":" + groups2 + "}";

    var trustedThenThird = await verifier.VerifyAsync(RawJose.Rs256(header, Body(TestJwt.ConsoleIssuer, RawJose.ThirdPoolIssuer, "[\"super_admin\"]", "[]"), cognito));
    Assert.Equal("issuer", trustedThenThird.Reason);

    var thirdThenTrusted = await verifier.VerifyAsync(RawJose.Rs256(header, Body(RawJose.ThirdPoolIssuer, TestJwt.ConsoleIssuer, "[\"super_admin\"]", "[]"), cognito));
    Assert.True(thirdThenTrusted.Ok, thirdThenTrusted.Reason);
    Assert.Equal(TestJwt.ConsoleIssuer, thirdThenTrusted.Claims!["iss"].GetString());
    Assert.Empty(thirdThenTrusted.Claims["cognito:groups"].EnumerateArray());

    var forged = await verifier.VerifyAsync(RawJose.Rs256(header, Body(RawJose.ThirdPoolIssuer, TestJwt.ConsoleIssuer, "[]", "[\"super_admin\"]"), attacker));
    Assert.Equal("signature", forged.Reason);

    // Duplicated `alg` in the header, unsigned: whichever copy wins, an empty signature loses.
    Assert.False((await verifier.VerifyAsync(RawJose.Unsigned("{\"alg\":\"none\",\"alg\":\"RS256\",\"kid\":\"" + Kid + "\"}", SuperAdminPayload()))).Ok);
    Assert.False((await verifier.VerifyAsync(RawJose.Unsigned("{\"alg\":\"RS256\",\"alg\":\"none\",\"kid\":\"" + Kid + "\"}", SuperAdminPayload()))).Ok);
  }

  [Fact]
  public async Task OversizedTokens_AreRejectedNotParsedOpen()
  {
    using var cognito = TestJwt.NewKey();
    using var attacker = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, cognito)));
    var verifier = Verifier(jwks);

    var twentyKb = RawJose.Header(Kid, extra: ("pad", new string('A', 20 * 1024)));
    Assert.Equal("signature", (await verifier.VerifyAsync(RawJose.Rs256(twentyKb, SuperAdminPayload(), attacker))).Reason);

    // Past the token handler's size ceiling: not even read, so not even a signature check.
    var threeHundredKb = RawJose.Header(Kid, extra: ("pad", new string('A', 300 * 1024)));
    Assert.Equal("malformed", (await verifier.VerifyAsync(RawJose.Rs256(threeHundredKb, SuperAdminPayload(), cognito))).Reason);
  }

  [Fact]
  public async Task BundledKeys_ResolveTheRealKids_WithoutTheNetwork()
  {
    // The four kids Cognito publishes today for the two pools, against the bundled files and
    // a live source that throws (core-vpc has no egress). "signature" and not "unknown_kid"
    // or "jwks_unavailable" proves the key came from the bundle.
    using var attacker = TestJwt.NewKey();
    var jwks = new StubJwks(_ => throw new HttpRequestException("no egress"));
    var verifier = new CognitoJwtVerifier(jwks, CognitoJwtVerifier.ParseIssuers(null), BundledJwks.Read);

    foreach (var (issuer, kid) in new[]
    {
      (TestJwt.ConsoleIssuer, "xRplDC0zB8GEk2p7ftUHae/n1nYgbj0XBWmJR4DPJNA="),
      (TestJwt.ConsoleIssuer, "v79GxFqcp47u/dYOxOss+vI5sSJFSpcfRByiYsGdbds="),
      (TestJwt.MobileIssuer, "L0KS/uqsH6QOFXtjiTiSKvvgQsrbTO6/PiShdgGG/X8="),
      (TestJwt.MobileIssuer, "CWYpNVP3QoEPA2vf1upZ7Q6CvjjI9I6/9ylxBl8oFLc="),
    })
    {
      var result = await verifier.VerifyAsync(TestJwt.Sign(attacker, kid, TestJwt.Payload(issuer: issuer, groups: ["super_admin"])));
      Assert.Equal("signature", result.Reason);
    }
    Assert.Equal(0, jwks.Calls);
  }

  [Fact]
  public async Task CognitoShapedTokens_ConsoleAccess_MobileId_MobileAccess_AreAccepted()
  {
    // Byte-level shape of what the clients actually send: the header is {"kid","alg"} with no
    // typ; an access token carries client_id/scope/username and no aud; an id token carries
    // aud/email/cognito:username and no client_id. ValidateAudience is off, so the access
    // token's missing aud is not a rejection.
    using var consoleKey = TestJwt.NewKey();
    using var mobileKey = TestJwt.NewKey();
    var jwks = new StubJwks(issuer => issuer == TestJwt.ConsoleIssuer ? TestJwt.Jwks(("ck", consoleKey)) : TestJwt.Jwks(("mk", mobileKey)));
    var verifier = Verifier(jwks);
    var now = TestJwt.Now();

    var consoleAccess = new Dictionary<string, object?>
    {
      ["sub"] = "11111111-2222-3333-4444-555555555555", ["cognito:groups"] = new[] { "super_admin" }, ["iss"] = TestJwt.ConsoleIssuer,
      ["version"] = 2, ["client_id"] = "6lkofeppclientid", ["origin_jti"] = "o", ["event_id"] = "e", ["token_use"] = "access",
      ["scope"] = "aws.cognito.signin.user.admin openid", ["auth_time"] = now - 100, ["exp"] = now + 3600, ["iat"] = now - 100,
      ["jti"] = "j", ["username"] = "11111111-2222-3333-4444-555555555555",
    };
    var r1 = await verifier.VerifyAsync(RawJose.Rs256("{\"kid\":\"ck\",\"alg\":\"RS256\"}", RawJose.Payload(consoleAccess), consoleKey));
    Assert.True(r1.Ok, r1.Reason);
    Assert.Equal("6lkofeppclientid", r1.Claims!["client_id"].GetString());
    Assert.False(r1.Claims.ContainsKey("aud"));

    var mobileId = new Dictionary<string, object?>
    {
      ["sub"] = "aaaa", ["email_verified"] = true, ["iss"] = TestJwt.MobileIssuer, ["cognito:username"] = "aaaa", ["origin_jti"] = "o",
      ["aud"] = "mobileclientid", ["event_id"] = "e", ["token_use"] = "id", ["auth_time"] = now, ["exp"] = now + 3600, ["iat"] = now,
      ["jti"] = "j", ["email"] = "u@example.com",
    };
    var r2 = await verifier.VerifyAsync(RawJose.Rs256("{\"kid\":\"mk\",\"alg\":\"RS256\"}", RawJose.Payload(mobileId), mobileKey));
    Assert.True(r2.Ok, r2.Reason);

    var mobileAccess = new Dictionary<string, object?>(consoleAccess) { ["iss"] = TestJwt.MobileIssuer, ["client_id"] = "mobileclientid" };
    mobileAccess.Remove("cognito:groups");
    var r3 = await verifier.VerifyAsync(RawJose.Rs256("{\"kid\":\"mk\",\"alg\":\"RS256\"}", RawJose.Payload(mobileAccess), mobileKey));
    Assert.True(r3.Ok, r3.Reason);
  }
}

/// <summary>
/// The same attacks at the route, plus the production policy read from the real environment.
/// Serial (postgres collection) because <see cref="Auth.Configure"/> and the environment are
/// process-global.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AuthBearerAdversarialTests : IDisposable
{
  private const string CardsPath = "/api/v1/authoring/cards";
  private const string Kid = "cognito-kid-1";
  private readonly RSA _cognito = TestJwt.NewKey();
  private readonly RSA _attacker = TestJwt.NewKey();
  private readonly StubJwks _jwks;

  public AuthBearerAdversarialTests()
  {
    _jwks = new StubJwks(TestJwt.Jwks((Kid, _cognito)));
    Auth.Configure(AuthOptions.Parse(null, null, "production"), _jwks);
  }

  public void Dispose()
  {
    Environment.SetEnvironmentVariable(AuthOptions.AllowUnverifiedEnv, null);
    Environment.SetEnvironmentVariable(AuthOptions.ApiEnvEnv, null);
    Environment.SetEnvironmentVariable(AuthOptions.IssuersEnv, null);
    Auth.ResetToEnvironment();
    _cognito.Dispose();
    _attacker.Dispose();
  }

  private static JsonElement Event(string path, string? authorization, object? authorizer = null)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (authorization is not null) headers["authorization"] = authorization;
    var requestContext = new Dictionary<string, object?> { ["requestId"] = Guid.NewGuid().ToString(), ["http"] = new { method = "GET" } };
    if (authorizer is not null) requestContext["authorizer"] = authorizer;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext,
      headers,
      queryStringParameters = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static Task<APIGatewayProxyResponse> CallAsync(string bearer) => new VpcFunction().Handler(Event(CardsPath, "Bearer " + bearer));

  private static string ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString()!;

  [Fact]
  public async Task KeyConfusion_HeaderKey_ThirdPool_OversizedHeader_AllAnswer401()
  {
    var payload = RawJose.Payload(TestJwt.Payload(groups: ["super_admin"]));
    var modulus = _cognito.ExportParameters(false).Modulus!;
    var tokens = new[]
    {
      RawJose.Hmac(RawJose.Header(Kid, "HS256"), payload, Encoding.ASCII.GetBytes(RawJose.B64(modulus))),
      RawJose.Rs256(RawJose.Header(Kid, extra: ("jwk", RawJose.Jwk(_attacker, Kid))), payload, _attacker),
      TestJwt.Sign(_cognito, Kid, TestJwt.Payload(issuer: RawJose.ThirdPoolIssuer, groups: ["super_admin"])),
      RawJose.Rs256(RawJose.Header(Kid, extra: ("pad", new string('A', 20 * 1024))), payload, _attacker),
    };

    foreach (var token in tokens)
    {
      var response = await CallAsync(token);
      Assert.Equal(401, response.StatusCode);
      Assert.Equal("UNAUTHORIZED", ErrorCode(response));
    }
  }

  [Fact]
  public async Task GatewayClaims_LegacyRestShape_StillWins()
  {
    // requestContext.authorizer.claims (REST API v1) alongside the v2 jwt.claims shape already
    // covered: both are the gateway's verified output and both pre-empt the bearer.
    var legacy = new { claims = new Dictionary<string, object> { ["sub"] = "gw", ["cognito:groups"] = "super_admin" } };
    var forged = TestJwt.Unsigned(Kid, TestJwt.Payload(groups: ["super_admin"]));

    var response = await new VpcFunction().Handler(Event(CardsPath, "Bearer " + forged, legacy));

    Assert.Equal(200, response.StatusCode);
    Assert.Equal(0, _jwks.Calls);
  }

  [Fact]
  public async Task ProductionReadFromTheRealEnvironment_FlagSet_FallbackStaysUnreachable()
  {
    // Not the pure Parse: the actual environment variables, read through ResetToEnvironment,
    // which is the path the Lambda takes. AUTH_ALLOW_UNVERIFIED=1 with API_ENV=production
    // must parse to "verify", and an alg=none super_admin must still be a 401.
    Environment.SetEnvironmentVariable(AuthOptions.AllowUnverifiedEnv, "1");
    Environment.SetEnvironmentVariable(AuthOptions.ApiEnvEnv, "production");
    Auth.ResetToEnvironment();
    Assert.False(Auth.Options.AllowUnverified);
    Auth.Configure(Auth.Options, _jwks);

    var response = await CallAsync(TestJwt.Unsigned(Kid, TestJwt.Payload(groups: ["super_admin"])));

    Assert.Equal(401, response.StatusCode);
    Assert.Equal("UNAUTHORIZED", ErrorCode(response));
  }

  [Fact]
  public async Task UnparseableAuthIssuers_FailsClosed()
  {
    // A bad AUTH_ISSUERS value throws in EnsureConfigured (caught and logged by the function
    // constructor) and again on the first request; the handler's catch yields an anonymous
    // context, so a genuine super_admin is denied rather than let through.
    Environment.SetEnvironmentVariable(AuthOptions.IssuersEnv, "garbage-no-underscore");
    Environment.SetEnvironmentVariable(AuthOptions.ApiEnvEnv, "production");
    Auth.ResetToEnvironment();
    Assert.Throws<ArgumentException>(Auth.EnsureConfigured);

    var response = await CallAsync(TestJwt.Sign(_cognito, Kid, TestJwt.Payload(groups: ["super_admin"])));

    Assert.NotEqual(200, response.StatusCode);
  }
}
