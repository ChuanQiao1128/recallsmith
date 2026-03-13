using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Public.CognitoAdmin;

public static class DeleteUser
{
  public static Task<APIGatewayProxyResponse> HandleCognitoDeleteUser(
    LambdaRequest req,
    Res res,
    AuthContext auth,
    IReadOnlyDictionary<string, string> parameters)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return Task.FromResult(deny);

    var username = parameters.TryGetValue("username", out var u) ? u : string.Empty;
    return Task.FromResult(res.NotImplemented($"TODO: delete Cognito user {username}"));
  }
}

