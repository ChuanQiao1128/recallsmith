using System.Collections.Concurrent;
using Npgsql;
using RecallSmith.Lambda.Vpc.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// Allows the backend containing migration 048 to serve old clients before the
/// owner applies it. Only positive readiness is cached: a warm Lambda must see
/// the additive migration on its next request without a restart.
/// </summary>
internal static class ProgressSchedulerSchema
{
  private static readonly ConcurrentDictionary<string, byte> ReadyDatabases = new(StringComparer.Ordinal);

  internal static void ResetReadyCache() => ReadyDatabases.Clear();

  internal static async Task<bool> IsReadyAsync(NpgsqlConnection conn)
  {
    // No credentials in the cache key, and no schema/data payload is cached.
    var database = $"{conn.Host}:{conn.Port}/{conn.Database}";
    if (ReadyDatabases.ContainsKey(database)) return true;

    var ready = await DbUtil.ExecuteScalarAsync(conn, null, """
      select exists (
        select 1 from pg_attribute
        where attrelid = to_regclass('public.user_progress')
          and attname = 'scheduler_state' and not attisdropped
      )
      """, []) is true;
    if (ready) ReadyDatabases.TryAdd(database, 0);
    return ready;
  }
}
