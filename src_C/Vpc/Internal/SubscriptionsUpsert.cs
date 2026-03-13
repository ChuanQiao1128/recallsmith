using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Internal;

public static class SubscriptionsUpsert
{
  public static Task<APIGatewayProxyResponse> HandleInternalSubscriptionsUpsert(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return Task.FromResult(res.MethodNotAllowed("Method not allowed"));

    var v = Auth.VerifyInternalSignature(req);
    if (!v.Ok) return Task.FromResult(res.Forbidden($"Internal auth failed: {v.Reason}"));

    return Task.FromResult(res.NotImplemented("TODO: internal subscriptions upsert (write RDS)"));
  }
}

