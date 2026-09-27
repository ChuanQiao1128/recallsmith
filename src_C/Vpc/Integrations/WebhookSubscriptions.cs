using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Integrations;

/// <summary>
/// super_admin console API for outbound webhook subscriptions (R18 J03, contract §6.6):
/// GET/POST /api/v1/admin/webhooks/subscriptions, PUT/DELETE …/subscriptions/:subscriptionId and
/// POST …/subscriptions/:subscriptionId/test. Subscriptions are soft-deleted only. The URL is returned
/// by this API and never logged; audit rows carry its host only.
/// </summary>
public static class WebhookSubscriptions
{
  public const int NameMaxLength = 80;

  private const string SelectColumns =
    """id, name, url, events, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" """;

  private sealed record SubscriptionFields(string? Name, string? Url, string[]? Events, bool? IsActive);

  public static async Task<APIGatewayProxyResponse> HandleSubscriptions(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var isGet = req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase);
    var isPost = req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase);
    if (!isGet && !isPost) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      if (isGet)
      {
        var rows = await DbUtil.QueryAsync(conn, null,
          $"select {SelectColumns} from webhook_subscriptions where deleted_at is null order by id", []);
        return res.Ok(new
        {
          items = rows.Select(ToWire).ToArray(),
          events = WebhookEvents.SubscribableEvents,
          signingSecretSsmName = WebhookEvents.SigningSecretSsmName,
        });
      }

      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var (fields, error) = ParseFields(doc.RootElement, res, requireAll: true);
      if (error is not null) return error;

      await using var tx = await conn.BeginTransactionAsync();
      var inserted = await DbUtil.QueryAsync(conn, tx,
        $"insert into webhook_subscriptions (name, url, events, is_active, created_by_sub) values ($1, $2, $3, $4, $5) returning {SelectColumns}",
        [fields!.Name, fields.Url, fields.Events, fields.IsActive ?? true, auth.UserSub]);
      var created = inserted[0];
      var id = Convert.ToInt64(created["id"], CultureInfo.InvariantCulture);

      var entry = AdminAudit.Entry(auth, res, "webhook.subscription.create", Target(id), null, AuditState(created));
      var persisted = await AdminAudit.RecordAsync(conn, tx, entry);
      await tx.CommitAsync();
      AdminAudit.Emit(entry, persisted);

      return res.Ok(ToWire(created));
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  public static async Task<APIGatewayProxyResponse> HandleSubscription(LambdaRequest req, Res res, AuthContext auth, string subscriptionId)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var isPut = req.Method.Equals("PUT", StringComparison.OrdinalIgnoreCase);
    var isDelete = req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase);
    if (!isPut && !isDelete) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    if (!TryParseId(subscriptionId, out var id)) return res.BadRequest("VALIDATION_ERROR", "subscriptionId must be a positive integer");

    try
    {
      SubscriptionFields? fields = null;
      if (isPut)
      {
        using var doc = Validation.ParseJsonBody(req);
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        var (parsed, error) = ParseFields(doc.RootElement, res, requireAll: false);
        if (error is not null) return error;
        fields = parsed;
      }

      await using var tx = await conn.BeginTransactionAsync();
      var existing = await DbUtil.QueryAsync(conn, tx,
        $"select {SelectColumns} from webhook_subscriptions where id = $1 and deleted_at is null for update", [id]);
      if (existing.Count == 0) return NotFound(res, id);
      var before = existing[0];

      List<Dictionary<string, object?>> after;
      string action;
      if (isPut)
      {
        after = await DbUtil.QueryAsync(conn, tx,
          $"""
          update webhook_subscriptions set
            name = coalesce($2, name),
            url = coalesce($3, url),
            events = coalesce($4::text[], events),
            is_active = coalesce($5::boolean, is_active),
            updated_at = now()
          where id = $1
          returning {SelectColumns}
          """,
          [id, fields!.Name, fields.Url, fields.Events, fields.IsActive]);
        action = "webhook.subscription.update";
      }
      else
      {
        after = await DbUtil.QueryAsync(conn, tx,
          $"update webhook_subscriptions set deleted_at = now(), is_active = false, updated_at = now() where id = $1 returning {SelectColumns}",
          [id]);
        action = "webhook.subscription.delete";
      }

      var entry = AdminAudit.Entry(auth, res, action, Target(id), AuditState(before), AuditState(after[0]));
      var persisted = await AdminAudit.RecordAsync(conn, tx, entry);
      await tx.CommitAsync();
      AdminAudit.Emit(entry, persisted);

      return isPut ? res.Ok(ToWire(after[0])) : res.Ok(new { id, deleted = true });
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  public static async Task<APIGatewayProxyResponse> HandleTest(LambdaRequest req, Res res, AuthContext auth, string subscriptionId)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    if (!TryParseId(subscriptionId, out var id)) return res.BadRequest("VALIDATION_ERROR", "subscriptionId must be a positive integer");

    try
    {
      var exists = await DbUtil.QueryAsync(conn, null,
        "select id from webhook_subscriptions where id = $1 and deleted_at is null", [id]);
      if (exists.Count == 0) return NotFound(res, id);

      if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv)))
      {
        return Helpers.ErrorEnvelope(res, 503, "WEBHOOKS_NOT_CONFIGURED", "The webhook events queue is not configured");
      }

      // An inactive subscription can still be tested: onlySubscriptionId ignores is_active and events.
      var result = await WebhookEvents.EnqueueAsync(conn, WebhookEvents.TestEvent,
        new { subscriptionId = id, message = "DeveloperCards test event" }, onlySubscriptionId: id);

      var deliveryId = await DbUtil.ExecuteScalarAsync(conn, null,
        "select delivery_id from webhook_deliveries where event_id = $1 limit 1", [result.EventId]);

      return res.Ok(new { eventId = result.EventId, deliveryId = deliveryId as Guid? });
    }
    catch (Exception ex)
    {
      return MapError(ex, res);
    }
  }

  // ------------------------------------------------------------------ helpers

  internal static bool TryParseId(string raw, out long id) =>
    long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out id) && id > 0;

  private static string Target(long id) => $"webhook_subscription:{id.ToString(CultureInfo.InvariantCulture)}";

  private static APIGatewayProxyResponse NotFound(Res res, long id) =>
    Helpers.ErrorEnvelope(res, 404, "SUBSCRIPTION_NOT_FOUND", $"Webhook subscription {id.ToString(CultureInfo.InvariantCulture)} not found");

  /// <summary>Validates the POST/PUT keys. With <paramref name="requireAll"/> false any subset may be
  /// present; each key that is present follows the same rule. Unknown keys are ignored.</summary>
  private static (SubscriptionFields? Fields, APIGatewayProxyResponse? Error) ParseFields(JsonElement body, Res res, bool requireAll)
  {
    if (body.ValueKind != JsonValueKind.Object) return (null, res.BadRequest("VALIDATION_ERROR", "Body must be a JSON object"));

    string? name = null;
    if (body.TryGetProperty("name", out var nameEl))
    {
      if (nameEl.ValueKind != JsonValueKind.String) return (null, res.BadRequest("VALIDATION_ERROR", "name must be a string of 1..80 characters"));
      name = nameEl.GetString()!.Trim();
      if (name.Length < 1 || name.Length > NameMaxLength) return (null, res.BadRequest("VALIDATION_ERROR", "name must be a string of 1..80 characters"));
    }
    else if (requireAll)
    {
      return (null, res.BadRequest("VALIDATION_ERROR", "name is required"));
    }

    string? url = null;
    if (body.TryGetProperty("url", out var urlEl) || requireAll)
    {
      var candidate = urlEl.ValueKind == JsonValueKind.String ? urlEl.GetString()!.Trim() : null;
      if (!WebhookEvents.IsValidSubscriptionUrl(candidate))
      {
        return (null, res.BadRequest("WEBHOOK_URL_INVALID",
          "url must be an https:// URL of at most 2048 characters, without credentials, whose host is not localhost or a private, loopback or link-local address"));
      }
      url = candidate;
    }

    string[]? events = null;
    if (body.TryGetProperty("events", out var eventsEl))
    {
      if (eventsEl.ValueKind != JsonValueKind.Array
          || eventsEl.GetArrayLength() is < 1 or > 4
          || eventsEl.EnumerateArray().Any(e => e.ValueKind != JsonValueKind.String))
      {
        return (null, res.BadRequest("VALIDATION_ERROR", "events must be an array of 1..4 event names"));
      }

      var list = new List<string>();
      foreach (var e in eventsEl.EnumerateArray())
      {
        var value = e.GetString()!;
        if (!WebhookEvents.SubscribableEvents.Contains(value, StringComparer.Ordinal))
        {
          return (null, res.BadRequest("WEBHOOK_EVENT_UNKNOWN",
            $"Unknown event '{value}'; subscribable events are {string.Join(", ", WebhookEvents.SubscribableEvents)}"));
        }
        if (!list.Contains(value, StringComparer.Ordinal)) list.Add(value);
      }
      events = list.ToArray();
    }
    else if (requireAll)
    {
      return (null, res.BadRequest("VALIDATION_ERROR", "events is required"));
    }

    bool? isActive = null;
    if (body.TryGetProperty("isActive", out var activeEl))
    {
      if (activeEl.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
      {
        return (null, res.BadRequest("VALIDATION_ERROR", "isActive must be a boolean"));
      }
      isActive = activeEl.GetBoolean();
    }

    return (new SubscriptionFields(name, url, events, isActive), null);
  }

  private static object ToWire(Dictionary<string, object?> row) => new
  {
    id = Convert.ToInt64(row["id"], CultureInfo.InvariantCulture),
    name = (string)row["name"]!,
    url = (string)row["url"]!,
    events = (string[])row["events"]!,
    isActive = (bool)row["isActive"]!,
    createdAt = row["createdAt"],
    updatedAt = row["updatedAt"],
  };

  /// <summary>Audit before/after: never the URL, only its host.</summary>
  private static object AuditState(Dictionary<string, object?> row) => new
  {
    id = Convert.ToInt64(row["id"], CultureInfo.InvariantCulture),
    name = (string)row["name"]!,
    urlHost = UrlHost((string)row["url"]!),
    events = (string[])row["events"]!,
    isActive = (bool)row["isActive"]!,
  };

  internal static string? UrlHost(string url) =>
    Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : null;

  /// <summary>42P01/42703 ⇒ 503 SERVER_NOT_READY_WEBHOOKS (migration 027 not run); other SQL errors
  /// through the shared mapper; anything else is a 500.</summary>
  internal static APIGatewayProxyResponse MapError(Exception ex, Res res)
  {
    if (ex is PostgresException { SqlState: "42P01" or "42703" })
    {
      return Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY_WEBHOOKS", "Run migration 027 first");
    }
    return Helpers.HandlePgError(ex, res) ?? res.Error500(ex);
  }
}
