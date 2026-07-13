using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda;

public sealed class VpcFunction
{
  public VpcFunction()
  {
    // SnapStart runtime hooks must be registered during init (before snapshot).
    SnapStartHooks.RegisterOnce();
  }

  public async Task<APIGatewayProxyResponse> Handler(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    var res = new Res(req.TraceId);

    Log.Info(
      JsonSerializer.Serialize(new
      {
        tag = "boot",
        lambda = "core-vpc",
        version = Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_VERSION"),
        apiEnv = Environment.GetEnvironmentVariable("API_ENV"),
        allowDevPremium = Environment.GetEnvironmentVariable("ALLOW_DEV_PREMIUM"),
        disallowSandbox = Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM"),
        path = req.Path,
        method = req.Method,
      }));

    AuthContext auth;
    try
    {
      auth = Auth.GetAuthContext(req);
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

    Log.Info(
      JsonSerializer.Serialize(new
      {
        traceId = req.TraceId,
        lambda = "core-vpc",
        method = req.Method,
        path = req.Path,
        userSub = auth.UserSub,
        username = auth.Username,
        groups = auth.Groups,
        isAdmin = auth.IsAdmin,
        isSuperAdmin = auth.IsSuperAdmin,
      }));

    try
    {
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
      // Dashboard - 合并 decks 和 manifest，减少前端请求次数
      if (p.EndsWith("/api/v1/authoring/dashboard", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Dashboard.HandleDashboard(req, res, auth);
      }

      // Runtime
      if (p.EndsWith("/api/v1/me", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Me.HandleMe(req, res, auth);
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

      // Admin users placeholders
      {
        var p1 = RouteMatcher.Match("/api/v1/admin/users", p);
        if (p1 is not null && req.Method == "GET")
        {
          if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
          return res.NotImplemented("TODO: admin users list");
        }

        var p2 = RouteMatcher.Match("/api/v1/admin/users/:userSub", p);
        if (p2 is not null && req.Method == "GET")
        {
          if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
          return res.NotImplemented($"TODO: admin user detail for {p2["userSub"]}");
        }

        var p3 = RouteMatcher.Match("/api/v1/admin/users/:userSub/entitlements", p);
        if (p3 is not null && req.Method == "PUT")
        {
          if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
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
