using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Common;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

public static class Migrate
{
  private sealed record Migration(int Version, string Name, string File, string FullPath, bool Destructive);

  /// <summary>
  /// A header line that marks a migration destructive (R26X F01): <see cref="HandleDbMigrate"/> stops before the
  /// first pending one unless the caller passes <c>confirmDestructive=&lt;its version&gt;</c>. Only the leading comment
  /// block is read, so a later comment cannot mark a file by accident.
  /// </summary>
  private static readonly System.Text.RegularExpressions.Regex DestructiveHeader = new(
    "^--\\s*destructive:\\s*true\\s*$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

  /// <summary>Test seam: points <see cref="LoadMigrations"/> at another folder for the current async flow only.</summary>
  internal static readonly AsyncLocal<string?> MigrationsDirOverride = new();

  /// <summary>The migration that creates <c>card_embeddings</c> when the vector extension exists (R20 V06).</summary>
  public const int VectorMigrationVersion = 38;

  /// <summary>
  /// The guarded <c>card_embeddings</c> block of 038, re-run on every migrate call once 038 is recorded (R20X F02,
  /// contract R20-00 §10.2). Prod's app role cannot install <c>vector</c>, so 038 is recorded with only a notice; when
  /// the owner later runs CREATE EXTENSION vector as the RDS master, the next Migrate creates the table here without
  /// deleting any schema_migrations row. A no-op without the extension or with the table already there; the DDL must
  /// stay identical to 038's (a test compares them).
  /// </summary>
  internal const string EnsureVectorObjectsSql = """
    do $$
    begin
      if exists (select 1 from pg_extension where extname = 'vector') then
        execute $ddl$
          create table if not exists card_embeddings (
            card_id bigint primary key references cards(id) on delete cascade,
            model text not null,
            dim int not null,
            text_sha256 text not null,
            embedding vector(384) not null,
            updated_at timestamptz not null default now()
          )
        $ddl$;
      end if;
    end $$;
    """;

  private static string MigrationsDir()
  {
    // Copied to output via csproj <CopyToOutputDirectory>.
    return MigrationsDirOverride.Value ?? Path.Combine(AppContext.BaseDirectory, "Db", "Migrations");
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

      var fullPath = Path.Combine(dir, file);
      migrations.Add(new Migration(version, baseName, file, fullPath, IsDestructive(File.ReadLines(fullPath))));
    }

    var seen = new HashSet<int>();
    foreach (var m in migrations)
    {
      if (!seen.Add(m.Version)) throw new InvalidOperationException($"Duplicate migration version: {m.Version}");
    }

    return migrations;
  }

