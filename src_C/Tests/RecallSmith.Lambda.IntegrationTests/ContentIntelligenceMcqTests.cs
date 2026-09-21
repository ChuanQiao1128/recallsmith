using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Content Intelligence's MCQ partition (C13) against a real Postgres.
///
/// Two claims here are only claims about a live planner. That the live query
/// stops feeding an MCQ card's answers into the Q/A baselines is a property of
/// the `and c.mcq is null` predicate the planner applies to real rows, and that
/// the count is scoped by deck and read permission is a property of the join it
/// runs — neither is decidable from the C# that builds the SQL. And the 42703
/// fallback is exercised for real against a database frozen at migration 018,
/// where the `cards.mcq` column genuinely does not exist.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ContentIntelligenceMcqTests
{
  private readonly PostgresFixture _db;

  private const string Path = "/api/v1/authoring/content-intelligence";

  // Shape-only MCQ overlay (§2.9.1): the live query and the count only test
  // `mcq is not null`, so the option text is placeholder, never exam wording.
  private const string McqBlob =
    """{"v":1,"options":[{"key":"a","why":null,"text":"option a","correct":true},{"key":"b","why":"why b","text":"option b","correct":false},{"key":"c","why":"why c","text":"option c","correct":false}],"shuffle":true,"qualifier":null}""";

  public ContentIntelligenceMcqTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub(string tag) => $"it-ci13-{tag}-{Guid.NewGuid():N}";

  private async Task<(long Id, string Slug)> NewDeckAsync(string tag)
  {
    var slug = $"it-ci13-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, $"deck {tag}", "tests");
    return (Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture), slug);
  }

  private async Task<string> NewCardAsync(long deckId, int orderInDeck, string? mcq = null, int isDeleted = 0)
  {
    var uid = $"uid-{Guid.NewGuid():N}";
    await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted, mcq) values ($1, $2, $3, $4, $5, $6::jsonb)",
      deckId, uid, "q", orderInDeck, isDeleted, mcq);
    return uid;
  }

  private Task GrantReadAsync(string adminSub, long deckId) =>
    _db.QueryAsync(
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)",
      adminSub, deckId);

  private static JsonElement Event(string path, string sub, string[] groups, IDictionary<string, string> query)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
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
      queryStringParameters = query,
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<JsonElement> GetAsync(string sub, string[] groups, IDictionary<string, string> query)
  {
    var req = new LambdaRequest(Event("/api/v1/authoring/content-intelligence", sub, groups, query));
    var res = new Res(req.TraceId);
    var response = await ContentIntelligence.HandleContentIntelligence(req, res, Auth.GetAuthContext(req));
    Assert.True(response.StatusCode == 200, $"GET content-intelligence returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static IDictionary<string, string> Query(params (string Key, string Value)[] pairs)
  {
    var q = new Dictionary<string, string>(StringComparer.Ordinal) { ["days"] = "7" };
    foreach (var (k, v) in pairs) q[k] = v;
    return q;
  }

  private static int McqCardCount(JsonElement data)
  {
    var summary = data.GetProperty("summary");
    Assert.True(summary.TryGetProperty("mcqCardCount", out var v), "summary is missing mcqCardCount");
    Assert.Equal(JsonValueKind.Number, v.ValueKind);
    return v.GetInt32();
  }

  private static int CardCount(JsonElement data) => data.GetProperty("summary").GetProperty("cardCount").GetInt32();

  // ------------------------------------------------------------------ tests

  [Fact]
  public async Task McqCardCount_IsScopedByDeckSlug_AndSkipsDeletedCards()
  {
    var (deckA, slugA) = await NewDeckAsync("scoped-a");
    await NewCardAsync(deckA, 1, mcq: McqBlob);
    await NewCardAsync(deckA, 2, mcq: McqBlob);
    await NewCardAsync(deckA, 3);
    await NewCardAsync(deckA, 4, mcq: McqBlob, isDeleted: 1);

    var (deckB, slugB) = await NewDeckAsync("scoped-b");
    await NewCardAsync(deckB, 1, mcq: McqBlob);

    var sub = NewSub("super");

    var scopedA = await GetAsync(sub, ["super_admin"], Query(("deckSlug", slugA)));
    Assert.Equal(2, McqCardCount(scopedA));
    Assert.Equal(0, CardCount(scopedA)); // no events posted

    var scopedB = await GetAsync(sub, ["super_admin"], Query(("deckSlug", slugB)));
    Assert.Equal(1, McqCardCount(scopedB));

    // Unscoped super-admin sees every readable MCQ card in a shared, deliberately
    // dirty database: the deck-A and deck-B cards are the most that can be pinned.
    var unscoped = await GetAsync(sub, ["super_admin"], Query());
    Assert.True(McqCardCount(unscoped) >= 3, "unscoped super-admin must see at least the three seeded MCQ cards");
  }

  [Fact]
  public async Task McqCardCount_FollowsReadPermission_ForEditors()
  {
    var (deckA, _) = await NewDeckAsync("perm-a");
    await NewCardAsync(deckA, 1, mcq: McqBlob);
    await NewCardAsync(deckA, 2, mcq: McqBlob);
    await NewCardAsync(deckA, 3);
    await NewCardAsync(deckA, 4, mcq: McqBlob, isDeleted: 1);

    var (deckB, slugB) = await NewDeckAsync("perm-b");
    await NewCardAsync(deckB, 1, mcq: McqBlob);

    var editor = NewSub("editor");
    await GrantReadAsync(editor, deckA);

    var readable = await GetAsync(editor, ["editor"], Query());
    Assert.Equal(2, McqCardCount(readable));

    var noPermission = NewSub("editor-none");
    var forbidden = await GetAsync(noPermission, ["editor"], Query());
    Assert.Equal(0, McqCardCount(forbidden));

    var editorAtB = await GetAsync(editor, ["editor"], Query(("deckSlug", slugB)));
    Assert.Equal(0, McqCardCount(editorAtB));
  }

  [Fact]
  public async Task LiveCards_ExcludeMcqCards_ButKeepQaCards()
  {
    var (deckA, slugA) = await NewDeckAsync("live-a");
    var qaUid = await NewCardAsync(deckA, 1);
    var mcqUid = await NewCardAsync(deckA, 2, mcq: McqBlob);

    var user = NewSub("reviewer");
    var eventTimeMs = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeMilliseconds();
    var body = new
    {
      deviceId = "device-under-test",
      clientVersion = "1.2.3",
      clientPlatform = "ios",
      events = new object[]
      {
        new { eventId = Guid.NewGuid().ToString("D"), deckSlug = slugA, stableUid = qaUid, rating = 3, eventTimeMs },
        new { eventId = Guid.NewGuid().ToString("D"), deckSlug = slugA, stableUid = mcqUid, rating = 3, eventTimeMs },
      },
    };
    await LambdaHost.PostProgressEventsAsync(user, body);

    var data = await GetAsync(NewSub("super"), ["super_admin"], Query(("deckSlug", slugA)));

    var cards = data.GetProperty("cards").EnumerateArray().ToList();
    Assert.Single(cards);
    Assert.Equal(qaUid, cards[0].GetProperty("cardStableUid").GetString());
    Assert.Equal(1, CardCount(data));
    Assert.Equal(1, McqCardCount(data));
  }

  [Fact]
  public async Task LiveQueries_FallBack_WhenCardsMcqColumnIsAbsent()
  {
    var cs = await _db.CreateScratchDatabaseAsync("ci_c13_mig018");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 18);

    var hasMcq = await DbUtil.QueryAsync(
      conn,
      null,
      "select 1 from information_schema.columns where table_name = 'cards' and column_name = 'mcq'",
      []);
    Assert.Empty(hasMcq); // the fallback is really exercised, not shadowed by the column existing

    var sub = NewSub("mig18");
    var slug = $"it-ci13-mig18-{Guid.NewGuid():N}";
    await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);
    var deckRows = await DbUtil.QueryAsync(
      conn, null, "insert into decks (slug, title, author) values ($1, $2, $3) returning id", [slug, "deck mig18", "tests"]);
    var deckId = Convert.ToInt64(deckRows[0]["id"], CultureInfo.InvariantCulture);
    var uid = $"uid-{Guid.NewGuid():N}";
    await DbUtil.ExecuteAsync(
      conn, null, "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4)", [deckId, uid, "q", 1]);
    await DbUtil.ExecuteAsync(
      conn,
      null,
      "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, rating, event_time) values ($1, $2, $3, $4, $5, now() - interval '1 hour')",
      [Guid.NewGuid(), sub, slug, uid, 3]);

    var cards = await ContentIntelligence.QueryLiveCardsAsync(conn, 7, slug, sub, true, 100);
    Assert.Single(cards);
    Assert.Equal(uid, Convert.ToString(cards[0]["cardStableUid"], CultureInfo.InvariantCulture));

    var mcqCount = await ContentIntelligence.CountMcqCardsAsync(conn, slug, sub, true);
    Assert.Equal(0, mcqCount);
  }
}
