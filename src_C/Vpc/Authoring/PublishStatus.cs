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
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars");

    // Editors may only poll jobs for decks they can read; a job on an unreadable deck answers
    // the same 404 as a missing job, so existence does not leak. Super-admins read any job.
    const string sql = """
      select
        p.job_id as "jobId",
        p.status,
        p.build_id as "buildId",
        p.s3_key as "s3Key",
        p.error_message as "errorMessage"
      from deck_publishes p
      where p.job_id = $1
        and ($2::boolean or exists (select 1 from admin_deck_permissions a
                                    where a.deck_id = p.deck_id and a.admin_sub = $3 and a.can_read = 1))
      limit 1;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [jobId, auth.IsSuperAdmin, auth.UserSub]);
    if (rows.Count == 0)
    {
      return res.NotFound("Job not found");
    }

    return res.Ok(rows[0]);
  }
}