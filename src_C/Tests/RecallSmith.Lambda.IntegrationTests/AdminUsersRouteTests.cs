using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The admin-users 501 placeholders are gone (CBE-01). GET /api/v1/admin/users,
/// GET /api/v1/admin/users/:sub and PUT /api/v1/admin/users/:sub/entitlements used to
/// answer 501 "TODO: admin users list" from core-vpc; core-vpc now recognises those old
/// paths only to reject them with a plain "Route not found" 404. The console later
/// called edge-public at /api/v1/admin/cognito/users; edge-public was retired on
/// 2026-10-04 (R27 EDGE) and console accounts are managed with the AWS CLI
/// (infra/RUNBOOK.md §14). Its gateway routes are gone, so its paths now fall through to
/// core-vpc, which serves none of them.
///
/// Every request below goes through <see cref="VpcFunction.Handler"/> with gateway
/// authorizer claims for a super_admin — the same event shape as
/// AuthBearerTests.AuthorizerClaims_StillWin_AndSkipTheVerifier — so a super admin who
/// could once reach a 501 now gets a 404, which is the whole point of the deletion.
/// </summary>
/// <remarks>
/// In the postgres collection because <see cref="Auth.Configure"/> is process-global
/// state that must stay serial with the other classes that call
/// <see cref="Auth.GetAuthContextAsync"/>. These routes answer before any DB access.
/// </remarks>
[Collection(PostgresCollection.Name)]
public sealed class AdminUsersRouteTests
{
  private static JsonElement SuperAdminEvent(string method, string path)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = "it-adminusers-super",
              ["cognito:groups"] = "[super_admin]",
            },
          },
        },
      },
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      queryStringParameters = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static string ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString()!;

  [Theory]
  [InlineData("GET", "/api/v1/admin/users")]
  [InlineData("GET", "/api/v1/admin/users/some-sub")]
  [InlineData("PUT", "/api/v1/admin/users/some-sub/entitlements")]
  public async Task RemovedAdminUsersPlaceholder_IsRouteNotFound_ForSuperAdmin(string method, string path)
  {
    var response = await new VpcFunction().Handler(SuperAdminEvent(method, path));

    Assert.Equal(404, response.StatusCode);
    Assert.Equal("NOT_FOUND", ErrorCode(response));
  }

  [Theory]
  [InlineData("GET", "/api/v1/admin/cognito/users")]
  [InlineData("POST", "/api/v1/admin/cognito/users")]
  [InlineData("POST", "/api/v1/admin/cognito/users/some-user/disable")]
  [InlineData("POST", "/api/v1/ai/explain-card")]
  [InlineData("POST", "/api/v1/billing/verify")]
  [InlineData("POST", "/api/v1/billing/webhook/apple")]
  public async Task RetiredEdgePublicPaths_AreNotServedByCoreVpc(string method, string path)
  {
    // edge-public's three gateway routes (ANY /api/v1/admin/cognito/{proxy+}, /api/v1/ai/{proxy+},
    // /api/v1/billing/{proxy+}) were deleted with it, so these requests now land on core-vpc
    // through ANY /api/v1/admin/{proxy+} and ANY /{proxy+}. core-vpc has no route for any of
    // them: even a super admin gets the generic 404, never a create, a disable or a 501 stub.
    var response = await new VpcFunction().Handler(SuperAdminEvent(method, path));

    Assert.Equal(404, response.StatusCode);
    Assert.Equal("NOT_FOUND", ErrorCode(response));
  }
}
