using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The per-invocation CloudWatch EMF line: its envelope, its route dimension, and the one
/// thing that decides whether any of it is real -- that the emission hangs off the shared
/// dispatch seam rather than off each handler.
///
/// The failure this file is written against is not a wrong metric, it is a missing one. This
/// repo has shipped code that existed and was never called fourteen times; an observability
/// change is the fifteenth candidate, because a metric nobody emits looks exactly like a
/// metric nobody triggered -- a flat zero line, which reads as health. So the assertions
/// below are weighted towards "a line was produced at all, for this exact path, exactly
/// once", and the mutation that proves it is deleting the wrapper from VpcFunction.Handler.
///
/// The second theme is cost. A CloudWatch dimension value is billed per unique combination,
/// so the route label is attacker-controlled spend if it is derived from the request path.
/// Several tests below assert about paths that do NOT exist, which is the only way to state
/// "an unknown path cannot mint a new metric".
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console, which is process-global
/// and shared with DbWarmupTests' capture buffer; xunit runs separate collections in
/// parallel. Two of them also move PG env vars. Same reasoning as CorsAllowlistTests, and
/// the fixture is likewise not injected.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class RouteMetricsTests
{
  // Today's contract, spelled out rather than read from the code under test: a test that
  // asks RouteMetrics what RouteMetrics emits would follow it to any name at all, and these
  // names are what every dashboard and alarm built post-merge will be keyed on.
  private const string Ns = "DeveloperCards";
  private const string Service = "core-vpc";

  // ---------------------------------------------------------------- the envelope

  [Fact]
  public void Envelope_IsTheShapeCloudWatchParses()
  {
    var line = RouteMetrics.BuildLine(
      metricNamespace: Ns,
      service: Service,
      route: "/api/v1/sync/push",
      method: "POST",
      latencyMs: 21.456,
      errors: 0,
      statusCode: 200,
      traceId: "trace-1",
      timestampMs: 1_700_000_000_123);

    using var doc = JsonDocument.Parse(line);
    var root = doc.RootElement;
    var aws = root.GetProperty("_aws");

    // Milliseconds since the epoch. Seconds here is the classic EMF mistake: CloudWatch
    // drops the whole record, the log line still looks perfect, and no metric ever appears.
    Assert.Equal(1_700_000_000_123, aws.GetProperty("Timestamp").GetInt64());

    var directive = Assert.Single(aws.GetProperty("CloudWatchMetrics").EnumerateArray().ToList());
    Assert.Equal(Ns, directive.GetProperty("Namespace").GetString());

    // Two dimension sets, and the rollup one is not decoration: CloudWatch cannot sum a
    // metric across the values of a dimension, so without ["Service"] the question "what is
    // the API's error rate" has no plain-alarm answer at all.
    var dimensionSets = directive.GetProperty("Dimensions")
      .EnumerateArray()
      .Select(set => set.EnumerateArray().Select(d => d.GetString()).ToArray())
      .ToArray();

    Assert.Equal(
      [["Service"], ["Service", "Route", "Method"]],
      dimensionSets);

    var metrics = directive.GetProperty("Metrics")
      .EnumerateArray()
      .Select(m => (Name: m.GetProperty("Name").GetString(), Unit: m.GetProperty("Unit").GetString()))
      .ToArray();

    Assert.Equal(
      [("Latency", "Milliseconds"), ("Errors", "Count")],
      metrics);

    // The root members. EMF's rule is that every declared dimension and metric name must
    // exist here as a member, and a metric declared but absent is dropped silently.
    Assert.Equal(Service, root.GetProperty("Service").GetString());
    Assert.Equal("/api/v1/sync/push", root.GetProperty("Route").GetString());
    Assert.Equal("POST", root.GetProperty("Method").GetString());
    Assert.Equal(21.456, root.GetProperty("Latency").GetDouble());
    Assert.Equal(0, root.GetProperty("Errors").GetInt32());

    // Numbers, not strings. A quoted "21.456" parses as JSON and is rejected as a metric.
    Assert.Equal(JsonValueKind.Number, root.GetProperty("Latency").ValueKind);
    Assert.Equal(JsonValueKind.Number, root.GetProperty("Errors").ValueKind);

    // statusCode is a property and NOT a dimension, deliberately: as a dimension it would
    // multiply the metric count by the number of distinct statuses and split every latency
    // percentile per status.
    Assert.Equal(200, root.GetProperty("statusCode").GetInt32());
    Assert.DoesNotContain("statusCode", dimensionSets.SelectMany(s => s!).ToList());

    Assert.Equal("trace-1", root.GetProperty("traceId").GetString());
  }

  [Fact]
  public void Envelope_IsASingleLine()
  {
    // EMF is one JSON object per log line. An embedded newline splits the record in the log
    // agent and neither half is valid, so the metric silently disappears.
    var line = RouteMetrics.BuildLine(Ns, Service, "/health", "GET", 0.5, 0, 200, "t", 1);

    Assert.DoesNotContain('\n', line);
    Assert.DoesNotContain('\r', line);
  }

  [Fact]
  public void Envelope_ErrorsIsEmittedAsZero_NotOmitted()
  {
    // The whole point of a continuous series. A metric that only appears on failure gives an
    // alarm no way to tell "nothing failed" from "nothing ran" -- and "nothing ran" is what
    // a broken deploy looks like.
    using var doc = JsonDocument.Parse(RouteMetrics.BuildLine(Ns, Service, "/health", "GET", 1, 0, 200, null, 1));

    Assert.True(doc.RootElement.TryGetProperty("Errors", out var errors));
    Assert.Equal(0, errors.GetInt32());
  }

  // ---------------------------------------------------------------- the route dimension

  [Theory]
  [InlineData("/health")]
  [InlineData("/api/v1/me")]
  [InlineData("/api/v1/sync/push")]
  [InlineData("/api/v1/sync/progress/events")]
  [InlineData("/api/v1/authoring/cards")]
  [InlineData("/api/v1/authoring/cards/page")]
  [InlineData("/api/v1/admin/permissions")]
  [InlineData("/api/v1/admin/permissions/bulk")]
  [InlineData("/api/v1/authoring/publish")]
  [InlineData("/api/v1/authoring/publish/status")]
  [InlineData("/api/v1/admin/manifest")]
  [InlineData("/api/v1/admin/manifest/rebuild")]
  [InlineData("/api/v1/content/premium-url")]
  [InlineData("/api/v1/content/premium-url-dev")]
  [InlineData("/api/v1/draw-state/sync")]
  [InlineData("/api/internal/subscriptions/upsert")]
  [InlineData("/api/v1/billing/webhook/apple")]
  [InlineData("/api/v1/ai/explain-card")]
  public void Route_KnownPaths_LabelThemselves(string path)
  {
    // The pairs matter more than the singles: /cards and /cards/page, /publish and
    // /publish/status, /premium-url and /premium-url-dev all differ by a suffix, and a
    // shortest-match implementation reports the specific one as the general one -- which
    // looks right on a dashboard and hides the new route's latency inside the old route's.
    Assert.Equal(path, RouteMetrics.RouteFor(path));
  }

  [Fact]
  public void Route_ParameterisedPaths_CollapseToTheTemplate()
  {
    // The cost claim, stated as a fact about a thousand distinct users: one metric, not a
    // thousand. This is the case a raw-path label gets wrong and a bill discovers later.
    var labels = Enumerable
      .Range(0, 1000)
      .Select(_ => RouteMetrics.RouteFor($"/api/v1/admin/users/{Guid.NewGuid()}"))
      .Distinct(StringComparer.Ordinal)
      .ToList();

    Assert.Equal(["/api/v1/admin/users/:userSub"], labels);

    Assert.Equal(
      "/api/v1/admin/users/:userSub/entitlements",
      RouteMetrics.RouteFor($"/api/v1/admin/users/{Guid.NewGuid()}/entitlements"));

    Assert.Equal(
      "/api/v1/admin/cognito/users/:username/disable",
      RouteMetrics.RouteFor("/api/v1/admin/cognito/users/some.user%40example.com/disable"));

    // And the unparameterised sibling is not swallowed by the template.
    Assert.Equal("/api/v1/admin/users", RouteMetrics.RouteFor("/api/v1/admin/users"));
    Assert.Equal("/api/v1/admin/cognito/users", RouteMetrics.RouteFor("/api/v1/admin/cognito/users"));
  }

  [Fact]
  public void Route_UnknownPaths_AllLandInOneBucket()
  {
    // The reason the route table is an allowlist and not a normaliser. Every segment below
    // is static-looking, so no "replace the id-shaped segments" rule would collapse them --
    // and each distinct label is a CloudWatch metric billed monthly, from a string the
    // caller chose. Five hundred requests, one dimension value.
    var labels = Enumerable
      .Range(0, 500)
      .Select(i => RouteMetrics.RouteFor($"/api/v1/nonexistent-{i:D4}"))
      .Distinct(StringComparer.Ordinal)
      .ToList();

    Assert.Equal(["unmatched"], labels);
  }

  [Theory]
  [InlineData("/api/v1/me/")]
  [InlineData("/API/V1/ME")]
  [InlineData("/prod/api/v1/me")]
  public void Route_MatchesThePathsTheRouterWouldRoute(string path)
  {
    // Suffix and case-insensitive, because that is what VpcFunction's dispatch does. Copying
    // the router's quirks is the point: a request the router sends to /api/v1/me must not be
    // labelled as anything else, however odd the spelling that got it there.
    Assert.Equal("/api/v1/me", RouteMetrics.RouteFor(path));
  }

  [Theory]
  [InlineData("")]
  [InlineData("/")]
  [InlineData(null)]
  public void Route_DegenerateInput_IsUnmatchedRatherThanACrash(string? path)
  {
    Assert.Equal("unmatched", RouteMetrics.RouteFor(path));
  }

  [Theory]
  [InlineData("GET", "GET")]
  [InlineData("post", "POST")]
  [InlineData(" delete ", "DELETE")]
  [InlineData("OPTIONS", "OPTIONS")]
  [InlineData("PROPFIND", "OTHER")]
  [InlineData("", "OTHER")]
  [InlineData(null, "OTHER")]
  public void Method_IsBoundedToo(string? method, string expected)
  {
    // Same cardinality argument as the route: the method reaches a dimension, so the set of
    // values it can take has to be closed rather than "whatever was in the request line".
    Assert.Equal(expected, RouteMetrics.MethodFor(method));
  }

  // ---------------------------------------------------------------- the seam

  [Fact]
  public async Task Measure_Success_RecordsTheStatusAndNoError()
  {
    var expected = new APIGatewayProxyResponse { StatusCode = 200, Body = "{}" };

    var (line, returned) = await MeasuredAsync("GET", "/health", () => Task.FromResult(expected));

    // The same instance, not an equivalent one: this method observes, it must never
    // substitute the response the caller is about to send.
    Assert.Same(expected, returned);

    Assert.Equal(Service, line.GetProperty("Service").GetString());
    Assert.Equal("/health", line.GetProperty("Route").GetString());
    Assert.Equal("GET", line.GetProperty("Method").GetString());
    Assert.Equal(200, line.GetProperty("statusCode").GetInt32());
    Assert.Equal(0, line.GetProperty("Errors").GetInt32());
    Assert.True(line.GetProperty("Latency").GetDouble() >= 0);
  }

  [Fact]
  public async Task Measure_ServerError_CountsOne()
  {
    var (line, _) = await MeasuredAsync(
      "POST",
      "/api/v1/sync/push",
      () => Task.FromResult(new APIGatewayProxyResponse { StatusCode = 500 }));

    // A handler that caught its own exception and returned 500 is still a server failure.
    // Counting only the exceptions that escape would miss every handler in this repo, since
    // most of them have a catch-all that returns res.Error500.
    Assert.Equal(1, line.GetProperty("Errors").GetInt32());
    Assert.Equal(500, line.GetProperty("statusCode").GetInt32());
  }

  [Theory]
  [InlineData(400)]
  [InlineData(401)]
  [InlineData(403)]
  [InlineData(404)]
  [InlineData(405)]
  public async Task Measure_ClientError_IsNotCountedAsAnError(int statusCode)
  {
    var (line, _) = await MeasuredAsync(
      "GET",
      "/api/v1/me",
      () => Task.FromResult(new APIGatewayProxyResponse { StatusCode = statusCode }));

    // Deliberate, and the pager is the reason: a 401 storm is a broken client, and an alarm
    // that wakes someone for it gets muted, taking the 5xx alarm with it. The status is
    // still on the line for anyone querying the logs.
    Assert.Equal(0, line.GetProperty("Errors").GetInt32());
    Assert.Equal(statusCode, line.GetProperty("statusCode").GetInt32());
  }

  [Fact]
  public async Task Measure_ThrowingDispatch_EmitsAnErrorAndRethrowsUntouched()
  {
    var boom = new InvalidOperationException("handler exploded");

    var (stdout, _) = await CaptureAsync(async () =>
    {
      var thrown = await Assert.ThrowsAsync<InvalidOperationException>(() =>
        RouteMetrics.MeasureAsync(
          Service,
          Request("POST", "/api/v1/authoring/publish"),
          () => throw boom));

      // Rethrown, not swallowed and not wrapped. The caller's own catch is what produces
      // today's 500-with-CORS-headers and today's "Unhandled error:" line; an instrument
      // that ate the exception would have replaced a logged failure with a silent one.
      Assert.Same(boom, thrown);
    });

    var line = MetricLine(stdout);
    Assert.Equal(1, line.GetProperty("Errors").GetInt32());

    // 500 because that is what the caller will send. The metric and the client have to agree
    // about what happened, or the error rate and the client's error rate disagree forever.
    Assert.Equal(500, line.GetProperty("statusCode").GetInt32());
    Assert.Equal("/api/v1/authoring/publish", line.GetProperty("Route").GetString());
    Assert.Equal("POST", line.GetProperty("Method").GetString());
  }

  [Fact]
  public async Task Measure_WhenTheEmitterItselfFails_TheRequestStillSucceeds()
  {
    // An instrument that can fail the request it measures is worse than no instrument. The
    // sink is the part outside this process's control -- a closed stdout, a full pipe -- so
    // it is the part worth proving cannot propagate.
    var expected = new APIGatewayProxyResponse { StatusCode = 200 };

    var oldOut = Console.Out;
    Console.SetOut(new ExplodingWriter());
    try
    {
      var returned = await RouteMetrics.MeasureAsync(
        Service,
        Request("GET", "/health"),
        () => Task.FromResult(expected));

      Assert.Same(expected, returned);
    }
    finally
    {
      Console.SetOut(oldOut);
    }
  }

  [Theory]
  [InlineData("1")]
  [InlineData("true")]
  [InlineData("YES")]
  public async Task Measure_KillSwitch_StopsTheLineButNotTheRequest(string flag)
  {
    // Custom metrics are billed per dimension combination, so a mistake here costs money for
    // as long as it is deployed. Turning it off has to be a configuration change, because
    // rolling a Lambda zip back is not measured in seconds.
    var saved = Environment.GetEnvironmentVariable(RouteMetrics.DisableEnvVar);
    try
    {
      Environment.SetEnvironmentVariable(RouteMetrics.DisableEnvVar, flag);

      var expected = new APIGatewayProxyResponse { StatusCode = 200 };
      var (stdout, _) = await CaptureAsync(async () =>
      {
        var returned = await RouteMetrics.MeasureAsync(Service, Request("GET", "/health"), () => Task.FromResult(expected));
        Assert.Same(expected, returned);
      });

      Assert.DoesNotContain("\"_aws\"", stdout, StringComparison.Ordinal);
    }
    finally
    {
      Environment.SetEnvironmentVariable(RouteMetrics.DisableEnvVar, saved);
    }
  }

  [Fact]
  public async Task Measure_NamespaceIsOverridableWithoutADeploy()
  {
    // Dashboards and alarms are built separately, after this merges. A namespace that can
    // only be corrected by shipping a new zip makes that ordering a deploy dependency.
    var saved = Environment.GetEnvironmentVariable(RouteMetrics.NamespaceEnvVar);
    try
    {
      Environment.SetEnvironmentVariable(RouteMetrics.NamespaceEnvVar, "DeveloperCards/Staging");

      var (line, _) = await MeasuredAsync("GET", "/health", () => Task.FromResult(new APIGatewayProxyResponse { StatusCode = 200 }));

      Assert.Equal(
        "DeveloperCards/Staging",
        line.GetProperty("_aws").GetProperty("CloudWatchMetrics")[0].GetProperty("Namespace").GetString());
    }
    finally
    {
      Environment.SetEnvironmentVariable(RouteMetrics.NamespaceEnvVar, saved);
    }
  }

  // ---------------------------------------------------------------- the wiring

  [Fact]
  public async Task VpcHandler_EmitsExactlyOneMetricLine_ForARoutedRequest()
  {
    // THE test this change exists for. Everything above builds its own inputs and would stay
    // green if VpcFunction never called RouteMetrics at all -- which is precisely the shape
    // of the fourteen previous "exists but is never called" bugs in this repo. This one goes
    // through the deployed entry point.
    var function = new VpcFunction();

    var (stdout, _) = await CaptureAsync(async () =>
    {
      var response = await function.Handler(Event("GET", "/health"));
      Assert.Equal(200, response.StatusCode);
    });

    // Exactly one, counted rather than found: a wrapper applied twice (say, per function and
    // again per route group) would double every count and halve every error rate, and a
    // "does it contain a line" assertion would call that a pass.
    Assert.Equal(1, CountMetricLines(stdout));

    var line = MetricLine(stdout);
    Assert.Equal(Service, line.GetProperty("Service").GetString());
    Assert.Equal("/health", line.GetProperty("Route").GetString());
    Assert.Equal("GET", line.GetProperty("Method").GetString());
    Assert.Equal(200, line.GetProperty("statusCode").GetInt32());
    Assert.Equal(0, line.GetProperty("Errors").GetInt32());
  }

  [Fact]
  public async Task VpcHandler_UnroutedPath_IsStillMeasured()
  {
    // Covered by construction, not by anyone remembering: there is no handler behind a 404,
    // so this is the datapoint a per-handler implementation cannot produce even in
    // principle. It is also how a client calling a route that was renamed shows up at all.
    var function = new VpcFunction();

    var (stdout, _) = await CaptureAsync(async () =>
    {
      var response = await function.Handler(Event("GET", "/api/v1/no-such-route"));
      Assert.Equal(404, response.StatusCode);
    });

    var line = MetricLine(stdout);
    Assert.Equal("unmatched", line.GetProperty("Route").GetString());
    Assert.Equal(404, line.GetProperty("statusCode").GetInt32());
    Assert.Equal(0, line.GetProperty("Errors").GetInt32());
  }

  [Fact]
  public async Task VpcHandler_Preflight_IsMeasured()
  {
    // The OPTIONS branch returns before the route table is even consulted. It is measured
    // only because the seam sits above it -- if the wrapper had been placed around the route
    // table instead of around the whole dispatch, every preflight would be invisible.
    var function = new VpcFunction();

    var (stdout, _) = await CaptureAsync(async () =>
    {
      var response = await function.Handler(Event("OPTIONS", "/api/v1/me"));
      Assert.Equal(200, response.StatusCode);
    });

    var line = MetricLine(stdout);
    Assert.Equal("/api/v1/me", line.GetProperty("Route").GetString());
    Assert.Equal("OPTIONS", line.GetProperty("Method").GetString());
  }

  [Fact]
  public async Task VpcHandler_WhenARealHandlerThrows_TheLineRecordsAServerError()
  {
    // The end-to-end half of the throwing case. HandleProgressEvents opens its connection
    // OUTSIDE its own try, so an unreachable database throws straight out of the handler and
    // into VpcFunction's catch-all -- a genuine unhandled exception on a production route,
    // not a fake delegate.
    //
    // Injected by moving the port rather than by unsetting the PG variables, because a
    // missing variable makes Pg return null and the handler answers 400 CONFIG_ERROR. A
    // refused connection is the failure this metric exists to catch: the database is
    // configured and gone.
    var function = new VpcFunction();

    var savedHost = Environment.GetEnvironmentVariable("PGHOST");
    var savedPort = Environment.GetEnvironmentVariable("PGPORT");
    var savedTimeout = Environment.GetEnvironmentVariable("PG_CONNECTION_TIMEOUT");
    try
    {
      // Loopback port 1 refuses instantly, so this is a fact rather than a wait; the short
      // timeout only bounds an environment where it somehow is not.
      Environment.SetEnvironmentVariable("PGHOST", "127.0.0.1");
      Environment.SetEnvironmentVariable("PGPORT", "1");
      Environment.SetEnvironmentVariable("PG_CONNECTION_TIMEOUT", "2000");
      Pg.Reset();

      var (stdout, stderr) = await CaptureAsync(async () =>
      {
        var response = await function.Handler(AuthedEvent("POST", "/api/v1/sync/push", "{\"events\":[]}"));
        Assert.Equal(500, response.StatusCode);
      });

      // Today's behaviour is untouched: the exception is still logged by the handler's own
      // catch. Measuring must add a line, never replace one.
      Assert.Contains("Unhandled error:", stderr, StringComparison.Ordinal);

      var line = MetricLine(stdout);
      Assert.Equal("/api/v1/sync/push", line.GetProperty("Route").GetString());
      Assert.Equal("POST", line.GetProperty("Method").GetString());
      Assert.Equal(500, line.GetProperty("statusCode").GetInt32());
      Assert.Equal(1, line.GetProperty("Errors").GetInt32());
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGHOST", savedHost);
      Environment.SetEnvironmentVariable("PGPORT", savedPort);
      Environment.SetEnvironmentVariable("PG_CONNECTION_TIMEOUT", savedTimeout);
      Pg.Reset();
    }
  }

  // ---------------------------------------------------------------- table vs router

  [Fact]
  public void RouteTable_AndTheDispatchers_NameTheSameRoutes()
  {
    // The allowlist's one genuine weakness, closed. Add a route to VpcFunction and forget
    // this table and the route reports as "unmatched" forever: the function works, every
    // behavioural test passes, and the only symptom is a dashboard that quietly omits the
    // newest endpoint. Nothing observable at runtime can catch that -- the two lists agreeing
    // is a property of the source, so the source is what gets read.
    //
    // The reverse direction is checked too. A label with no route behind it is a series that
    // is flat at zero forever, which is indistinguishable from a healthy route nobody calls.
    var router = new SortedSet<string>(StringComparer.Ordinal);

    foreach (var file in new[] { "Vpc/VpcFunction.cs", "Public/PublicFunction.cs" })
    {
      var source = File.ReadAllText(Path.Combine(SourceRoot(), file));

      // The three shapes the dispatchers actually route with. A fourth would show up here as
      // a route missing from the table, which is the failure this test reports anyway.
      foreach (Match m in Regex.Matches(source, @"p\.EndsWith\(""([^""]+)")) router.Add(m.Groups[1].Value);
      foreach (Match m in Regex.Matches(source, @"req\.Path == ""([^""]+)")) router.Add(m.Groups[1].Value);
      foreach (Match m in Regex.Matches(source, @"RouteMatcher\.Match\(""([^""]+)")) router.Add(m.Groups[1].Value);
    }

    // Guard against the regexes silently matching nothing -- an empty set would make both
    // assertions below trivially true and this test a decoration.
    Assert.True(router.Count > 40, $"only found {router.Count} route literals; the dispatchers' shape must have changed");

    var table = new SortedSet<string>(RouteMetrics.KnownRoutes, StringComparer.Ordinal);

    Assert.Equal(router, table);
  }

  /// <summary>Walks up from the test binary to the directory the projects live in.</summary>
  private static string SourceRoot()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null)
    {
      if (File.Exists(Path.Combine(dir.FullName, "Vpc", "VpcFunction.cs"))) return dir.FullName;
      dir = dir.Parent;
    }

    // Loudly, not by skipping: a check that quietly disappears when it cannot find its input
    // is the same failure it exists to prevent.
    throw new FileNotFoundException($"no Vpc/VpcFunction.cs above {AppContext.BaseDirectory}");
  }

  // ---------------------------------------------------------------- helpers

  private static async Task<(JsonElement Line, APIGatewayProxyResponse Response)> MeasuredAsync(
    string method,
    string path,
    Func<Task<APIGatewayProxyResponse>> dispatch)
  {
    APIGatewayProxyResponse? response = null;
    var (stdout, _) = await CaptureAsync(async () =>
    {
      response = await RouteMetrics.MeasureAsync(Service, Request(method, path), dispatch);
    });

    return (MetricLine(stdout), response!);
  }

  private static LambdaRequest Request(string method, string path) => new(Event(method, path));

  private static JsonElement Event(string method, string path) =>
    JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      },
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      queryStringParameters = new Dictionary<string, string>(StringComparer.Ordinal),
      body = (string?)null,
      isBase64Encoded = false,
    });

  /// <summary>An event carrying the claims API Gateway's JWT authorizer would have added.</summary>
  private static JsonElement AuthedEvent(string method, string path, string body) =>
    JsonSerializer.SerializeToElement(new
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
            claims = new Dictionary<string, string>(StringComparer.Ordinal)
            {
              ["sub"] = $"it-metrics-{Guid.NewGuid():N}",
            },
          },
        },
      },
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      queryStringParameters = new Dictionary<string, string>(StringComparer.Ordinal),
      body,
      isBase64Encoded = false,
    });

  /// <summary>
  /// Metric lines go through Console, so reading them back means redirecting it. Safe only
  /// because every class that logs is in this one serially-run collection; Console.SetOut is
  /// process-global and a parallel collection writing during the window would land here.
  /// </summary>
  private static async Task<(string Out, string Err)> CaptureAsync(Func<Task> action)
  {
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    var stderr = new StringWriter();

    Console.SetOut(stdout);
    Console.SetError(stderr);
    try
    {
      await action().ConfigureAwait(false);
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
    }

    return (stdout.ToString(), stderr.ToString());
  }

  // "_aws" rather than any of the names this change introduces: it is the marker the
  // CloudWatch log agent itself keys on, so a line that this finds is a line that would
  // actually become a metric.
  private static IEnumerable<string> MetricLines(string text) =>
    text.Split('\n', StringSplitOptions.RemoveEmptyEntries)
        .Where(l => l.Contains("\"_aws\"", StringComparison.Ordinal));

  private static int CountMetricLines(string text) => MetricLines(text).Count();

  private static JsonElement MetricLine(string text)
  {
    var line = MetricLines(text).FirstOrDefault();
    Assert.True(line is not null, $"no EMF metric line was emitted. Captured:\n{text}");

    using var doc = JsonDocument.Parse(line!);
    return doc.RootElement.Clone();
  }

  private sealed class ExplodingWriter : TextWriter
  {
    public override Encoding Encoding => Encoding.UTF8;

    public override void Write(char value) => throw new IOException("log sink is gone");

    public override void WriteLine(string? value) => throw new IOException("log sink is gone");
  }
}
