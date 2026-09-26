using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public sealed record ReapResult(int Pending, int Processing, string[] JobIds);

/// <summary>
/// POST /api/v1/admin/publish/reap (super-admin): fails orphaned PENDING (&gt; 10 min since insert)
/// and PROCESSING (&gt; 30 min since last touch) rows. FAILED is terminal: the worker never re-acquires
/// a FAILED row, and if a reaped job's in-flight SQS message is later redelivered the worker
/// acknowledges and drops it, so recovering the deck needs a fresh publish. The core is Res-free so
/// E12's scheduled reap can reuse it.
/// </summary>
public static class PublishReaper
{
  // Two data-modifying CTEs so each returned row carries its PRE-update status; the PENDING and
  // PROCESSING predicates are disjoint, so no row is touched twice in one statement.
  private const string ReapSql = """
    with p as (
      update deck_publishes
      set status = 'FAILED', error_message = 'orphaned: no worker pickup', updated_at = now()
      where status = 'PENDING' and created_at < now() - interval '10 minutes'
      returning job_id
    ), q as (
      update deck_publishes
      set status = 'FAILED', error_message = 'orphaned: no worker pickup', updated_at = now()
      where status = 'PROCESSING' and updated_at < now() - interval '30 minutes'
      returning job_id
    )
    select 'PENDING' as was, job_id from p
    union all
    select 'PROCESSING' as was, job_id from q
    """;

  public static async Task<ReapResult> ReapOrphansAsync(NpgsqlConnection conn)
  {
    var rows = await DbUtil.QueryAsync(conn, null, ReapSql, []);

    var pending = 0;
    var processing = 0;
    var jobIds = new List<string>();
    foreach (var r in rows)
    {
      var was = Convert.ToString(r["was"], CultureInfo.InvariantCulture) ?? string.Empty;
      var jobId = Convert.ToString(r["job_id"], CultureInfo.InvariantCulture) ?? string.Empty;
      if (was == "PENDING") pending++;
      else if (was == "PROCESSING") processing++;
      if (!string.IsNullOrEmpty(jobId)) jobIds.Add(jobId);
    }

    return new ReapResult(pending, processing, jobIds.ToArray());
  }

  public static async Task<APIGatewayProxyResponse> HandlePublishReap(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars");

    var r = await ReapOrphansAsync(conn);
    return res.Ok(new { pending = r.Pending, processing = r.Processing, jobIds = r.JobIds });
  }
}
