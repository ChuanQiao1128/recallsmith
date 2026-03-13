using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Internal;

public static class EntitlementsApply
{
  public static Task<APIGatewayProxyResponse> HandleInternalEntitlementsApply(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return Task.FromResult(res.MethodNotAllowed("Method not allowed"));

    var v = Auth.VerifyInternalSignature(req);
    if (!v.Ok) return Task.FromResult(res.Forbidden($"Internal auth failed: {v.Reason}"));

    return Task.FromResult(res.NotImplemented("TODO: internal entitlements apply (write RDS)"));
  }
}

