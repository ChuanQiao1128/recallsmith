using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class PublishJobs
{
  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleFetchPublishJobs(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed();

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    // 修复点：移除了不存在的 updated_at 字段
    const string sql = """
      select
        job_id as "jobId",
        deck_slug as "deckSlug",
        status,
        note,
        error_message as "errorMessage",
        created_at as "createdAt"
      from deck_publishes
      where job_id is not null
      order by created_at desc
      limit 100;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, []);
    
    return res.Ok(rows);
  }
}