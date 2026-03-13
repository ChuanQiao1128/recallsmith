using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Db;

public static class QueryRcEvents
{
  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbRcEvents(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    const string sql = """
      select event_id, mode, environment, event_type, product_id, received_at
      from rc_webhook_events
      order by received_at desc
      limit 5;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, []);
    return res.Ok(new { rows });
  }
}

