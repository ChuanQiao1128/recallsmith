using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The admin-users 501 placeholders are gone (CBE-01). GET /api/v1/admin/users,
/// GET /api/v1/admin/users/:sub and PUT /api/v1/admin/users/:sub/entitlements used to
/// answer 501 "TODO: admin users list" from core-vpc; they now fall through to the
/// generic "Route not found" 404. The console instead calls edge-public at
/// /api/v1/admin/cognito/users, which core-vpc never served and still does not.
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

  [Fact]
  public async Task CognitoUsersPath_IsNotServedByCoreVpc()
  {
    // edge-public owns /api/v1/admin/cognito/users; core-vpc has no route for it, so a
    // super admin hitting it here gets the generic 404.
    var response = await new VpcFunction().Handler(SuperAdminEvent("GET", "/api/v1/admin/cognito/users"));

    Assert.Equal(404, response.StatusCode);
    Assert.Equal("NOT_FOUND", ErrorCode(response));
  }
}