  /// <summary>True when the leading comment block (blank lines and <c>--</c> lines) holds <c>-- destructive: true</c>.</summary>
  internal static bool IsDestructive(IEnumerable<string> lines)
  {
    foreach (var raw in lines)
    {
      var line = raw.Trim();
      if (line.Length == 0) continue;
      if (!line.StartsWith("--", StringComparison.Ordinal)) return false;
      if (DestructiveHeader.IsMatch(line)) return true;
    }
    return false;
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

  /// <summary>
  /// SPC-01: every application connection starts with <c>statement_timeout</c> and
  /// <c>idle_in_transaction_session_timeout</c> (<see cref="RecallSmith.Lambda.Db.PgSessionTimeouts"/>). A migration
  /// (an index build, a backfill) may legitimately take longer, so its transaction lifts both, for that transaction
  /// only (<c>set local</c>: they return to the connection's limits at commit or rollback). Npgsql's client-side
  /// Command Timeout (30 s) still applies, as it did before.
  /// </summary>
  internal const string LiftTimeoutsSql =
    "set local statement_timeout = 0; set local idle_in_transaction_session_timeout = 0;";

  private static async Task<bool> ApplyOne(NpgsqlConnection conn, Migration m, RecallSmith.Lambda.Vpc.Authoring.AdminAuditEntry? audit)
  {
    var sql = await File.ReadAllTextAsync(m.FullPath);

    await using var tx = await conn.BeginTransactionAsync();
    try
    {
      await ExecuteAsync(conn, tx, LiftTimeoutsSql, []);
      await ExecuteAsync(conn, tx, sql, []);
      await ExecuteAsync(
        conn,
        tx,
        "insert into schema_migrations(version, name) values ($1, $2) on conflict (version) do nothing;",
        [m.Version, m.Name]);

      // For migrations before 023 on a fresh database the table does not exist yet, so nothing is
      // written; 023 itself creates it inside this same transaction and so audits its own application.
      var persisted = audit is not null && await RecallSmith.Lambda.Vpc.Authoring.AdminAudit.RecordAsync(conn, tx, audit);

      await tx.CommitAsync();
      return persisted;
    }
    catch
    {
      try { await tx.RollbackAsync(); } catch { /* ignore */ }
      throw;
    }
  }

  /// <summary>
  /// Runs <see cref="EnsureVectorObjectsSql"/> in its own transaction and answers whether the vector store is ready
  /// (extension and table). Not audited and not recorded: it changes nothing unless the extension appeared.
  /// </summary>
  internal static async Task<bool> EnsureVectorObjectsAsync(NpgsqlConnection conn)
  {
    await using (var tx = await conn.BeginTransactionAsync())
    {
      await ExecuteAsync(conn, tx, LiftTimeoutsSql, []);
      await ExecuteAsync(conn, tx, EnsureVectorObjectsSql, []);
      await tx.CommitAsync();
    }
    var ready = await ExecuteScalarAsync(conn, null,
      "select exists(select 1 from pg_extension where extname = 'vector') and to_regclass('public.card_embeddings') is not null", []);
    return ready is true;
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

    // extra manual guard: x-migrate-secret (constant-time; 503 in prod when unset)
    var secretDeny = DbSafety.CheckMigrateSecret(req, res);
    if (secretDeny is not null) return secretDeny;

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
    // Unlocks exactly one destructive migration: the value must equal its version as dryRun prints it (e.g. "45").
    var confirmDestructive = req.Query.TryGetValue("confirmDestructive", out var c) ? c : null;

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
          pending = pending.Select(m => new { version = m.Version, name = m.Name, file = m.File, destructive = m.Destructive }).ToList(),
        };
      }

      var appliedNow = new List<object>();
      Migration? blocked = null;
      foreach (var m in pending)
      {
        // Stop before a destructive migration the caller did not name; nothing after it runs either, so the
        // migrations stay in order and a later additive one never carries the destructive one along.
        if (m.Destructive && !string.Equals(confirmDestructive, m.Version.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal))
        {
          blocked = m;
          break;
        }

        var audit = RecallSmith.Lambda.Vpc.Authoring.AdminAudit.Entry(
          auth, res, "db.migrate", $"migration:{m.Version}", null, new { version = m.Version, name = m.Name, file = m.File });
        var persisted = await ApplyOne(conn, m, audit);
        RecallSmith.Lambda.Vpc.Authoring.AdminAudit.Emit(audit, persisted);
        appliedNow.Add(new { version = m.Version, name = m.Name, file = m.File });
      }

      // Every call, also when nothing is pending: the owner step is "CREATE EXTENSION vector, then press Migrate".
      bool? vectorReady = null;
      if (applied.Contains(VectorMigrationVersion) || pending.Any(m => m.Version == VectorMigrationVersion))
      {
        vectorReady = await EnsureVectorObjectsAsync(conn);
        RecallSmith.Lambda.Vpc.Authoring.CardEmbeddings.ResetReadyCache();
      }

      return (object)new
      {
        dryRun = false,
        applied = appliedNow,
        appliedCount = appliedNow.Count,
        latestAvailable = migrations[^1].Version,
        vectorReady,
        blockedBy = blocked is null ? null : new { version = blocked.Version, name = blocked.Name, file = blocked.File },
        message = blocked is null
          ? null
          : $"Stopped before destructive migration {blocked.File}; it and every later migration are still pending. " +
            $"Re-run with confirmDestructive={blocked.Version.ToString(CultureInfo.InvariantCulture)} to apply it.",
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
    // First, before any role check: a production caller cannot tell this route from an unregistered path.
    if (!DbSafety.DestructiveRoutesEnabled()) return res.NotFound("Route not found");

    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var secretDeny = DbSafety.CheckMigrateSecret(req, res);
    if (secretDeny is not null) return secretDeny;

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
    // First, before any role check: a production caller cannot tell this route from an unregistered path.
    if (!DbSafety.DestructiveRoutesEnabled()) return res.NotFound("Route not found");

    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var secretDeny = DbSafety.CheckMigrateSecret(req, res);
    if (secretDeny is not null) return secretDeny;

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
