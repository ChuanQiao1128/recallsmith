using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class Me
{
  public static Task<APIGatewayProxyResponse> HandleMe(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return Task.FromResult(deny);

    return Task.FromResult(res.Ok(new
    {
      userSub = auth.UserSub,
      groups = auth.Groups,
      serverTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
    }));
  }
}

