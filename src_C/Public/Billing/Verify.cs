using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Public.Billing;

public static class Verify
{
  public static Task<APIGatewayProxyResponse> HandleBillingVerify(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return Task.FromResult(deny);

    if (req.Method != "POST") return Task.FromResult(res.MethodNotAllowed("Method not allowed"));
    return Task.FromResult(res.NotImplemented("TODO: billing verify (call Apple/Google) then call core-vpc internal routes"));
  }
}

