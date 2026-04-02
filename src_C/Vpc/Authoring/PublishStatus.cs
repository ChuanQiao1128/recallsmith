using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class PublishStatus
{
  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandlePublishStatus(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed();

    if (!req.Query.TryGetValue("jobId", out var jobId) || string.IsNullOrWhiteSpace(jobId))
    {
      return res.BadRequest("VALIDATION_ERROR", "Missing required query parameter: jobId");
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    const string sql = """
      select
        job_id as "jobId",
        status,
        build_id as "buildId",
        s3_key as "s3Key",
        error_message as "errorMessage"
      from deck_publishes
      where job_id = $1
      limit 1;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [jobId]);
    if (rows.Count == 0)
    {
      return res.NotFound("Job not found");
    }

    return res.Ok(rows[0]);
  }
}