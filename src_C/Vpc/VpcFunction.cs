using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda;

public sealed class VpcFunction
{
  // One spelling of this function's name, used both as the `lambda` field of the structured
  // logs and as the Service dimension of the metrics. They have to be the same string for
  // anyone to join an alarm to the log lines behind it, and two literals cannot promise that.
  private const string ServiceName = "core-vpc";

  public VpcFunction()
  {
    // SnapStart runtime hooks must be registered during init (before snapshot).
    // Note these never fire while SnapStart is off on this function, which is why the
    // warmup below hangs off the constructor rather than off a restore hook.
    SnapStartHooks.RegisterOnce();

    // Read the bearer-verification policy here, in INIT, so that if the unverified dev mode
    // is on the warning is the first thing in the log stream rather than a line buried after
    // the first request. Never throws: a bad AUTH_ISSUERS value would, so it is caught and
    // logged, and the first request then fails closed with a 401 instead of a crashed INIT.
    try { Auth.EnsureConfigured(); } catch (Exception ex) { Log.Error("auth config:", ex.Message); }

    // Boot line once per container, not once per request: the constructor is the INIT-phase
    // mount point, so this fires on cold start and the CloudWatch count tracks cold starts.
    // No path/method here — a container serves many requests, so per-request fields belong on
    // the per-request line in DispatchAsync.
    Log.Event("info", new
    {
      tag = "boot",
      lambda = ServiceName,
      version = Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_VERSION"),
      apiEnv = Environment.GetEnvironmentVariable("API_ENV"),
      allowDevPremium = Environment.GetEnvironmentVariable("ALLOW_DEV_PREMIUM"),
      disallowSandbox = Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM"),
    });

    // The constructor is the real INIT phase mount point: it runs once per container,
    // before any request, with the init phase CPU burst. RunOnce never throws.
    Warmup.RunOnce();
  }

  public async Task<APIGatewayProxyResponse> Handler(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    // The origin travels with the response builder, not with a route: every response this
    // function can produce -- including the OPTIONS preflight and the 500 from the catch
    // below -- has to carry the same CORS answer, or the browser reports the wrong failure.
    var res = new Res(req.TraceId, req.Origin);

    // The whole dispatch, wrapped once. Deliberately the only statement in this method that
    // can produce a response: there is no early return above it and no route below it, so a
    // route added tomorrow is measured without anyone deciding to measure it. That is the
    // entire difference between this and a Stopwatch inside each handler, and it is why the
    // 404 branch and the unhandled-exception branch -- the two that matter most and get
    // instrumented last -- are covered here for free.
    return await RouteMetrics.MeasureAsync(ServiceName, req, () => DispatchAsync(req, res));
  }

