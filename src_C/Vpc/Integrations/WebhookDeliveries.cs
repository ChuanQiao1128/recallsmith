using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.Vpc.Integrations;

/// <summary>
/// super_admin delivery log and redelivery for outbound webhooks (R18 J03, contract §6.6):
/// GET /api/v1/admin/webhooks/deliveries and POST …/deliveries/:deliveryId/redeliver. The delivered
/// body is never returned.
/// </summary>
public static class WebhookDeliveries
{
  public static readonly IReadOnlyList<string> Statuses = ["queued", "delivered", "retrying", "failed", "dead", "enqueue_failed"];

  public const int DefaultLimit = 50;
  public const int MaxLimit = 100;

  public static async Task<APIGatewayProxyResponse> HandleDeliveries(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var where = new List<string>();
    var parameters = new List<object?>();

    if (Param(req, "subscriptionId") is { } subRaw)
    {
      if (!WebhookSubscriptions.TryParseId(subRaw, out var subscriptionId)) return res.BadRequest("VALIDATION_ERROR", "subscriptionId must be a positive integer");
      parameters.Add(subscriptionId);
      where.Add($"d.subscription_id = ${parameters.Count}");
    }

    if (Param(req, "status") is { } status)
    {
      if (!Statuses.Contains(status, StringComparer.Ordinal)) return res.BadRequest("VALIDATION_ERROR", $"status must be one of {string.Join(", ", Statuses)}");
      parameters.Add(status);
      where.Add($"d.status = ${parameters.Count}");
    }

    if (Param(req, "event") is { } eventType)
    {
      var known = WebhookEvents.SubscribableEvents.Contains(eventType, StringComparer.Ordinal)
        || string.Equals(eventType, WebhookEvents.TestEvent, StringComparison.Ordinal);
      if (!known) return res.BadRequest("VALIDATION_ERROR", "event must be a subscribable event or webhook.test");
      parameters.Add(eventType);
      where.Add($"d.event = ${parameters.Count}");
    }

    var limit = DefaultLimit;
    if (Param(req, "limit") is { } limitRaw)
    {
      if (!int.TryParse(limitRaw, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxLimit)
      {
        return res.BadRequest("VALIDATION_ERROR", "limit must be an integer in 1..100");
      }
    }

    if (Param(req, "cursor") is { } cursorRaw)
    {
      if (!TryDecodeCursor(cursorRaw, out var micros, out var lastId)) return res.BadRequest("VALIDATION_ERROR", "Invalid cursor");
      parameters.Add(micros);
      var tIndex = parameters.Count;
      parameters.Add(lastId);
      var idIndex = parameters.Count;
      // Exact: timestamps are integer microseconds, so epoch + N µs rebuilds the stored value with no float.
      where.Add($"(d.created_at, d.delivery_id) < (timestamptz 'epoch' + (${tIndex}::bigint * interval '1 microsecond'), ${idIndex}::uuid)");
    }

    parameters.Add(limit);
    var sql = $"""
      select d.delivery_id as "deliveryId", d.event_id as "eventId", d.event as "event", d.subscription_id as "subscriptionId",
             d.status as "status", d.attempts as "attempts", d.last_status_code as "lastStatusCode", d.last_error as "lastError",
             d.created_at as "createdAt", d.updated_at as "updatedAt", d.delivered_at as "deliveredAt",
             (extract(epoch from d.created_at) * 1000000)::bigint as "t"
      from webhook_deliveries d
      {(where.Count > 0 ? "where " + string.Join(" and ", where) : string.Empty)}
      order by d.created_at desc, d.delivery_id desc
      limit ${parameters.Count}
      """;

    try
    {
      var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
      var items = rows.Select(r => new
      {
        deliveryId = (Guid)r["deliveryId"]!,
        eventId = (Guid)r["eventId"]!,
        @event = (string)r["event"]!,
        subscriptionId = Convert.ToInt64(r["subscriptionId"], CultureInfo.InvariantCulture),
        status = (string)r["status"]!,
        attempts = Convert.ToInt32(r["attempts"], CultureInfo.InvariantCulture),
        lastStatusCode = r["lastStatusCode"] is null ? (int?)null : Convert.ToInt32(r["lastStatusCode"], CultureInfo.InvariantCulture),
        lastError = (string?)r["lastError"],
        createdAt = r["createdAt"],
        updatedAt = r["updatedAt"],
        deliveredAt = r["deliveredAt"],
      }).ToArray();

      string? nextCursor = null;
      if (rows.Count == limit)
      {
        var last = rows[^1];
        nextCursor = EncodeCursor(Convert.ToInt64(last["t"], CultureInfo.InvariantCulture), (Guid)last["deliveryId"]!);
      }

      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return WebhookSubscriptions.MapError(ex, res);
    }
  }

  public static async Task<APIGatewayProxyResponse> HandleRedeliver(LambdaRequest req, Res res, AuthContext auth, string deliveryId)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    if (!Guid.TryParse(deliveryId, out var id)) return res.BadRequest("VALIDATION_ERROR", "deliveryId must be a uuid");

    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select d.event_id as "eventId", (s.deleted_at is null and s.is_active) as "live"
        from webhook_deliveries d
        join webhook_subscriptions s on s.id = d.subscription_id
        where d.delivery_id = $1
        """,
        [id]);
      if (rows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DELIVERY_NOT_FOUND", $"Delivery {id} not found");
      if (!(bool)rows[0]["live"]!)
      {
        return Helpers.ErrorEnvelope(res, 409, "SUBSCRIPTION_INACTIVE", "The subscription of this delivery is deleted or inactive");
      }

      if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv)))
      {
        return Helpers.ErrorEnvelope(res, 503, "WEBHOOKS_NOT_CONFIGURED", "The webhook events queue is not configured");
      }

      var newId = await WebhookEvents.RedeliverAsync(conn, id);
      if (newId is null) return res.Error500(null);

      return res.Ok(new { deliveryId = newId.Value, eventId = (Guid)rows[0]["eventId"]! });
    }
    catch (Exception ex)
    {
      return WebhookSubscriptions.MapError(ex, res);
    }
  }

  // ------------------------------------------------------------------ helpers

  private static string? Param(LambdaRequest req, string name) =>
    req.Query.TryGetValue(name, out var v) && !string.IsNullOrEmpty(v) ? v : null;

  /// <summary>base64url of UTF-8 <c>{"v":1,"t":&lt;created_at epoch µs&gt;,"id":"&lt;deliveryId&gt;"}</c>.</summary>
  internal static string EncodeCursor(long micros, Guid deliveryId) =>
    CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { v = 1, t = micros, id = deliveryId.ToString("D") })));

  internal static bool TryDecodeCursor(string raw, out long micros, out Guid deliveryId)
  {
    micros = 0;
    deliveryId = Guid.Empty;

    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return false;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object) return false;
      if (!CursorCodec.TryReadVersion(root)) return false;
      if (!root.TryGetProperty("t", out var t) || t.ValueKind != JsonValueKind.Number || !t.TryGetInt64(out micros)) return false;
      if (!root.TryGetProperty("id", out var idEl) || idEl.ValueKind != JsonValueKind.String || !Guid.TryParse(idEl.GetString(), out deliveryId)) return false;
      return true;
    }
    catch (JsonException)
    {
      return false;
    }
  }
}
