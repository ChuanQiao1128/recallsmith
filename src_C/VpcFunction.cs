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
      if (req.Path == "/health" && req.Method == "GET") return res.Ok(new { ok = true });

      // RevenueCat webhooks
      if (
        (req.Path == "/webhooks/revenuecat/development" ||
         req.Path == "/webhooks/revenuecat/production" ||
         req.Path == "/rc/webhook" ||
         req.Path == "/webhooks/revenuecat") &&
        req.Method == "POST")
      {
        return await Vpc.Webhooks.RevenuecatWebhook.HandleRevenuecatWebhook(req, res);
      }

      // DB
      if (req.Path == "/api/v1/db/ping" && req.Method == "GET")
      {
        return await Vpc.Db.Migrate.HandleDbPing(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/migrate" && req.Method == "POST")
      {
        return await Vpc.Db.Migrate.HandleDbMigrate(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/migrations" && req.Method == "GET")
      {
        return await Vpc.Db.Migrate.HandleDbMigrationsList(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/create" && req.Method == "POST")
      {
        return await Vpc.Db.Migrate.HandleDbCreateDatabase(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/databases" && req.Method == "GET")
      {
        return await Vpc.Db.Migrate.HandleDbListDatabases(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/recreate" && req.Method == "POST")
      {
        return await Vpc.Db.Migrate.HandleDbDropAndRecreate(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/netcheck" && req.Method == "GET")
      {
        return await Vpc.Db.Netcheck.HandleDbNetcheck(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/premium-state" && req.Method == "GET")
      {
        return await Vpc.Db.QueryPremiumState.HandleDbPremiumState(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/db/rc-events" && req.Method == "GET")
      {
        return await Vpc.Db.QueryRcEvents.HandleDbRcEvents(req, res, auth);
      }

      // Authoring
      if (req.Path == "/api/v1/authoring/decks")
      {
        return await Vpc.Authoring.Decks.HandleAuthoringDecks(req, res, auth);
      }
      if (req.Path == "/api/v1/authoring/cards")
      {
        return await Vpc.Authoring.Cards.HandleAuthoringCards(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/permissions" || req.Path == "/api/v1/admin/permissions/bulk")
      {
        return await Vpc.Authoring.Permissions.HandleAuthoringPermissions(req, res, auth);
      }
      if (req.Path == "/api/v1/authoring/publish")
      {
        return await Vpc.Authoring.Publish.HandleAuthoringPublish(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/manifest/rebuild" && req.Method == "POST")
      {
        return await Vpc.Authoring.ManifestRebuild.HandleManifestRebuild(req, res, auth);
      }

      // Runtime
      if (req.Path == "/api/v1/me" && req.Method == "GET")
      {
        return await Vpc.Runtime.Me.HandleMe(req, res, auth);
      }
      if (req.Path == "/api/v1/user/bootstrap")
      {
        return await Vpc.Runtime.Bootstrap.HandleBootstrap(req, res, auth);
      }
      if (req.Path == "/api/v1/entitlements" && req.Method == "GET")
      {
        return await Vpc.Runtime.Entitlements.HandleEntitlements(req, res, auth);
      }
      if (req.Path == "/api/v1/admin/manifest" && req.Method == "GET")
      {
        return await Vpc.Runtime.AdminManifest.HandleAdminManifest(req, res, auth);
      }

      if (
        (req.Path == "/api/v1/content/premium-url" ||
         req.Path == "/api/v1/runtime/premium-url" ||
         req.Path == "/api/v1/content/premium-url-dev" ||
         req.Path == "/api/v1/runtime/premium-url-dev") &&
        req.Method == "GET")
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

      if (req.Path == "/api/v1/sync/progress/events" || req.Path == "/api/v1/sync/push")
      {
        return await Vpc.Runtime.ProgressEvents.HandleProgressEvents(req, res, auth);
      }

      if (req.Path == "/api/v1/sync/progress" || req.Path == "/api/v1/sync/pull")
      {
        return await Vpc.Runtime.ProgressGet.HandleProgressGet(req, res, auth);
      }

      // Admin users placeholders
      {
        var p1 = RouteMatcher.Match("/api/v1/admin/users", req.Path);
        if (p1 is not null && req.Method == "GET")
        {
          if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
          return res.NotImplemented("TODO: admin users list");
        }

        var p2 = RouteMatcher.Match("/api/v1/admin/users/:userSub", req.Path);
        if (p2 is not null && req.Method == "GET")
        {
          if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
          return res.NotImplemented($"TODO: admin user detail for {p2["userSub"]}");
        }

        var p3 = RouteMatcher.Match("/api/v1/admin/users/:userSub/entitlements", req.Path);
        if (p3 is not null && req.Method == "PUT")
        {
          if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
          return res.NotImplemented($"TODO: admin set entitlements for {p3["userSub"]}");
        }
      }

      // Internal routes
      if (req.Path == "/api/internal/entitlements/apply" && req.Method == "POST")
      {
        return await Vpc.Internal.EntitlementsApply.HandleInternalEntitlementsApply(req, res);
      }
      if (req.Path == "/api/internal/subscriptions/upsert" && req.Method == "POST")
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
