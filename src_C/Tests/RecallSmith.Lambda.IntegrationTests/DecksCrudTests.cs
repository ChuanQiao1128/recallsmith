using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Decks.HandleAuthoringDecks (CBE-15) against a real Postgres, driven through JWT authorizer
/// claims (super_admin vs editor) exactly as API Gateway delivers them and through F02's
/// 4-argument overload with a counting rebuild stub, so no S3 call ever happens. Covers the
/// super_admin create/get/update/soft-delete round trip, the editor restricted-field filter
/// (F08 ignoredFields), the editor read-permission join, and the super_admin-only POST/DELETE.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DecksCrudTests
{
  private readonly PostgresFixture _db;
  public DecksCrudTests(PostgresFixture db) => _db = db;

  private static string Slug(string tag) => $"it-f14-{tag}-{Guid.NewGuid():N}";
  private static string NewSub() => $"it-f14-adm-{Guid.NewGuid():N}";

  private static JsonElement Event(string method, string sub, string[] groups, IDictionary<string, string>? query, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/admin/decks",
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

  /// <summary>Counting stub for F02's ManifestRebuildFn: never touches S3, only records calls.</summary>
  private sealed class RebuildStub
  {
    public int Calls;
    public DeckRollback.ManifestRebuildFn Fn => _ =>
    {
      Calls++;
      return Task.FromResult(new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1));
    };
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokeAsync(
    string method, string sub, string[] groups, IDictionary<string, string>? query, string? body, DeckRollback.ManifestRebuildFn rebuild)
  {
    var req = new LambdaRequest(Event(method, sub, groups, query, body));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await Decks.HandleAuthoringDecks(req, res, auth, rebuild);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private static JsonElement Data(JsonDocument doc) => doc.RootElement.GetProperty("data");
  private static string? ErrorCode(JsonDocument doc) => doc.RootElement.GetProperty("error").GetProperty("code").GetString();

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [slug, "deck a", "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static Task GrantAsync(NpgsqlConnection conn, string adminSub, long deckId, int canRead, int canWrite) =>
    DbUtil.ExecuteAsync(conn, null,
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1,$2,$3,$4)",
      [adminSub, deckId, canRead, canWrite]);

  // ---- super_admin round trip -----------------------------------------------------------------

  [Fact]
  public async Task SuperAdmin_Create_Get_Update_SoftDelete_RoundTrip()
  {
    var sub = NewSub();
    var slug = Slug("rt");
    string[] sa = ["super_admin"];
    var stub = new RebuildStub();

    // POST -> 200 with an id
    var createBody = JsonSerializer.Serialize(new { slug, title = "original", author = "tests" });
    var (postStatus, postDoc) = await InvokeAsync("POST", sub, sa, null, createBody, stub.Fn);
    Assert.True(postStatus == 200, $"POST returned {postStatus}: {postDoc.RootElement}");
    var deckId = Data(postDoc).GetProperty("id").GetInt64();
    postDoc.Dispose();

    // GET ?id= -> the deck
    var idQuery = new Dictionary<string, string>(StringComparer.Ordinal) { ["id"] = deckId.ToString(CultureInfo.InvariantCulture) };
    var (getStatus, getDoc) = await InvokeAsync("GET", sub, sa, idQuery, null, stub.Fn);
    Assert.Equal(200, getStatus);
    var getRows = Data(getDoc).EnumerateArray().ToList();
    Assert.Single(getRows);
    Assert.Equal(deckId, getRows[0].GetProperty("id").GetInt64());
    Assert.Equal("original", getRows[0].GetProperty("title").GetString());
    getDoc.Dispose();

    // PUT title -> 200 and the new title
    var putBody = JsonSerializer.Serialize(new { id = deckId, title = "renamed" });
    var (putStatus, putDoc) = await InvokeAsync("PUT", sub, sa, null, putBody, stub.Fn);
    Assert.True(putStatus == 200, $"PUT returned {putStatus}: {putDoc.RootElement}");
    Assert.Equal("renamed", Data(putDoc).GetProperty("title").GetString());
    putDoc.Dispose();

    // DELETE ?id= -> 200
    var (delStatus, delDoc) = await InvokeAsync("DELETE", sub, sa, idQuery, null, stub.Fn);
    Assert.True(delStatus == 200, $"DELETE returned {delStatus}: {delDoc.RootElement}");
    delDoc.Dispose();

    // GET ?id= -> empty list
    var (afterStatus, afterDoc) = await InvokeAsync("GET", sub, sa, idQuery, null, stub.Fn);
    Assert.Equal(200, afterStatus);
    Assert.Empty(Data(afterDoc).EnumerateArray());
    afterDoc.Dispose();

    // GET ?id=&includeDeleted=true -> the row with isDeleted == 1
    var deletedQuery = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["id"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["includeDeleted"] = "true",
    };
    var (delGetStatus, delGetDoc) = await InvokeAsync("GET", sub, sa, deletedQuery, null, stub.Fn);
    Assert.Equal(200, delGetStatus);
    var deletedRows = Data(delGetDoc).EnumerateArray().ToList();
    Assert.Single(deletedRows);
    Assert.Equal(1, deletedRows[0].GetProperty("isDeleted").GetInt32());
    delGetDoc.Dispose();
  }

  // ---- editor restricted-field filter ---------------------------------------------------------

  [Fact]
  public async Task Editor_Put_DropsRestrictedFields_AndReportsThem()
  {
    var editorSub = NewSub();
    var slug = Slug("edrf");
    var otherSlug = Slug("edrf2");
    long deckId;
    string? originalTier;
    await using (var conn = await _db.OpenAsync())
    {
      deckId = await SeedDeckAsync(conn, slug);
      await GrantAsync(conn, editorSub, deckId, canRead: 1, canWrite: 1);
      var seeded = await DbUtil.QueryAsync(conn, null, "select tier from decks where id = $1", [deckId]);
      originalTier = seeded[0]["tier"] as string;
    }

    var putBody = JsonSerializer.Serialize(new { id = deckId, title = "editor-renamed", tier = "premium", slug = otherSlug });
    var (status, doc) = await InvokeAsync("PUT", editorSub, ["editor"], null, putBody, new RebuildStub().Fn);

    Assert.True(status == 200, $"PUT returned {status}: {doc.RootElement}");
    Assert.Equal("editor-renamed", Data(doc).GetProperty("title").GetString());

    var ignored = Data(doc).GetProperty("ignoredFields").EnumerateArray().Select(e => e.GetString()).ToList();
    Assert.Contains("tier", ignored);
    Assert.Contains("slug", ignored);
    doc.Dispose();

    // tier and slug are unchanged in the DB (editors cannot touch them).
    var rows = await _db.QueryAsync("select slug, tier, title from decks where id = $1", deckId);
    Assert.Equal(slug, Convert.ToString(rows[0]["slug"], CultureInfo.InvariantCulture));
    Assert.Equal(originalTier, rows[0]["tier"] as string);
    Assert.Equal("editor-renamed", Convert.ToString(rows[0]["title"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Editor_WithoutWritePermission_Is403()
  {
    var editorSub = NewSub();
    long deckId;
    await using (var conn = await _db.OpenAsync())
    {
      deckId = await SeedDeckAsync(conn, Slug("noww"));
      await GrantAsync(conn, editorSub, deckId, canRead: 1, canWrite: 0);
    }

    var putBody = JsonSerializer.Serialize(new { id = deckId, title = "nope" });
    var (status, doc) = await InvokeAsync("PUT", editorSub, ["editor"], null, putBody, new RebuildStub().Fn);

    Assert.Equal(403, status);
    doc.Dispose();
  }

  [Fact]
  public async Task Editor_Get_ListsOnlyReadableDecks()
  {
    var editorSub = NewSub();
    var readableSlug = Slug("rdbl");
    long readableId;
    await using (var conn = await _db.OpenAsync())
    {
      readableId = await SeedDeckAsync(conn, readableSlug);
      await SeedDeckAsync(conn, Slug("hidden"));
      await GrantAsync(conn, editorSub, readableId, canRead: 1, canWrite: 0);
    }

    var (status, doc) = await InvokeAsync("GET", editorSub, ["editor"], null, null, new RebuildStub().Fn);

    Assert.Equal(200, status);
    var rows = Data(doc).EnumerateArray().ToList();
    Assert.Single(rows);
    Assert.Equal(readableId, rows[0].GetProperty("id").GetInt64());
    Assert.Equal(readableSlug, rows[0].GetProperty("slug").GetString());
    doc.Dispose();
  }

  [Fact]
  public async Task Editor_Post_Is403()
  {
    var body = JsonSerializer.Serialize(new { slug = Slug("edpost"), title = "t", author = "tests" });
    var (status, doc) = await InvokeAsync("POST", NewSub(), ["editor"], null, body, new RebuildStub().Fn);

    Assert.Equal(403, status);
    doc.Dispose();
  }
}
