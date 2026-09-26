using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// CBE-13 (F07): once a deck has a SUCCESS or in-flight publish, its slug is the key of builds,
/// patches and every device's progress, so a super_admin's PUT that renames it answers
/// 409 SLUG_LOCKED. The two readers that look up "the latest SUCCESS build of this deck" now key
/// on deck_id, not the slug, so a historical rename can no longer hide a deck's builds. Driven
/// through JWT authorizer claims exactly as API Gateway delivers them, against a real Postgres;
/// the manifest rebuild is a no-op stub (ManifestRebuildFn) so no S3 call happens.
/// </summary>
[Collection(PostgresCollection.Name)]
public class SlugLockTests
{
  private readonly PostgresFixture _db;
  public SlugLockTests(PostgresFixture db) => _db = db;

  private const string DecksPath = "/api/v1/authoring/decks";
  private const string AdminDecksPath = "/api/v1/admin/decks";

  private static string Slug(string tag) => $"it-f07-{tag}-{Guid.NewGuid():N}";

  private static readonly DeckRollback.ManifestRebuildFn NoopRebuild =
    _ => Task.FromResult(new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1));

  private static JsonElement Event(string path, string method, IDictionary<string, string>? query, string? body)
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
              ["sub"] = "it-f07-admin",
              ["cognito:groups"] = new[] { "super_admin" },
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

  private static async Task<(int Status, JsonDocument Doc)> PutDeckAsync(object body)
  {
    var req = new LambdaRequest(Event(DecksPath, "PUT", null, JsonSerializer.Serialize(body)));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await Decks.HandleAuthoringDecks(req, res, auth, NoopRebuild);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private static async Task<(int Status, JsonDocument Doc)> GetAdminDecksAsync(string q)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["q"] = q };
    var req = new LambdaRequest(Event(AdminDecksPath, "GET", query, null));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await AdminDecks.HandleAdminDecks(req, res, auth);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private async Task<long> SeedDeckAsync(string slug)
  {
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      slug, "deck f07", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private Task SeedPublishAsync(long deckId, string deckSlug, string buildId, string status, DateTimeOffset createdAt) =>
    _db.QueryAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
      deckId, deckSlug, buildId, $"content/{buildId}", Guid.NewGuid().ToString(), status, createdAt);

  private async Task<string?> DbSlugAsync(long deckId) =>
    Convert.ToString(await _db.ScalarAsync("select slug from decks where id = $1", deckId), CultureInfo.InvariantCulture);

  private static string? ErrorCode(JsonDocument doc) =>
    doc.RootElement.GetProperty("error").GetProperty("code").GetString();

  // ---- SLUG_LOCKED (PUT) ----------------------------------------------------------------------

  [Fact]
  public async Task SlugRename_AfterSuccessfulPublish_Is409SlugLocked()
  {
    var slug = Slug("succ");
    var deckId = await SeedDeckAsync(slug);
    await SeedPublishAsync(deckId, slug, "b-succ", "SUCCESS", DateTimeOffset.UtcNow);

    var newSlug = Slug("succ2");
    var (status, doc) = await PutDeckAsync(new { id = deckId, slug = newSlug });

    Assert.Equal(409, status);
    Assert.Equal("SLUG_LOCKED", ErrorCode(doc));
    Assert.Equal(slug, await DbSlugAsync(deckId));
    doc.Dispose();
  }

  [Fact]
  public async Task SlugRename_WhileAPublishIsPending_Is409SlugLocked()
  {
    var slug = Slug("pend");
    var deckId = await SeedDeckAsync(slug);
    await SeedPublishAsync(deckId, slug, "b-pend", "PENDING", DateTimeOffset.UtcNow);

    var newSlug = Slug("pend2");
    var (status, doc) = await PutDeckAsync(new { id = deckId, slug = newSlug });

    Assert.Equal(409, status);
    Assert.Equal("SLUG_LOCKED", ErrorCode(doc));
    Assert.Equal(slug, await DbSlugAsync(deckId));
    doc.Dispose();
  }

  [Fact]
  public async Task SlugRename_OnNeverPublishedDeck_Is200()
  {
    var slug = Slug("never");
    var deckId = await SeedDeckAsync(slug);
    // A FAILED publish does not lock the slug.
    await SeedPublishAsync(deckId, slug, "b-failed", "FAILED", DateTimeOffset.UtcNow);

    var newSlug = Slug("never2");
    var (status, doc) = await PutDeckAsync(new { id = deckId, slug = newSlug });

    Assert.True(status == 200, $"expected 200, got {status}: {doc.RootElement}");
    Assert.Equal(newSlug, await DbSlugAsync(deckId));
    doc.Dispose();
  }

  [Fact]
  public async Task PutWithUnchangedSlug_OnPublishedDeck_Is200()
  {
    var slug = Slug("same");
    var deckId = await SeedDeckAsync(slug);
    await SeedPublishAsync(deckId, slug, "b-same", "SUCCESS", DateTimeOffset.UtcNow);

    // The console (post-F20) resends every field on save, so an unchanged slug arrives on each PUT.
    var (status, doc) = await PutDeckAsync(new { id = deckId, slug, title = "t2" });

    Assert.True(status == 200, $"expected 200, got {status}: {doc.RootElement}");
    Assert.Equal(slug, await DbSlugAsync(deckId));
    var title = Convert.ToString(await _db.ScalarAsync("select title from decks where id = $1", deckId), CultureInfo.InvariantCulture);
    Assert.Equal("t2", title);
    doc.Dispose();
  }

  // ---- deck_id join, not slug -----------------------------------------------------------------

  [Fact]
  public async Task AdminDecks_LatestBuildId_FollowsDeckIdNotSlug()
  {
    var slug = Slug("admbid");
    var deckId = await SeedDeckAsync(slug);
    // Both SUCCESS rows carry a historical (renamed-away) deck_slug, unlike the deck's current slug.
    var baseTime = DateTimeOffset.UtcNow.AddMinutes(-10);
    await SeedPublishAsync(deckId, $"{slug}-old1", "b-older", "SUCCESS", baseTime);
    await SeedPublishAsync(deckId, $"{slug}-old2", "b-newer", "SUCCESS", baseTime.AddSeconds(30));

    var (status, doc) = await GetAdminDecksAsync(slug);

    Assert.Equal(200, status);
    var items = doc.RootElement.GetProperty("data").GetProperty("items");
    var item = items.EnumerateArray().Single(i => i.GetProperty("slug").GetString() == slug);
    Assert.Equal("b-newer", item.GetProperty("latestBuildId").GetString());
    doc.Dispose();
  }

  [Fact]
  public async Task ArtifactsRepository_LatestSuccessBuild_FollowsDeckId()
  {
    var slug = Slug("artid");
    var deckId = await SeedDeckAsync(slug);
    var baseTime = DateTimeOffset.UtcNow.AddMinutes(-10);
    // All of deck X's rows carry deck_slug values unlike its current slug (historical renames).
    await SeedPublishAsync(deckId, $"{slug}-h1", "b-older", "SUCCESS", baseTime);
    await SeedPublishAsync(deckId, $"{slug}-h2", "b-newer", "SUCCESS", baseTime.AddSeconds(30));
    await SeedPublishAsync(deckId, $"{slug}-h3", "b-failed", "FAILED", baseTime.AddSeconds(60));

    // A SUCCESS row of a different deck must not leak in.
    var otherSlug = Slug("artoth");
    var otherId = await SeedDeckAsync(otherSlug);
    await SeedPublishAsync(otherId, otherSlug, "b-other", "SUCCESS", baseTime.AddSeconds(90));

    var prev = await new ContentArtifactsRepository().GetLatestSuccessBuildAsync(deckId);

    Assert.NotNull(prev);
    Assert.Equal("b-newer", prev!.BuildId);
    Assert.Equal("content/b-newer", prev.S3Key);
  }
}
