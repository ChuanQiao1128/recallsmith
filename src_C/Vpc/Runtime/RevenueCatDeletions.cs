using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// R25 G04 / R25X F04: the RevenueCat customer record of a deleted account is deleted from outside the VPC.
/// core-vpc has no egress (infra/modules/worker/ai_qa.tf), so it never calls RevenueCat. Instead:
/// <list type="number">
/// <item><see cref="EnqueueAsync"/>: DELETE /api/v1/user/me inserts the caller's sub into <c>revenuecat_deletions</c>
/// (migration 044) inside the deletion's own transaction, so a rolled-back deletion queues nothing.</item>
/// <item><c>GET /api/v1/internal/revenuecat-deletions?limit=50</c>: the pending subs (attempts &lt; 10, requested within
/// 30 days), oldest first.</item>
/// <item><c>POST /api/v1/internal/revenuecat-deletions/report</c> with <c>[{sub, status}]</c>: 2xx or 404 removes the
/// row; anything else (a null status is a timeout or network error) counts one more attempt.</item>
/// <item><see cref="DeleteExpiredAsync"/>: the tick's <c>revenuecat_deletions_retention</c> step drops rows older than 30
/// days, whatever their state.</item>
/// </list>
/// Both routes are the notifier's (services/notifier, on every tick) and are verified exactly like its tick and report
/// routes: <see cref="Auth.VerifyInternalSignatureStrict"/> against <c>INTERNAL_SECRET_NOTIFIER</c>. The GET has an empty
/// body, so its signature covers <c>"&lt;ts&gt;."</c>. Logs carry counts only, never a sub.
/// </summary>
public static class RevenueCatDeletions
{
  public const string PendingPath = "/api/v1/internal/revenuecat-deletions";
  public const string ReportPath = "/api/v1/internal/revenuecat-deletions/report";

  public const int MaxAttempts = 10;
  public const int RetentionDays = 30;
  public const int DefaultLimit = 50;
  public const int MaxLimit = 50;
  public const int MaxReportItems = 50;
  private const int MaxSubLength = 200;

  private const string Ready = "select to_regclass('revenuecat_deletions') is not null";

  /// <summary>
  /// Queues <paramref name="userSub"/> inside <paramref name="tx"/>; returns 1 when a row was inserted, 0 when it was
  /// already queued or migration 044 has not run (checked first, so a missing table never aborts the transaction).
  /// </summary>
  public static async Task<int> EnqueueAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string userSub)
  {
    if (await DbUtil.ExecuteScalarAsync(conn, tx, Ready, []) is not true) return 0;
    return await DbUtil.ExecuteAsync(conn, tx,
      "insert into revenuecat_deletions (sub) values ($1) on conflict (sub) do nothing",
      [userSub]);
  }

  /// <summary>Deletes the rows requested more than <see cref="RetentionDays"/> days ago; 0 before migration 044.</summary>
  public static async Task<int> DeleteExpiredAsync(NpgsqlConnection conn)
  {
    if (await DbUtil.ExecuteScalarAsync(conn, null, Ready, []) is not true) return 0;
    var deleted = await DbUtil.ExecuteAsync(conn, null,
      "delete from revenuecat_deletions where requested_at < now() - make_interval(days => $1)",
      [RetentionDays]);
    if (deleted > 0) Log.Event("info", new { tag = "revenuecat_delete", outcome = "expired", rows = deleted });
    return deleted;
  }

  // GET /api/v1/internal/revenuecat-deletions?limit=50
  public static async Task<APIGatewayProxyResponse> HandlePending(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    var v = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.NotifierSecretEnv);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    var limit = DefaultLimit;
    if (req.Query.TryGetValue("limit", out var rawLimit) && !string.IsNullOrEmpty(rawLimit))
    {
      if (!int.TryParse(rawLimit, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit < 1)
      {
        return res.BadRequest("VALIDATION_ERROR", $"limit must be an integer between 1 and {MaxLimit}");
      }
      limit = Math.Min(limit, MaxLimit);
    }

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      if (await DbUtil.ExecuteScalarAsync(conn, null, Ready, []) is not true) return NotReady(res);

      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select sub from revenuecat_deletions
        where attempts < $1 and requested_at >= now() - make_interval(days => $2)
        order by requested_at, sub
        limit $3
        """,
        [MaxAttempts, RetentionDays, limit]);
      var subs = rows.Select(r => (string)r["sub"]!).ToArray();
      return res.Ok(new { subs });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // POST /api/v1/internal/revenuecat-deletions/report   body: [{"sub": "...", "status": 204 | 404 | 500 | null}]
  public static async Task<APIGatewayProxyResponse> HandleReport(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    var v = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.NotifierSecretEnv);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    List<(string Sub, int? Status)> items;
    try
    {
      items = ParseReport(req);
    }
    catch (ValidationError ex)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      if (await DbUtil.ExecuteScalarAsync(conn, null, Ready, []) is not true) return NotReady(res);

      int deleted = 0, retried = 0, unknown = 0;
      foreach (var (sub, status) in items)
      {
        int rows;
        if (status is >= 200 and < 300 or 404)
        {
          rows = await DbUtil.ExecuteAsync(conn, null, "delete from revenuecat_deletions where sub = $1", [sub]);
          deleted += rows;
        }
        else
        {
          rows = await DbUtil.ExecuteAsync(conn, null,
            "update revenuecat_deletions set attempts = attempts + 1, last_status = $2, last_attempt_at = now() where sub = $1",
            [sub, status]);
          retried += rows;
        }
        if (rows == 0) unknown++;
      }

      Log.Event(retried > 0 ? "warn" : "info", new { tag = "revenuecat_delete", outcome = "reported", deleted, retried, unknown });
      return res.Ok(new { deleted, retried, unknown });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static List<(string Sub, int? Status)> ParseReport(LambdaRequest req)
  {
    using var doc = Validation.ParseJsonBody(req) ?? throw new ValidationError("Invalid JSON body", "body");
    var root = doc.RootElement;
    if (root.ValueKind != JsonValueKind.Array) throw new ValidationError("body must be an array of {sub, status}", "body");
    if (root.GetArrayLength() > MaxReportItems) throw new ValidationError($"at most {MaxReportItems} items", "body");

    var items = new List<(string, int?)>();
    foreach (var item in root.EnumerateArray())
    {
      if (item.ValueKind != JsonValueKind.Object) throw new ValidationError("each item must be an object", "body");
      if (!item.TryGetProperty("sub", out var subEl) || subEl.ValueKind != JsonValueKind.String ||
          subEl.GetString() is not { Length: > 0 and <= MaxSubLength } sub)
      {
        throw new ValidationError($"sub must be a string of 1..{MaxSubLength} characters", "sub");
      }
      int? status = null;
      if (item.TryGetProperty("status", out var stEl) && stEl.ValueKind != JsonValueKind.Null)
      {
        if (stEl.ValueKind != JsonValueKind.Number || !stEl.TryGetInt32(out var s) || s < 100 || s > 599)
        {
          throw new ValidationError("status must be an HTTP status code or null", "status");
        }
        status = s;
      }
      items.Add((sub, status));
    }
    return items;
  }

  private static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY", "revenuecat_deletions is not migrated yet (migration 044)");
}
