using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class Entitlements
{
  private const string EntitlementsImpl = "entitlements-v3";

  public static async Task<APIGatewayProxyResponse> HandleEntitlements(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var userSub = (auth.UserSub ?? string.Empty).Trim();
    if (string.IsNullOrEmpty(userSub)) return res.Unauthorized("Missing user");

    var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    Dictionary<string, object?>? rcRow = null;
    string? rcErr = null;

    try
    {
      const string rcSql = """
        select premium_active, premium_env, product_id, expires_at_ms, last_event_id, last_event_type, last_event_ts_ms
        from user_premium_state
        where app_user_id = $1
        limit 1;
        """;

      var rcRows = await DbUtil.QueryAsync(conn, null, rcSql, [userSub]);
      rcRow = rcRows.Count > 0 ? rcRows[0] : null;
    }
    catch (Exception ex)
    {
      rcErr = ex.Message;
      Log.Warn("[entitlements] rc_state query failed:", new { impl = EntitlementsImpl, userSub, err = rcErr });
    }

    if (rcRow is not null)
    {
      var env = Lower(ToStringOrNull(rcRow.TryGetValue("premium_env", out var pe) ? pe : null));
      var expMs = NumOrNull(rcRow.TryGetValue("expires_at_ms", out var exp) ? exp : null);

      var active = expMs is not null
        ? expMs > nowMs
        : ToBool(rcRow.TryGetValue("premium_active", out var pa) ? pa : null);

      if (active)
      {
        return res.Ok(new
        {
          userSub,
          tier = "premium",
          expiresAtMs = expMs,
          unlockedDeckSlugs = Array.Empty<string>(),
          premiumSource = "revenuecat",
          premiumEnv = string.IsNullOrEmpty(env) ? null : env,
          productId = ToStringOrNull(rcRow.TryGetValue("product_id", out var pid) ? pid : null),
          serverTimeMs = nowMs,

          impl = EntitlementsImpl,
          rcLastEventId = ToStringOrNull(rcRow.TryGetValue("last_event_id", out var le) ? le : null),
          rcLastEventType = ToStringOrNull(rcRow.TryGetValue("last_event_type", out var let) ? let : null),
          rcLastEventTsMs = NumOrNull(rcRow.TryGetValue("last_event_ts_ms", out var lts) ? lts : null),
        });
      }
    }

    // legacy: user_entitlements (deck-based)
    const string legacySql = """
      select entitlement_key as "entitlementKey",
             tier,
             expires_at as "expiresAt"
      from user_entitlements
      where user_sub = $1
        and (expires_at is null or expires_at > now())
      order by
        (case when entitlement_key = 'premium_all' then 0 else 1 end) asc,
        expires_at desc nulls first,
        entitlement_key asc
      """;

    var rows = await DbUtil.QueryAsync(conn, null, legacySql, [userSub]);

    var tierOut = "free";
    long? expiresAtMs = null;
    var unlockedDeckSlugs = new List<string>();

    var premiumAll = rows.FirstOrDefault(x =>
      string.Equals(Convert.ToString(x.GetValueOrDefault("entitlementKey")), "premium_all", StringComparison.Ordinal) &&
      string.Equals(Convert.ToString(x.GetValueOrDefault("tier")), "premium", StringComparison.Ordinal));

    if (premiumAll is not null)
    {
      tierOut = "premium";
      expiresAtMs = DateToMs(premiumAll.GetValueOrDefault("expiresAt"));
    }
    else
    {
      var deckEnts = rows.Where(x =>
        Convert.ToString(x.GetValueOrDefault("tier")) == "premium" &&
        (Convert.ToString(x.GetValueOrDefault("entitlementKey")) ?? string.Empty).StartsWith("deck:", StringComparison.Ordinal)).ToList();

      if (deckEnts.Count > 0)
      {
        tierOut = "premium";
        unlockedDeckSlugs = deckEnts
          .Select(x => Convert.ToString(x.GetValueOrDefault("entitlementKey")) ?? string.Empty)
          .Select(k => k.Length > "deck:".Length ? k["deck:".Length..] : string.Empty)
          .Where(s => s.Length > 0)
          .ToList();

        expiresAtMs = deckEnts
          .Select(x => DateToMs(x.GetValueOrDefault("expiresAt")))
          .Where(x => x is not null)
          .OrderByDescending(x => x)
          .FirstOrDefault();
      }
    }

    return res.Ok(new
    {
      userSub,
      tier = tierOut,
      expiresAtMs,
      unlockedDeckSlugs,
      premiumSource = "legacy",
      premiumEnv = (string?)null,
      productId = (string?)null,
      serverTimeMs = nowMs,

      impl = EntitlementsImpl,
      rcCheckError = rcErr,
      rcRowSeen = rcRow is not null,
    });
  }

  private static string? ToStringOrNull(object? v)
  {
    var s = Convert.ToString(v, CultureInfo.InvariantCulture);
    return string.IsNullOrEmpty(s) ? null : s;
  }

  private static string Lower(string? v) => (v ?? string.Empty).Trim().ToLowerInvariant();

  private static long? NumOrNull(object? v)
  {
    if (v is null) return null;
    try
    {
      return v switch
      {
        long l => l,
        int i => i,
        short s => s,
        decimal d => (long)d,
        double d => (long)Math.Floor(d),
        float f => (long)Math.Floor(f),
        _ => long.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null,
      };
    }
    catch
    {
      return null;
    }
  }

  private static bool ToBool(object? v)
  {
    if (v is null) return false;
    if (v is bool b) return b;
    var s = Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim().ToLowerInvariant();
    return s is "1" or "true" or "yes" or "y";
  }

  private static long? DateToMs(object? v)
  {
    if (v is null) return null;
    if (v is DateTime dt) return new DateTimeOffset(dt).ToUnixTimeMilliseconds();
    if (v is DateTimeOffset dto) return dto.ToUnixTimeMilliseconds();
    return null;
  }

  private static object? GetValueOrDefault(this Dictionary<string, object?> dict, string key)
  {
    return dict.TryGetValue(key, out var v) ? v : null;
  }
}

