using System.Security.Cryptography;
using System.Text.Json;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The in-process bearer verifier, against tokens minted by hand: what it accepts, what it
/// rejects, and -- the property that decides whether the JWKS endpoint is a liability -- how
/// often it goes to the network.
///
/// Pure: every test builds its own verifier over its own stub key source, so nothing here
/// touches the process environment, the static <see cref="Auth"/> configuration, or a
/// database. The wiring of this verifier into the real handler is covered separately in
/// <see cref="AuthBearerTests"/>, which is where a forged super_admin meets a real route.
/// </summary>
public class JwtVerifierTests
{
  private const string Kid = "kid-A";

  private static CognitoJwtVerifier Verifier(StubJwks jwks, params string[] issuers) =>
    new(jwks, issuers.Length == 0 ? [TestJwt.ConsoleIssuer, TestJwt.MobileIssuer] : issuers);

  // ------------------------------------------------------------------ accepts

  [Fact]
  public async Task ValidAccessToken_YieldsClaims_IncludingGroups()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var token = TestJwt.Sign(key, Kid, TestJwt.Payload(sub: "sub-1", groups: ["super_admin", "editor_x"]));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.True(result.Ok, result.Reason);
    Assert.Equal("ok", result.Reason);
    Assert.NotNull(result.Claims);
    Assert.Equal("sub-1", result.Claims!["sub"].GetString());
    Assert.Equal("access", result.Claims["token_use"].GetString());
    var groups = result.Claims["cognito:groups"].EnumerateArray().Select(g => g.GetString()).ToList();
    Assert.Equal(["super_admin", "editor_x"], groups);
    Assert.Equal(1, jwks.Calls);
  }

  [Fact]
  public async Task ValidIdToken_YieldsClaims()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var token = TestJwt.Sign(key, Kid, TestJwt.Payload(tokenUse: "id", sub: "sub-id", issuer: TestJwt.MobileIssuer));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.True(result.Ok, result.Reason);
    Assert.Equal("sub-id", result.Claims!["sub"].GetString());
    Assert.Equal("id", result.Claims["token_use"].GetString());
    Assert.Equal("user-sub-id", result.Claims["cognito:username"].GetString());
    Assert.Equal([TestJwt.MobileIssuer], jwks.Issuers);
  }

  [Fact]
  public async Task WithinClockSkew_IsAccepted()
  {
    // 60 s of skew is the contract: a token 30 s past exp, or 30 s before nbf, still passes.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = Verifier(jwks);

    var justExpired = TestJwt.Sign(key, Kid, TestJwt.Payload(exp: TestJwt.Now() - 30));
    Assert.True((await v.VerifyAsync(justExpired)).Ok);

    var almostValid = TestJwt.Sign(key, Kid, TestJwt.Payload(nbf: TestJwt.Now() + 30));
    Assert.True((await v.VerifyAsync(almostValid)).Ok);
  }

  // ------------------------------------------------------------------ rejects

  [Fact]
  public async Task AlgNone_IsRejected_WithoutTouchingTheJwks()
  {
    // The forgery the old code accepted: no signature at all, super_admin in the payload.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var token = TestJwt.Unsigned(Kid, TestJwt.Payload(groups: ["super_admin"]));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("alg", result.Reason);
    Assert.Null(result.Claims);
    Assert.Equal(0, jwks.Calls);
  }

  [Fact]
  public async Task WrongKey_IsRejected()
  {
    // Right kid, right issuer, right shape, signed by someone who is not Cognito.
    using var real = TestJwt.NewKey();
    using var attacker = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, real)));
    var token = TestJwt.ResignedWith(attacker, Kid, TestJwt.Payload(groups: ["super_admin"]));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("signature", result.Reason);
    Assert.Null(result.Claims);
  }

  [Fact]
  public async Task Expired_IsRejected()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var token = TestJwt.Sign(key, Kid, TestJwt.Payload(exp: TestJwt.Now() - 120));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("expired", result.Reason);
  }

  [Fact]
  public async Task NotYetValid_IsRejected()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var token = TestJwt.Sign(key, Kid, TestJwt.Payload(nbf: TestJwt.Now() + 120));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("not_yet_valid", result.Reason);
  }

  [Fact]
  public async Task MissingExp_IsRejected()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var payload = TestJwt.Payload();
    payload.Remove("exp");
    var token = TestJwt.Sign(key, Kid, payload);

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("no_exp", result.Reason);
  }

  [Fact]
  public async Task WrongIssuer_IsRejected_WithoutTouchingTheJwks()
  {
    // A perfectly good token from a pool this API does not trust. Also: the issuer decides
    // which JWKS to fetch, so an untrusted issuer must never cause a fetch of anything.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var foreign = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_attacker";
    var token = TestJwt.Sign(key, Kid, TestJwt.Payload(issuer: foreign, groups: ["super_admin"]));

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("issuer", result.Reason);
    Assert.Equal(0, jwks.Calls);
  }

  [Fact]
  public async Task IssuerCheck_IsExactMatch()
  {
    // Prefix and suffix games on the issuer string are the other classic: a pool id that
    // merely contains ours, or ours with a path appended.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = Verifier(jwks);

    foreach (var iss in new[] { TestJwt.ConsoleIssuer + "x", TestJwt.ConsoleIssuer + "/extra", "x" + TestJwt.ConsoleIssuer })
    {
      var result = await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(issuer: iss)));
      Assert.Equal("issuer", result.Reason);
    }
    Assert.Equal(0, jwks.Calls);
  }

  [Theory]
  [InlineData("refresh")]
  [InlineData("")]
  [InlineData(null)]
  public async Task TokenUse_MustBeAccessOrId(string? tokenUse)
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var payload = TestJwt.Payload();
    if (tokenUse is null) payload.Remove("token_use"); else payload["token_use"] = tokenUse;

    var result = await Verifier(jwks).VerifyAsync(TestJwt.Sign(key, Kid, payload));

    Assert.False(result.Ok);
    Assert.Equal("token_use", result.Reason);
    Assert.Equal(0, jwks.Calls);
  }

  [Fact]
  public async Task MissingKid_IsRejected()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));

    var result = await Verifier(jwks).VerifyAsync(TestJwt.Sign(key, "", TestJwt.Payload()));

    Assert.False(result.Ok);
    Assert.Equal("kid", result.Reason);
    Assert.Equal(0, jwks.Calls);
  }

  [Theory]
  [InlineData("")]
  [InlineData("not-a-jwt")]
  [InlineData("a.b")]
  [InlineData("!!!.@@@.###")]
  public async Task NotAJwt_IsRejectedAsMalformed(string token)
  {
    // What a RevenueCat webhook's shared-secret bearer looks like to this code. Rejected,
    // cheaply, and reported as "malformed" so Auth can log it below the warn level.
    var jwks = new StubJwks("{\"keys\":[]}");

    var result = await Verifier(jwks).VerifyAsync(token);

    Assert.False(result.Ok);
    Assert.Equal("malformed", result.Reason);
    Assert.Equal(0, jwks.Calls);
  }

  // ------------------------------------------------------------ the key cache

  [Fact]
  public async Task Jwks_IsFetchedOnce_AndReused()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = Verifier(jwks);

    for (var i = 0; i < 5; i++)
    {
      Assert.True((await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()))).Ok);
    }

    Assert.Equal(1, jwks.Calls);
  }

  [Fact]
  public async Task UnknownKid_TriggersExactlyOneRefresh()
  {
    // Warm the cache, then present a kid the JWKS will never contain. Exactly one re-fetch
    // for the first miss, and none for the second: an invented kid must not be a lever that
    // turns every request into an outbound HTTPS call.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = Verifier(jwks);
    Assert.True((await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()))).Ok);
    Assert.Equal(1, jwks.Calls);

    var first = await v.VerifyAsync(TestJwt.Sign(key, "kid-unknown", TestJwt.Payload()));
    Assert.Equal("unknown_kid", first.Reason);
    Assert.Equal(2, jwks.Calls);

    var second = await v.VerifyAsync(TestJwt.Sign(key, "kid-unknown-2", TestJwt.Payload()));
    Assert.Equal("unknown_kid", second.Reason);
    Assert.Equal(2, jwks.Calls);

    // And the cached key still serves: the failed refreshes did not poison the cache.
    Assert.True((await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()))).Ok);
    Assert.Equal(2, jwks.Calls);
  }

  [Fact]
  public async Task RotatedKey_IsPickedUpByTheRefresh()
  {
    // The reason the refresh exists at all: Cognito publishes a new key, tokens start
    // arriving under its kid, and the cached set is stale. One fetch later they verify.
    using var keyA = TestJwt.NewKey();
    using var keyB = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks(("kid-A", keyA)));
    var v = Verifier(jwks);
    Assert.True((await v.VerifyAsync(TestJwt.Sign(keyA, "kid-A", TestJwt.Payload()))).Ok);

    jwks.Serve(TestJwt.Jwks(("kid-A", keyA), ("kid-B", keyB)));
    var result = await v.VerifyAsync(TestJwt.Sign(keyB, "kid-B", TestJwt.Payload(sub: "rotated")));

    Assert.True(result.Ok, result.Reason);
    Assert.Equal("rotated", result.Claims!["sub"].GetString());
    Assert.Equal(2, jwks.Calls);
  }

  [Fact]
  public async Task JwksFetchFailure_IsRejected_NotOpen()
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    jwks.Fail(new HttpRequestException("connect timeout"));

    var result = await Verifier(jwks).VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(groups: ["super_admin"])));

    Assert.False(result.Ok);
    Assert.Equal("jwks_unavailable", result.Reason);
    Assert.Null(result.Claims);
  }

  [Fact]
  public async Task JwksFetchFailure_IsNotCached_NextRequestRetries()
  {
    // A transient outage must not be remembered as "no keys": the next token tries again,
    // and succeeds once the endpoint is back.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = Verifier(jwks);
    var token = TestJwt.Sign(key, Kid, TestJwt.Payload());

    jwks.Fail(new HttpRequestException("503"));
    Assert.Equal("jwks_unavailable", (await v.VerifyAsync(token)).Reason);

    jwks.Serve(TestJwt.Jwks((Kid, key)));
    Assert.True((await v.VerifyAsync(token)).Ok);
    Assert.Equal(2, jwks.Calls);
  }

  [Fact]
  public async Task FailedRefresh_StartsTheCooldown_AndKeepsTheCachedKeys()
  {
    // The no-egress case for real: core-vpc cannot reach Cognito, so a refresh triggered by
    // an unknown kid times out. That must cost one attempt per cooldown, not one per
    // request, and it must leave the keys the container already holds untouched.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = Verifier(jwks);
    Assert.True((await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()))).Ok);

    jwks.Fail(new TaskCanceledException("3 s budget"));
    Assert.Equal("jwks_unavailable", (await v.VerifyAsync(TestJwt.Sign(key, "kid-x", TestJwt.Payload()))).Reason);
    Assert.Equal(2, jwks.Calls);

    Assert.Equal("unknown_kid", (await v.VerifyAsync(TestJwt.Sign(key, "kid-y", TestJwt.Payload()))).Reason);
    Assert.Equal(2, jwks.Calls);

    Assert.True((await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()))).Ok);
    Assert.Equal(2, jwks.Calls);
  }

  [Theory]
  [InlineData("not json")]
  [InlineData("{}")]
  [InlineData("{\"keys\":[]}")]
  public async Task UnusableJwks_IsRejected(string served)
  {
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(served);

    var result = await Verifier(jwks).VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()));

    Assert.False(result.Ok);
    Assert.Contains(result.Reason, new[] { "jwks_unavailable", "unknown_kid" });
  }

  [Fact]
  public async Task NonRsaKey_WithMatchingKid_IsNotUsed()
  {
    // A JWKS entry of another type under our kid: filtered out at parse time, so the RS256
    // validator never sees it and the token is "unknown_kid", not something stranger.
    using var key = TestJwt.NewKey();
    var jwks = new StubJwks(JsonSerializer.Serialize(new
    {
      keys = new[] { new { kty = "oct", kid = Kid, k = "c2VjcmV0" } },
    }));

    var result = await Verifier(jwks).VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()));

    Assert.False(result.Ok);
    Assert.Equal("unknown_kid", result.Reason);
  }

  // ------------------------------------------------------------ the bundled seed

  [Fact]
  public async Task Seed_VerifiesAtColdStart_WithoutTheNetwork()
  {
    // What makes this deployable to a function with no internet egress: the first token is
    // verified against the bundled document, and the live source is never asked.
    using var key = TestJwt.NewKey();
    var live = new StubJwks("{\"keys\":[]}");
    var v = new CognitoJwtVerifier(live, [TestJwt.ConsoleIssuer], seed: _ => TestJwt.Jwks((Kid, key)));

    var result = await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload(sub: "seeded")));

    Assert.True(result.Ok, result.Reason);
    Assert.Equal("seeded", result.Claims!["sub"].GetString());
    Assert.Equal(0, live.Calls);
  }

  [Fact]
  public async Task Seed_MissingKid_FallsThroughToTheLiveSource_Once()
  {
    // A kid the bundle does not list is an unknown kid like any other: one live refresh,
    // then the cooldown. A bundled key set that is stale therefore degrades to the fetched
    // behaviour, never to an open door.
    using var bundled = TestJwt.NewKey();
    using var rotated = TestJwt.NewKey();
    var live = new StubJwks(TestJwt.Jwks(("kid-old", bundled), ("kid-new", rotated)));
    var v = new CognitoJwtVerifier(live, [TestJwt.ConsoleIssuer], seed: _ => TestJwt.Jwks(("kid-old", bundled)));

    Assert.True((await v.VerifyAsync(TestJwt.Sign(rotated, "kid-new", TestJwt.Payload()))).Ok);
    Assert.Equal(1, live.Calls);

    Assert.Equal("unknown_kid", (await v.VerifyAsync(TestJwt.Sign(rotated, "kid-none", TestJwt.Payload()))).Reason);
    Assert.Equal(2, live.Calls);
    Assert.Equal("unknown_kid", (await v.VerifyAsync(TestJwt.Sign(rotated, "kid-none-2", TestJwt.Payload()))).Reason);
    Assert.Equal(2, live.Calls);
  }

  [Fact]
  public async Task Seed_ThatDoesNotParse_IsIgnored_NotTrusted()
  {
    using var key = TestJwt.NewKey();
    var live = new StubJwks(TestJwt.Jwks((Kid, key)));
    var v = new CognitoJwtVerifier(live, [TestJwt.ConsoleIssuer], seed: _ => "this is not a key set");

    Assert.True((await v.VerifyAsync(TestJwt.Sign(key, Kid, TestJwt.Payload()))).Ok);
    Assert.Equal(1, live.Calls);
  }

  [Fact]
  public void BundledJwks_ShipsBothPools_NextToTheAssembly()
  {
    // The files exist in the OUTPUT directory, which is the deployable claim: a None item
    // that is in the repo but not copied would pass a source-tree check and fail at cold
    // start in the one environment that cannot fall back to the network.
    foreach (var issuer in CognitoJwtVerifier.ParseIssuers(null))
    {
      var json = BundledJwks.Read(issuer);
      Assert.False(string.IsNullOrWhiteSpace(json), $"no bundled JWKS for {issuer}");

      var keys = new Microsoft.IdentityModel.Tokens.JsonWebKeySet(json).Keys;
      Assert.NotEmpty(keys);
      Assert.All(keys, k =>
      {
        Assert.Equal("RSA", k.Kty);
        Assert.Equal("RS256", k.Alg);
        Assert.False(string.IsNullOrEmpty(k.Kid));
        Assert.False(k.HasPrivateKey);
      });
    }
  }

  [Theory]
  [InlineData("https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_nosuchpool")]
  [InlineData("https://cognito-idp.ap-southeast-2.amazonaws.com/")]
  [InlineData("https://cognito-idp.ap-southeast-2.amazonaws.com/..")]
  public void BundledJwks_UnknownOrOddIssuer_IsNull(string issuer)
  {
    Assert.Null(BundledJwks.Read(issuer));
  }

  // ------------------------------------------------------------ configuration

  [Fact]
  public void ParseIssuers_Default_IsTodaysTwoPools()
  {
    Assert.Equal([TestJwt.ConsoleIssuer, TestJwt.MobileIssuer], CognitoJwtVerifier.ParseIssuers(null));
    Assert.Equal([TestJwt.ConsoleIssuer, TestJwt.MobileIssuer], CognitoJwtVerifier.ParseIssuers("  "));
  }

  [Fact]
  public void ParseIssuers_AcceptsPoolIdsAndUrls_AndCanonicalises()
  {
    var parsed = CognitoJwtVerifier.ParseIssuers(
      " ap-southeast-2_4Vf8uCXKt , https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc/ ,, ap-southeast-2_4Vf8uCXKt");

    Assert.Equal(
      [TestJwt.ConsoleIssuer, "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc"],
      parsed);
  }

  [Theory]
  [InlineData("")]
  [InlineData("nounderscore")]
  [InlineData("_abc")]
  public void NormalizeIssuer_RejectsThingsThatAreNeitherPoolIdNorUrl(string raw)
  {
    Assert.Throws<ArgumentException>(() => CognitoJwtVerifier.NormalizeIssuer(raw));
  }

  [Fact]
  public void Verifier_RequiresAtLeastOneIssuer()
  {
    Assert.Throws<ArgumentException>(() => new CognitoJwtVerifier(new StubJwks("{}"), []));
  }

  [Theory]
  [InlineData("1", "production", false)]
  [InlineData("1", "Production", false)]
  [InlineData("1", " production ", false)]
  [InlineData("1", "dev", true)]
  [InlineData("1", "staging", true)]
  [InlineData("1", null, true)]
  [InlineData("1", "", true)]
  [InlineData(null, "dev", false)]
  [InlineData("", "dev", false)]
  [InlineData("true", "dev", false)]
  [InlineData("0", "dev", false)]
  public void AllowUnverified_OnlyWithFlagOne_AndNeverInProduction(string? flag, string? apiEnv, bool expected)
  {
    Assert.Equal(expected, AuthOptions.Parse(null, flag, apiEnv).AllowUnverified);
  }

  [Fact]
  public void AuthOptions_CarryTheIssuerList()
  {
    var options = AuthOptions.Parse("ap-southeast-2_only", null, "production");
    Assert.Equal(["https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_only"], options.Issuers);
    Assert.False(options.AllowUnverified);
  }
}
