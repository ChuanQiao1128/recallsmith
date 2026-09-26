using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The console's deck PUT/DELETE rebuild manifest.json in-process, but only when a column the
/// manifest reads actually changed, and never when a slug or tier change on a published deck would
/// point live phones at S3 objects that do not exist yet (REPUBLISH_REQUIRED). The rebuild is a
/// counting stub (ManifestRebuildFn) so the endpoint's DB effects and rebuild decision are observed
/// without touching S3; a rebuild that throws still leaves a 200 with the DB write intact.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DeckManifestRebuildTests
{
  private readonly PostgresFixture _db;
  public DeckManifestRebuildTests(PostgresFixture db) => _db = db;

  private const string DecksPath = "/api/v1/authoring/decks";

  private static JsonElement Event(string method, IDictionary<string, string>? query, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = DecksPath,
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
              ["sub"] = "it-f02-admin",
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

  private sealed class RebuildStub
  {
    public int Calls;
    public bool Throw;
    public DeckRollback.ManifestRebuildFn Fn => _ =>
    {
      Calls++;
      if (Throw) throw new InvalidOperationException("s3 down");
      return Task.FromResult(new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1));
    };
  }

  private static async Task<APIGatewayProxyResponse> InvokeAsync(string method, IDictionary<string, string>? query, string? body, RebuildStub stub)
  {
    var req = new LambdaRequest(Event(method, query, body));
    var res = new Res(req.TraceId);
    return await Decks.HandleAuthoringDecks(req, res, await Auth.GetAuthContextAsync(req), stub.Fn);
  }

  private async Task<(long Id, string Slug)> SeedDeckAsync(string? liveBuildId = null)
  {
    var slug = $"it-f02-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      slug, "deck f02", "tests");
    var id = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
    if (liveBuildId is not null)
    {
      await _db.ScalarAsync("update decks set live_build_id = $2 where id = $1", id, liveBuildId);
    }
    return (id, slug);
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  // ---- PUT ------------------------------------------------------------------------------------

  [Fact]
  public async Task Put_ManifestOrderChange_RebuildsManifestOnce()
  {
    var (id, _) = await SeedDeckAsync();
    var stub = new RebuildStub();

    var resp = await InvokeAsync("PUT", null, JsonSerializer.Serialize(new { id, manifestOrder = 7 }), stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.Equal(7, data.GetProperty("manifestOrder").GetInt32());
    Assert.True(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal(JsonValueKind.Null, data.GetProperty("manifestNote").ValueKind);
    Assert.Equal(1, stub.Calls);
  }

  [Fact]
  public async Task Put_DescriptionOnly_DoesNotRebuild()
  {
    var (id, _) = await SeedDeckAsync();
    var stub = new RebuildStub();

    var resp = await InvokeAsync("PUT", null, JsonSerializer.Serialize(new { id, description = "d2" }), stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.False(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal("NO_MANIFEST_CHANGE", data.GetProperty("manifestNote").GetString());
    Assert.Equal(0, stub.Calls);
  }

  [Fact]
  public async Task Put_UnchangedFullFormResave_DoesNotRebuild()
  {
    var (id, slug) = await SeedDeckAsync();
    var stub = new RebuildStub();

    var body = JsonSerializer.Serialize(new
    {
      id,
      slug,
      title = "deck f02",
      description = (string?)null,
      manifestOrder = 1000,
      availability = "live",
      tier = "free",
      eta = (string?)null,
      retiredAtMs = (long?)null,
      totalCards = 0,
      previewCards = (int?)null,
    });
    var resp = await InvokeAsync("PUT", null, body, stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.False(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal("NO_MANIFEST_CHANGE", data.GetProperty("manifestNote").GetString());
    Assert.Equal(0, stub.Calls);
  }

  [Fact]
  public async Task Put_TierFlipOnPublishedDeck_SkipsRebuild()
  {
    var (id, _) = await SeedDeckAsync(liveBuildId: "b-f02-live");
    var stub = new RebuildStub();

    var resp = await InvokeAsync("PUT", null, JsonSerializer.Serialize(new { id, tier = "premium" }), stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.False(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal("REPUBLISH_REQUIRED", data.GetProperty("manifestNote").GetString());
    Assert.Equal(0, stub.Calls);

    var tier = await _db.ScalarAsync("select tier from decks where id = $1", id);
    Assert.Equal("premium", Convert.ToString(tier, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Put_TierFlipOnUnpublishedDeck_Rebuilds()
  {
    var (id, _) = await SeedDeckAsync();
    var stub = new RebuildStub();

    var resp = await InvokeAsync("PUT", null, JsonSerializer.Serialize(new { id, tier = "premium" }), stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.True(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal(1, stub.Calls);
  }

  [Fact]
  public async Task Put_RebuildThrows_Is200WithRebuildFailed()
  {
    var (id, _) = await SeedDeckAsync();
    var stub = new RebuildStub { Throw = true };

    var resp = await InvokeAsync("PUT", null, JsonSerializer.Serialize(new { id, manifestOrder = 8 }), stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.False(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal("REBUILD_FAILED", data.GetProperty("manifestNote").GetString());

    var order = await _db.ScalarAsync("select manifest_order from decks where id = $1", id);
    Assert.Equal(8, Convert.ToInt32(order, CultureInfo.InvariantCulture));
  }

  // ---- DELETE ---------------------------------------------------------------------------------

  [Fact]
  public async Task Delete_RebuildsManifest()
  {
    var (id, _) = await SeedDeckAsync();
    var stub = new RebuildStub();

    var resp = await InvokeAsync("DELETE", new Dictionary<string, string> { ["id"] = id.ToString(CultureInfo.InvariantCulture) }, null, stub);

    Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.Equal(id, data.GetProperty("id").GetInt64());
    Assert.True(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal(1, stub.Calls);

    var isDeleted = await _db.ScalarAsync("select is_deleted from decks where id = $1", id);
    Assert.Equal(1, Convert.ToInt32(isDeleted, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Delete_UnknownDeck_Is404WithoutRebuild()
  {
    var stub = new RebuildStub();

    var resp = await InvokeAsync("DELETE", new Dictionary<string, string> { ["id"] = "999999999" }, null, stub);

    Assert.Equal(404, resp.StatusCode);
    Assert.Equal(0, stub.Calls);
  }

  // ---- default rebuild without a bucket -------------------------------------------------------

  [Fact]
  public async Task DefaultRebuild_WithoutContentBucket_ReportsRebuildFailed()
  {
    var (id, _) = await SeedDeckAsync();
    var saved = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    try
    {
      Environment.SetEnvironmentVariable("CONTENT_BUCKET", null);

      var req = new LambdaRequest(Event("PUT", null, JsonSerializer.Serialize(new { id, manifestOrder = 9 })));
      var res = new Res(req.TraceId);
      // The 3-argument overload wires DefaultManifestRebuildAsync, which reads CONTENT_BUCKET at call time.
      var resp = await Decks.HandleAuthoringDecks(req, res, await Auth.GetAuthContextAsync(req));

      Assert.True(resp.StatusCode == 200, $"expected 200, got {resp.StatusCode}: {resp.Body}");
      var data = Data(resp);
      Assert.False(data.GetProperty("manifestRebuilt").GetBoolean());
      Assert.Equal("REBUILD_FAILED", data.GetProperty("manifestNote").GetString());
    }
    finally
    {
      Environment.SetEnvironmentVariable("CONTENT_BUCKET", saved);
    }
  }

  // ---- DeliveryChanged (pure) -----------------------------------------------------------------

  [Fact]
  public void DeliveryChanged_RequiresALiveBuild()
  {
    static IReadOnlyDictionary<string, object?> Row(string? liveBuildId, string slug, string tier) =>
      new Dictionary<string, object?>(StringComparer.Ordinal)
      {
        ["liveBuildId"] = liveBuildId,
        ["slug"] = slug,
        ["tier"] = tier,
      };

    // A tier change with no live build is safe to rebuild.
    Assert.False(Decks.DeliveryChanged(Row(null, "s", "free"), Row(null, "s", "premium")));
    // With a live build, a tier change would strand phones on missing S3 objects.
    Assert.True(Decks.DeliveryChanged(Row("b1", "s", "free"), Row("b1", "s", "premium")));
    // No delivery-affecting change: same slug and tier.
    Assert.False(Decks.DeliveryChanged(Row("b1", "s", "free"), Row("b1", "s", "free")));
    // A slug change on a published deck also requires a republish.
    Assert.True(Decks.DeliveryChanged(Row("b1", "s", "free"), Row("b1", "s2", "free")));
  }
}
