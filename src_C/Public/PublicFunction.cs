using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda;

public sealed class PublicFunction
{
  public PublicFunction()
  {
    // SnapStart runtime hooks must be registered during init (before snapshot).
    SnapStartHooks.RegisterOnce();
  }

  public async Task<APIGatewayProxyResponse> Handler(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    var res = new Res(req.TraceId);

    // SAFE auth parsing (webhooks / custom Authorization header may NOT be JWT)
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
        lambda = "edge-public",
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
