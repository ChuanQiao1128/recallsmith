using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Webhooks;

public static class RevenuecatWebhook
{
  private const string ImplVersion = "2026-09-22T00:00Z-v14";

  private static string PickHeader(LambdaRequest req, string name)
  {
    return req.Headers.TryGetValue(name, out var v) ? (v ?? string.Empty).Trim() : string.Empty;
  }

  private static string Upper(string? v)
  {
    var s = (v ?? string.Empty).Trim();
    return s.Length == 0 ? string.Empty : s.ToUpperInvariant();
  }

  private static JsonDocument? ReadBodyJson(LambdaRequest req)
  {
    if (string.IsNullOrEmpty(req.RawBody)) return null;
    try
    {
      return JsonDocument.Parse(req.RawBody);
    }
    catch
    {
      return null;
    }
  }

  private static string StripBearer(string? v)
  {
    var s = (v ?? string.Empty).Trim();
    if (s.Length == 0) return string.Empty;

    var m = System.Text.RegularExpressions.Regex.Match(s, "^bearer\\s+(.+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    var token = m.Success ? m.Groups[1].Value : s;
    return System.Text.RegularExpressions.Regex.Replace(token, "[\\r\\n\\t ]+", string.Empty).Trim();
  }

  private static string? Hash8(string s)
  {
    try
    {
      var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(s));
      return Convert.ToHexString(bytes).ToLowerInvariant()[..8];
    }
    catch
    {
      return null;
    }
  }

  private static APIGatewayProxyResponse DbUnavailable(Res res, string mode) =>
    res.Raw(503, new { ok = false, error = "DB_UNAVAILABLE", mode, impl = ImplVersion }, new Dictionary<string, string> { ["retry-after"] = "60" });

  private static string ModeFromPath(LambdaRequest req)
  {
    var path = req.Path;
    if (path == "/webhooks/revenuecat/development") return "development";
    if (path == "/webhooks/revenuecat/production") return "production";
    if (path == "/rc/webhook") return "development";

    // An unmatched path (the bare /webhooks/revenuecat that VpcFunction still routes)
    // fails safe onto the production token rather than a host heuristic.
    return "production";
  }

  private static string GetExpectedAuthRaw(string mode)
  {
    return mode == "development"
      ? (Environment.GetEnvironmentVariable("RC_WEBHOOK_AUTH_DEVELOPMENT") ?? string.Empty)
      : (Environment.GetEnvironmentVariable("RC_WEBHOOK_AUTH_PRODUCTION") ?? string.Empty);
  }

  private static string GetExpectedToken(string mode) => StripBearer(GetExpectedAuthRaw(mode).Trim());

  private static string GetExpectedEnv(string mode)
  {
    var raw = mode == "development"
      ? (Environment.GetEnvironmentVariable("RC_WEBHOOK_EXPECT_ENV_DEVELOPMENT") ?? "SANDBOX")
      : (Environment.GetEnvironmentVariable("RC_WEBHOOK_EXPECT_ENV_PRODUCTION") ?? "PRODUCTION");
    return Upper(raw);
  }

  private static string GetMonthlyProductId()
  {
    var raw = (Environment.GetEnvironmentVariable("RC_WEBHOOK_MONTHLY_PRODUCT_ID") ?? string.Empty).Trim();
    return string.IsNullOrEmpty(raw) ? "developercards_premium_monthly" : raw;
  }

  private static string MapPremiumEnv(string envUpper)
  {
    if (envUpper == "PRODUCTION") return "production";
    if (envUpper == "SANDBOX") return "sandbox";
    return "none";
  }

  private static bool IsPromoProduct(string? productId)
  {
    var s = (productId ?? string.Empty).Trim().ToLowerInvariant();
    return s.StartsWith("rc_promo_", StringComparison.Ordinal);
  }

  private static bool ComputePremiumActive(string typeUpper, long? expMs, long nowMs)
  {
    if (typeUpper is "EXPIRATION" or "CANCELLATION" or "REFUND") return false;
    if (expMs is not null) return expMs.Value > nowMs;
    return true;
  }

  private static long? ReadLong(JsonElement obj, string prop)
  {
    if (!obj.TryGetProperty(prop, out var el)) return null;
    if (el.ValueKind == JsonValueKind.Number)
    {
      if (el.TryGetInt64(out var n)) return n;
      if (el.TryGetDouble(out var d) && d > 0) return (long)Math.Floor(d);
      return null;
    }

    if (el.ValueKind == JsonValueKind.String &&
        long.TryParse(el.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v))
    {
      return v;
    }

    return null;
  }

  private static string? ReadString(JsonElement obj, string prop)
  {
    if (!obj.TryGetProperty(prop, out var el)) return null;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;
    return el.ToString();
  }

