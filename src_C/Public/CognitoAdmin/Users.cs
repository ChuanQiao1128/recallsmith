using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using System.Text.Json;

namespace RecallSmith.Lambda.Public.CognitoAdmin;

public static class Users
{
  public static async Task<APIGatewayProxyResponse> HandleCognitoUsers(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method == "GET")
    {
      var users = await CognitoClient.ListAdminUsersFromCognito();
      return res.Ok(users);
    }

    if (req.Method == "POST")
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var root = doc.RootElement;
      var username = root.TryGetProperty("username", out var u) ? u.ToString() : null;
      var email = root.TryGetProperty("email", out var e) ? e.ToString() : null;
      var tempPassword = root.TryGetProperty("tempPassword", out var tp) ? tp.ToString() : null;

      if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(tempPassword))
      {
        return res.BadRequest("VALIDATION_ERROR", "username, email, tempPassword are required");
      }
      if (!email.Contains('@', StringComparison.Ordinal))
      {
        return res.BadRequest("VALIDATION_ERROR", "email must be valid");
      }
      if (tempPassword.Length < 8)
      {
        return res.BadRequest("VALIDATION_ERROR", "tempPassword must be >= 8 chars");
      }

      try
      {
        var created = await CognitoClient.CreateEditorUserInCognito(username, email, tempPassword);
        return res.Ok(created);
      }
      catch (Exception ex)
      {
        return res.BadRequest("COGNITO_ERROR", ex.Message);
      }
    }

    return res.MethodNotAllowed("Method not allowed");
  }
}

