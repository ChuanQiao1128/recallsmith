using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// ManifestBuilder against a real Postgres: the golden document shape (byte-compatible with the
/// old ManifestRebuild writer), the live-pointer precedence, migration 021's backfill + partial
/// index + stale-row reap, CompleteJobAsync moving the pointer, and the redelivery take-over rule
/// baked into TryAcquireJobAsync. The pure NormalizePrefix rules are a table.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ManifestBuilderTests
{
  private readonly PostgresFixture _db;
  public ManifestBuilderTests(PostgresFixture db) => _db = db;

  private const long Gen = 1700000000000L;

  private static readonly string[] ExpectedTopKeys = { "schemaVersion", "prefix", "generatedAtMs", "decks" };
  private static readonly string[] ExpectedDeckKeys =
  {
    "order", "slug", "title", "locale", "deckType", "tier", "availability", "retiredAtMs", "eta",
    "downloadMode", "totalCards", "version", "buildId", "path", "sha256", "packagePath",
    "previewCards", "previewVersion", "previewBuildId", "previewPath", "previewSha256",
    "patches", "previewPatches",
  };

  private static string Slug(string tag) => $"it-e03-{tag}-{Guid.NewGuid():N}";

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug, string tier = "free", string availability = "live", int totalCards = 3, int? previewCards = null)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author, tier, availability, total_cards, preview_cards) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [slug, "deck a", "tests", tier, availability, totalCards, (object?)previewCards]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static async Task SeedSuccessAsync(NpgsqlConnection conn, long deckId, string slug, string buildId, string? sha256 = null, string? packageKey = null, int createdMinutesAgo = 0)
  {
    var sql = $"""
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, content_sha256, package_key, created_at, updated_at)
      values ($1, $2, $3, $4, $5, 'SUCCESS', $6, $7, now() - interval '{createdMinutesAgo} minutes', now())
      """;
    await DbUtil.ExecuteAsync(conn, null, sql,
      [deckId, slug, buildId, $"content/decks/{slug}/builds/{buildId}/deck.json", Guid.NewGuid().ToString(), (object?)sha256, (object?)packageKey]);
  }

  private static async Task SeedPatchAsync(NpgsqlConnection conn, string slug, string fromB, string toB, string relPath, string sha256, int createdMinutesAgo)
  {
    var sql = $"""
      insert into deck_build_patches (deck_slug, from_build_id, to_build_id, rel_path, s3_key, sha256, bytes, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, now() - interval '{createdMinutesAgo} minutes')
      """;
    await DbUtil.ExecuteAsync(conn, null, sql, [slug, fromB, toB, relPath, $"content/{relPath}", sha256, 100L]);
  }

  private static async Task<JsonDocument> BuildDocAsync(NpgsqlConnection conn)
  {
    var body = await ManifestBuilder.BuildAsync(conn, "content", Gen);
    return JsonDocument.Parse(body.Json);
  }

  private static JsonElement FindDeck(JsonElement root, string slug) =>
    root.GetProperty("decks").EnumerateArray().First(d => d.GetProperty("slug").GetString() == slug);

  private static async Task ApplyMigrationFileAsync(NpgsqlConnection conn, string fileName)
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", fileName);
    var sql = await File.ReadAllTextAsync(path);
    await DbUtil.ExecuteAsync(conn, null, sql, []);
  }

  // ---- golden shape & pointer precedence -----------------------------------------------------

  [Fact]
  public async Task Build_GoldenShape_PinsKeyOrder()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("golden");
    var deckId = await SeedDeckAsync(conn, slug);
    var build = "b-golden-1";
    await SeedSuccessAsync(conn, deckId, slug, build, sha256: "sha-golden", packageKey: "content/pkg.json");
    await SeedPatchAsync(conn, slug, "b-prev", build, $"decks/{slug}/patches/x.bin", "sha-patch", createdMinutesAgo: 0);

    using var doc = await BuildDocAsync(conn);
    var root = doc.RootElement;

    Assert.Equal(ExpectedTopKeys, root.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(2, root.GetProperty("schemaVersion").GetInt32());
    Assert.Equal(Gen, root.GetProperty("generatedAtMs").GetInt64());
    Assert.Equal("content", root.GetProperty("prefix").GetString());

    var deck = FindDeck(root, slug);
    Assert.Equal(ExpectedDeckKeys, deck.EnumerateObject().Select(p => p.Name).ToArray());

    var patch = Assert.Single(deck.GetProperty("patches").EnumerateArray());
    Assert.Equal(new[] { "fromVersion", "toVersion", "path", "sha256" }, patch.EnumerateObject().Select(p => p.Name).ToArray());
  }

  [Fact]
  public async Task Build_LivePointer_WinsOverNewestSuccess()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("pointer");
    var deckId = await SeedDeckAsync(conn, slug);
    var older = "b-old";
    var newer = "b-new";
    await SeedSuccessAsync(conn, deckId, slug, older, sha256: "sha-old", packageKey: "content/pkg-old.json", createdMinutesAgo: 60);
    await SeedSuccessAsync(conn, deckId, slug, newer, sha256: "sha-new", packageKey: "content/pkg-new.json", createdMinutesAgo: 0);
    await DbUtil.ExecuteAsync(conn, null, "update decks set live_build_id = $2 where id = $1", [deckId, older]);

    using var doc = await BuildDocAsync(conn);
    var deck = FindDeck(doc.RootElement, slug);

    Assert.Equal(older, deck.GetProperty("buildId").GetString());
    Assert.Equal(older, deck.GetProperty("version").GetString());
    Assert.Contains(older, deck.GetProperty("path").GetString());
    Assert.Equal("sha-old", deck.GetProperty("sha256").GetString());
    Assert.Equal("content/pkg-old.json", deck.GetProperty("packagePath").GetString());
  }

  [Fact]
  public async Task Build_NullPointer_FallsBackToNewestSuccess()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("nullptr");
    var deckId = await SeedDeckAsync(conn, slug);
    await SeedSuccessAsync(conn, deckId, slug, "b-old", sha256: "sha-old", createdMinutesAgo: 60);
    await SeedSuccessAsync(conn, deckId, slug, "b-new", sha256: "sha-new", createdMinutesAgo: 0);
    // live_build_id left null

    using var doc = await BuildDocAsync(conn);
    var deck = FindDeck(doc.RootElement, slug);

    Assert.Equal("b-new", deck.GetProperty("buildId").GetString());
  }

  [Fact]
  public async Task Build_LiveDeckWithoutSuccess_IsOmitted()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("draft");
    await SeedDeckAsync(conn, slug); // live but no SUCCESS build → draft, filtered out

    using var doc = await BuildDocAsync(conn);
    var present = doc.RootElement.GetProperty("decks").EnumerateArray().Any(d => d.GetProperty("slug").GetString() == slug);
    Assert.False(present);
  }

  [Fact]
  public async Task Build_PremiumDeck_CarriesPreviewFieldsOnly()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("premium");
    var deckId = await SeedDeckAsync(conn, slug, tier: "premium", previewCards: 5);
    var build = "b-prem-1";
    await SeedSuccessAsync(conn, deckId, slug, build, sha256: "sha-prem", packageKey: "content/pkg.json");

    using var doc = await BuildDocAsync(conn);
    var deck = FindDeck(doc.RootElement, slug);

    Assert.Equal(JsonValueKind.Null, deck.GetProperty("path").ValueKind);
    Assert.Equal(build + "-preview", deck.GetProperty("previewBuildId").GetString());
    Assert.Equal(JsonValueKind.String, deck.GetProperty("previewPath").ValueKind);
    Assert.Equal(JsonValueKind.Null, deck.GetProperty("sha256").ValueKind);
    Assert.Equal(JsonValueKind.Null, deck.GetProperty("packagePath").ValueKind);
    Assert.Equal(JsonValueKind.Null, deck.GetProperty("patches").ValueKind);
  }

  [Fact]
  public async Task Build_PatchEdges_NewestFourPerSlug()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("patches");
    var deckId = await SeedDeckAsync(conn, slug);
    await SeedSuccessAsync(conn, deckId, slug, "b-patch", sha256: "sha", packageKey: "content/pkg.json");

    // e1 oldest (6 min ago) .. e6 newest (1 min ago)
    for (var i = 1; i <= 6; i++)
    {
      await SeedPatchAsync(conn, slug, $"e{i}", $"t{i}", $"decks/{slug}/patches/p{i}.bin", $"sha{i}", createdMinutesAgo: 7 - i);
    }

    using var doc = await BuildDocAsync(conn);
    var deck = FindDeck(doc.RootElement, slug);

    var fromVersions = deck.GetProperty("patches").EnumerateArray().Select(p => p.GetProperty("fromVersion").GetString()).ToArray();
    Assert.Equal(new[] { "e6", "e5", "e4", "e3" }, fromVersions);
  }

  // ---- migration 021 --------------------------------------------------------------------------

  [Fact]
  public async Task Migration021_BackfillsPointerAndAddsPartialIndex()
  {
    var cs = await _db.CreateScratchDatabaseAsync("e03_mig021");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 20);

    var slug = Slug("mig021");
    var deckId = await SeedDeckAsync(conn, slug);
    await SeedSuccessAsync(conn, deckId, slug, "b1", createdMinutesAgo: 60);
    await SeedSuccessAsync(conn, deckId, slug, "b2", createdMinutesAgo: 0);

    await ApplyMigrationFileAsync(conn, "021_decks_live_build_id.sql");

    var pointer = await DbUtil.ExecuteScalarAsync(conn, null, "select live_build_id from decks where id = $1", [deckId]);
    Assert.Equal("b2", Convert.ToString(pointer, CultureInfo.InvariantCulture));

    var idx = await DbUtil.ExecuteScalarAsync(conn, null, "select 1 from pg_indexes where indexname = 'uq_deck_publishes_active'", []);
    Assert.NotNull(idx);

    // one PENDING is fine, a second active row for the same deck violates the partial unique index
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PENDING')",
      [deckId, slug, "b3", "s3/b3", Guid.NewGuid().ToString()]);

    var ex = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PENDING')",
      [deckId, slug, "b4", "s3/b4", Guid.NewGuid().ToString()]));
    Assert.Equal("23505", ex.SqlState);
    Assert.Equal("uq_deck_publishes_active", ex.ConstraintName);
  }

  [Fact]
  public async Task Migration021_ReapsStaleActiveRowsBeforeIndex()
  {
    var cs = await _db.CreateScratchDatabaseAsync("e03_mig021b");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 20);

    var slug = Slug("mig021b");
    var deckId = await SeedDeckAsync(conn, slug);

    var staleJob = Guid.NewGuid().ToString();
    var freshJob = Guid.NewGuid().ToString();
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, updated_at) values ($1,$2,$3,$4,$5,'PENDING', now() - interval '40 minutes')",
      [deckId, slug, "b-stale", "s3/stale", staleJob]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, updated_at) values ($1,$2,$3,$4,$5,'PENDING', now())",
      [deckId, slug, "b-fresh", "s3/fresh", freshJob]);

    await ApplyMigrationFileAsync(conn, "021_decks_live_build_id.sql");

    var staleRows = await DbUtil.QueryAsync(conn, null, "select status, error_message from deck_publishes where job_id = $1", [staleJob]);
    Assert.Equal("FAILED", Convert.ToString(staleRows[0]["status"], CultureInfo.InvariantCulture));
    Assert.Equal("orphaned: pre-021 stale active row", Convert.ToString(staleRows[0]["error_message"], CultureInfo.InvariantCulture));

    var freshStatus = await DbUtil.ExecuteScalarAsync(conn, null, "select status from deck_publishes where job_id = $1", [freshJob]);
    Assert.Equal("PENDING", Convert.ToString(freshStatus, CultureInfo.InvariantCulture));
  }

  // ---- CompleteJobAsync moves the pointer -----------------------------------------------------

  [Fact]
  public async Task CompleteJob_SetsSuccessAndMovesPointer()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("complete");
    var deckId = await SeedDeckAsync(conn, slug);
    var build = "b-complete";
    var jobId = Guid.NewGuid().ToString();
    await DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,'PROCESSING')",
      [deckId, slug, build, "s3/complete", jobId]);

    await new JobRepository().CompleteJobAsync(jobId);

    var status = await DbUtil.ExecuteScalarAsync(conn, null, "select status from deck_publishes where job_id = $1", [jobId]);
    Assert.Equal("SUCCESS", Convert.ToString(status, CultureInfo.InvariantCulture));

    var pointer = await DbUtil.ExecuteScalarAsync(conn, null, "select live_build_id from decks where id = $1", [deckId]);
    Assert.Equal(build, Convert.ToString(pointer, CultureInfo.InvariantCulture));
  }

  // ---- redelivery take-over rule ---------------------------------------------------------------

  [Theory]
  [InlineData(1, 5, false)]
  [InlineData(2, 5, false)]
  [InlineData(2, 12, true)]
  [InlineData(1, 12, false)]
  [InlineData(1, 16, true)]
  [InlineData(3, 0, false)]
  public async Task TryAcquire_RedeliveryTakesOverOnlyStaleProcessing(int receiveCount, int minutesStale, bool expected)
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("acquire");
    var deckId = await SeedDeckAsync(conn, slug);
    var jobId = Guid.NewGuid().ToString();
    var sql = $"""
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, updated_at)
      values ($1, $2, $3, $4, $5, 'PROCESSING', now() - interval '{minutesStale} minutes')
      """;
    await DbUtil.ExecuteAsync(conn, null, sql, [deckId, slug, "b-acq", "s3/acq", jobId]);

    var acquired = await new JobRepository().TryAcquireJobAsync(jobId, receiveCount);
    Assert.Equal(expected, acquired);
  }

  // ---- NormalizePrefix (pure) ------------------------------------------------------------------

  [Theory]
  [InlineData(null, "content", "content")]
  [InlineData("/x/", "content", "x")]
  [InlineData("  ", "content", "content")]
  [InlineData("a/b", "content", "a/b")]
  public void NormalizePrefix_Table(string? raw, string fallback, string expected)
  {
    Assert.Equal(expected, ManifestBuilder.NormalizePrefix(raw, fallback));
  }
}
