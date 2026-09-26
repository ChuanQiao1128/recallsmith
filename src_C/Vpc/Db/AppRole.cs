using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using RecallSmith.Lambda.Common;
using static RecallSmith.Lambda.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Db;

/// <summary>
/// super_admin-only bootstrap of the least-privilege application login roles
/// (E00 §2.6.1). One app role owns the whole schema so migrations keep running
/// through the same pool as requests; the staging database and role are created
/// now while master access still exists (E00 §6 #9).
///
/// The password is never interpolated into SQL: it travels as a bound parameter
/// into set_config('app.pw', …, true), then a server-side DO block reads it with
/// current_setting and applies it through format(… %L …). Role and database
/// identifiers are interpolated only after the regexes below have accepted them.
///
/// Unqualified `Pg`/`DbUtil` inside this namespace would bind to the byte-near
/// duplicate under RecallSmith.Lambda.Vpc.Db (E14 deletes it), so the shared pool
/// is reached through the fully-qualified RecallSmith.Lambda.Db.Pg and a
/// `using static RecallSmith.Lambda.Db.DbUtil;`.
/// </summary>
public static class AppRole
{
  private const string RoleNamePattern = "^developercards_app(_staging)?$";
  private const string DatabaseNamePattern = "^developercards_(db|staging)$";
  private const string PwPattern = "^[A-Za-z0-9]{32,64}$";

  private static readonly Regex RoleNameRegex = new(RoleNamePattern, RegexOptions.Compiled);
  private static readonly Regex DatabaseNameRegex = new(DatabaseNamePattern, RegexOptions.Compiled);
  private static readonly Regex PasswordRegex = new(PwPattern, RegexOptions.Compiled);

  public sealed record AppRoleSpec(string Name, string Password, string Database, bool CreateDatabase);

  public sealed record AppRoleResult(string Name, bool Created, bool DatabaseCreated, int TablesReassigned, int SequencesReassigned);

  /// <summary>current_user lacks rolcreaterole — the bootstrap must run as the master user.</summary>
  public sealed class NotMasterException : Exception
  {
    public NotMasterException() : base("current_user lacks rolcreaterole") { }
  }

  /// <summary>A spec named a database that does not exist while createDatabase is false.</summary>
  public sealed class DatabaseMissingException : Exception
  {
    public string Database { get; }

    public DatabaseMissingException(string database) : base($"database {database} does not exist") => Database = database;
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleBootstrapRoles(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    // extra manual guard: x-migrate-secret (constant-time; 503 in prod when unset). Bootstrap-roles
    // is not destructive, so it stays enabled in production — only the secret gate applies.
    var secretDeny = DbSafety.CheckMigrateSecret(req, res);
    if (secretDeny is not null) return secretDeny;

    using var doc = Validation.ParseJsonBody(req);
    if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

    var root = doc.RootElement;
    if (root.ValueKind != JsonValueKind.Object ||
        !root.TryGetProperty("roles", out var rolesEl) ||
        rolesEl.ValueKind != JsonValueKind.Array)
    {
      return res.BadRequest("VALIDATION_ERROR", "roles must be a JSON array of 1-2 objects");
    }

    var length = rolesEl.GetArrayLength();
    if (length is < 1 or > 2) return res.BadRequest("VALIDATION_ERROR", "roles must contain 1 or 2 objects");

    var specs = new List<AppRoleSpec>();
    var seen = new HashSet<string>(StringComparer.Ordinal);
    var i = 0;
    foreach (var el in rolesEl.EnumerateArray())
    {
      if (el.ValueKind != JsonValueKind.Object) return res.BadRequest("VALIDATION_ERROR", $"roles[{i}] must be an object");

      if (!el.TryGetProperty("name", out var nameEl) || nameEl.ValueKind != JsonValueKind.String)
        return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].name is required");
      var name = nameEl.GetString()!;
      if (!RoleNameRegex.IsMatch(name)) return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].name must match {RoleNamePattern}");

