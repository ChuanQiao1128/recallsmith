using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Common;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

public static class Migrate
{
  private sealed record Migration(int Version, string Name, string File, string FullPath);

  private static string MigrationsDir()
  {
    // Copied to output via csproj <CopyToOutputDirectory>.
    return Path.Combine(AppContext.BaseDirectory, "Db", "Migrations");
  }

  private static List<Migration> LoadMigrations()
  {
    var dir = MigrationsDir();
    if (!Directory.Exists(dir)) return [];

    var files = Directory
      .EnumerateFiles(dir, "*.sql", SearchOption.TopDirectoryOnly)
      .Select(f => Path.GetFileName(f)!)
      .Where(f => System.Text.RegularExpressions.Regex.IsMatch(f, "^\\d+_.+\\.sql$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
      .OrderBy(f => f, StringComparer.Ordinal)
      .ToList();

    var migrations = new List<Migration>();
    foreach (var file in files)
    {
      var baseName = file[..^4]; // .sql
      var versionStr = baseName.Split('_')[0];
      if (!int.TryParse(versionStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out var version))
      {
        throw new InvalidOperationException($"Bad migration filename (no numeric prefix): {file}");
      }

      migrations.Add(new Migration(version, baseName, file, Path.Combine(dir, file)));
    }

    var seen = new HashSet<int>();
    foreach (var m in migrations)
    {
      if (!seen.Add(m.Version)) throw new InvalidOperationException($"Duplicate migration version: {m.Version}");
    }

    return migrations;
  }

  private static async Task EnsureMigrationsTable(NpgsqlConnection conn, NpgsqlTransaction? tx)
  {
    const string sql = """
      create table if not exists schema_migrations (
        version int primary key,
        name text not null,
        applied_at timestamptz not null default now()
      );
      """;

    await ExecuteAsync(conn, tx, sql, []);
  }

  private static async Task<HashSet<int>> GetAppliedVersions(NpgsqlConnection conn, NpgsqlTransaction? tx)
  {
    await EnsureMigrationsTable(conn, tx);
    const string sql = "select version from schema_migrations order by version asc;";
    var rows = await QueryAsync(conn, tx, sql, []);
    return rows.Select(r => Convert.ToInt32(r["version"], CultureInfo.InvariantCulture)).ToHashSet();
  }

  private static async Task ApplyOne(NpgsqlConnection conn, Migration m)
  {
    var sql = await File.ReadAllTextAsync(m.FullPath);

    await using var tx = await conn.BeginTransactionAsync();
    try
    {
      await ExecuteAsync(conn, tx, sql, []);
      await ExecuteAsync(
        conn,
        tx,
        "insert into schema_migrations(version, name) values ($1, $2) on conflict (version) do nothing;",
        [m.Version, m.Name]);

      await tx.CommitAsync();
    }
    catch
    {
      try { await tx.RollbackAsync(); } catch { /* ignore */ }
      throw;
    }
  }

  private static async Task<T> WithMigrationLock<T>(NpgsqlConnection conn, Func<Task<T>> fn)
  {
    const int lockId = 77889911;
    await ExecuteAsync(conn, null, "select pg_advisory_lock($1);", [lockId]);
    try
    {
      return await fn();
    }
    finally
    {
      try { await ExecuteAsync(conn, null, "select pg_advisory_unlock($1);", [lockId]); } catch { /* ignore */ }
    }
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbPing(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
    }

    var scalar = await ExecuteScalarAsync(conn, null, "select 1 as ok;", []);
    var ok = scalar is not null && Convert.ToInt32(scalar, CultureInfo.InvariantCulture) == 1;
    return res.Ok(new { ok });
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbMigrate(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    // extra manual guard: x-migrate-secret (if configured)
    var required = Environment.GetEnvironmentVariable("MIGRATE_SECRET") ?? string.Empty;
    if (!string.IsNullOrEmpty(required))
    {
      var got = Validation.GetHeader(req, "x-migrate-secret") ?? string.Empty;
      if (!string.Equals(got, required, StringComparison.Ordinal)) return res.Forbidden("Bad migrate secret");
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
    }

    var migrations = LoadMigrations();
    if (migrations.Count == 0)
    {
      return res.BadRequest("MIGRATIONS_EMPTY", "No migrations found in Db/Migrations");
    }

    var dryRun = string.Equals(req.Query.TryGetValue("dryRun", out var d) ? d : null, "true", StringComparison.OrdinalIgnoreCase);

    var result = await WithMigrationLock<object>(conn, async () =>
    {
      var applied = await GetAppliedVersions(conn, null);
      var pending = migrations.Where(m => !applied.Contains(m.Version)).ToList();

      if (dryRun)
      {
        return (object)new
        {
          dryRun = true,
          available = migrations.Select(m => new { version = m.Version, name = m.Name, file = m.File }).ToList(),
          pending = pending.Select(m => new { version = m.Version, name = m.Name, file = m.File }).ToList(),
        };
      }

      var appliedNow = new List<object>();
      foreach (var m in pending)
      {
        await ApplyOne(conn, m);
        appliedNow.Add(new { version = m.Version, name = m.Name, file = m.File });
      }

      return (object)new
      {
        dryRun = false,
        applied = appliedNow,
        appliedCount = appliedNow.Count,
        latestAvailable = migrations[^1].Version,
      };
    });

    return res.Ok(result);
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbMigrationsList(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var migrations = LoadMigrations();

    await EnsureMigrationsTable(conn, null);
    var rows = await QueryAsync(conn, null, "select version, name, applied_at from schema_migrations order by version asc;", []);

    var applied = rows.Select(x => new
    {
      version = Convert.ToInt32(x["version"], CultureInfo.InvariantCulture),
      name = Convert.ToString(x["name"], CultureInfo.InvariantCulture),
      appliedAt = x["applied_at"] is DateTime dt ? new DateTimeOffset(dt).ToString("O") : null,
    }).ToList();

    var appliedSet = applied.Select(x => x.version).ToHashSet();
    var pending = migrations
      .Where(m => !appliedSet.Contains(m.Version))
      .Select(m => new { version = m.Version, name = m.Name, file = m.File })
      .ToList();

    return res.Ok(new
    {
      available = migrations.Select(m => new { version = m.Version, name = m.Name, file = m.File }).ToList(),
      applied,
      pending,
    });
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbListDatabases(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    const string sql = """
      SELECT datname
      FROM pg_database
      WHERE datistemplate = false
      ORDER BY datname;
      """;

    var rows = await QueryAsync(conn, null, sql, []);
    return res.Ok(new { databases = rows.Select(x => x["datname"]).ToList() });
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbCreateDatabase(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var required = Environment.GetEnvironmentVariable("MIGRATE_SECRET") ?? string.Empty;
    if (!string.IsNullOrEmpty(required))
    {
      var got = Validation.GetHeader(req, "x-migrate-secret") ?? string.Empty;
      if (!string.Equals(got, required, StringComparison.Ordinal)) return res.Forbidden("Bad migrate secret");
    }

    if (!string.Equals(Environment.GetEnvironmentVariable("PGDATABASE") ?? string.Empty, "postgres", StringComparison.Ordinal))
    {
      return res.BadRequest("CONFIG_ERROR", "PGDATABASE must be 'postgres' for CREATE DATABASE");
    }

    var name = (req.Query.TryGetValue("name", out var n) ? n : string.Empty).Trim();
    if (string.IsNullOrEmpty(name)) return res.BadRequest("BAD_REQUEST", "Missing query param: ?name=");
    if (!Validation.IsValidDbName(name)) return res.BadRequest("BAD_REQUEST", "Bad database name");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    var exists = await QueryAsync(conn, null, "SELECT 1 FROM pg_database WHERE datname=$1", [name]);
    if (exists.Count == 0)
    {
      await ExecuteAsync(conn, null, $"CREATE DATABASE {name};", []);
      return res.Ok(new { ok = true, created = name });
    }

    return res.Ok(new { ok = true, existed = name });
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbDropAndRecreate(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var required = Environment.GetEnvironmentVariable("MIGRATE_SECRET") ?? string.Empty;
    if (!string.IsNullOrEmpty(required))
    {
      var got = Validation.GetHeader(req, "x-migrate-secret") ?? string.Empty;
      if (!string.Equals(got, required, StringComparison.Ordinal)) return res.Forbidden("Bad migrate secret");
    }

    if (!string.Equals(Environment.GetEnvironmentVariable("PGDATABASE") ?? string.Empty, "postgres", StringComparison.Ordinal))
    {
      return res.BadRequest("CONFIG_ERROR", "PGDATABASE must be 'postgres' to drop/create databases");
    }

    var name = (req.Query.TryGetValue("name", out var n) ? n : string.Empty).Trim();
    if (string.IsNullOrEmpty(name)) return res.BadRequest("BAD_REQUEST", "Missing query param: ?name=");
    if (!Validation.IsValidDbName(name)) return res.BadRequest("BAD_REQUEST", "Bad database name");
    if (name is "postgres" or "rdsadmin") return res.BadRequest("BAD_REQUEST", "Refusing to drop system database");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    // terminate existing connections
    const string terminateSql = """
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid();
      """;
    await ExecuteAsync(conn, null, terminateSql, [name]);

    try
    {
      await ExecuteAsync(conn, null, $"DROP DATABASE IF EXISTS {name} WITH (FORCE);", []);
      await ExecuteAsync(conn, null, $"CREATE DATABASE {name};", []);
      return res.Ok(new { ok = true, recreated = name });
    }
    catch (Exception ex)
    {
      return res.BadRequest("DB_RECREATE_FAILED", ex.Message);
    }
  }
}
