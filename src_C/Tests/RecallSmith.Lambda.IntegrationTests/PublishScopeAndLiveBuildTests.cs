using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// PublishJobs / PublishStatus scoping by admin_deck_permissions (CBE-21) and AdminDecks
/// exposing decks.live_build_id (CBE-18), against a real Postgres and driven through the JWT
/// authorizer claims (editor with a fresh sub, or super_admin) exactly as API Gateway delivers
/// them. Rows are seeded by SQL; no S3 or SQS is touched.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishScopeAndLiveBuildTests
{
  private readonly PostgresFixture _db;
  public PublishScopeAndLiveBuildTests(PostgresFixture db) => _db = db;

  private static string Slug(string tag) => $"it-f10-{tag}-{Guid.NewGuid():N}";
  private static string NewSub() => $"it-f10-sub-{Guid.NewGuid():N}";

  private static JsonElement Event(string path, string method, string sub, string[] groups, Dictionary<string, string>? query)
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
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      queryStringParameters = query ?? new Dictionary<string, string>(StringComparer.Ordinal),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokeAsync(
    JsonElement evt,
    Func<LambdaRequest, Res, AuthContext, Task<APIGatewayProxyResponse>> handler)
  {
    var req = new LambdaRequest(evt);
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await handler(req, res, auth);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [slug, "deck " + slug, "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static async Task<string> SeedPublishAsync(NpgsqlConnection conn, long deckId, string slug, string buildId, string status)
  {
    var jobId = Guid.NewGuid().ToString();
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,$6)",
      [deckId, slug, buildId, $"content/{buildId}", jobId, status]);
    return jobId;
  }

  private static Task GrantReadAsync(NpgsqlConnection conn, string adminSub, long deckId) =>
    DbUtil.ExecuteAsync(conn, null,
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1,$2,1,0)",
      [adminSub, deckId]);

  private static string[] JobIds(JsonElement data) =>
    data.EnumerateArray().Select(r => r.GetProperty("jobId").GetString()!).ToArray();

  // ---- PublishJobs scoping --------------------------------------------------------------------

  [Fact]
  public async Task Jobs_Editor_SeesOnlyReadableDecks()
  {
    await using var conn = await _db.OpenAsync();
    var editor = NewSub();
    var slugA = Slug("a");
    var slugB = Slug("b");
    var deckA = await SeedDeckAsync(conn, slugA);
    var deckB = await SeedDeckAsync(conn, slugB);
    var jobA = await SeedPublishAsync(conn, deckA, slugA, "b-a", "PENDING");
    var jobB = await SeedPublishAsync(conn, deckB, slugB, "b-b", "PENDING");
    await GrantReadAsync(conn, editor, deckA);

    var (status, doc) = await InvokeAsync(
      Event("/api/v1/authoring/publish/jobs", "GET", editor, new[] { "editor" }, null),
      PublishJobs.HandleFetchPublishJobs);

    Assert.Equal(200, status);
    var ids = JobIds(doc.RootElement.GetProperty("data"));
    Assert.Contains(jobA, ids);
    Assert.DoesNotContain(jobB, ids);
    doc.Dispose();
  }

  [Fact]
  public async Task Jobs_SuperAdmin_SeesEveryDeck()
  {
    await using var conn = await _db.OpenAsync();
    var slugA = Slug("a");
    var slugB = Slug("b");
    var deckA = await SeedDeckAsync(conn, slugA);
    var deckB = await SeedDeckAsync(conn, slugB);
    var jobA = await SeedPublishAsync(conn, deckA, slugA, "b-a", "PENDING");
    var jobB = await SeedPublishAsync(conn, deckB, slugB, "b-b", "PENDING");

    var (status, doc) = await InvokeAsync(
      Event("/api/v1/authoring/publish/jobs", "GET", NewSub(), new[] { "super_admin" }, null),
      PublishJobs.HandleFetchPublishJobs);

    Assert.Equal(200, status);
    var ids = JobIds(doc.RootElement.GetProperty("data"));
    Assert.Contains(jobA, ids);
    Assert.Contains(jobB, ids);
    doc.Dispose();
  }

  // ---- PublishStatus scoping ------------------------------------------------------------------

  [Fact]
  public async Task Status_Editor_JobOfUnreadableDeck_Is404()
  {
    await using var conn = await _db.OpenAsync();
    var editor = NewSub();
    var slug = Slug("unreadable");
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = await SeedPublishAsync(conn, deckId, slug, "b-x", "PENDING");
    // Editor granted read on a different deck, not this one.
    await GrantReadAsync(conn, editor, await SeedDeckAsync(conn, Slug("other")));

    var (status, doc) = await InvokeAsync(
      Event("/api/v1/authoring/publish/status", "GET", editor, new[] { "editor" },
        new Dictionary<string, string>(StringComparer.Ordinal) { ["jobId"] = jobId }),
      PublishStatus.HandlePublishStatus);

    Assert.Equal(404, status);
    Assert.Equal("NOT_FOUND", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    doc.Dispose();
  }

  [Fact]
  public async Task Status_Editor_JobOfReadableDeck_Is200()
  {
    await using var conn = await _db.OpenAsync();
    var editor = NewSub();
    var slug = Slug("readable");
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = await SeedPublishAsync(conn, deckId, slug, "b-y", "PENDING");
    await GrantReadAsync(conn, editor, deckId);

    var (status, doc) = await InvokeAsync(
      Event("/api/v1/authoring/publish/status", "GET", editor, new[] { "editor" },
        new Dictionary<string, string>(StringComparer.Ordinal) { ["jobId"] = jobId }),
      PublishStatus.HandlePublishStatus);

    Assert.Equal(200, status);
    Assert.Equal(jobId, doc.RootElement.GetProperty("data").GetProperty("jobId").GetString());
    doc.Dispose();
  }

  // ---- AdminDecks liveBuildId -----------------------------------------------------------------

  [Fact]
  public async Task AdminDecks_ReturnsLiveBuildId_AfterRollback()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("live");
    var deckId = await SeedDeckAsync(conn, slug);
    // Older then newer SUCCESS build; the newest by (created_at desc, id desc) is the latest.
    await SeedPublishAsync(conn, deckId, slug, "b-older", "SUCCESS");
    await SeedPublishAsync(conn, deckId, slug, "b-newer", "SUCCESS");
    // A rollback moved the live pointer back to the older build.
    await DbUtil.ExecuteAsync(conn, null, "update decks set live_build_id = $2 where id = $1", [deckId, "b-older"]);

    var (status, doc) = await InvokeAsync(
      Event("/api/v1/admin/decks", "GET", NewSub(), new[] { "super_admin" },
        new Dictionary<string, string>(StringComparer.Ordinal) { ["q"] = slug }),
      AdminDecks.HandleAdminDecks);

    Assert.Equal(200, status);
    var items = doc.RootElement.GetProperty("data").GetProperty("items");
    var item = items.EnumerateArray().Single(i => i.GetProperty("slug").GetString() == slug);
    Assert.Equal("b-older", item.GetProperty("liveBuildId").GetString());
    Assert.Equal("b-newer", item.GetProperty("latestBuildId").GetString());
    doc.Dispose();
  }
}
