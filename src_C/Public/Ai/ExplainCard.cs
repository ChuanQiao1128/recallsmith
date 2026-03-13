using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Public.Ai;

public static class ExplainCard
{
  public static Task<APIGatewayProxyResponse> HandleAiExplainCard(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return Task.FromResult(deny);

    if (req.Method != "POST") return Task.FromResult(res.MethodNotAllowed("Method not allowed"));
    return Task.FromResult(res.NotImplemented("TODO: AI explain card (public lambda can call model APIs)"));
  }
}

