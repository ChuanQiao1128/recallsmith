using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The append-only audit trail (CBE-12) against a real Postgres: every admin mutation writes one
/// <c>admin_audit</c> row inside its own transaction (so a rolled-back mutation leaves none) and
/// emits a <c>tag:"audit"</c> log line after commit; the table's triggers reject UPDATE/DELETE.
/// Handlers are driven through super_admin gateway claims exactly as API Gateway delivers them, and
/// every assertion is scoped to a unique target because the table is shared by the whole suite.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AdminAuditTests
{
  private readonly PostgresFixture _db;
  public AdminAuditTests(PostgresFixture db) => _db = db;

  private static string Unique(string tag) => $"it-f09-{tag}-{Guid.NewGuid():N}";

  private static JsonElement Event(string path, string method, string sub, string[] groups, string? body, IDictionary<string, string>? query = null)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = sub,
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokePermsAsync(
    string method, string path, string callerSub, string? body, IDictionary<string, string>? query = null)
  {
    var req = new LambdaRequest(Event(path, method, callerSub, new[] { "super_admin" }, body, query));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await Permissions.HandleAuthoringPermissions(req, res, auth);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private sealed record AuditRow(string Action, string Target, string? Before, string? After, string? Actor);

  private async Task<List<AuditRow>> ReadAuditAsync(string target)
  {
    var rows = await _db.QueryAsync(
      "select action, target, before_state::text as before, after_state::text as after, actor_sub from admin_audit where target = $1 order by id",
      target);
    return rows.Select(r => new AuditRow(
      Convert.ToString(r["action"], CultureInfo.InvariantCulture) ?? string.Empty,
      Convert.ToString(r["target"], CultureInfo.InvariantCulture) ?? string.Empty,
      r["before"] as string,
      r["after"] as string,
      r["actor_sub"] as string)).ToList();
  }

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [Unique("deck"), "f09", "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static Task SeedPermAsync(NpgsqlConnection conn, string adminSub, long deckId) =>
    DbUtil.ExecuteAsync(conn, null,
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1,$2,$3,$4)",
      [adminSub, deckId, 1, 0]);

  private static List<long> DeckIdsIn(string json)
  {
    using var d = JsonDocument.Parse(json);
    return d.RootElement.EnumerateArray().Select(e => e.GetProperty("deckId").GetInt64()).ToList();
  }

  // ---- permissions bulk -----------------------------------------------------------------------

  [Fact]
  public async Task PermissionsBulkReplace_WritesAuditRow_WithBeforeAndAfter()
  {
    var adminSub = Unique("admin");
    var target = $"admin:{adminSub}";
    var caller = Unique("caller");

    await using var conn = await _db.OpenAsync();
    var deckOld1 = await SeedDeckAsync(conn);
    var deckOld2 = await SeedDeckAsync(conn);
    var deckNew = await SeedDeckAsync(conn);
    await SeedPermAsync(conn, adminSub, deckOld1);
    await SeedPermAsync(conn, adminSub, deckOld2);

    var body = JsonSerializer.Serialize(new
    {
      adminSub,
      mode = "replace",
      permissions = new[] { new { deckId = deckNew, canRead = true } },
    });

    var (status, doc) = await InvokePermsAsync("POST", "/api/v1/admin/permissions/bulk", caller, body);
    Assert.Equal(200, status);
    doc.Dispose();

    var row = Assert.Single(await ReadAuditAsync(target));
    Assert.Equal("permissions.replace", row.Action);
    Assert.Equal(caller, row.Actor);

    var beforeIds = DeckIdsIn(row.Before!);
    Assert.Contains(deckOld1, beforeIds);
    Assert.Contains(deckOld2, beforeIds);

    Assert.Equal(new[] { deckNew }, DeckIdsIn(row.After!).ToArray());
  }

  [Fact]
  public async Task PermissionsBulk_FailedTransaction_WritesNoAuditRow()
  {
    var adminSub = Unique("admin");
    var target = $"admin:{adminSub}";
    var caller = Unique("caller");

    await using var conn = await _db.OpenAsync();
    var deckKept = await SeedDeckAsync(conn);
    await SeedPermAsync(conn, adminSub, deckKept);

    // An unknown deck id trips the 23503 foreign-key violation on the upsert, rolling the whole
    // transaction back: the delete, and the audit row with it.
    var body = JsonSerializer.Serialize(new
    {
      adminSub,
      mode = "replace",
      permissions = new[] { new { deckId = 999999999L, canRead = true } },
    });

    var (status, doc) = await InvokePermsAsync("POST", "/api/v1/admin/permissions/bulk", caller, body);
    Assert.NotEqual(200, status);
    doc.Dispose();

    Assert.Empty(await ReadAuditAsync(target));

    var kept = await _db.ScalarAsync(
      "select count(*) from admin_deck_permissions where admin_sub = $1 and deck_id = $2", adminSub, deckKept);
    Assert.Equal(1L, Convert.ToInt64(kept, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task PermissionsDelete_WritesAuditRow()
  {
    var adminSub = Unique("admin");
    var target = $"admin:{adminSub}";
    var caller = Unique("caller");

    await using var conn = await _db.OpenAsync();
    var deckId = await SeedDeckAsync(conn);
    await SeedPermAsync(conn, adminSub, deckId);

    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["adminSub"] = adminSub,
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
    };

    var (status, doc) = await InvokePermsAsync("DELETE", "/api/v1/admin/permissions", caller, null, query);
    Assert.Equal(200, status);
    doc.Dispose();

    var row = Assert.Single(await ReadAuditAsync(target));
    Assert.Equal("permissions.delete", row.Action);
    Assert.NotNull(row.Before);
    Assert.Null(row.After);
  }

  [Fact]
  public async Task PermissionsUpsert_EmitsAuditLogLine()
  {
    var adminSub = Unique("admin");
    var caller = Unique("caller");

    await using var conn = await _db.OpenAsync();
    var deckId = await SeedDeckAsync(conn);

    var body = JsonSerializer.Serialize(new { adminSub, deckId, canRead = true });

    // Log lines go through Console; reading them back means redirecting it. Safe only because this
    // whole collection runs serially (see LogShapeTests).
    var oldOut = Console.Out;
    var stdout = new StringWriter();
    Console.SetOut(stdout);
    try
    {
      var (status, doc) = await InvokePermsAsync("PUT", "/api/v1/admin/permissions", caller, body);
      Assert.Equal(200, status);
      doc.Dispose();
    }
    finally
    {
      Console.SetOut(oldOut);
    }

    var outText = stdout.ToString();
    Assert.Contains("\"tag\":\"audit\"", outText);
    Assert.Contains("\"action\":\"permissions.upsert\"", outText);
  }

  // ---- deck rollback --------------------------------------------------------------------------

  private sealed class RebuildStub
  {
    public int Calls;
    public DeckRollback.ManifestRebuildFn Fn => _ =>
    {
      Calls++;
      return Task.FromResult(new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1));
    };
  }

  [Fact]
  public async Task DeckRollback_WritesAuditRow_WithPreviousLiveBuild()
  {
    var caller = Unique("caller");

    await using var conn = await _db.OpenAsync();
    var slug = Unique("rollback");
    var deckId = await SeedDeckAsync(conn);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'SUCCESS')",
      [deckId, slug, "b-older", "content/b-older", Guid.NewGuid().ToString()]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'SUCCESS')",
      [deckId, slug, "b-newer", "content/b-newer", Guid.NewGuid().ToString()]);
    await DbUtil.ExecuteAsync(conn, null, "update decks set live_build_id = $2 where id = $1", [deckId, "b-newer"]);

    var stub = new RebuildStub();
    var req = new LambdaRequest(Event(
      $"/api/v1/admin/decks/{deckId}/rollback", "POST", caller, new[] { "super_admin" }, "{\"buildId\":\"b-older\"}"));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await DeckRollback.HandleDeckRollback(req, res, auth, stub.Fn);
    Assert.Equal(200, resp.StatusCode);
    Assert.Equal(1, stub.Calls);

    var row = Assert.Single(await ReadAuditAsync($"deck:{deckId}"));
    Assert.Equal("deck.rollback", row.Action);
    using (var before = JsonDocument.Parse(row.Before!))
    {
      Assert.Equal("b-newer", before.RootElement.GetProperty("liveBuildId").GetString());
    }
    using (var after = JsonDocument.Parse(row.After!))
    {
      Assert.Equal("b-older", after.RootElement.GetProperty("liveBuildId").GetString());
    }
  }

  // ---- publish reap ---------------------------------------------------------------------------

  [Fact]
  public async Task PublishReap_WritesAuditRow()
  {
    var caller = Unique("caller");

    await using var conn = await _db.OpenAsync();
    var slug = Unique("reap");
    var deckId = await SeedDeckAsync(conn);
    var jobId = Guid.NewGuid().ToString();
    await DbUtil.ExecuteAsync(conn, null,
      """
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, created_at)
      values ($1, $2, $3, $4, $5, 'PENDING', now() - interval '20 minutes')
      """,
      [deckId, slug, $"b-{jobId[..8]}", $"content/{jobId}", jobId]);

    var req = new LambdaRequest(Event("/api/v1/admin/publish/reap", "POST", caller, new[] { "super_admin" }, null));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await PublishReaper.HandlePublishReap(req, res, auth);
    Assert.Equal(200, resp.StatusCode);

    var audit = await ReadAuditAsync("deck_publishes");
    Assert.Contains(audit, r => r.Action == "publish.reap" && r.After is not null && r.After.Contains(jobId, StringComparison.Ordinal));
  }

  // ---- db migrate -----------------------------------------------------------------------------

  [Fact]
  public async Task DbMigrate_WritesAuditRowPerAppliedMigration()
  {
    var caller = Unique("caller");
    var scratchConn = await _db.CreateScratchDatabaseAsync("it_f09_migrate");

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    var savedApiEnv = Environment.GetEnvironmentVariable("API_ENV");
    var savedSecret = Environment.GetEnvironmentVariable("MIGRATE_SECRET");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", "it_f09_migrate");
      Environment.SetEnvironmentVariable("API_ENV", null);
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", null);
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      var req = new LambdaRequest(Event("/api/v1/admin/db/migrate", "POST", caller, new[] { "super_admin" }, null));
      var res = new Res(req.TraceId);
      var auth = await Auth.GetAuthContextAsync(req);
      var resp = await RecallSmith.Lambda.Vpc.Db.Migrate.HandleDbMigrate(req, res, auth);
      Assert.Equal(200, resp.StatusCode);

      await using var conn = new NpgsqlConnection(scratchConn);
      await conn.OpenAsync();
      var cnt = await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from admin_audit where action = 'db.migrate' and target like 'migration:%'", []);
      Assert.True(Convert.ToInt64(cnt, CultureInfo.InvariantCulture) >= 1);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Environment.SetEnvironmentVariable("API_ENV", savedApiEnv);
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", savedSecret);
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  // ---- append-only trigger --------------------------------------------------------------------

  [Fact]
  public async Task AdminAudit_RejectsUpdateAndDelete()
  {
    var target = $"admin:{Unique("append")}";

    await using var conn = await _db.OpenAsync();
    var entry = new AdminAuditEntry("actor-x", "user-x", "test.action", target, new { a = 1 }, new { b = 2 }, "trace-x");
    Assert.True(await AdminAudit.RecordAsync(conn, null, entry));

    var idObj = await DbUtil.ExecuteScalarAsync(conn, null, "select id from admin_audit where target = $1", [target]);
    var id = Convert.ToInt64(idObj, CultureInfo.InvariantCulture);

    await Assert.ThrowsAsync<PostgresException>(() =>
      DbUtil.ExecuteAsync(conn, null, "update admin_audit set action = 'x' where id = $1", [id]));
    await Assert.ThrowsAsync<PostgresException>(() =>
      DbUtil.ExecuteAsync(conn, null, "delete from admin_audit where id = $1", [id]));

    var actionAfter = await DbUtil.ExecuteScalarAsync(conn, null, "select action from admin_audit where id = $1", [id]);
    Assert.Equal("test.action", Convert.ToString(actionAfter, CultureInfo.InvariantCulture));
  }
}