  private static async Task<bool> InsertRcEventOnce(
    NpgsqlConnection conn,
    string eventId,
    string mode,
    string? environment,
    string? eventType,
    string? appUserId,
    string? productId,
    long eventTimestampMs,
    long? expirationAtMs,
    string rawJson)
  {
    const string sql = """
      insert into rc_webhook_events (
        event_id,
        mode,
        environment,
        event_type,
        app_user_id,
        product_id,
        event_timestamp_ms,
        expiration_at_ms,
        raw
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      on conflict (event_id) do nothing returning 1;
      """;

    var inserted = await DbUtil.ExecuteScalarAsync(conn, null, sql,
    [
      eventId,
      mode,
      environment,
      eventType,
      appUserId,
      productId,
      eventTimestampMs,
      expirationAtMs,
      rawJson,
    ]);
    return inserted is not null;
  }

  private static async Task UpsertPremiumState(
    NpgsqlConnection conn,
    string appUserId,
    bool premiumActive,
    string premiumEnv,
    string? productId,
    string? entitlementId,
    long? expiresAtMs,
    string lastEventId,
    string lastEventType,
    long lastEventTsMs)
  {
    const string sql = """
      insert into user_premium_state (
        app_user_id,
        premium_active,
        premium_env,
        product_id,
        entitlement_id,
        expires_at_ms,
        updated_at,
        last_event_id,
        last_event_type,
        last_event_at,
        last_event_ts_ms
      )
      values ($1,$2,$3,$4,$5,$6,now(),$7,$8,to_timestamp($9/1000.0),$9)
      on conflict (app_user_id) do update set
        premium_active   = excluded.premium_active,
        premium_env      = excluded.premium_env,
        product_id       = excluded.product_id,
        entitlement_id   = excluded.entitlement_id,
        expires_at_ms    = excluded.expires_at_ms,
        updated_at       = now(),
        last_event_id    = excluded.last_event_id,
        last_event_type  = excluded.last_event_type,
        last_event_at    = excluded.last_event_at,
        last_event_ts_ms = excluded.last_event_ts_ms
      where
        user_premium_state.last_event_ts_ms <= excluded.last_event_ts_ms
        and (user_premium_state.premium_env <> 'production' or excluded.premium_env = 'production');
      """;

    await DbUtil.ExecuteAsync(conn, null, sql,
    [
      appUserId,
      premiumActive,
      premiumEnv,
      productId,
      entitlementId,
      expiresAtMs,
      lastEventId,
      lastEventType,
      lastEventTsMs,
    ]);
  }

