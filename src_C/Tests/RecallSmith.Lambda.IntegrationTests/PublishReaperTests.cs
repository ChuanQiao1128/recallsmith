using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// PublishReaper against a real Postgres: which rows the reaper fails (stale PENDING/PROCESSING,
/// counted by their pre-update status), its idempotence, that a reaped row is re-acquirable by the
/// worker, the super-admin route, and the 23505 → 409 mapping the partial index makes possible.
/// One fresh deck per active row — the migration-021 index forbids two active rows per deck.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishReaperTests
{
  private readonly PostgresFixture _db;
  public PublishReaperTests(PostgresFixture db) => _db = db;

  private static string Slug(string tag) => $"it-e03-{tag}-{Guid.NewGuid():N}";

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [slug, "deck a", "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  /// <summary>Seeds one row on its own fresh deck; created_at/updated_at may be backdated.</summary>
  private static async Task<string> SeedRowAsync(NpgsqlConnection conn, string status, int? createdMinutesAgo = null, int? updatedMinutesAgo = null)
  {
    var slug = Slug("reap");
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = Guid.NewGuid().ToString();
    var createdExpr = createdMinutesAgo is null ? "now()" : $"now() - interval '{createdMinutesAgo} minutes'";
    var updatedExpr = updatedMinutesAgo is null ? "now()" : $"now() - interval '{updatedMinutesAgo} minutes'";
    var sql = $"""
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, {createdExpr}, {updatedExpr})
      """;
    await DbUtil.ExecuteAsync(conn, null, sql, [deckId, slug, $"b-{jobId[..8]}", $"content/{jobId}", jobId, status]);
    return jobId;
  }

  private static async Task<string> StatusOfAsync(NpgsqlConnection conn, string jobId) =>
    Convert.ToString(await DbUtil.ExecuteScalarAsync(conn, null, "select status from deck_publishes where job_id = $1", [jobId]), CultureInfo.InvariantCulture) ?? string.Empty;

  private static JsonElement Event(string path, string method, string[] groups)
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
              ["sub"] = "admin-sub",
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokeAsync(string method, string[] groups)
  {
    var req = new LambdaRequest(Event("/api/v1/admin/publish/reap", method, groups));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await PublishReaper.HandlePublishReap(req, res, auth);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  // ---- core reap ------------------------------------------------------------------------------

  [Fact]
  public async Task Reap_MarksStalePendingAndProcessingOnly()
  {
    await using var conn = await _db.OpenAsync();

    var stalePending = await SeedRowAsync(conn, "PENDING", createdMinutesAgo: 11);
    var freshPending = await SeedRowAsync(conn, "PENDING", createdMinutesAgo: 2);
    var staleProcessing = await SeedRowAsync(conn, "PROCESSING", updatedMinutesAgo: 31);
    var freshProcessing = await SeedRowAsync(conn, "PROCESSING", updatedMinutesAgo: 5);
    var success = await SeedRowAsync(conn, "SUCCESS", createdMinutesAgo: 60);
    var failed = await SeedRowAsync(conn, "FAILED", createdMinutesAgo: 60);

    var r = await PublishReaper.ReapOrphansAsync(conn);

    Assert.Equal(1, r.Pending);
    Assert.Equal(1, r.Processing);
    Assert.Equal(new[] { stalePending, staleProcessing }.OrderBy(x => x), r.JobIds.OrderBy(x => x));

    Assert.Equal("FAILED", await StatusOfAsync(conn, stalePending));
    Assert.Equal("FAILED", await StatusOfAsync(conn, staleProcessing));
    var msg = await DbUtil.ExecuteScalarAsync(conn, null, "select error_message from deck_publishes where job_id = $1", [stalePending]);
    Assert.Equal("orphaned: no worker pickup", Convert.ToString(msg, CultureInfo.InvariantCulture));

    // the other four rows are untouched
    Assert.Equal("PENDING", await StatusOfAsync(conn, freshPending));
    Assert.Equal("PROCESSING", await StatusOfAsync(conn, freshProcessing));
    Assert.Equal("SUCCESS", await StatusOfAsync(conn, success));
    Assert.Equal("FAILED", await StatusOfAsync(conn, failed));
  }

  [Fact]
  public async Task Reap_IsIdempotent()
  {
    await using var conn = await _db.OpenAsync();
    await SeedRowAsync(conn, "PENDING", createdMinutesAgo: 11);
    await SeedRowAsync(conn, "PROCESSING", updatedMinutesAgo: 31);

    await PublishReaper.ReapOrphansAsync(conn); // first reap fails them

    var second = await PublishReaper.ReapOrphansAsync(conn);
    Assert.Equal(0, second.Pending);
    Assert.Equal(0, second.Processing);
    Assert.Empty(second.JobIds);
  }

  [Fact]
  public async Task Reap_ReapedRowIsReacquirable()
  {
    await using var conn = await _db.OpenAsync();
    var jobId = await SeedRowAsync(conn, "PROCESSING", updatedMinutesAgo: 31);

    await PublishReaper.ReapOrphansAsync(conn);
    Assert.Equal("FAILED", await StatusOfAsync(conn, jobId));

    var acquired = await new JobRepository().TryAcquireJobAsync(jobId, 2);
    Assert.True(acquired);
    Assert.Equal("PROCESSING", await StatusOfAsync(conn, jobId));
  }

  // ---- route ----------------------------------------------------------------------------------

  [Fact]
  public async Task HandlePublishReap_ReturnsCounts()
  {
    await using var conn = await _db.OpenAsync();
    await SeedRowAsync(conn, "PENDING", createdMinutesAgo: 11);
    await SeedRowAsync(conn, "PROCESSING", updatedMinutesAgo: 31);

    var (status, doc) = await InvokeAsync("POST", new[] { "super_admin" });

    Assert.Equal(200, status);
    var data = doc.RootElement.GetProperty("data");
    var keys = data.EnumerateObject().Select(p => p.Name).ToArray();
    Assert.Contains("pending", keys);
    Assert.Contains("processing", keys);
    Assert.Contains("jobIds", keys);
    doc.Dispose();
  }

  [Fact]
  public async Task HandlePublishReap_RequiresSuperAdmin_403()
  {
    var (status, doc) = await InvokeAsync("POST", new[] { "editor" });
    Assert.Equal(403, status);
    doc.Dispose();
  }

  [Fact]
  public async Task HandlePublishReap_Get_405()
  {
    var (status, doc) = await InvokeAsync("GET", new[] { "super_admin" });
    Assert.Equal(405, status);
    doc.Dispose();
  }

  // ---- 23505 → 409 ----------------------------------------------------------------------------

  [Fact]
  public async Task Publish_SecondActiveRow_23505MapsTo409()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("dup");
    var deckId = await SeedDeckAsync(conn, slug);

    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PENDING')",
      [deckId, slug, "b1", "content/b1", Guid.NewGuid().ToString()]);

    var pg = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PENDING')",
      [deckId, slug, "b2", "content/b2", Guid.NewGuid().ToString()]));
    Assert.Equal("23505", pg.SqlState);

    var res = new Res("t");
    var mapped = Helpers.MapUniqueViolation409(pg, res);
    Assert.NotNull(mapped);
    Assert.Equal(409, mapped!.StatusCode);
    using (var doc = JsonDocument.Parse(mapped.Body ?? "{}"))
    {
      Assert.Equal("PUBLISH_IN_PROGRESS", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    Assert.Null(Helpers.MapUniqueViolation409(new InvalidOperationException("x"), res));
  }
}
