using System.Security.Cryptography;
using System.Text;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// DELETE /api/v1/me (and /api/v1/user/me): a user erasing every server row keyed by their own
/// Cognito sub, so account deletion on the phone removes more than the Cognito user. This is the
/// server half of App Store Guideline 5.1.1(v).
///
/// Migration 016 argues against a generic "delete user X" admin route, and it is right: a route
/// that takes a sub is a permanent, dangerous surface. This route is not that. It is self-service
/// behind <see cref="Auth.RequireUser"/> and deletes only <c>auth.UserSub</c> -- no path, query or
/// body parameter selects a user -- so it can only ever remove the caller's own rows.
///
/// The outbox is deleted FIRST, before the events it links to. analytics_event_outbox has no user
/// column; its rows are found through the event_id they came from, so once user_progress_events is
/// gone (via the users cascade) they can no longer be located. This is the ordering migration 016
/// established.
///
/// Out of reach on purpose: rows already exported to Snowflake carry only a pseudonymous
/// user_id_hash, and the Cognito user itself is the phone's job -- the app deletes it after this
/// call succeeds.
/// </summary>
public static class AccountDeletion
{
  public sealed record AccountDeletionResult(int OutboxRows, int PremiumStateRows, int WebhookEventRows, int UserRows);

  /// <summary>
  /// Deletes every row keyed by <paramref name="userSub"/> in one transaction, in a fixed order:
  /// the outbox rows (through the caller's events) first, then user_premium_state and
  /// rc_webhook_events by app_user_id, then the users row -- whose <c>on delete cascade</c> removes
  /// user_entitlements, user_subscriptions, user_progress_events, user_progress, user_draw_owned,
  /// user_draw_meta and user_wallet. A failure rolls the whole thing back, so the phone keeps the
  /// account and can retry.
  /// </summary>
  public static async Task<AccountDeletionResult> DeleteUserDataAsync(NpgsqlConnection conn, string userSub)
  {
    await using var tx = await conn.BeginTransactionAsync();

    var outboxRows = await DbUtil.ExecuteAsync(conn, tx,
      "delete from analytics_event_outbox o using user_progress_events e where o.event_id = e.event_id and e.user_sub = $1",
      [userSub]);

    var premiumStateRows = await DbUtil.ExecuteAsync(conn, tx,
      "delete from user_premium_state where app_user_id = $1",
      [userSub]);

    var webhookEventRows = await DbUtil.ExecuteAsync(conn, tx,
      "delete from rc_webhook_events where app_user_id = $1",
      [userSub]);

    var userRows = await DbUtil.ExecuteAsync(conn, tx,
      "delete from users where user_sub = $1",
      [userSub]);

    await tx.CommitAsync();

    return new AccountDeletionResult(outboxRows, premiumStateRows, webhookEventRows, userRows);
  }

  public static async Task<APIGatewayProxyResponse> HandleDeleteMe(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;

    if (!string.Equals(req.Method, "DELETE", StringComparison.OrdinalIgnoreCase))
    {
      return res.MethodNotAllowed("Method not allowed");
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
    }

    var r = await DeleteUserDataAsync(conn, auth.UserSub!);

    Log.Event("info", new
    {
      tag = "account-delete",
      userSubHash = HashSub(auth.UserSub!),
      outboxRows = r.OutboxRows,
      premiumStateRows = r.PremiumStateRows,
      webhookEventRows = r.WebhookEventRows,
      userRows = r.UserRows,
    });

    return res.Raw(204, string.Empty);
  }

  /// <summary>Lower-case hex SHA-256 of the UTF-8 sub, first 16 characters. Never logs the raw sub.</summary>
  internal static string HashSub(string sub)
  {
    var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(sub));
    return Convert.ToHexString(bytes).ToLowerInvariant()[..16];
  }
}
