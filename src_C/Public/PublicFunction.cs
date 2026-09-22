using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda;

public sealed class PublicFunction
{
  // Matches the `lambda` field these logs already carry, so an alarm on the Service
  // dimension and a Logs Insights query on the log lines name the same thing.
  private const string ServiceName = "edge-public";

  public PublicFunction()
  {
    // SnapStart runtime hooks must be registered during init (before snapshot).
    SnapStartHooks.RegisterOnce();

    // Same as core-vpc: read the bearer-verification policy in INIT so its dev-mode warning,
    // if any, leads the log stream. Never throws.
    try { Auth.EnsureConfigured(); } catch (Exception ex) { Log.Error("auth config:", ex.Message); }
  }

  public async Task<APIGatewayProxyResponse> Handler(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    // Same wiring as core-vpc, and needed here for the same reason: once CORS_ORIGIN names a
    // list, a Res built without the request's origin allows nobody. Leaving this handler on
    // the one-argument constructor would not have failed a build or a test -- it would have
    // silently taken edge-public out of the browser on the day the env var changed.
    var res = new Res(req.TraceId, req.Origin);

    // Wrapped for the same reason as core-vpc, and it is the same kind of omission risk that
    // the CORS wiring above was: the test project cannot reference this assembly (it and
    // RecallSmith.Lambda.Vpc both build an assembly called RecallSmith.Lambda), so nothing
    // here fails a build or a test if it is forgotten. Billing and the AI route would simply
    // be the two paths with no latency series, discovered the first time one of them got slow.
    return await RouteMetrics.MeasureAsync(ServiceName, req, () => DispatchAsync(req, res));
  }

  private static async Task<APIGatewayProxyResponse> DispatchAsync(LambdaRequest req, Res res)
  {
    // SAFE auth parsing (webhooks / custom Authorization header may NOT be JWT)
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

    Log.Info(
      JsonSerializer.Serialize(new
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
      }));

    try
    {
      if (req.Path == "/health" && req.Method == "GET") return res.Ok(new { ok = true });

      // Billing
      if (req.Path == "/api/v1/billing/verify")
      {
        return await RecallSmith.Lambda.Public.Billing.Verify.HandleBillingVerify(req, res, auth);
      }
      if (req.Path == "/api/v1/billing/webhook/apple")
      {
        return await RecallSmith.Lambda.Public.Billing.WebhookApple.HandleWebhookApple(req, res);
      }
      if (req.Path == "/api/v1/billing/webhook/google")
      {
        return await RecallSmith.Lambda.Public.Billing.WebhookGoogle.HandleWebhookGoogle(req, res);
      }

      // AI
      if (req.Path == "/api/v1/ai/explain-card")
      {
        return await RecallSmith.Lambda.Public.Ai.ExplainCard.HandleAiExplainCard(req, res, auth);
      }

      // Cognito admin
      if (req.Path == "/api/v1/admin/cognito/users")
      {
        return await RecallSmith.Lambda.Public.CognitoAdmin.Users.HandleCognitoUsers(req, res, auth);
      }

      var pDisable = RouteMatcher.Match("/api/v1/admin/cognito/users/:username/disable", req.Path);
      if (pDisable is not null)
      {
        return await RecallSmith.Lambda.Public.CognitoAdmin.DisableUser.HandleCognitoDisableUser(req, res, auth, pDisable);
      }

      var pDelete = RouteMatcher.Match("/api/v1/admin/cognito/users/:username/delete", req.Path);
      if (pDelete is not null)
      {
        return await RecallSmith.Lambda.Public.CognitoAdmin.DeleteUser.HandleCognitoDeleteUser(req, res, auth, pDelete);
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
