using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Permissions.HandleAuthoringPermissions bulk branch (/api/v1/admin/permissions/bulk) against a
/// real Postgres (CBE-15). Pins the transactional rollback on an unknown deck (F08's 23503 → 400),
/// replace-scoped-to-one-admin, merge-keeps-unlisted, and the super_admin-only gate. Every test uses
/// a fresh target admin sub, so assertions never count whole tables.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PermissionsBulkRollbackTests
{
  private readonly PostgresFixture _db;
  public PermissionsBulkRollbackTests(PostgresFixture db) => _db = db;

  private const string BulkPath = "/api/v1/admin/permissions/bulk";

  private static string Slug(string tag) => $"it-f14-{tag}-{Guid.NewGuid():N}";
  private static string NewSub(string tag) => $"it-f14-{tag}-{Guid.NewGuid():N}";

  private static JsonElement Event(string method, string sub, string[] groups, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = BulkPath,
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
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokeAsync(string callerSub, string[] groups, object body)
  {
    var req = new LambdaRequest(Event("POST", callerSub, groups, JsonSerializer.Serialize(body)));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await Permissions.HandleAuthoringPermissions(req, res, auth);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [slug, "deck a", "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static Task SeedPermAsync(NpgsqlConnection conn, string adminSub, long deckId, int canRead, int canWrite) =>
    DbUtil.ExecuteAsync(conn, null,
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1,$2,$3,$4)",
      [adminSub, deckId, canRead, canWrite]);

  private async Task<(int CanRead, int CanWrite)?> PermAsync(string adminSub, long deckId)
  {
    var rows = await _db.QueryAsync(
      "select can_read, can_write from admin_deck_permissions where admin_sub = $1 and deck_id = $2",
      adminSub, deckId);
    if (rows.Count == 0) return null;
    return (Convert.ToInt32(rows[0]["can_read"], CultureInfo.InvariantCulture),
            Convert.ToInt32(rows[0]["can_write"], CultureInfo.InvariantCulture));
  }

  private async Task<List<long>> DeckIdsAsync(string adminSub)
  {
    var rows = await _db.QueryAsync(
      "select deck_id from admin_deck_permissions where admin_sub = $1 order by deck_id", adminSub);
    return rows.Select(r => Convert.ToInt64(r["deck_id"], CultureInfo.InvariantCulture)).ToList();
  }

  // ---- rollback -------------------------------------------------------------------------------

  [Fact]
  public async Task BulkReplace_WithUnknownDeck_RollsBack_AndKeepsPreviousRows()
  {
    var adminSub = NewSub("adm");
    long deckOld1, deckOld2, deckNew;
    await using (var conn = await _db.OpenAsync())
    {
      deckOld1 = await SeedDeckAsync(conn, Slug("old1"));
      deckOld2 = await SeedDeckAsync(conn, Slug("old2"));
      deckNew = await SeedDeckAsync(conn, Slug("new"));
      await SeedPermAsync(conn, adminSub, deckOld1, canRead: 1, canWrite: 0);
      await SeedPermAsync(conn, adminSub, deckOld2, canRead: 1, canWrite: 1);
    }

    // The unknown deck id trips 23503 on the upsert; the whole transaction (delete + insert) rolls back.
    var (status, doc) = await InvokeAsync(NewSub("caller"), ["super_admin"], new
    {
      adminSub,
      mode = "replace",
      permissions = new object[]
      {
        new { deckId = deckNew, canWrite = true },
        new { deckId = 999999999L, canRead = true },
      },
    });

    Assert.Equal(400, status);
    Assert.Equal("VALIDATION_ERROR", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    doc.Dispose();

    // Both original rows survive, byte-for-byte, and the valid new deck was never written.
    Assert.Equal((1, 0), await PermAsync(adminSub, deckOld1));
    Assert.Equal((1, 1), await PermAsync(adminSub, deckOld2));
    Assert.Null(await PermAsync(adminSub, deckNew));
  }

  [Fact]
  public async Task BulkReplace_ReplacesAllRows_ForThatAdminOnly()
  {
    var adminA = NewSub("admA");
    var adminB = NewSub("admB");
    long deckA1, deckA2, deckB1, deckNew1, deckNew2;
    await using (var conn = await _db.OpenAsync())
    {
      deckA1 = await SeedDeckAsync(conn, Slug("a1"));
      deckA2 = await SeedDeckAsync(conn, Slug("a2"));
      deckB1 = await SeedDeckAsync(conn, Slug("b1"));
      deckNew1 = await SeedDeckAsync(conn, Slug("n1"));
      deckNew2 = await SeedDeckAsync(conn, Slug("n2"));
      await SeedPermAsync(conn, adminA, deckA1, 1, 0);
      await SeedPermAsync(conn, adminA, deckA2, 1, 1);
      await SeedPermAsync(conn, adminB, deckB1, 1, 0);
    }

    var (status, doc) = await InvokeAsync(NewSub("caller"), ["super_admin"], new
    {
      adminSub = adminA,
      mode = "replace",
      permissions = new object[]
      {
        new { deckId = deckNew1, canRead = true },
        new { deckId = deckNew2, canWrite = true },
      },
    });

    Assert.Equal(200, status);
    doc.Dispose();

    Assert.Equal(new[] { deckNew1, deckNew2 }.OrderBy(x => x), (await DeckIdsAsync(adminA)).OrderBy(x => x));
    Assert.Null(await PermAsync(adminA, deckA1));
    Assert.Null(await PermAsync(adminA, deckA2));

    // Admin B is untouched.
    Assert.Equal(new[] { deckB1 }, await DeckIdsAsync(adminB));
    Assert.Equal((1, 0), await PermAsync(adminB, deckB1));
  }

  [Fact]
  public async Task BulkMerge_KeepsUnlistedRows()
  {
    var adminSub = NewSub("adm");
    long deckKeep, deckUpdate, deckAdd;
    await using (var conn = await _db.OpenAsync())
    {
      deckKeep = await SeedDeckAsync(conn, Slug("keep"));
      deckUpdate = await SeedDeckAsync(conn, Slug("upd"));
      deckAdd = await SeedDeckAsync(conn, Slug("add"));
      await SeedPermAsync(conn, adminSub, deckKeep, 1, 0);
      await SeedPermAsync(conn, adminSub, deckUpdate, 1, 0);
    }

    var (status, doc) = await InvokeAsync(NewSub("caller"), ["super_admin"], new
    {
      adminSub,
      mode = "merge",
      permissions = new object[]
      {
        new { deckId = deckUpdate, canWrite = true },
        new { deckId = deckAdd, canRead = true },
      },
    });

    Assert.Equal(200, status);
    doc.Dispose();

    // Unlisted row survives unchanged, listed row is updated, and the new row is added.
    Assert.Equal((1, 0), await PermAsync(adminSub, deckKeep));
    Assert.Equal((1, 1), await PermAsync(adminSub, deckUpdate));
    Assert.Equal((1, 0), await PermAsync(adminSub, deckAdd));
  }

  [Fact]
  public async Task Bulk_IsSuperAdminOnly()
  {
    var (status, doc) = await InvokeAsync(NewSub("editor"), ["editor"], new
    {
      adminSub = NewSub("target"),
      mode = "replace",
      permissions = Array.Empty<object>(),
    });

    Assert.Equal(403, status);
    doc.Dispose();
  }
}
