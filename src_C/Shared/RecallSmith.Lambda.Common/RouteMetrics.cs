using System.Diagnostics;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;

namespace RecallSmith.Lambda.Common;

/// <summary>
/// One CloudWatch EMF line per invocation: how long the request took, and whether it
/// failed, dimensioned by service, route and HTTP method.
/// </summary>
/// <remarks>
/// Why EMF rather than the CloudWatch API: PutMetricData is a network call, and putting one
/// on the request path would add latency to the number it is reporting -- on a 128 MB
/// function the first AWS SDK call in a container measured 2980 ms (see Warmup.cs). It is
/// also the wrong dependency for core-vpc specifically: the function sits in a VPC with no
/// NAT and no CloudWatch interface endpoint, so PutMetricData would hang until its timeout
/// on every single request. EMF sidesteps both: the "call" is a Console.WriteLine, the log
/// agent that already ships this function's logs does the delivery, and there is no new
/// package to add to a zip that is kept small on purpose.
///
/// Why the emission lives here and not in the handlers: a metric that each route has to
/// remember to emit is a metric that is missing from exactly the route nobody thought about.
/// The functions call <see cref="MeasureAsync"/> once, around the whole dispatch, so a new
/// route is covered by construction -- including the 404 branch and the unhandled-exception
/// branch, which are the two paths a per-handler implementation always misses.
///
/// The existing Stopwatch log lines (ProgressEvents' ingest_timing, Warmup's db-warmup) are
/// untouched. They carry the *segments* -- parse vs SQL vs connect -- which is what you read
/// after an alarm fires. This carries the aggregate, which is what makes the alarm possible.
/// </remarks>
public static class RouteMetrics
{
  // ------------------------------------------------------------------ configuration

  /// <summary>CloudWatch namespace the metrics land in.</summary>
  /// <remarks>
  /// Overridable because dashboards and alarms are created separately (post-merge, by infra),
  /// and a namespace baked into a zip can only be corrected by a deploy. The default is a
  /// real value rather than null so that the code is useful the day it ships, before anyone
  /// has set anything.
  /// </remarks>
  public const string DefaultNamespace = "DeveloperCards";
  public const string NamespaceEnvVar = "METRICS_NAMESPACE";

  /// <summary>
  /// Kill switch, same spelling of truthiness as WARMUP_DISABLED.
  /// </summary>
  /// <remarks>
  /// This one is worth having for a reason the warmup's is not: CloudWatch bills per unique
  /// metric-and-dimension combination, so a mistake here costs money for as long as it is
  /// deployed. Turning it off through configuration takes seconds; rolling back a Lambda zip
  /// does not.
  /// </remarks>
  public const string DisableEnvVar = "METRICS_DISABLED";

  // Names are part of the contract with every dashboard and alarm built on top of them, so
  // they are constants rather than literals scattered through a serializer call.
  public const string LatencyMetric = "Latency";
  public const string ErrorsMetric = "Errors";
  public const string ServiceDimension = "Service";
  public const string RouteDimension = "Route";
  public const string MethodDimension = "Method";

  /// <summary>The single bucket every unrecognised path collapses into.</summary>
  public const string UnmatchedRoute = "unmatched";

  /// <summary>The single bucket every unrecognised HTTP method collapses into.</summary>
  public const string OtherMethod = "OTHER";

  /// <summary>Label prefix for E12's scheduler-driven internal events (synthetic path /internal/&lt;action&gt;).</summary>
  public const string InternalRoutePrefix = "internal:";

  /// <summary>The internal actions RouteFor labels; anything else under /internal/ is "unmatched" (same cost rule as the route table).</summary>
  public static readonly IReadOnlyList<string> InternalActions =
  [
    "outbox/publish",
    "content-intelligence/import",
    "publish/reap-orphans",
    "manifest/rebuild",
    "db/migrate",
    "health/deep",
  ];

  // ------------------------------------------------------------------ the route table