  private static async Task<APIGatewayProxyResponse> DispatchAsync(LambdaRequest req, Res res)
  {
    AuthContext auth;
    try
    {
      auth = await Auth.GetAuthContextAsync(req);
    }
    catch
    {
      auth = new AuthContext(
        Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
        UserSub: null,
        Username: null,
        Groups: [],
        IsSuperAdmin: false,
        IsEditor: false,
        IsAdmin: false);
    }

    if (string.Equals(req.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
    {
      return res.Raw(200, new { ok = true });
    }

    Log.Event("info", new
    {
      traceId = req.TraceId,
      lambda = ServiceName,
      method = req.Method,
      path = req.Path,
      userSub = auth.UserSub,
      username = auth.Username,
      groups = auth.Groups,
      isAdmin = auth.IsAdmin,
      isSuperAdmin = auth.IsSuperAdmin,
    });

    try
    {
      if ((req.RawBody?.Length ?? 0) > 1_048_576) return res.PayloadTooLarge();
      // 💡 彻底清除路径匹配的干扰因素：去掉尾部斜杠
      var p = req.Path.TrimEnd('/');

      if (p.EndsWith("/health", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.Ok(new { ok = true });

      // RevenueCat webhooks
      if (
        (p.EndsWith("/webhooks/revenuecat/development", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/webhooks/revenuecat/production", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/rc/webhook", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/webhooks/revenuecat", StringComparison.OrdinalIgnoreCase)) &&
        req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Webhooks.RevenuecatWebhook.HandleRevenuecatWebhook(req, res);
      }

      // DB
      if (p.EndsWith("/api/v1/db/ping", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbPing(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/migrate", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbMigrate(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/bootstrap-roles", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.AppRole.HandleBootstrapRoles(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/content-intelligence-demo", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.ContentIntelligenceDemo.HandleContentIntelligenceDemo(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/migrations", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbMigrationsList(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/create", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbCreateDatabase(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/databases", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbListDatabases(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/recreate", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbDropAndRecreate(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/netcheck", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Netcheck.HandleDbNetcheck(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/premium-state", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.QueryPremiumState.HandleDbPremiumState(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/rc-events", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.QueryRcEvents.HandleDbRcEvents(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/analytics/outbox/publish", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Analytics.OutboxPublisher.HandlePublishOutbox(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/analytics/content-intelligence/import", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Analytics.ContentIntelligenceSnapshotImport.HandleImportSnapshot(req, res, auth);
      }

      // Authoring
      if (p.EndsWith("/api/v1/authoring/decks", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Decks.HandleAuthoringDecks(req, res, auth);
      }
      // Keyset-paginated card list. Additive: the unpaged route below keeps its
      // exact behaviour for the console and the mobile app. Ordering matters
      // less than it looks — "/api/v1/authoring/cards/page" does not end with
      // "/api/v1/authoring/cards", so the two never shadow each other — but the
      // more specific path stays first anyway, so a future prefix match cannot
      // quietly swallow it.
      if (p.EndsWith("/api/v1/authoring/cards/import", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardsImport.HandleCardsImport(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/cards/page", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardsPage.HandleAuthoringCardsPage(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/cards", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Cards.HandleAuthoringCards(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/permissions", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/api/v1/admin/permissions/bulk", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Permissions.HandleAuthoringPermissions(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/publish", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Publish.HandleAuthoringPublish(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/publish/status", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.PublishStatus.HandlePublishStatus(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/publish/jobs", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.PublishJobs.HandleFetchPublishJobs(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/content-intelligence", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.ContentIntelligence.HandleContentIntelligence(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/manifest/rebuild", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.ManifestRebuild.HandleManifestRebuild(req, res, auth);
      }
      if (p.EndsWith("/rollback", StringComparison.OrdinalIgnoreCase) && p.Contains("/api/v1/admin/decks/", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.DeckRollback.HandleDeckRollback(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/publish/reap", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.PublishReaper.HandlePublishReap(req, res, auth);
      }
      // Runtime
      if (p.EndsWith("/api/v1/me", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Me.HandleMe(req, res, auth);
      }
      if ((p.EndsWith("/api/v1/me", StringComparison.OrdinalIgnoreCase) ||
           p.EndsWith("/api/v1/user/me", StringComparison.OrdinalIgnoreCase)) &&
          req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.AccountDeletion.HandleDeleteMe(req, res, auth);
      }
      if (p.EndsWith("/api/v1/user/client-errors", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.ClientErrors.HandleClientErrors(req, res, auth);
      }
      if (p.EndsWith("/api/v1/user/bootstrap", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Bootstrap.HandleBootstrap(req, res, auth);
      }
      if (p.EndsWith("/api/v1/entitlements", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Entitlements.HandleEntitlements(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/manifest", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.AdminManifest.HandleAdminManifest(req, res, auth);
      }
      // Keyset-paginated console deck list (replaces loading the whole manifest/catalog).
      if (p.EndsWith("/api/v1/admin/decks", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.AdminDecks.HandleAdminDecks(req, res, auth);
      }

      if (
        (p.EndsWith("/api/v1/content/premium-url", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/api/v1/runtime/premium-url", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/api/v1/content/premium-url-dev", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/api/v1/runtime/premium-url-dev", StringComparison.OrdinalIgnoreCase)) &&
        req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        var isDevRoute = req.Path.EndsWith("-dev", StringComparison.Ordinal);
        var q = req.Query;
        var e = req;
        if (isDevRoute)
        {
          e = req.WithQuery("dev", "1").WithHeader("x-dev-bypass", "1");
          q = e.Query;
        }

        return await Vpc.Runtime.PremiumDeckUrl.HandlePremiumDeckUrl(e, q, res, auth);
      }

      if (p.EndsWith("/api/v1/sync/progress/events", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/api/v1/sync/push", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.ProgressEvents.HandleProgressEvents(req, res, auth);
      }

      if (p.EndsWith("/api/v1/sync/progress", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/api/v1/sync/pull", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.ProgressGet.HandleProgressGet(req, res, auth);
      }

      // Gamification state (collection, pity, wallet). Deliberately its own
      // route and not a field on the review sync: it is snapshot-shaped rather
      // than event-shaped, and keeping it separate is what lets a failure here
      // be silently skipped by the client without touching review sync.
      if (p.EndsWith("/api/v1/draw-state/sync", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.DrawStateSync.HandleDrawStateSync(req, res, auth);
      }

      // Admin users placeholders
      {
        var p1 = RouteMatcher.Match("/api/v1/admin/users", p);
        if (p1 is not null && req.Method == "GET")
        {
          var deny = Auth.RequireSuperAdmin(auth, res);
          if (deny is not null) return deny;
          return res.NotImplemented("TODO: admin users list");
        }

        var p2 = RouteMatcher.Match("/api/v1/admin/users/:userSub", p);
        if (p2 is not null && req.Method == "GET")
        {
          var deny = Auth.RequireSuperAdmin(auth, res);
          if (deny is not null) return deny;
          return res.NotImplemented($"TODO: admin user detail for {p2["userSub"]}");
        }

        var p3 = RouteMatcher.Match("/api/v1/admin/users/:userSub/entitlements", p);
        if (p3 is not null && req.Method == "PUT")
        {
          var deny = Auth.RequireSuperAdmin(auth, res);
          if (deny is not null) return deny;
          return res.NotImplemented($"TODO: admin set entitlements for {p3["userSub"]}");
        }
      }

      // Internal routes
      if (p.EndsWith("/api/internal/entitlements/apply", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Internal.EntitlementsApply.HandleInternalEntitlementsApply(req, res);
      }
      if (p.EndsWith("/api/internal/subscriptions/upsert", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Internal.SubscriptionsUpsert.HandleInternalSubscriptionsUpsert(req, res);
      }

      return res.NotFound("Route not found");
    }
    catch (Exception ex)
    {
      Log.Error("Unhandled error:", ex);
      return res.Error500(ex);
    }
  }
}
