using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The console's view of the source watch (R18A A05, contract A00 §8.6): list the watched targets with the latest
/// events (A), add a feed (SA) and edit a target (SA). Page targets are never created by hand: the watcher's
/// <c>targets</c> call syncs them from the live cards' source URLs. The seeded feed URLs and deck slugs are data, fixed
/// here without a migration.
/// </summary>
public static class WatchAdminRoutes
{
  public const int DefaultListLimit = 50;
  public const int MaxListLimit = 100;
  public const int RecentEvents = 50;
  public const int MaxUrlLength = 2048;
  public const int MaxPatternLength = 1000;
  public const int MinInterval = 60, MaxInterval = 43200, DefaultFeedInterval = 360;

  private static readonly string[] Kinds = ["feed", "page"];
  private static readonly string[] FeedFormats = ["rss", "atom", "html-headings"];

  private const string TargetColumns = """
    t.id, t.kind, t.url, t.feed_format, t.deck_id, d.slug as deck_slug, t.item_title_pattern, t.active, t.check_interval_minutes,
    t.last_checked_at, t.last_changed_at, t.last_status, t.last_http_status, t.consecutive_failures, t.created_by, t.created_at,
    case when t.kind = 'page' then (select count(*) from cards c where c.is_deleted = 0 and c.source->>'url' = t.url) end as citing_cards
    """;

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/automation/watch
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleWatch(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      string? kind = null;
      if (req.Query.TryGetValue("kind", out var k) && !string.IsNullOrEmpty(k))
      {
        if (!Kinds.Contains(k)) throw new ValidationError("kind must be feed or page", "kind");
        kind = k;
      }
      bool? active = null;
      if (req.Query.TryGetValue("active", out var a) && !string.IsNullOrEmpty(a))
      {
        active = a switch
        {
          "true" => true,
          "false" => false,
          _ => throw new ValidationError("active must be true or false", "active"),
        };
      }
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
      if (kind is not null)
      {
        parameters.Add(kind);
        where.Add($"t.kind = ${parameters.Count}");
      }
      if (active is not null)
      {
        parameters.Add(active.Value);
        where.Add($"t.active = ${parameters.Count}");
      }
      if (cursorId is not null)
      {
        parameters.Add(cursorId.Value);
        where.Add($"t.id < ${parameters.Count}");
      }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {TargetColumns}
        from source_watch_targets t left join decks d on d.id = t.deck_id
        where {string.Join(" and ", where)}
        order by t.id desc
        limit ${parameters.Count}
        """, parameters);
      var page = rows.Take(limit).ToList();
      var items = page.Select(ToWatchTarget).ToList();
      var nextCursor = rows.Count > limit ? Drafts.EncodeCursor(RunnerRoutes.Long(page[^1]["id"])) : null;

      var events = await DbUtil.QueryAsync(conn, null,
        $"""
        select e.id, e.target_id, t.url, e.kind, e.old_sha256, e.new_sha256, e.details::text as details, e.recheck_state, e.recheck_run_ids,
          e.notification_id, e.created_at
        from source_watch_events e join source_watch_targets t on t.id = e.target_id
        order by e.id desc
        limit {RecentEvents}
        """, []);
      var recentEvents = events.Select(ToWatchEvent).ToList();
      return res.Ok(new { items, recentEvents, nextCursor });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/admin/automation/watch/targets
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleTargets(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

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
      // Page targets come only from the cards' sources (the watcher's targets call).
      AutomationBody.RequiredEnum(body, "kind", ["feed"]);
      var feedFormat = AutomationBody.RequiredEnum(body, "feedFormat", FeedFormats);
      var deckId = AutomationBody.RequiredLong(body, "deckId");
      var pattern = AutomationBody.OptionalString(body, "itemTitlePattern", MaxPatternLength);
      var interval = AutomationBody.OptionalInt(body, "checkIntervalMinutes", MinInterval, MaxInterval) ?? DefaultFeedInterval;
      if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      if (!await LiveDeckAsync(conn, deckId)) return DeckNotFound(res);
      if (pattern is not null && !await PatternValidAsync(conn, pattern)) return PatternInvalid(res);

      var id = await DbUtil.ExecuteScalarAsync(conn, null,
        """
        insert into source_watch_targets (kind, url, feed_format, deck_id, item_title_pattern, active, check_interval_minutes, created_by)
        values ('feed', $1, $2, $3, $4::text, true, $5, $6)
        on conflict (url) do nothing
        returning id
        """, [url, feedFormat, deckId, pattern, interval, $"owner:{auth.UserSub}"]);
      if (id is null) return Helpers.ErrorEnvelope(res, 409, "WATCH_TARGET_EXISTS", "A watch target with this url already exists");

      return res.Ok(await LoadTargetAsync(conn, RunnerRoutes.Long(id)));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // PUT /api/v1/admin/automation/watch/targets/:targetId
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleTarget(LambdaRequest req, Res res, AuthContext auth, string targetId)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("PUT", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    if (!long.TryParse(targetId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) return TargetNotFound(res);

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);

      var sets = new List<string>();
      var parameters = new List<object?> { id };
      void Set(string column, object? value, string cast = "")
      {
        parameters.Add(value);
        sets.Add($"{column} = ${parameters.Count}{cast}");
      }

      if (body.TryGetProperty("active", out var activeEl))
      {
        if (activeEl.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new ValidationError("active must be a boolean", "active");
        Set("active", activeEl.GetBoolean());
      }
      long? deckId = null;
      var hasDeck = body.TryGetProperty("deckId", out _);
      if (hasDeck)
      {
        deckId = body.GetProperty("deckId").ValueKind == JsonValueKind.Null ? null : AutomationBody.RequiredLong(body, "deckId");
        Set("deck_id", deckId, "::bigint");
      }
      string? pattern = null;
      if (body.TryGetProperty("itemTitlePattern", out _))
      {
        pattern = AutomationBody.OptionalString(body, "itemTitlePattern", MaxPatternLength);
        Set("item_title_pattern", pattern, "::text");
      }
      if (body.TryGetProperty("checkIntervalMinutes", out _))
      {
        var interval = AutomationBody.OptionalInt(body, "checkIntervalMinutes", MinInterval, MaxInterval)
          ?? throw new ValidationError($"checkIntervalMinutes must be an integer in {MinInterval}..{MaxInterval}", "checkIntervalMinutes");
        Set("check_interval_minutes", interval);
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      if (await DbUtil.ExecuteScalarAsync(conn, null, "select id from source_watch_targets where id = $1", [id]) is null) return TargetNotFound(res);
      if (deckId is { } d && !await LiveDeckAsync(conn, d)) return DeckNotFound(res);
      if (pattern is not null && !await PatternValidAsync(conn, pattern)) return PatternInvalid(res);

      if (sets.Count > 0)
      {
        var updated = await DbUtil.ExecuteAsync(conn, null,
          $"update source_watch_targets set {string.Join(", ", sets)}, updated_at = now() where id = $1", parameters);
        if (updated == 0) return TargetNotFound(res);
      }
      return res.Ok(await LoadTargetAsync(conn, id));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------------------------

  private static APIGatewayProxyResponse TargetNotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "WATCH_TARGET_NOT_FOUND", "Watch target not found");

  private static APIGatewayProxyResponse DeckNotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");

  private static APIGatewayProxyResponse PatternInvalid(Res res) =>
    res.BadRequest("WATCH_PATTERN_INVALID", "itemTitlePattern is not a valid PostgreSQL regular expression");

  private static async Task<bool> LiveDeckAsync(NpgsqlConnection conn, long deckId) =>
    await DbUtil.ExecuteScalarAsync(conn, null, "select id from decks where id = $1 and is_deleted = 0", [deckId]) is not null;

  /// <summary>The pattern is used as <c>title ~* pattern</c>; PostgreSQL alone decides whether it is valid (SqlState 2201B).</summary>
  private static async Task<bool> PatternValidAsync(NpgsqlConnection conn, string pattern)
  {
    try
    {
      await DbUtil.ExecuteScalarAsync(conn, null, "select '' ~* $1::text", [pattern]);
      return true;
    }
    catch (PostgresException pg) when (pg.SqlState == "2201B")
    {
      return false;
    }
  }

  private static async Task<object> LoadTargetAsync(NpgsqlConnection conn, long id)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      $"select {TargetColumns} from source_watch_targets t left join decks d on d.id = t.deck_id where t.id = $1", [id]);
    return ToWatchTarget(rows[0]);
  }

  private static object ToWatchTarget(Dictionary<string, object?> r) => new
  {
    targetId = RunnerRoutes.Long(r["id"]),
    kind = r["kind"],
    url = r["url"],
    feedFormat = r["feed_format"],
    deckId = r["deck_id"] is null ? (long?)null : RunnerRoutes.Long(r["deck_id"]),
    deckSlug = r["deck_slug"],
    itemTitlePattern = r["item_title_pattern"],
    active = r["active"] is true,
    checkIntervalMinutes = Convert.ToInt32(r["check_interval_minutes"], CultureInfo.InvariantCulture),
    lastCheckedAt = RunnerRoutes.Timestamp(r["last_checked_at"]),
    lastChangedAt = RunnerRoutes.Timestamp(r["last_changed_at"]),
    lastStatus = r["last_status"],
    lastHttpStatus = r["last_http_status"] is null ? (int?)null : Convert.ToInt32(r["last_http_status"], CultureInfo.InvariantCulture),
    consecutiveFailures = Convert.ToInt32(r["consecutive_failures"], CultureInfo.InvariantCulture),
    citingCards = r["citing_cards"] is null ? (long?)null : RunnerRoutes.Long(r["citing_cards"]),
    createdBy = r["created_by"],
    createdAt = RunnerRoutes.Timestamp(r["created_at"]),
  };

  private static object ToWatchEvent(Dictionary<string, object?> r)
  {
    JsonElement? details = null;
    var queueItemIds = new List<long>();
    if (r["details"] is string json)
    {
      using var doc = JsonDocument.Parse(json);
      details = doc.RootElement.Clone();
      if (doc.RootElement.ValueKind == JsonValueKind.Object
          && doc.RootElement.TryGetProperty("queueItemIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
      {
        queueItemIds.AddRange(ids.EnumerateArray().Where(i => i.ValueKind == JsonValueKind.Number && i.TryGetInt64(out _)).Select(i => i.GetInt64()));
      }
    }
    return new
    {
      eventId = RunnerRoutes.Long(r["id"]),
      targetId = RunnerRoutes.Long(r["target_id"]),
      url = r["url"],
      kind = r["kind"],
      oldSha256 = r["old_sha256"],
      newSha256 = r["new_sha256"],
      details,
      recheckState = r["recheck_state"],
      recheckRunIds = r["recheck_run_ids"] as Guid[] ?? [],
      queueItemIds,
      notificationId = r["notification_id"] as Guid?,
      createdAt = RunnerRoutes.Timestamp(r["created_at"]),
    };
  }
}
