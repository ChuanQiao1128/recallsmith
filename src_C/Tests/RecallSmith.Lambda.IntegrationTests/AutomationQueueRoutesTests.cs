using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The console's authoring-queue routes (R18A A02, contract A00 §8.6): list with the status filter and the keyset
/// cursor, add a manual item (SA; 404 DECK_NOT_FOUND, 409 QUEUE_ITEM_EXISTS, url validation), skip a queued item and
/// the pre-034 503. Every test runs against this class's own scratch database migrated to the latest version (the
/// <c>PGDATABASE</c> switch, restored in <c>finally</c>), so the list sees only this class's items.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AutomationQueueRoutesTests
{
  private const string ScratchName = "it_a02_queue";
  private const string NotReadyName = "it_a02_queue_notready";
  private const string QueuePath = "/api/v1/admin/automation/queue";

  // A00 §8.6 QueueItem, in contract order.
  private static readonly string[] QueueItemKeys =
  [
    "itemId", "kind", "url", "title", "sectionHint", "note", "deckId", "deckSlug", "status", "attempts", "notBefore", "claimedByRunner",
    "claimedAt", "leaseExpiresAt", "lastRunId", "lastError", "sourceTargetId", "sourceEventId", "createdBy", "createdAt", "updatedAt", "finishedAt",
  ];

  private static readonly SemaphoreSlim ScratchGate = new(1, 1);
  private static string? _scratch;

  private readonly PostgresFixture _db;
  public AutomationQueueRoutesTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- scratch database

  private async Task<string> ScratchAsync()
  {
    await ScratchGate.WaitAsync();
    try
    {
      if (_scratch is null)
      {
        var cs = await _db.CreateScratchDatabaseAsync(ScratchName);
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
        _scratch = cs;
      }
      return _scratch;
    }
    finally
    {
      ScratchGate.Release();
    }
  }

  private async Task InScratchAsync(Func<Task> body, string database = ScratchName)
  {
    if (database == ScratchName) await ScratchAsync();

    var saved = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", database);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", saved);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  private async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    return await DbUtil.QueryAsync(conn, null, sql, parameters);
  }

  private async Task<object?> ScalarAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    return await DbUtil.ExecuteScalarAsync(conn, null, sql, parameters);
  }

  // ---------------------------------------------------------------- helpers

  private static string Sub() => $"it-a02-queue-{Guid.NewGuid():N}";
  private static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);
  private static string Url() => $"https://docs.example.com/a02/queue/{Guid.NewGuid():N}";

  private static AuthContext Ctx(string sub, bool superAdmin = true) => new(
    Claims: new Dictionary<string, JsonElement>(),
    UserSub: sub,
    Username: null,
    Groups: superAdmin ? ["super_admin"] : ["editor"],
    IsSuperAdmin: superAdmin,
    IsEditor: !superAdmin,
    IsAdmin: true,
    IsAgentClient: false);

  private static async Task<APIGatewayProxyResponse> CallAsync(string method, string path, object? body, AuthContext auth,
    IDictionary<string, string>? query = null, string? itemId = null)
  {
    var raw = body switch { null => null, string s => s, _ => JsonSerializer.Serialize(body) };
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers = new Dictionary<string, string> { ["content-type"] = "application/json" },
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body = raw,
      isBase64Encoded = false,
    }));
    var res = new Res(req.TraceId);
    return itemId is null ? await QueueRoutes.HandleQueue(req, res, auth) : await QueueRoutes.HandleSkip(req, res, auth, itemId);
  }

  private static Task<APIGatewayProxyResponse> ListAsync(Dictionary<string, string> query, AuthContext? auth = null) =>
    CallAsync("GET", QueuePath, null, auth ?? Ctx(Sub(), superAdmin: false), query);

  private static Task<APIGatewayProxyResponse> AddAsync(object body, AuthContext? auth = null) =>
    CallAsync("POST", QueuePath, body, auth ?? Ctx(Sub()));

  private static Task<APIGatewayProxyResponse> SkipAsync(string itemId, AuthContext? auth = null) =>
    CallAsync("POST", $"{QueuePath}/{itemId}/skip", null, auth ?? Ctx(Sub()), itemId: itemId);

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"expected 200, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static void AssertError(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    Assert.Equal(code, doc.RootElement.GetProperty("error").GetProperty("code").GetString());
  }

  private async Task<(long Id, string Slug)> NewDeckAsync(int isDeleted = 0)
  {
    var slug = $"it-a02-queue-{Guid.NewGuid():N}";
    var rows = await QueryAsync("insert into decks (slug, title, author, is_deleted) values ($1, $2, $3, $4) returning id",
      slug, "deck a02 queue", "tests", (short)isDeleted);
    return (Long(rows[0]["id"]), slug);
  }

  private async Task<long> NewItemAsync(long deckId, string status = "queued")
  {
    return Long(await ScalarAsync(
      """
      insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, finished_at, claimed_by_runner, claimed_at, lease_expires_at)
      values ('manual', $1, $2, $3, 'owner:it-a02', $4,
        case when $4 in ('done', 'failed', 'skipped') then now() end,
        case when $4 = 'claimed' then 'it-a02-runner' end,
        case when $4 = 'claimed' then now() end,
        case when $4 = 'claimed' then now() + interval '90 minutes' end)
      returning id
      """, Url(), deckId, $"test:{Guid.NewGuid()}", status));
  }

  private static List<long> Ids(JsonElement data) =>
    data.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("itemId").GetInt64()).ToList();

  // ---------------------------------------------------------------- list

  [Fact]
  public async Task ListQueue_FiltersByStatus_AndPaginates()
  {
    await InScratchAsync(async () =>
    {
      await ScalarAsync("delete from authoring_queue_items");
      var (deckId, slug) = await NewDeckAsync();
      var q1 = await NewItemAsync(deckId);
      var q2 = await NewItemAsync(deckId);
      var claimed = await NewItemAsync(deckId, "claimed");
      var q3 = await NewItemAsync(deckId);
      var done = await NewItemAsync(deckId, "done");
      var skipped = await NewItemAsync(deckId, "skipped");

      var page1 = Data(await ListAsync(new() { ["status"] = "queued", ["limit"] = "2" }));
      Assert.Equal([q3, q2], Ids(page1));
      var cursor = page1.GetProperty("nextCursor").GetString();
      Assert.False(string.IsNullOrEmpty(cursor));
      var page2 = Data(await ListAsync(new() { ["status"] = "queued", ["limit"] = "2", ["cursor"] = cursor! }));
      Assert.Equal([q1], Ids(page2));
      Assert.Equal(JsonValueKind.Null, page2.GetProperty("nextCursor").ValueKind);

      var all = Data(await ListAsync(new()));
      Assert.Equal([skipped, done, q3, claimed, q2, q1], Ids(all));
      Assert.Equal(JsonValueKind.Null, all.GetProperty("nextCursor").ValueKind);
      Assert.Equal([done], Ids(Data(await ListAsync(new() { ["status"] = "done" }))));
      Assert.Equal([claimed], Ids(Data(await ListAsync(new() { ["status"] = "claimed" }))));
      Assert.Equal([skipped], Ids(Data(await ListAsync(new() { ["status"] = "skipped" }))));
      Assert.Empty(Ids(Data(await ListAsync(new() { ["status"] = "failed" }))));

      var item = all.GetProperty("items").EnumerateArray().First(i => i.GetProperty("itemId").GetInt64() == claimed);
      Assert.Equal(QueueItemKeys, item.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal("manual", item.GetProperty("kind").GetString());
      Assert.Equal(deckId, item.GetProperty("deckId").GetInt64());
      Assert.Equal(slug, item.GetProperty("deckSlug").GetString());
      Assert.Equal("claimed", item.GetProperty("status").GetString());
      Assert.Equal("it-a02-runner", item.GetProperty("claimedByRunner").GetString());
      Assert.NotEqual(JsonValueKind.Null, item.GetProperty("leaseExpiresAt").ValueKind);
      Assert.Equal("owner:it-a02", item.GetProperty("createdBy").GetString());
      Assert.EndsWith("Z", item.GetProperty("createdAt").GetString());

      AssertError(await ListAsync(new() { ["status"] = "pending" }), 400, "VALIDATION_ERROR");
      AssertError(await ListAsync(new() { ["limit"] = "0" }), 400, "VALIDATION_ERROR");
      AssertError(await ListAsync(new() { ["limit"] = "101" }), 400, "VALIDATION_ERROR");
      AssertError(await ListAsync(new() { ["cursor"] = "not-a-cursor" }), 400, "VALIDATION_ERROR");
    });
  }

  // ---------------------------------------------------------------- add

  [Fact]
  public async Task AddQueueItem_SuperAdmin_CreatesManualItem()
  {
    await InScratchAsync(async () =>
    {
      var (deckId, slug) = await NewDeckAsync();
      var sub = Sub();
      var url = Url();

      var item = Data(await AddAsync(new { url, deckId, title = "Synthetic manual item", note = "synthetic note" }, Ctx(sub)));
      Assert.Equal(QueueItemKeys, item.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal("manual", item.GetProperty("kind").GetString());
      Assert.Equal(url, item.GetProperty("url").GetString());
      Assert.Equal(deckId, item.GetProperty("deckId").GetInt64());
      Assert.Equal(slug, item.GetProperty("deckSlug").GetString());
      Assert.Equal("Synthetic manual item", item.GetProperty("title").GetString());
      Assert.Equal("synthetic note", item.GetProperty("note").GetString());
      Assert.Equal("queued", item.GetProperty("status").GetString());
      Assert.Equal(0, item.GetProperty("attempts").GetInt32());
      Assert.Equal($"owner:{sub}", item.GetProperty("createdBy").GetString());
      Assert.Equal(JsonValueKind.Null, item.GetProperty("finishedAt").ValueKind);

      var dedupe = (string)(await ScalarAsync("select dedupe_key from authoring_queue_items where id = $1", item.GetProperty("itemId").GetInt64()))!;
      Assert.StartsWith("manual:", dedupe);
      Assert.True(Guid.TryParseExact(dedupe["manual:".Length..], "D", out _));

      // title and note are optional.
      var bare = Data(await AddAsync(new { url = Url(), deckId }));
      Assert.Equal(JsonValueKind.Null, bare.GetProperty("title").ValueKind);
      Assert.Equal(JsonValueKind.Null, bare.GetProperty("note").ValueKind);
    });
  }

  [Fact]
  public async Task AddQueueItem_Editor_Returns403()
  {
    await InScratchAsync(async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var url = Url();
      AssertError(await AddAsync(new { url, deckId }, Ctx(Sub(), superAdmin: false)), 403, "FORBIDDEN");
      Assert.Equal(0L, Long(await ScalarAsync("select count(*) from authoring_queue_items where url = $1", url)));

      var itemId = await NewItemAsync(deckId);
      AssertError(await SkipAsync(itemId.ToString(CultureInfo.InvariantCulture), Ctx(Sub(), superAdmin: false)), 403, "FORBIDDEN");
      Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
    });
  }

  [Fact]
  public async Task AddQueueItem_UnknownDeck_Returns404DeckNotFound()
  {
    await InScratchAsync(async () =>
    {
      var (deletedDeck, _) = await NewDeckAsync(isDeleted: 1);
      AssertError(await AddAsync(new { url = Url(), deckId = long.MaxValue - 7 }), 404, "DECK_NOT_FOUND");
      AssertError(await AddAsync(new { url = Url(), deckId = deletedDeck }), 404, "DECK_NOT_FOUND");
      Assert.Equal(0L, Long(await ScalarAsync("select count(*) from authoring_queue_items where deck_id = $1", deletedDeck)));
    });
  }

  [Fact]
  public async Task AddQueueItem_SameUrlAndDeckOpen_Returns409QueueItemExists()
  {
    await InScratchAsync(async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var (otherDeck, _) = await NewDeckAsync();
      var url = Url();

      var first = Data(await AddAsync(new { url, deckId })).GetProperty("itemId").GetInt64();
      AssertError(await AddAsync(new { url, deckId }), 409, "QUEUE_ITEM_EXISTS");
      Data(await AddAsync(new { url, deckId = otherDeck }));

      // A claimed item is open too.
      await ScalarAsync("update authoring_queue_items set status = 'claimed', claimed_at = now(), lease_expires_at = now() + interval '1 hour' where id = $1", first);
      AssertError(await AddAsync(new { url, deckId }), 409, "QUEUE_ITEM_EXISTS");

      // Once it is finished, the url can be queued again.
      await ScalarAsync("update authoring_queue_items set status = 'done', lease_expires_at = null, finished_at = now() where id = $1", first);
      Data(await AddAsync(new { url, deckId }));

      // Concurrent adds of one pair: exactly one wins.
      var raced = Url();
      var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Task.Run(() => AddAsync(new { url = raced, deckId }))));
      Assert.Equal(1, responses.Count(r => r.StatusCode == 200));
      Assert.All(responses.Where(r => r.StatusCode != 200), r => AssertError(r, 409, "QUEUE_ITEM_EXISTS"));
      Assert.Equal(1L, Long(await ScalarAsync("select count(*) from authoring_queue_items where url = $1", raced)));
    });
  }

  [Fact]
  public async Task AddQueueItem_InvalidUrl_Returns400ValidationError()
  {
    await InScratchAsync(async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var bodies = new object[]
      {
        new { url = "http://docs.example.com/a02", deckId },
        new { url = "ftp://docs.example.com/a02", deckId },
        new { url = "not a url", deckId },
        new { url = "https://", deckId },
        new { url = "https://docs.example.com/" + new string('a', 2048), deckId },
        new { url = 42, deckId },
        new { deckId },
        new { url = Url() },
        new { url = Url(), deckId = "1" },
        new { url = Url(), deckId, title = new string('t', 301) },
        new { url = Url(), deckId, note = new string('n', 501) },
      };
      foreach (var body in bodies) AssertError(await AddAsync(body), 400, "VALIDATION_ERROR");
      AssertError(await AddAsync("{not json"), 400, "BAD_REQUEST");
      Assert.Equal(0L, Long(await ScalarAsync("select count(*) from authoring_queue_items where deck_id = $1", deckId)));
    });
  }

  // ---------------------------------------------------------------- skip

  [Fact]
  public async Task SkipQueueItem_Queued_IsSkipped()
  {
    await InScratchAsync(async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);

      var item = Data(await SkipAsync(itemId.ToString(CultureInfo.InvariantCulture)));
      Assert.Equal(QueueItemKeys, item.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(itemId, item.GetProperty("itemId").GetInt64());
      Assert.Equal("skipped", item.GetProperty("status").GetString());
      Assert.NotEqual(JsonValueKind.Null, item.GetProperty("finishedAt").ValueKind);

      var row = Assert.Single(await QueryAsync("select status, finished_at from authoring_queue_items where id = $1", itemId));
      Assert.Equal("skipped", row["status"]);
      Assert.NotNull(row["finished_at"]);
    });
  }

  [Fact]
  public async Task SkipQueueItem_NotQueued_Returns409QueueItemNotQueued()
  {
    await InScratchAsync(async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      foreach (var status in new[] { "claimed", "done", "failed", "skipped" })
      {
        var itemId = await NewItemAsync(deckId, status);
        AssertError(await SkipAsync(itemId.ToString(CultureInfo.InvariantCulture)), 409, "QUEUE_ITEM_NOT_QUEUED");
        Assert.Equal(status, await ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
      }
    });
  }

  [Fact]
  public async Task SkipQueueItem_Unknown_Returns404QueueItemNotFound()
  {
    await InScratchAsync(async () =>
    {
      AssertError(await SkipAsync((long.MaxValue - 11).ToString(CultureInfo.InvariantCulture)), 404, "QUEUE_ITEM_NOT_FOUND");
      AssertError(await SkipAsync("abc"), 404, "QUEUE_ITEM_NOT_FOUND");
      AssertError(await SkipAsync("-1"), 404, "QUEUE_ITEM_NOT_FOUND");
      AssertError(await SkipAsync("0"), 404, "QUEUE_ITEM_NOT_FOUND");
    });
  }

  // ---------------------------------------------------------------- schema not ready

  [Fact]
  public async Task QueueRoutes_MissingTables_Return503ServerNotReadyAutomation()
  {
    var cs = await _db.CreateScratchDatabaseAsync(NotReadyName);
    long deckId;
    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 33);
      deckId = Long(await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author) values ($1, $2, $3) returning id", [$"it-a02-notready-{Guid.NewGuid():N}", "deck a02", "tests"]));
    }

    await InScratchAsync(async () =>
    {
      AssertError(await ListAsync(new()), 503, "SERVER_NOT_READY_AUTOMATION");
      AssertError(await AddAsync(new { url = Url(), deckId }), 503, "SERVER_NOT_READY_AUTOMATION");
      AssertError(await SkipAsync("1"), 503, "SERVER_NOT_READY_AUTOMATION");
    }, NotReadyName);
  }
}
