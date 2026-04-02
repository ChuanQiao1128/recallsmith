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

      var csb = new NpgsqlConnectionStringBuilder
      {
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

  public static async Task<NpgsqlConnection?> OpenConnectionOrNullAsync()
  {
    var conn = ConnectionOrNull();
    if (conn is null) return null;
    await conn.OpenAsync();
    return conn;
  }
}
