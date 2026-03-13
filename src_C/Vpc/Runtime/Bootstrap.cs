using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class Bootstrap
{
  public static async Task<APIGatewayProxyResponse> HandleBootstrap(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var body = doc.RootElement;

      var deviceId = body.TryGetProperty("deviceId", out var d) ? d.ToString().Trim() : null;
      var clientPlatform = body.TryGetProperty("clientPlatform", out var p) ? p.ToString().Trim() : null;
      var clientVersion = body.TryGetProperty("clientVersion", out var v) ? v.ToString().Trim() : null;

      if (deviceId is not null && deviceId.Length > 200) throw new ValidationError("deviceId too long", "deviceId");
      if (clientPlatform is not null && clientPlatform.Length > 50) throw new ValidationError("clientPlatform too long", "clientPlatform");
      if (clientVersion is not null && clientVersion.Length > 50) throw new ValidationError("clientVersion too long", "clientVersion");

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null)
      {
        return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      }

      var userSub = auth.UserSub!;
      var email =
        GetClaimString(auth.Claims, "email") ??
        GetClaimString(auth.Claims, "cognito:email");

      const string sql = """
        insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)
        values ($1, $2, now(), $3, $4, $5)
        on conflict (user_sub)
        do update set
          email = coalesce(excluded.email, users.email),
          last_seen_at = now(),
          last_platform = coalesce(excluded.last_platform, users.last_platform),
          last_version = coalesce(excluded.last_version, users.last_version),
          last_device_id = coalesce(excluded.last_device_id, users.last_device_id)
        returning
          (xmax = 0) as "created",
          user_sub as "userSub",
          extract(epoch from created_at) * 1000 as "createdAtMs",
          extract(epoch from last_seen_at) * 1000 as "lastSeenAtMs";
        """;

      var rows = await DbUtil.QueryAsync(conn, null, sql, [userSub, email, clientPlatform, clientVersion, deviceId]);
      var row = rows.Count > 0 ? rows[0] : new Dictionary<string, object?>();

      var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      var outObj = new Dictionary<string, object?>(row) { ["serverTimeMs"] = nowMs };
      return res.Ok(outObj);
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      return res.Error500(ex);
    }
  }

  private static string? GetClaimString(IReadOnlyDictionary<string, JsonElement> claims, string key)
  {
    if (!claims.TryGetValue(key, out var el)) return null;
    if (el.ValueKind == JsonValueKind.Null || el.ValueKind == JsonValueKind.Undefined) return null;
    return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
  }
}

