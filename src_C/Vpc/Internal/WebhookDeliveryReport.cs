using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Internal;

/// <summary>
/// POST /api/internal/webhooks/deliveries/report (R18 J03, contract §6.5.3): the webhook dispatcher
/// reports every delivery attempt here, HMAC-signed (§4.3). One statement updates the delivery row and
/// answers whether the dispatcher should stop (subscription deleted or inactive). A delivered row never
/// moves backwards: only its attempt count may grow.
/// </summary>
public static class WebhookDeliveryReport
{
  public const int MaxErrorLength = 500;

  private static readonly Dictionary<string, string> OutcomeStatus = new(StringComparer.Ordinal)
  {
    ["delivered"] = "delivered",
    ["retry"] = "retrying",
    ["failed"] = "failed",
    ["dead"] = "dead",
  };

  public static async Task<APIGatewayProxyResponse> HandleReport(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    var v = Auth.VerifyInternalSignature(req);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    Guid deliveryId;
    int attempt;
    string status;
    int? statusCode;
    string? error;

    using (var doc = Validation.ParseJsonBody(req))
    {
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) return Invalid(res, "Body must be a JSON object");

      if (!body.TryGetProperty("deliveryId", out var idEl) || idEl.ValueKind != JsonValueKind.String || !Guid.TryParse(idEl.GetString(), out deliveryId))
      {
        return Invalid(res, "deliveryId must be a uuid");
      }

      if (!body.TryGetProperty("attempt", out var attemptEl) || attemptEl.ValueKind != JsonValueKind.Number || !attemptEl.TryGetInt32(out attempt) || attempt < 1)
      {
        return Invalid(res, "attempt must be an integer >= 1");
      }

      if (!body.TryGetProperty("outcome", out var outcomeEl) || outcomeEl.ValueKind != JsonValueKind.String
          || !OutcomeStatus.TryGetValue(outcomeEl.GetString()!, out var mapped))
      {
        return Invalid(res, "outcome must be one of delivered, retry, failed, dead");
      }
      status = mapped;

      statusCode = null;
      // statusCode and error are nullable; an absent key reads as null.
      if (body.TryGetProperty("statusCode", out var codeEl) && codeEl.ValueKind != JsonValueKind.Null)
      {
        if (codeEl.ValueKind != JsonValueKind.Number || !codeEl.TryGetInt32(out var code)) return Invalid(res, "statusCode must be an integer or null");
        statusCode = code;
      }

      if (!body.TryGetProperty("durationMs", out var durEl) || durEl.ValueKind != JsonValueKind.Number || !durEl.TryGetInt64(out var durationMs) || durationMs < 0)
      {
        return Invalid(res, "durationMs must be an integer >= 0");
      }

      error = null;
      if (body.TryGetProperty("error", out var errEl) && errEl.ValueKind != JsonValueKind.Null)
      {
        if (errEl.ValueKind != JsonValueKind.String) return Invalid(res, "error must be a string or null");
        error = errEl.GetString()!;
        if (error.Length > MaxErrorLength) error = error[..MaxErrorLength];
      }
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      // One statement. A row already 'delivered' keeps its status, delivered_at, last_status_code and
      // last_error; only attempts may grow. `returning` also yields d.event for the ledger (§9.3).
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        update webhook_deliveries d set
          attempts = greatest(d.attempts, $2),
          status = case when d.status = 'delivered' then d.status else $3 end,
          last_status_code = case when d.status = 'delivered' then d.last_status_code else $4::int end,
          last_error = case when d.status = 'delivered' then d.last_error else $5::text end,
          delivered_at = case when d.status <> 'delivered' and $3 = 'delivered' then now() else d.delivered_at end,
          updated_at = now()
        from webhook_subscriptions s
        where d.delivery_id = $1 and s.id = d.subscription_id
        returning d.delivery_id as "deliveryId", d.status as "status", d.event as "event",
                  (s.deleted_at is not null or not s.is_active) as "stop"
        """,
        [deliveryId, attempt, status, statusCode, error]);

      if (rows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DELIVERY_NOT_FOUND", $"Delivery {deliveryId} not found");

      var row = rows[0];
      return res.Ok(new
      {
        deliveryId = (Guid)row["deliveryId"]!,
        status = (string)row["status"]!,
        stop = (bool)row["stop"]!,
      });
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      return Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY_WEBHOOKS", "Run migration 027 first");
    }
  }

  private static APIGatewayProxyResponse Invalid(Res res, string message) => res.BadRequest("VALIDATION_ERROR", message);
}