  // WHY AN ALLOWLIST AND NOT A NORMALISER.
  //
  // The route is a CloudWatch dimension value, and CloudWatch charges per unique
  // dimension combination -- a new value is a new metric, priced monthly, forever. That
  // makes the dimension value attacker-controlled input if it is derived from the request
  // path, and no amount of "replace the id-looking segments with {id}" fixes it: a caller
  // sending /api/v1/aaaa, /api/v1/aaab, ... mints one metric per request, and every one of
  // those segments looks perfectly static. Structural normalisation bounds the shape of the
  // label, not the number of them, and the number is what costs money.
  //
  // So an unknown path gets no label of its own; it lands in UnmatchedRoute. The failure
  // mode of an allowlist is that someone adds a route to the dispatcher and forgets to add
  // it here, and that route's traffic then reports as "unmatched". That is a visible,
  // bounded, self-announcing kind of wrong -- "unmatched" climbing is exactly the series an
  // on-call person would notice -- and it is the one to prefer over an unbounded bill.
  //
  // These are suffixes, not whole paths, because the dispatchers match with EndsWith:
  // Validation.NormalizePath only strips an API Gateway stage prefix off /health and /api/*,
  // so the webhook routes still arrive carrying theirs. Copying the router's rule is the
  // point -- a label that disagrees with the router about which route ran is worse than an
  // ugly rule.
  private static readonly string[] StaticRoutes =
  [
    // core-vpc
    "/health",
    "/webhooks/revenuecat/development",
    "/webhooks/revenuecat/production",
    "/webhooks/revenuecat",
    "/rc/webhook",
    "/api/v1/db/ping",
    "/api/v1/admin/db/migrate",
    "/api/v1/admin/db/bootstrap-roles",
    "/api/v1/admin/db/content-intelligence-demo",
    "/api/v1/admin/db/migrations",
    "/api/v1/admin/db/create",
    "/api/v1/admin/db/databases",
    "/api/v1/admin/db/recreate",
    "/api/v1/admin/db/netcheck",
    "/api/v1/admin/db/premium-state",
    "/api/v1/admin/db/rc-events",
    "/api/v1/admin/analytics/outbox/publish",
    "/api/v1/admin/analytics/content-intelligence/import",
    "/api/v1/authoring/decks",
    "/api/v1/authoring/cards/import",
    "/api/v1/authoring/cards/page",
    "/api/v1/authoring/cards",
    "/api/v1/admin/permissions",
    "/api/v1/admin/permissions/bulk",
    "/api/v1/authoring/publish",
    "/api/v1/authoring/publish/status",
    "/api/v1/authoring/publish/jobs",
    "/api/v1/authoring/content-intelligence",
    "/api/v1/admin/manifest/rebuild",
    "/api/v1/me",
    "/api/v1/user/client-errors",
    "/api/v1/user/bootstrap",
    "/api/v1/user/me",
    "/api/v1/entitlements",
    "/api/v1/admin/manifest",
    "/api/v1/admin/decks",
    "/rollback",
    "/builds",
    "/api/v1/admin/publish/reap",
    "/api/v1/content/premium-url",
    "/api/v1/runtime/premium-url",
    "/api/v1/content/premium-url-dev",
    "/api/v1/runtime/premium-url-dev",
    "/api/v1/sync/progress/events",
    "/api/v1/sync/push",
    "/api/v1/sync/progress",
    "/api/v1/sync/pull",
    "/api/v1/draw-state/sync",
    "/api/v1/admin/users",
    "/api/internal/entitlements/apply",
    "/api/internal/subscriptions/upsert",

    // edge-public
    "/api/v1/billing/verify",
    "/api/v1/billing/webhook/apple",
    "/api/v1/billing/webhook/google",
    "/api/v1/ai/explain-card",
    "/api/v1/admin/cognito/users",
  ];

  // The parameterised routes, and the whole reason the table cannot be a plain list of
  // literals: /api/v1/admin/users/<sub> carries a user id in the path, so labelling it with
  // the raw path would mint one metric per user. The template is the label.
  //
  // Matched with RouteMatcher (equal segment counts, exact), not with EndsWith, because that
  // is what the dispatchers do for these routes. The asymmetry with StaticRoutes above is
  // copied deliberately rather than tidied away: tidying it would make the label disagree
  // with the router for stage-prefixed paths, which is the one thing a label must never do.
  private static readonly string[] TemplateRoutes =
  [
    "/api/v1/admin/users/:userSub/entitlements",
    "/api/v1/admin/users/:userSub",
    "/api/v1/admin/cognito/users/:username/disable",
    "/api/v1/admin/cognito/users/:username/delete",
  ];