  public static async Task<APIGatewayProxyResponse> HandleRevenuecatWebhook(LambdaRequest req, Res res)
  {
    if (req.Method != "POST") return res.Raw(405, new { ok = false, error = "Method not allowed" });

    var mode = ModeFromPath(req);

    // auth
    var expectedToken = GetExpectedToken(mode);
    if (string.IsNullOrEmpty(expectedToken))
    {
      return res.Raw(500, new
      {
        ok = false,
        error = $"Missing RC_WEBHOOK_AUTH_{mode.ToUpperInvariant()}",
        mode,
        impl = ImplVersion,
      });
    }

    var gotAuth = PickHeader(req, "authorization");
    var gotToken = StripBearer(gotAuth);

    if (!Secrets.FixedTimeEquals(gotToken, expectedToken))
    {
      var expectedRaw = GetExpectedAuthRaw(mode).Trim();
      var gotBearer = gotAuth.TrimStart().StartsWith("bearer ", StringComparison.OrdinalIgnoreCase);
      var gotLen = gotToken.Length;
      var expectedLen = expectedToken.Length;
      var expectedHasBearer = expectedRaw.TrimStart().StartsWith("bearer ", StringComparison.OrdinalIgnoreCase);
      var gotHash8 = gotToken.Length > 0 ? Hash8(gotToken) : null;
      var expectedHash8 = expectedToken.Length > 0 ? Hash8(expectedToken) : null;
      Log.Event("warn", new { tag = "rc-webhook", reason = "unauthorized", mode, gotBearer, gotLen, expectedLen, expectedHasBearer, gotHash8, expectedHash8 });
      return res.Raw(401, new { ok = false, error = "Unauthorized", mode, impl = ImplVersion });
    }

    // parse payload
    using var payloadDoc = ReadBodyJson(req);
    if (payloadDoc is null || payloadDoc.RootElement.ValueKind != JsonValueKind.Object)
    {
      return res.Raw(400, new { ok = false, error = "Invalid JSON body", mode, impl = ImplVersion });
    }

    var payload = payloadDoc.RootElement;
    var ev = payload.TryGetProperty("event", out var evEl) && evEl.ValueKind == JsonValueKind.Object
      ? evEl
      : default;

    if (ev.ValueKind != JsonValueKind.Object)
    {
      return res.Raw(400, new { ok = false, error = "Missing event.id", mode, impl = ImplVersion });
    }

    var eventId = (ReadString(ev, "id") ?? string.Empty).Trim();
    if (string.IsNullOrEmpty(eventId)) return res.Raw(400, new { ok = false, error = "Missing event.id", mode, impl = ImplVersion });

    var typeUpper = Upper(ReadString(ev, "type") ?? "UNKNOWN");
    var isTest = typeUpper == "TEST";

    var envUpper = Upper(ReadString(ev, "environment"));
    var appUserId = (ReadString(ev, "app_user_id") ?? string.Empty).Trim();
    appUserId = string.IsNullOrEmpty(appUserId) ? null : appUserId;
    var productId = (ReadString(ev, "product_id") ?? string.Empty).Trim();
    productId = string.IsNullOrEmpty(productId) ? null : productId;

    var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var eventTsMs = ReadLong(ev, "event_timestamp_ms") ?? nowMs;
    var expMs = ReadLong(ev, "expiration_at_ms");

    var promo = IsPromoProduct(productId);

    // The DB steps are required, not best-effort: with the ::jsonb cast the insert is real,
    // and an event that cannot be recorded (so cannot be de-duplicated on retry) is a 503 with
    // retry-after so RevenueCat retries the paid event instead of marking it delivered.
    NpgsqlConnection? conn;
    try
    {
      conn = await Pg.OpenConnectionOrNullAsync();
    }
    catch (Exception ex)
    {
      Log.Event("error", new { tag = "rc-webhook", reason = "db_unavailable", mode, eventId, error = ex.Message });
      return DbUnavailable(res, mode);
    }
    if (conn is null)
    {
      Log.Event("error", new { tag = "rc-webhook", reason = "db_unavailable", mode, eventId, error = (string?)null });
      return DbUnavailable(res, mode);
    }
    await using (conn)
    {
      bool replayed;
      try
      {
        replayed = !await InsertRcEventOnce(
          conn,
          eventId: eventId,
          mode: mode,
          environment: string.IsNullOrEmpty(envUpper) ? null : envUpper,
          eventType: string.IsNullOrEmpty(typeUpper) ? null : typeUpper,
          appUserId: appUserId,
          productId: productId,
          eventTimestampMs: eventTsMs,
          expirationAtMs: expMs,
          rawJson: req.RawBody);
      }
      catch (Exception ex)
      {
        Log.Event("error", new { tag = "rc-webhook", reason = "db_insert_failed", mode, eventId, error = ex.Message });
        return DbUnavailable(res, mode);
      }

      if (!isTest)
      {
        var expectedEnv = GetExpectedEnv(mode);
        if (!string.IsNullOrEmpty(envUpper) && !string.IsNullOrEmpty(expectedEnv) && envUpper != expectedEnv)
        {
          Log.Event("warn", new { tag = "rc-webhook", reason = "env_mismatch", mode, path = req.Path, eventId, got = envUpper, expected = expectedEnv });
          return res.Raw(200, new
          {
            ok = true,
            accepted = false,
            reason = "env_mismatch",
            mode,
            impl = ImplVersion,
            gotEnv = string.IsNullOrEmpty(envUpper) ? null : envUpper,
            expectedEnv,
            eventId,
            type = typeUpper,
          });
        }

        var monthly = GetMonthlyProductId();
        if (!string.IsNullOrEmpty(productId) && !string.IsNullOrEmpty(monthly) && productId != monthly && !promo)
        {
          Log.Event("warn", new { tag = "rc-webhook", reason = "product_mismatch", mode, path = req.Path, eventId, got = productId, expected = monthly, type = typeUpper });
          return res.Raw(200, new
          {
            ok = true,
            accepted = false,
            reason = "product_mismatch",
            mode,
            impl = ImplVersion,
            gotProductId = productId,
            expectedMonthlyProductId = monthly,
            eventId,
            type = typeUpper,
          });
        }
      }

      // premium state (real events only)
      if (!isTest && appUserId is not null)
      {
        var premiumActive = ComputePremiumActive(typeUpper, expMs, nowMs);
        var premiumEnv = MapPremiumEnv(envUpper);

        try
        {
          var entitlementId = ReadString(ev, "entitlement_id");
          await UpsertPremiumState(
            conn,
            appUserId: appUserId,
            premiumActive: premiumActive,
            premiumEnv: premiumEnv,
            productId: productId,
            entitlementId: entitlementId,
            expiresAtMs: expMs,
            lastEventId: eventId,
            lastEventType: typeUpper,
            lastEventTsMs: eventTsMs);
        }
        catch (Exception ex)
        {
          Log.Event("error", new { tag = "rc-webhook", reason = "db_upsert_failed", mode, eventId, appUserId, error = ex.Message });
          return DbUnavailable(res, mode);
        }

        Log.Event("info", new
        {
          tag = "rc-webhook",
          reason = "accepted",
          impl = ImplVersion,
          mode,
          isTest,
          route = req.Path,
          eventId,
          type = typeUpper,
          environment = string.IsNullOrEmpty(envUpper) ? null : envUpper,
          appUserId,
          productId,
          promo,
          promoAllowed = promo,
          replayed,
        });
      }

      return res.Raw(200, new { ok = true, accepted = true, mode, impl = ImplVersion, eventId, type = typeUpper, promo });
    }
  }
}