      if (!el.TryGetProperty("password", out var pwEl) || pwEl.ValueKind != JsonValueKind.String)
        return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].password is required");
      var pw = pwEl.GetString()!;
      if (!PasswordRegex.IsMatch(pw)) return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].password must match {PwPattern}");

      if (!el.TryGetProperty("database", out var dbEl) || dbEl.ValueKind != JsonValueKind.String)
        return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].database is required");
      var database = dbEl.GetString()!;
      if (!DatabaseNameRegex.IsMatch(database)) return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].database must match {DatabaseNamePattern}");

      var createDatabase = false;
      if (el.TryGetProperty("createDatabase", out var cdEl))
      {
        if (cdEl.ValueKind == JsonValueKind.True) createDatabase = true;
        else if (cdEl.ValueKind == JsonValueKind.False) createDatabase = false;
        else return res.BadRequest("VALIDATION_ERROR", $"roles[{i}].createDatabase must be a boolean");
      }

      if (!seen.Add(name)) return res.BadRequest("VALIDATION_ERROR", $"duplicate role name {name}");

      specs.Add(new AppRoleSpec(name, pw, database, createDatabase));
      i++;
    }

    await using var conn = await RecallSmith.Lambda.Db.Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var results = await BootstrapAsync(conn, specs);
      // Names and booleans only — never the body, the specs or a password.
      Log.Info(JsonSerializer.Serialize(new
      {
        tag = "bootstrap-roles",
        roles = results.Select(r => r.Name).ToArray(),
        created = results.Select(r => r.Created).ToArray(),
        databaseCreated = results.Select(r => r.DatabaseCreated).ToArray(),
      }));
      return res.Ok(new { roles = results });
    }
    catch (NotMasterException)
    {
      return res.Raw(409, new { ok = false, error = "NOT_MASTER", message = "current_user lacks CREATEROLE; run bootstrap-roles while PGUSER is still the master user" });
    }
    catch (DatabaseMissingException ex)
    {
      return res.BadRequest("VALIDATION_ERROR", $"database {ex.Database} does not exist and createDatabase is false");
    }
  }

  public static async Task<IReadOnlyList<AppRoleResult>> BootstrapAsync(
    NpgsqlConnection conn,
    IReadOnlyList<AppRoleSpec> specs,
    CancellationToken ct = default)
  {
    // 1. Only the master (rds_superuser + CREATEROLE) may run this.
    var canCreate = await ExecuteScalarAsync(conn, null, "select rolcreaterole from pg_roles where rolname = current_user", []);
    if (canCreate is not true) throw new NotMasterException();

    // 2. Pre-flight: every spec that will not create its database must find it (before any mutation).
    foreach (var spec in specs)
    {
      if (spec.CreateDatabase) continue;
      var present = await ExecuteScalarAsync(conn, null, "select 1 from pg_database where datname = $1", [spec.Database]);
      if (present is null) throw new DatabaseMissingException(spec.Database);
    }

    var currentDatabase = (string)(await ExecuteScalarAsync(conn, null, "select current_database()", []))!;

    var results = new List<AppRoleResult>();
    foreach (var spec in specs)
    {
      var name = spec.Name;
      var database = spec.Database;

      // 3a. Create the login role if it is not there yet.
      var roleExists = await ExecuteScalarAsync(conn, null, "select 1 from pg_roles where rolname = $1", [name]);
      var created = roleExists is null;
      if (created)
      {
        await ExecuteAsync(conn, null, $"create role {name} with login nosuperuser nocreatedb nocreaterole noinherit connection limit 50", []);
      }

      // 3b. The explicit self-grant (SET TRUE, INHERIT) that lets the master SET ROLE to the
      // new owner for `create database … owner` and `alter … owner to`, and keeps read access.
      await ExecuteAsync(conn, null, $"grant {name} to current_user", []);

      // 3c. Set/rotate the password without it ever appearing in SQL text: bound parameter into a
      // transaction-local GUC, then a server-side DO block quotes it through format(… %L …).
      await using (var tx = await conn.BeginTransactionAsync(ct))
      {
        await ExecuteAsync(conn, tx, "select set_config('app.role', $1, true), set_config('app.pw', $2, true)", [name, spec.Password]);
        await ExecuteAsync(conn, tx, "do $$ begin execute format('alter role %I password %L', current_setting('app.role'), current_setting('app.pw')); end $$;", []);
        await tx.CommitAsync(ct);
      }

      // 3d. Create the owned database (CREATE DATABASE cannot run inside a transaction).
      var databaseCreated = false;
      if (spec.CreateDatabase)
      {
        var dbExists = await ExecuteScalarAsync(conn, null, "select 1 from pg_database where datname = $1", [database]);
        if (dbExists is null)
        {
          await ExecuteAsync(conn, null, $"create database {database} owner {name}", []);
          databaseCreated = true;
        }
      }

      await ExecuteAsync(conn, null, $"grant connect on database {database} to {name}", []);

      // 3f. Ownership transfer + default privileges only on the database this connection is on.
      var tablesReassigned = 0;
      var sequencesReassigned = 0;
      if (string.Equals(database, currentDatabase, StringComparison.Ordinal))
      {
        await using var tx = await conn.BeginTransactionAsync(ct);

        await ExecuteAsync(conn, tx, $"grant usage, create on schema public to {name}", []);

        var tCount = await ExecuteScalarAsync(conn, tx, $"select count(*) from pg_tables where schemaname = 'public' and tableowner <> '{name}'", []);
        tablesReassigned = Convert.ToInt32(tCount, CultureInfo.InvariantCulture);
        var sCount = await ExecuteScalarAsync(conn, tx, $"select count(*) from pg_sequences where schemaname = 'public' and sequenceowner <> '{name}'", []);
        sequencesReassigned = Convert.ToInt32(sCount, CultureInfo.InvariantCulture);

        await ExecuteAsync(conn, tx, $"do $$ declare r record; begin for r in select schemaname, tablename from pg_tables where schemaname = 'public' and tableowner <> '{name}' loop execute format('alter table %I.%I owner to %I', r.schemaname, r.tablename, '{name}'); end loop; end $$;", []);
        await ExecuteAsync(conn, tx, $"do $$ declare r record; begin for r in select schemaname, sequencename from pg_sequences where schemaname = 'public' and sequenceowner <> '{name}' loop execute format('alter sequence %I.%I owner to %I', r.schemaname, r.sequencename, '{name}'); end loop; end $$;", []);

        await ExecuteAsync(conn, tx, $"alter default privileges in schema public grant all on tables to {name}", []);
        await ExecuteAsync(conn, tx, $"alter default privileges in schema public grant all on sequences to {name}", []);

        await tx.CommitAsync(ct);
      }

      results.Add(new AppRoleResult(name, created, databaseCreated, tablesReassigned, sequencesReassigned));
    }

    return results;
  }
}
