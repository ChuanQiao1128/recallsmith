using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Db;

public static class Pg
{
  private static NpgsqlDataSource? _dataSource;
  private static Exception? _initError;

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    var ds = _dataSource;
    _dataSource = null;
    _initError = null;

    if (ds is null) return;
    try { ds.Dispose(); } catch { /* best-effort */ }
  }

  public static NpgsqlDataSource? DataSource()
  {
    if (_dataSource is not null) return _dataSource;
    if (_initError is not null) throw _initError;

    var host = Environment.GetEnvironmentVariable("PGHOST");
    var database = Environment.GetEnvironmentVariable("PGDATABASE");
    var user = Environment.GetEnvironmentVariable("PGUSER");
    var password = Environment.GetEnvironmentVariable("PGPASSWORD");

    if (string.IsNullOrWhiteSpace(host) ||
        string.IsNullOrWhiteSpace(database) ||
        string.IsNullOrWhiteSpace(user) ||
        string.IsNullOrWhiteSpace(password))
    {
      return null;
    }

    try
    {
      var portRaw = Environment.GetEnvironmentVariable("PGPORT");
      var port = int.TryParse(portRaw, out var p) ? p : 5432;

      var sslModeRaw = (Environment.GetEnvironmentVariable("PGSSLMODE") ?? string.Empty).Trim().ToLowerInvariant();
      var disableSsl = sslModeRaw == "disable";

      var maxRaw = Environment.GetEnvironmentVariable("PG_MAX");
      var max = int.TryParse(maxRaw, out var m) ? m : 1;

      var connTimeoutMsRaw = Environment.GetEnvironmentVariable("PG_CONNECTION_TIMEOUT");
      var connTimeoutMs = int.TryParse(connTimeoutMsRaw, out var ct) ? ct : 8000;

      var idleTimeoutMsRaw = Environment.GetEnvironmentVariable("PG_IDLE_TIMEOUT");
      var idleTimeoutMs = int.TryParse(idleTimeoutMsRaw, out var it) ? it : 30000;

      // Npgsql's default is 0 (never auto-prepare). Turned on because it was
      // measured, not because it sounds faster: 300 batch=1 ingests per arm
      // against postgres:16-alpine, interleaved off/on/off/on so warm-up and
      // drift could not be mistaken for the effect --
      //
      //   off  p50 1.716ms   on  p50 0.990ms
      //   off  p50 1.654ms   on  p50 0.882ms
      //
      // What that buys is server-side parse and plan of a ~5KB seven-CTE
      // statement, which is CPU and therefore costs the same on RDS as it does
      // in a container. It is NOT a round trip: Npgsql pipelines the Parse into
      // the same protocol batch as the Execute, so this adds to the VPC RTT
      // saving from the fold rather than overlapping with it.
      //
      // 10 rather than Npgsql's suggested larger caches because the statement
      // text varies with batch size (the VALUES list grows per event), so the
      // cache holds one entry per distinct batch size seen. Ten covers the
      // small sizes that dominate; a container that saw every size from 1 to
      // 200 would churn, and churning 200 plans of this size on a 128MB
      // function is the failure mode being avoided.
      //
      // The known risk is a warm container holding a prepared plan across a
      // migration. Postgres replans invalidated plans by itself and only raises
      // "cached plan must not change result type" when the statement's OUTPUT
      // type changes, which no migration so far has done -- but this is a
      // property of future migrations, not one this file can guarantee, so
      // PG_MAX_AUTO_PREPARE=0 turns the whole thing off without a deploy, the
      // same escape hatch WARMUP_DISABLED gives the INIT-phase warmup.
      var autoPrepRaw = Environment.GetEnvironmentVariable("PG_MAX_AUTO_PREPARE");
      var autoPrepare = int.TryParse(autoPrepRaw, out var apv) && apv >= 0 ? apv : 10;

      var csb = new NpgsqlConnectionStringBuilder
      {
        MaxAutoPrepare = autoPrepare,
        Host = host.Trim(),
        Port = port,
        Database = database.Trim(),
        Username = user.Trim(),
        Password = password,
        SslMode = disableSsl ? SslMode.Disable : SslMode.Require,

        Pooling = true,
        MaxPoolSize = max,

        // Npgsql uses seconds here
        Timeout = Math.Max(1, connTimeoutMs / 1000),
        ConnectionIdleLifetime = Math.Max(1, idleTimeoutMs / 1000),
      };

      _dataSource = new NpgsqlDataSourceBuilder(csb.ConnectionString).Build();
      return _dataSource;
    }
    catch (Exception ex)
    {
      _initError = ex;
      throw;
    }
  }

  public static NpgsqlConnection? ConnectionOrNull()
  {
    var ds = DataSource();
    return ds?.CreateConnection();
  }

  public static Task<NpgsqlConnection?> OpenConnectionOrNullAsync() =>
    OpenConnectionOrNullAsync(CancellationToken.None);

  /// <summary>
  /// The cancellable form, added for the INIT-phase warmup in Warmup.cs.
  /// </summary>
  /// <remarks>
  /// The warmup needs a hard time cap that is shorter than Npgsql's own
  /// connect Timeout, because the two protect different things: Timeout keeps
  /// a request from hanging, the warmup cap keeps container init from being
  /// aborted and retried by Lambda. It deliberately goes through this method
  /// rather than opening a private connection, so what gets warmed is the pool
  /// every handler above draws from -- a throwaway connection would pay the
  /// JIT and TLS cost and still leave that pool empty.
  ///
  /// The no-argument overload forwards CancellationToken.None, which is
  /// exactly what NpgsqlConnection.OpenAsync() already passed, so every
  /// existing caller keeps byte-identical behaviour.
  /// </remarks>
  public static async Task<NpgsqlConnection?> OpenConnectionOrNullAsync(CancellationToken cancellationToken)
  {
    var conn = ConnectionOrNull();
    if (conn is null) return null;
    await conn.OpenAsync(cancellationToken);
    return conn;
  }
}
