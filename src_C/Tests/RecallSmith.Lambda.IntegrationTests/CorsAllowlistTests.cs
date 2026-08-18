using System.Text.Json;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The Lambda-side CORS allowlist: which origin a response says it allows, and when it says
/// nothing at all.
///
/// The failure this guards against is not a broken response, it is a working one. API Gateway
/// already holds an allowlist; the Lambda answered "*" regardless. Two layers that disagree
/// look identical in every green test until someone widens the gateway, at which point the
/// widening is the whole exposure. So the assertions below are mostly about what is NOT in
/// the response — an absent access-control-allow-origin, an origin that is not echoed — which
/// is exactly the class of claim that no happy-path test makes.
///
/// Split in two halves on purpose. The decision is a pure function of (configured value,
/// request origin) and is tested as one, because the alternative — driving every case through
/// the environment — would mean a process-global mutation per case for logic that has nothing
/// global about it. The second half then drives the real constructor and the real handler,
/// which is the only way to catch the wiring bugs the pure tests cannot see: a constructor
/// that ignores the env var, a handler that never passes the request's origin.
/// </summary>
/// <remarks>
/// In the postgres collection although only two tests need a database at all. CORS_ORIGIN is
/// process-global state, and so is the Console that the handler test writes to; xunit runs
/// separate collections in parallel, so a class of its own could flip the env var underneath
/// LambdaHost (which builds a Res per invocation) or spill log lines into DbWarmupTests's
/// capture buffer. Same reasoning as WarmupDecisionTests, and the fixture is likewise not
/// injected.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class CorsAllowlistTests
{
  private const string EnvVar = "CORS_ORIGIN";
  private const string Cdn = "https://d2xexample.cloudfront.net";
  private const string Local = "http://localhost:5173";
  private const string List = Local + "," + Cdn;

  // Today's values, spelled out rather than read from the code under test: a test that asks
  // Res what Res emits would follow it anywhere.
  private const string AllowHeaders =
    "authorization,content-type,accept,x-internal-timestamp,x-internal-signature,x-migrate-secret";
  private const string AllowMethods = "GET,POST,PUT,DELETE,OPTIONS";

  // ---------------------------------------------------------------- the decision

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData(Cdn)]
  public void Decide_UnsetEnv_IsWildcardWithNoVary(string? requestOrigin)
  {
    // The precondition for shipping this at all: the code goes out before the env var does,
    // so with nothing configured it must answer exactly what it answered yesterday, whatever
    // origin the caller sends.
    Assert.Equal(new Res.CorsDecision("*", false), Res.DecideCors(null, requestOrigin));
  }

  [Theory]
  [InlineData("*")]
  [InlineData("  *  ")]
  public void Decide_ExplicitStar_IsStillWildcard(string configured)
  {
    // The dangerous ordering: a function that already sets CORS_ORIGIN=* explicitly. Reading
    // that as a one-entry allowlist would match no origin and take the whole API out of the
    // browser on deploy, before anyone touched the configuration.
    Assert.Equal(new Res.CorsDecision("*", false), Res.DecideCors(configured, Cdn));
  }

  [Theory]
  [InlineData(Local)]
  [InlineData(Cdn)]
  public void Decide_MatchingOrigin_IsEchoedWithVary(string requestOrigin)
  {
    // Both entries, not just the first: "comma-separated list" is the requirement, and a
    // single-value implementation passes any test that only ever asks about entry one.
    Assert.Equal(new Res.CorsDecision(requestOrigin, true), Res.DecideCors(List, requestOrigin));
  }

  [Fact]
  public void Decide_NonMatchingOrigin_AllowsNobodyAndStillVaries()
  {
    Assert.Equal(new Res.CorsDecision(null, true), Res.DecideCors(List, "https://evil.example"));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  public void Decide_NoRequestOrigin_UnderAList_AllowsNobody(string? requestOrigin)
  {
    Assert.Equal(new Res.CorsDecision(null, true), Res.DecideCors(List, requestOrigin));
  }

  [Fact]
  public void Decide_ConfiguredList_NeverAnswersStar()
  {
    // Literally asking for the wildcard does not produce one. Cheap to state, and it is the
    // sentence in the issue ("never `*` when a list is configured") that an implementation
    // built out of string concatenation is most likely to break.
    Assert.Equal(new Res.CorsDecision(null, true), Res.DecideCors(List, "*"));
  }

  [Fact]
  public void Decide_EntriesAreTrimmed()
  {
    // Env vars are edited by hand in a console; "a, b" is what a human types.
    Assert.Equal(
      new Res.CorsDecision(Cdn, true),
      Res.DecideCors($" {Local} , {Cdn} ", Cdn));
  }

  [Fact]
  public void Decide_CaseDifferingEntry_MatchesAndEchoesTheRequestSpelling()
  {
    // Host and scheme are case-insensitive, so this IS the same origin and must match. What
    // goes back on the wire is the browser's spelling, though: the browser compares the
    // header against its own serialised origin exactly, so echoing the configured casing
    // would fail the check the entry was written to pass.
    Assert.Equal(
      new Res.CorsDecision("https://d2xexample.cloudfront.net", true),
      Res.DecideCors("HTTPS://D2XExample.CloudFront.NET", "https://d2xexample.cloudfront.net"));
  }

  [Theory]
  [InlineData("")]
  [InlineData("   ")]
  [InlineData(",")]
  [InlineData(" , ")]
  public void Decide_ConfigurationThatParsesToNothing_AllowsNobody(string configured)
  {
    // Fails closed rather than falling back to "*". A typo in the allowlist is the one input
    // where "restore the old default" and "open the API to everyone" are the same action.
    Assert.Equal(new Res.CorsDecision(null, true), Res.DecideCors(configured, Cdn));
  }

  [Fact]
  public void Decide_StarAmongRealEntries_StopsBeingAWildcard()
  {
    var configured = "*," + Cdn;

    Assert.Equal(new Res.CorsDecision(null, true), Res.DecideCors(configured, "https://evil.example"));
    Assert.Equal(new Res.CorsDecision(Cdn, true), Res.DecideCors(configured, Cdn));
  }

  // ---------------------------------------------------------------- the response

  [Fact]
  public void Headers_WithEnvUnset_AreExactlyTodays()
  {
    WithCorsOrigin(null, () =>
    {
      // Order included, not just content. Dictionary<K,V> enumerates in insertion order as
      // long as nothing is removed, and this dictionary is serialised straight into the
      // response API Gateway parses -- so pinning the sequence is what makes "unchanged"
      // mean unchanged rather than equivalent.
      var expected = new[]
      {
        KeyValuePair.Create("content-type", "application/json"),
        KeyValuePair.Create("access-control-allow-origin", "*"),
        KeyValuePair.Create("access-control-allow-headers", AllowHeaders),
        KeyValuePair.Create("access-control-allow-methods", AllowMethods),
      };

      Assert.Equal<KeyValuePair<string, string>>(expected, new Res("trace").Ok(null).Headers);

      // And an origin on the request does not perturb it: with nothing configured there is
      // nothing to vary on, so no Vary header appears either.
      Assert.Equal<KeyValuePair<string, string>>(
        expected,
        new Res("trace", Cdn).Ok(null).Headers);
    });
  }

  [Fact]
  public void Headers_WithAllowlist_EchoTheMatchAndVary()
  {
    WithCorsOrigin(List, () =>
    {
      var headers = new Res("trace", Local).Ok(null).Headers;

      Assert.Equal(Local, headers["access-control-allow-origin"]);
      Assert.Equal("Origin", headers["vary"]);
      // The rest of the CORS answer is untouched -- this change is about the origin only.
      Assert.Equal(AllowHeaders, headers["access-control-allow-headers"]);
      Assert.Equal(AllowMethods, headers["access-control-allow-methods"]);
    });
  }

  [Fact]
  public void Headers_WithAllowlist_OmitAllowOriginForAnotherOrigin()
  {
    WithCorsOrigin(List, () =>
    {
      var headers = new Res("trace", "https://evil.example").Ok(null).Headers;

      Assert.False(headers.ContainsKey("access-control-allow-origin"));
      Assert.Equal("Origin", headers["vary"]);
    });
  }

  [Fact]
  public void Headers_WithAllowlist_AndNoRequestOrigin_FailClosed()
  {
    // The one-argument constructor still compiles, and this is what it now means under a
    // configured list. Pinned rather than merely allowed: it is the difference between a
    // forgotten call site losing CORS and a forgotten call site handing it to everyone.
    WithCorsOrigin(List, () =>
    {
      var headers = new Res("trace").Ok(null).Headers;

      Assert.False(headers.ContainsKey("access-control-allow-origin"));
      Assert.Equal("Origin", headers["vary"]);
    });
  }

  [Fact]
  public void Headers_ErrorResponses_CarryTheSameDecision()
  {
    // A 500 is exactly when the browser needs the header: without it the console reports a
    // CORS failure and the real error never reaches the client's error handler.
    WithCorsOrigin(List, () =>
    {
      var headers = new Res("trace", Cdn).Error500(new InvalidOperationException()).Headers;

      Assert.Equal(Cdn, headers["access-control-allow-origin"]);
      Assert.Equal("Origin", headers["vary"]);
    });
  }

  // ---------------------------------------------------------------- the wiring

  [Fact]
  public async Task VpcHandler_Preflight_EchoesTheOriginHeaderOfTheRequest()
  {
    // Through the deployed entry point, because everything above builds its own Res and
    // would stay green if VpcFunction never passed the request's origin at all. OPTIONS is
    // the route that returns before any authorisation or database work, so this asserts the
    // wiring and nothing else.
    await WithCorsOriginAsync(List, async () =>
    {
      var response = await new VpcFunction().Handler(Event("OPTIONS", "/api/v1/me", Cdn));

      Assert.Equal(200, response.StatusCode);
      Assert.Equal(Cdn, response.Headers["access-control-allow-origin"]);
      Assert.Equal("Origin", response.Headers["vary"]);
    });
  }

  [Fact]
  public async Task VpcHandler_Preflight_FromAnUnlistedOrigin_IsNotAllowed()
  {
    // The scenario in one test: the gateway let a foreign origin through to the function,
    // and the function still refuses to name it.
    await WithCorsOriginAsync(List, async () =>
    {
      var response = await new VpcFunction().Handler(Event("OPTIONS", "/api/v1/me", "https://evil.example"));

      Assert.False(response.Headers.ContainsKey("access-control-allow-origin"));
      Assert.Equal("Origin", response.Headers["vary"]);
    });
  }

  [Fact]
  public void Request_Origin_IsReadCaseInsensitivelyAndEmptyMeansAbsent()
  {
    // API Gateway does not promise a casing for header names, and it renders a header with
    // no value as "" rather than dropping it.
    Assert.Equal(Cdn, new LambdaRequest(Event("GET", "/api/v1/me", Cdn, headerName: "Origin")).Origin);
    Assert.Equal(Cdn, new LambdaRequest(Event("GET", "/api/v1/me", Cdn, headerName: "origin")).Origin);
    Assert.Null(new LambdaRequest(Event("GET", "/api/v1/me", "")).Origin);
    Assert.Null(new LambdaRequest(Event("GET", "/api/v1/me", null)).Origin);
  }

  // ---------------------------------------------------------------- helpers

  private static JsonElement Event(string method, string path, string? origin, string headerName = "Origin")
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (origin is not null) headers[headerName] = origin;

    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      },
      headers,
      queryStringParameters = new Dictionary<string, string>(StringComparer.Ordinal),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  /// <summary>
  /// Sets CORS_ORIGIN for the duration of one test and puts it back. Passing null to
  /// SetEnvironmentVariable removes the variable, so "unset" is restorable and testable.
  /// </summary>
  private static void WithCorsOrigin(string? value, Action body)
  {
    var previous = Environment.GetEnvironmentVariable(EnvVar);
    Environment.SetEnvironmentVariable(EnvVar, value);
    try
    {
      body();
    }
    finally
    {
      Environment.SetEnvironmentVariable(EnvVar, previous);
    }
  }

  private static async Task WithCorsOriginAsync(string? value, Func<Task> body)
  {
    var previous = Environment.GetEnvironmentVariable(EnvVar);
    Environment.SetEnvironmentVariable(EnvVar, value);
    try
    {
      await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable(EnvVar, previous);
    }
  }
}