  // Longest first, so the table stays order-independent: appending an entry to the arrays
  // above cannot change which label an existing path gets. (With EndsWith the specific
  // routes do not currently collide with the general ones -- "/a/b/page" does not end with
  // "/a/b" -- but that is a property of today's spelling, not a rule anyone will remember.)
  private static readonly string[] StaticRoutesLongestFirst =
    [.. StaticRoutes.OrderByDescending(r => r.Length, Comparer<int>.Default)];

  private static readonly (string Pattern, int Segments)[] TemplateRoutesLongestFirst =
    [.. TemplateRoutes
      .Select(t => (Pattern: t, Segments: t.Split('/', StringSplitOptions.RemoveEmptyEntries).Length))
      .OrderByDescending(t => t.Segments)];

  private static readonly string[] KnownMethods =
    ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

  /// <summary>
  /// Every label this class can produce apart from <see cref="UnmatchedRoute"/>.
  /// </summary>
  /// <remarks>
  /// Exposed so that a test can hold this list against the route literals in the two
  /// dispatchers. That check is the answer to the allowlist's one real weakness: a route
  /// added to VpcFunction and forgotten here would silently report as "unmatched", and no
  /// behavioural test can notice, because the function still works perfectly.
  /// </remarks>
  public static IReadOnlyList<string> KnownRoutes { get; } = [.. StaticRoutes, .. TemplateRoutes];

  // ------------------------------------------------------------------ normalisation

  /// <summary>
  /// The route dimension for a request path: a known route's own spelling, or
  /// <see cref="UnmatchedRoute"/>.
  /// </summary>
  public static string RouteFor(string? path)
  {
    var p = (path ?? string.Empty).TrimEnd('/');
    if (p.Length == 0) return UnmatchedRoute;

    if (p.StartsWith("/internal/", StringComparison.Ordinal))
    {
      var action = p["/internal/".Length..];
      foreach (var known in InternalActions)
      {
        if (string.Equals(action, known, StringComparison.Ordinal)) return InternalRoutePrefix + known;
      }
      return UnmatchedRoute;
    }

    foreach (var route in StaticRoutesLongestFirst)
    {
      if (p.EndsWith(route, StringComparison.OrdinalIgnoreCase)) return route;
    }

    foreach (var (pattern, _) in TemplateRoutesLongestFirst)
    {
      // RouteMatcher rather than a private matcher: it is the code the dispatchers route
      // with, so reusing it means the label cannot drift from the routing decision. It
      // allocates a small dictionary per call, which is nanoseconds against the
      // milliseconds this line exists to report.
      if (RouteMatcher.Match(pattern, p) is not null) return pattern;
    }

    return UnmatchedRoute;
  }

  /// <summary>
  /// The method dimension: an uppercased known HTTP method, or <see cref="OtherMethod"/>.
  /// </summary>
  /// <remarks>
  /// Bounded for the same reason the route is. Method belongs in the dimension set at all
  /// because several routes here serve both GET and POST from one path, and pooling those
  /// into one latency series lets a slow write hide behind fast reads.
  /// </remarks>
  public static string MethodFor(string? method)
  {
    var m = (method ?? string.Empty).Trim().ToUpperInvariant();
    foreach (var known in KnownMethods)
    {
      if (string.Equals(m, known, StringComparison.Ordinal)) return known;
    }

    return OtherMethod;
  }

  /// <summary>Same truthiness as WARMUP_DISABLED, so one habit covers both switches.</summary>
  public static bool IsDisabled(string? flag)
  {
    var f = (flag ?? string.Empty).Trim();
    return f.Equals("1", StringComparison.Ordinal) ||
           f.Equals("true", StringComparison.OrdinalIgnoreCase) ||
           f.Equals("yes", StringComparison.OrdinalIgnoreCase);
  }

  // ------------------------------------------------------------------ the envelope

