using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The console's view of the authoring queue the runner pulls from (R18A A02, contract A00 §8.6): list (A), add a
/// manual item (SA) and skip a queued item (SA). An item is added at most once while it is open: a <c>queued</c> or
/// <c>claimed</c> item with the same url and deck answers 409, checked under a transaction-scoped advisory lock on
/// that pair so two concurrent adds cannot both pass.
/// </summary>
public static class QueueRoutes
{
  public const int DefaultListLimit = 50;
  public const int MaxListLimit = 100;
  public const int MaxUrlLength = 2048;
  public const int MaxTitleLength = 300;
  public const int MaxNoteLength = 500;

  private static readonly string[] ListStatuses = ["queued", "claimed", "done", "failed", "skipped", "all"];

  private const string ItemColumns = """
    q.id, q.kind, q.url, q.title, q.section_hint, q.note, q.deck_id, d.slug as deck_slug, q.status, q.attempts, q.not_before,
    q.claimed_by_runner, q.claimed_at, q.lease_expires_at, q.last_run_id, q.last_error, q.source_target_id, q.source_event_id,
    q.created_by, q.created_at, q.updated_at, q.finished_at
    """;

  // ---------------------------------------------------------------------------------------------
  // /api/v1/admin/automation/queue
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleQueue(LambdaRequest req, Res res, AuthContext auth)
  {
    if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
    {
      var denyRead = Auth.RequireAdmin(auth, res);
      if (denyRead is not null) return denyRead;
      return await List(req, res);
    }
    if (req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
    {
      var denyWrite = Auth.RequireSuperAdmin(auth, res);
      if (denyWrite is not null) return denyWrite;
      return await Add(req, res, auth);
    }
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    return res.MethodNotAllowed("Method not allowed");
  }

  private static async Task<APIGatewayProxyResponse> List(LambdaRequest req, Res res)
  {
    try
    {
      var status = req.Query.TryGetValue("status", out var st) && !string.IsNullOrEmpty(st) ? st : "all";
      if (!ListStatuses.Contains(status)) throw new ValidationError("status must be queued, claimed, done, failed, skipped or all", "status");

      var limit = DefaultListLimit;
      if (req.Query.TryGetValue("limit", out var lim) && !string.IsNullOrEmpty(lim))
      {
        if (!int.TryParse(lim, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxListLimit)
        {
          throw new ValidationError($"limit must be an integer in 1..{MaxListLimit}", "limit");
        }
      }

      long? cursorId = null;
      if (req.Query.TryGetValue("cursor", out var cursorRaw) && !string.IsNullOrEmpty(cursorRaw))
      {
        if (!Drafts.TryDecodeCursor(cursorRaw, out var lastId)) throw new ValidationError("Invalid cursor", "cursor");
        cursorId = lastId;
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var parameters = new List<object?>();
      var where = new List<string> { "true" };
      if (status != "all")
      {
        parameters.Add(status);
        where.Add($"q.status = ${parameters.Count}");
      }
      if (cursorId is not null)
      {
        parameters.Add(cursorId.Value);
        where.Add($"q.id < ${parameters.Count}");
      }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {ItemColumns}
        from authoring_queue_items q left join decks d on d.id = q.deck_id
        where {string.Join(" and ", where)}
        order by q.id desc
        limit ${parameters.Count}
        """, parameters);
      var page = rows.Take(limit).ToList();
      var items = page.Select(ToQueueItem).ToList();
      var nextCursor = rows.Count > limit ? Drafts.EncodeCursor(RunnerRoutes.Long(page[^1]["id"])) : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static async Task<APIGatewayProxyResponse> Add(LambdaRequest req, Res res, AuthContext auth)
  {
    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);

      var url = AutomationBody.OptionalString(body, "url", MaxUrlLength);
      if (url is null || !url.StartsWith("https://", StringComparison.Ordinal)
          || !Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme != Uri.UriSchemeHttps || string.IsNullOrEmpty(parsed.Host))
      {
        throw new ValidationError($"url must be an https URL of at most {MaxUrlLength} characters", "url");
      }
      var deckId = AutomationBody.RequiredLong(body, "deckId");
      var title = AutomationBody.OptionalString(body, "title", MaxTitleLength);
      var note = AutomationBody.OptionalString(body, "note", MaxNoteLength);
      if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      long itemId;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        var deck = await DbUtil.ExecuteScalarAsync(conn, tx, "select id from decks where id = $1 and is_deleted = 0", [deckId]);
        if (deck is null)
        {
          await tx.RollbackAsync();
          return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");
        }

        await DbUtil.ExecuteAsync(conn, tx, "select pg_advisory_xact_lock(hashtextextended('automation-queue:' || $1::text || ':' || $2, 0))", [deckId, url]);
        var open = await DbUtil.ExecuteScalarAsync(conn, tx,
          "select id from authoring_queue_items where url = $1 and deck_id = $2 and status in ('queued', 'claimed') limit 1", [url, deckId]);
        if (open is not null)
        {
          await tx.RollbackAsync();
          return Helpers.ErrorEnvelope(res, 409, "QUEUE_ITEM_EXISTS", "An open queue item already exists for this url and deck");
        }

        itemId = RunnerRoutes.Long(await DbUtil.ExecuteScalarAsync(conn, tx,
          """
          insert into authoring_queue_items (kind, url, deck_id, title, note, dedupe_key, created_by)
          values ('manual', $1, $2, $3, $4, $5, $6)
          returning id
          """, [url, deckId, title, note, $"manual:{Guid.NewGuid()}", $"owner:{auth.UserSub}"]));
        await tx.CommitAsync();
      }

      return res.Ok(await LoadItemAsync(conn, null, itemId));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // /api/v1/admin/automation/queue/:itemId/skip
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleSkip(LambdaRequest req, Res res, AuthContext auth, string itemId)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    if (!long.TryParse(itemId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) return ItemNotFound(res);

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      await using (var tx = await conn.BeginTransactionAsync())
      {
        var status = await DbUtil.ExecuteScalarAsync(conn, tx, "select status from authoring_queue_items where id = $1 for update", [id]);
        if (status is null)
        {
          await tx.RollbackAsync();
          return ItemNotFound(res);
        }
        if ((string)status != "queued")
        {
          await tx.RollbackAsync();
          return Helpers.ErrorEnvelope(res, 409, "QUEUE_ITEM_NOT_QUEUED", "Only a queued item can be skipped");
        }

        await DbUtil.ExecuteAsync(conn, tx,
          "update authoring_queue_items set status = 'skipped', finished_at = now(), updated_at = now() where id = $1", [id]);
        await tx.CommitAsync();
      }

      return res.Ok(await LoadItemAsync(conn, null, id));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------------------------

  private static APIGatewayProxyResponse ItemNotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "QUEUE_ITEM_NOT_FOUND", "Queue item not found");

  private static async Task<object> LoadItemAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long id)
  {
    var rows = await DbUtil.QueryAsync(conn, tx,
      $"select {ItemColumns} from authoring_queue_items q left join decks d on d.id = q.deck_id where q.id = $1", [id]);
    return ToQueueItem(rows[0]);
  }

  private static object ToQueueItem(Dictionary<string, object?> r) => new
  {
    itemId = RunnerRoutes.Long(r["id"]),
    kind = r["kind"],
    url = r["url"],
    title = r["title"],
    sectionHint = r["section_hint"],
    note = r["note"],
    deckId = r["deck_id"] is null ? (long?)null : RunnerRoutes.Long(r["deck_id"]),
    deckSlug = r["deck_slug"],
    status = r["status"],
    attempts = Convert.ToInt32(r["attempts"], CultureInfo.InvariantCulture),
    notBefore = RunnerRoutes.Timestamp(r["not_before"]),
    claimedByRunner = r["claimed_by_runner"],
    claimedAt = RunnerRoutes.Timestamp(r["claimed_at"]),
    leaseExpiresAt = RunnerRoutes.Timestamp(r["lease_expires_at"]),
    lastRunId = r["last_run_id"],
    lastError = r["last_error"],
    sourceTargetId = r["source_target_id"] is null ? (long?)null : RunnerRoutes.Long(r["source_target_id"]),
    sourceEventId = r["source_event_id"] is null ? (long?)null : RunnerRoutes.Long(r["source_event_id"]),
    createdBy = r["created_by"],
    createdAt = RunnerRoutes.Timestamp(r["created_at"]),
    updatedAt = RunnerRoutes.Timestamp(r["updated_at"]),
    finishedAt = RunnerRoutes.Timestamp(r["finished_at"]),
  };
}
