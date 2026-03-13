using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Db;

public static class QueryPremiumState
{
  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbPremiumState(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var user = (req.Query.TryGetValue("user", out var u) ? u : string.Empty).Trim();
    if (string.IsNullOrEmpty(user)) return res.BadRequest("BAD_REQUEST", "Missing ?user=");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    const string sql = """
      select
        app_user_id,
        premium_active,
        premium_env,
        product_id,
        entitlement_id,
        expires_at_ms,
        updated_at,
        last_event_id,
        last_event_type,
        last_event_at
      from user_premium_state
      where app_user_id = $1
      limit 1;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [user]);
    return res.Ok(new { row = rows.Count > 0 ? rows[0] : null });
  }
}