  /// <summary>
  /// Builds the EMF line. Pure, so the envelope's shape can be asserted without a handler,
  /// a clock or a Console.
  /// </summary>
  /// <remarks>
  /// Shape rules that are not obvious from reading it:
  ///
  /// TWO dimension sets, not one. ["Service"] alone is what makes "the API's error rate"
  /// expressible as a plain alarm -- CloudWatch cannot sum a metric across the values of a
  /// dimension, so without a rollup set the only service-wide number is a Metric Math SEARCH
  /// expression that silently stops covering routes added later.
  ///
  /// Errors is emitted on every invocation, as 0 or 1, never omitted on success. A metric
  /// that only appears when something breaks produces a series full of gaps, and a
  /// CloudWatch alarm cannot tell "nothing failed" from "nothing ran" -- treat-missing-data
  /// is the setting every runbook gets wrong. A continuous series has one meaning.
  ///
  /// There is deliberately no Count metric. Latency is published once per invocation, so
  /// CloudWatch's SampleCount(Latency) already IS the request count, and error rate is
  /// Sum(Errors) / SampleCount(Latency). A third metric would cost a third more per route
  /// for a number that is already there.
  ///
  /// statusCode rides along as a plain property, not a dimension. As a dimension it would
  /// multiply the metric count by the number of distinct statuses and split the latency
  /// percentiles per status; as a property it stays queryable in Logs Insights, which is
  /// where "which status was it" is actually asked.
  ///
  /// PascalCase for the declared metric and dimension members because CloudWatch's own
  /// convention shows up in every console and alarm; camelCase for the free-form properties
  /// because that is what the rest of this repo's structured logs use.
  /// </remarks>
  public static string BuildLine(
    string metricNamespace,
    string service,
    string route,
    string method,
    double latencyMs,
    int errors,
    int statusCode,
    string? traceId,
    long timestampMs)
  {
    return JsonSerializer.Serialize(new
    {
      _aws = new
      {
        // Milliseconds since the epoch, which is what the EMF spec requires; CloudWatch
        // rejects the whole line if this is seconds.
        Timestamp = timestampMs,
        CloudWatchMetrics = new[]
        {
          new
          {
            Namespace = metricNamespace,
            Dimensions = new[]
            {
              new[] { ServiceDimension },
              new[] { ServiceDimension, RouteDimension, MethodDimension },
            },
            Metrics = new[]
            {
              new { Name = LatencyMetric, Unit = "Milliseconds" },
              new { Name = ErrorsMetric, Unit = "Count" },
            },
          },
        },
      },
      Service = service,
      Route = route,
      Method = method,
      Latency = latencyMs,
      Errors = errors,
      statusCode,
      traceId,
    });
  }

  // ------------------------------------------------------------------ the seam

  /// <summary>
  /// Times one invocation's dispatch, emits its metric line, and returns (or rethrows)
  /// exactly what the dispatch produced.
  /// </summary>
  /// <remarks>
  /// The rethrow is load-bearing: the caller's own catch is what turns an unhandled
  /// exception into today's 500-with-CORS-headers response and today's "Unhandled error:"
  /// log line, and measuring must not change either. This method observes; it never decides.
  /// </remarks>
  public static async Task<APIGatewayProxyResponse> MeasureAsync(
    string service,
    LambdaRequest req,
    Func<Task<APIGatewayProxyResponse>> dispatch)
  {
    var sw = Stopwatch.StartNew();

    try
    {
      var response = await dispatch();

      // `?.` guards a case no route can currently produce. It is here because the contract
      // of this method is "changes nothing", and a NullReferenceException raised by the
      // instrument would break a request that was about to succeed.
      var statusCode = response?.StatusCode ?? 0;

      Emit(service, req, sw.Elapsed.TotalMilliseconds, statusCode, IsServerError(statusCode));
      return response!;
    }
    catch
    {
      // A dispatch that threw never produced a status code. 500 is recorded because that is
      // what the caller's catch will send, so the metric and the client agree.
      //
      // In both functions today the route table's own try/catch converts handler exceptions
      // into a 500 *response*, so this branch is defence in depth rather than the usual
      // path -- a throw from the boot log or from route selection itself. Both arrive at
      // Errors=1 either way, which is the property that matters.
      Emit(service, req, sw.Elapsed.TotalMilliseconds, statusCode: 500, isError: true);
      throw;
    }
  }

