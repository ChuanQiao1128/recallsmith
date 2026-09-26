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

    // Non-super-admins are scoped by admin_deck_permissions, so they need an identity to scope by.
    if (!auth.IsSuperAdmin && string.IsNullOrEmpty(auth.UserSub))
    {
      return res.Forbidden("Requires authenticated admin user");
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars");

    // Editors only see jobs for decks they can read (admin_deck_permissions.can_read = 1),
    // as Cards and Decks already do. Super-admins see every deck.
    const string sql = """
      select
        p.job_id as "jobId",
        p.deck_id as "deckId",
        p.deck_slug as "deckSlug",
        p.status,
        p.note,
        p.error_message as "errorMessage",
        p.created_at as "createdAt"
      from deck_publishes p
      where p.job_id is not null
        and ($1::boolean or exists (select 1 from admin_deck_permissions a
                                    where a.deck_id = p.deck_id and a.admin_sub = $2 and a.can_read = 1))
      order by p.created_at desc
      limit 100;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [auth.IsSuperAdmin, auth.UserSub]);

    return res.Ok(rows);
  }
}