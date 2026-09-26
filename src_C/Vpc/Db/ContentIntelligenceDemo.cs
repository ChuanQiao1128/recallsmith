using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

public static class ContentIntelligenceDemo
{
  private static string ScriptsDir()
  {
    return Path.Combine(AppContext.BaseDirectory, "Db", "Scripts");
  }

  private static string ScriptPath(string action)
  {
    var file = action switch
    {
      "seed" => "seed_content_intelligence_demo.sql",
      "cleanup" => "cleanup_content_intelligence_demo.sql",
      _ => throw new InvalidOperationException("Unsupported action")
    };

    return Path.Combine(ScriptsDir(), file);
  }

  public static async Task<APIGatewayProxyResponse> HandleContentIntelligenceDemo(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    // First, before any role check: a production caller cannot tell this route from an unregistered path.
    if (!DbSafety.DestructiveRoutesEnabled()) return res.NotFound("Route not found");

    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (req.Method != "POST") return res.MethodNotAllowed();

    var secretDeny = DbSafety.CheckMigrateSecret(req, res);
    if (secretDeny is not null) return secretDeny;

    var action = (req.Query.TryGetValue("action", out var rawAction) ? rawAction : "seed")
      .Trim()
      .ToLowerInvariant();
    if (action is not ("seed" or "cleanup"))
    {
      return res.BadRequest("BAD_REQUEST", "Query param action must be seed or cleanup");
    }

    var path = ScriptPath(action);
    if (!File.Exists(path))
    {
      return res.BadRequest("SCRIPT_NOT_FOUND", $"Missing script: {Path.GetFileName(path)}");
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
    }

    try
    {
      var sql = await File.ReadAllTextAsync(path);
      await ExecuteAsync(conn, null, sql, []);

      var cardCount = await ExecuteScalarAsync(
        conn,
        null,
        """
        select count(*)
        from cards c
        join decks d on d.id = c.deck_id
        where d.slug = 'content-intelligence-demo'
          and c.is_deleted = 0;
        """,
        []);

      var eventCount = await ExecuteScalarAsync(
        conn,
        null,
        """
        select count(*)
        from user_progress_events
        where deck_slug = 'content-intelligence-demo';
        """,
        []);

      return res.Ok(new
      {
        ok = true,
        action,
        script = Path.GetFileName(path),
        deckSlug = "content-intelligence-demo",
        cardCount,
        eventCount,
      });
    }
    catch (Exception ex)
    {
      Log.Error("Content intelligence demo script error:", ex);
      return res.Error500(ex);
    }
  }
}
