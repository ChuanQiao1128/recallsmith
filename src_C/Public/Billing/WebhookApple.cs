using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Public.Billing;

public static class WebhookApple
{
  public static Task<APIGatewayProxyResponse> HandleWebhookApple(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return Task.FromResult(res.MethodNotAllowed("Method not allowed"));
    return Task.FromResult(res.NotImplemented("TODO: Apple webhook verify signature + apply entitlements via internal route"));
  }
}

