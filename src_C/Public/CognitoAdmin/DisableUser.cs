using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Public.CognitoAdmin;

public static class DisableUser
{
  public static async Task<APIGatewayProxyResponse> HandleCognitoDisableUser(
    LambdaRequest req,
    Res res,
    AuthContext auth,
    IReadOnlyDictionary<string, string> parameters)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var username = parameters.TryGetValue("username", out var u) ? u : string.Empty;
    try
    {
      var r = await CognitoClient.DisableUserInCognito(username);
      var outObj = new Dictionary<string, object?>(r) { ["username"] = username };
      return res.Ok(outObj);
    }
    catch (Exception ex)
    {
      return res.BadRequest("COGNITO_ERROR", ex.Message);
    }
  }
}