  /// <summary>
  /// 5xx and unhandled exceptions only.
  /// </summary>
  /// <remarks>
  /// A 400 or a 404 is the caller being wrong, and an alarm that fires on those pages
  /// somebody for a misbehaving client -- which trains the team to ignore the alarm. The
  /// status code is still on the line, so a 4xx spike stays one Logs Insights query away.
  /// </remarks>
  public static bool IsServerError(int statusCode) => statusCode >= 500;

  // ------------------------------------------------------------------ the gauge

  /// <summary>
  /// One EMF line carrying a single dimensionless gauge (e.g. OutboxPending) in the same
  /// namespace as the route metrics. Same kill switch, same namespace override, same
  /// never-throws rule as Emit; unit null → "None".
  /// </summary>
  public static void EmitGauge(string name, double value, string? unit = "Count")
  {
    if (IsDisabled(Environment.GetEnvironmentVariable(DisableEnvVar))) return;
    if (string.IsNullOrWhiteSpace(name)) return;

    try
    {
      var line = BuildGaugeLine(
        metricNamespace: Environment.GetEnvironmentVariable(NamespaceEnvVar) is { Length: > 0 } ns
          ? ns
          : DefaultNamespace,
        name: name,
        value: value,
        unit: unit ?? "None",
        timestampMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

      Console.Out.WriteLine(line);
    }
    catch
    {
      // As with Emit: a gauge that cannot serialise is a missing data point, never a fault.
    }
  }

  /// <summary>
  /// Builds the dimensionless-gauge EMF line. Pure, so its shape can be asserted without a
  /// clock or a Console. <c>Dimensions</c> is a one-element array holding an empty array,
  /// which is how EMF spells "no dimensions"; the metric name is a top-level property.
  /// </summary>
  public static string BuildGaugeLine(string metricNamespace, string name, double value, string unit, long timestampMs)
  {
    var payload = new Dictionary<string, object?>
    {
      ["_aws"] = new
      {
        Timestamp = timestampMs,
        CloudWatchMetrics = new[]
        {
          new
          {
            Namespace = metricNamespace,
            Dimensions = new[] { Array.Empty<string>() },
            Metrics = new[]
            {
              new { Name = name, Unit = unit },
            },
          },
        },
      },
      [name] = value,
    };

    return JsonSerializer.Serialize(payload);
  }

  private static void Emit(string service, LambdaRequest req, double latencyMs, int statusCode, bool isError)
  {
    try
    {
      if (IsDisabled(Environment.GetEnvironmentVariable(DisableEnvVar))) return;

      var line = BuildLine(
        metricNamespace: Environment.GetEnvironmentVariable(NamespaceEnvVar) is { Length: > 0 } ns
          ? ns
          : DefaultNamespace,
        service: service,
        route: RouteFor(req.Path),
        method: MethodFor(req.Method),
        // Three decimals to match the ingest_timing line; sub-millisecond routes exist
        // (the OPTIONS preflight is one) and rounding them to 0 would make their p99 a
        // flat zero rather than a small number.
        latencyMs: Math.Round(latencyMs, 3),
        errors: isError ? 1 : 0,
        statusCode: statusCode,
        traceId: req.TraceId,
        timestampMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

      // Console.Out directly, NOT Log.Info, and that is the difference between a metric and
      // a log line. Log.Info is gated on LOG_LEVEL, so the first person who turns logging
      // down to trim CloudWatch cost would silently delete every metric and every alarm
      // built on them -- and the alarms would not fire, they would go blank, which is the
      // failure that looks like health.
      //
      // One pre-built string in one call, because EMF is one JSON object per line and two
      // writes can interleave with another thread's.
      Console.Out.WriteLine(line);
    }
    catch
    {
      // An instrument must not be able to fail the request it is measuring. Same rule as
      // Warmup's SafeLog: the worst case here is a missing data point.
    }
  }
}
