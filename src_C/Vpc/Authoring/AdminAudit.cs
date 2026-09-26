using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>One append-only audit record: who (actor), what (action), on what (target), and the
/// before/after state, plus the request trace id. <c>Before</c>/<c>After</c> are serialised to jsonb.</summary>
public sealed record AdminAuditEntry(string? ActorSub, string? ActorUsername, string Action, string Target, object? Before, object? After, string? TraceId);

/// <summary>
/// Writes one <c>admin_audit</c> row inside the caller's transaction, so a rolled-back mutation
/// leaves no audit row and a committed one always has its row (CBE-12). After commit the caller
/// emits one <c>{tag:"audit", …}</c> log line. The table check is intentionally NOT cached: a
/// scratch or pre-023 database must be able to answer false and the mutation still proceeds.
/// </summary>
public static class AdminAudit
{
  /// <summary>Builds an entry from the request identity (<paramref name="auth"/>) and trace id (<paramref name="res"/>).</summary>
  public static AdminAuditEntry Entry(AuthContext auth, Res res, string action, string target, object? before, object? after) =>
    new(auth.UserSub, auth.Username, action, target, before, after, res.TraceId);

  /// <summary>
  /// <c>select to_regclass('public.admin_audit') is not null</c> — NOT cached (a scratch or
  /// pre-023 database must answer false).
  /// </summary>
  public static async Task<bool> TableExistsAsync(NpgsqlConnection conn, NpgsqlTransaction? tx)
  {
    var scalar = await DbUtil.ExecuteScalarAsync(conn, tx, "select to_regclass('public.admin_audit') is not null", []);
    return scalar is bool b && b;
  }

  /// <summary>Inserts one row inside the caller's transaction; false (no insert) when the table does not exist.</summary>
  public static async Task<bool> RecordAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, AdminAuditEntry entry)
  {
    if (!await TableExistsAsync(conn, tx)) return false;

    var before = entry.Before is null ? null : JsonSerializer.Serialize(entry.Before);
    var after = entry.After is null ? null : JsonSerializer.Serialize(entry.After);

    // The ::jsonb casts are required: the parameters bind as text.
    await DbUtil.ExecuteAsync(
      conn,
      tx,
      "insert into admin_audit (actor_sub, actor_username, action, target, before_state, after_state, trace_id) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)",
      [entry.ActorSub, entry.ActorUsername, entry.Action, entry.Target, before, after, entry.TraceId]);

    return true;
  }

  /// <summary>After commit: one structured line, <c>persisted</c> telling whether a row was written.</summary>
  public static void Emit(AdminAuditEntry entry, bool persisted) =>
    Log.Event("info", new
    {
      tag = "audit",
      actor = entry.ActorSub,
      actorUsername = entry.ActorUsername,
      action = entry.Action,
      target = entry.Target,
      before = entry.Before,
      after = entry.After,
      traceId = entry.TraceId,
      persisted,
    });
}
