using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Public.Billing;

public static class WebhookGoogle
{
  public static Task<APIGatewayProxyResponse> HandleWebhookGoogle(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return Task.FromResult(res.MethodNotAllowed("Method not allowed"));
    return Task.FromResult(res.NotImplemented("TODO: Google RTDN webhook + apply entitlements via internal route"));
  }
}

