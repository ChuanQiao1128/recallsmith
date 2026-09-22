using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The keyset-paginated card list (GET /api/v1/authoring/cards/page) against a
/// real Postgres.
///
/// A live database is the whole point here. Pagination is not a property of the
/// C# that builds the SQL; it is a property of what a planner returns for a
/// sequence of statements while the table is being written underneath. Two of
/// the claims below cannot be made anywhere else: that a page walk survives
/// concurrent inserts (OFFSET does not, and the same fixture is used to show it
/// does not), and that a page boundary falling inside a group of equal
/// order_in_deck loses nothing — which depends on rows coming back in an order
/// no in-process fake can decide.
/// </summary>
[Collection(PostgresCollection.Name)]
public class CardsPageTests
{
  private readonly PostgresFixture _db;

  private const string PagePath = "/api/v1/authoring/cards/page";
  private const string FullPath = "/api/v1/authoring/cards";

  public CardsPageTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub(string tag) => $"it-cardspage-{tag}-{Guid.NewGuid():N}";

  private async Task<long> NewDeckAsync(string tag)
  {
    var slug = $"it-cardspage-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<long> NewCardAsync(long deckId, int orderInDeck, int isDeleted = 0)
  {
    var rows = await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck, is_deleted) values ($1, $2, $3, $4, $5) returning id",
      deckId, $"uid-{Guid.NewGuid():N}", "q", orderInDeck, isDeleted);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private Task GrantReadAsync(string adminSub, long deckId) =>
    _db.QueryAsync(
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)",
      adminSub, deckId);

  /// <summary>
  /// A real API Gateway event, with the groups carried as JWT claims rather than
  /// a hand-built AuthContext: super_admin vs editor is decided by
  /// Auth.GetAuthContext parsing those claims, and the permission scoping below
  /// is only a real claim if that mapping is in the picture.
  /// </summary>
  private static JsonElement Event(string path, string sub, string[] groups, IDictionary<string, string>? query)
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
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> InvokePageAsync(string sub, string[] groups, IDictionary<string, string> query)
  {
    var req = new LambdaRequest(Event(PagePath, sub, groups, query));
    var res = new Res(req.TraceId);
    return await CardsPage.HandleAuthoringCardsPage(req, res, await Auth.GetAuthContextAsync(req));
  }

  private sealed record Page(List<long> Ids, List<JsonElement> Items, string? NextCursor, bool HasMore);

  private static async Task<Page> FetchPageAsync(
    long? deckId,
    int limit,
    string? cursor = null,
    bool includeDeleted = false,
    string? sub = null,
    string[]? groups = null)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["limit"] = limit.ToString(CultureInfo.InvariantCulture),
    };
    if (deckId is not null) query["deckId"] = deckId.Value.ToString(CultureInfo.InvariantCulture);
    if (cursor is not null) query["cursor"] = cursor;
    if (includeDeleted) query["includeDeleted"] = "true";

    var response = await InvokePageAsync(sub ?? NewSub("super"), groups ?? ["super_admin"], query);
    Assert.True(response.StatusCode == 200, $"GET {PagePath} returned {response.StatusCode}: {response.Body}");

    using var doc = JsonDocument.Parse(response.Body!);
    var data = doc.RootElement.GetProperty("data").Clone();

    var items = data.GetProperty("items").EnumerateArray().ToList();
    var nextCursor = data.GetProperty("nextCursor").ValueKind == JsonValueKind.Null
      ? null
      : data.GetProperty("nextCursor").GetString();

    return new Page(
      items.Select(x => x.GetProperty("id").GetInt64()).ToList(),
      items,
      nextCursor,
      data.GetProperty("hasMore").GetBoolean());
  }

  /// <summary>
  /// Drains the walk, optionally running <paramref name="betweenPages"/> after
  /// each page — that hook is where the concurrent writer lives.
  /// </summary>
  private static async Task<List<long>> WalkAsync(
    long? deckId,
    int limit,
    string? startCursor = null,
    Func<Page, Task>? betweenPages = null,
    int maxPages = 200)
  {
    var seen = new List<long>();
    var cursor = startCursor;

    for (var page = 0; page < maxPages; page++)
    {
      var result = await FetchPageAsync(deckId, limit, cursor);
      seen.AddRange(result.Ids);

      if (betweenPages is not null) await betweenPages(result);

      if (!result.HasMore || result.NextCursor is null) return seen;
      cursor = result.NextCursor;
    }

    Assert.Fail($"walk did not terminate within {maxPages} pages");
    return seen;
  }

  // ------------------------------------------------- completeness under writes

  [Fact]
  public async Task PageWalk_LosesAndRepeatsNothing_WhileRowsAreInsertedBehindTheCursor()
  {
    var deckId = await NewDeckAsync("walk-keyset");

    // Sparse orders leave room to insert *behind* the cursor later, which is the
    // hazard: an insert ahead of the walk is simply picked up, an insert behind
    // it is what shifts an OFFSET window.
    var seeded = new List<long>();
    for (var i = 1; i <= 10; i++) seeded.Add(await NewCardAsync(deckId, orderInDeck: i * 10));

    var intruder = 0;
    var walked = await WalkAsync(
      deckId,
      limit: 3,
      betweenPages: async _ =>
      {
        // order_in_deck 1..N sorts before every seeded row, so every one of these
        // lands strictly behind the cursor once the first page is out.
        intruder++;
        await NewCardAsync(deckId, orderInDeck: intruder);
      });

    Assert.Equal(seeded.Count, walked.Distinct().Count());
    Assert.Equal(walked.Count, walked.Distinct().Count());
    foreach (var id in seeded) Assert.Contains(id, walked);

    // The rows inserted behind the cursor are legitimately absent: they sort into
    // pages the client has already been handed. Keyset pagination promises a
    // complete, duplicate-free pass over the rows that existed at the start —
    // not a snapshot of a table that is still being written.
    Assert.True(intruder >= 3, "the concurrent writer must actually have run between pages");
  }

  [Fact]
  public async Task OffsetWalk_RepeatsRows_UnderTheSameInterleaving()
  {
    // The counter-witness. Without it, the test above could be passing because
    // the fixture never reproduces the hazard rather than because keyset
    // pagination survives it. Same shape, same interleaving, OFFSET instead of a
    // cursor — and the duplicate is deterministic, not a race: inserting one row
    // before the window shifts every later window by exactly one.
    var deckId = await NewDeckAsync("walk-offset");
    for (var i = 1; i <= 10; i++) await NewCardAsync(deckId, orderInDeck: i * 10);

    var seen = new List<long>();
    var intruder = 0;

    for (var offset = 0; offset < 60; offset += 3)
    {
      var rows = await _db.QueryAsync(
        """
        select id from cards
        where deck_id = $1 and is_deleted = 0
        order by order_in_deck asc, id asc
        limit 3 offset $2
        """,
        deckId,
        offset);

      if (rows.Count == 0) break;
      seen.AddRange(rows.Select(r => Convert.ToInt64(r["id"], CultureInfo.InvariantCulture)));

      intruder++;
      await NewCardAsync(deckId, orderInDeck: intruder);
    }

    Assert.True(
      seen.Count != seen.Distinct().Count(),
      "OFFSET pagination was expected to re-deliver rows under inserts behind the window");
  }

  // ------------------------------------------------------------- the tie-break

  [Fact]
  public async Task PageWalk_KeepsEveryCard_WhenOrderInDeckIsTied()
  {
    // A tie needs more than one deck: uq_cards_deck_order (deck_id, order_in_deck)
    // makes order_in_deck unique INSIDE a deck, so the deck-unscoped listing —
    // the same listing the unpaged endpoint serves when ?deckId= is omitted — is
    // where equal order_in_deck is normal rather than exotic.
    const int TieOrder = 987_654_321;

    var ids = new List<long>();
    for (var i = 0; i < 3; i++)
    {
      var deckId = await NewDeckAsync($"tie-{i}");
      ids.Add(await NewCardAsync(deckId, orderInDeck: TieOrder));
    }

    // Not decoration: an UPDATE writes a new tuple version later in the heap, so
    // after this the physical scan order disagrees with the id order — exactly
    // what an edited card does in production, and exactly the condition under
    // which "the rows happen to come back sorted anyway" stops being true.
    await _db.QueryAsync("update cards set question = question || '!' where id = $1", ids[0]);

    // Starting the walk just below the tie group keeps this test independent of
    // every other row in a shared, deliberately dirty database. Clients never
    // build cursors — this one is built with the production codec, which is the
    // only supported way to name a position in the sequence.
    var startCursor = new CardsPageCursor(TieOrder - 1, long.MaxValue).Encode();

    // limit = 1 puts a page boundary between every pair of tied rows.
    var walked = await WalkAsync(deckId: null, limit: 1, startCursor: startCursor);

    foreach (var id in ids)
    {
      Assert.Equal(1, walked.Count(x => x == id));
    }

    // Tie-break direction, not just survival: within the group the ids ascend.
    var walkedTie = walked.Where(ids.Contains).ToList();
    Assert.Equal(ids.OrderBy(x => x).ToList(), walkedTie);
  }

  [Fact]
  public async Task PageWalk_KeepsEveryTiedCard_EvenWhenThePlannerCannotUseTheKeysetIndex()
  {
    // Measured while mutation-testing the test above, and the reason this one
    // exists: with idx_cards_order_id available the planner returns a tie group
    // already ordered by id, so the `, id asc` leg of the ORDER BY is invisible —
    // the index is doing its job for it. Take the index scan away and the same
    // statement is a seq scan plus a sort, and the sort only tie-breaks on what
    // the ORDER BY names. Which plan runs is the planner's business and changes
    // with table size, statistics and parallelism; the walk being complete is
    // not allowed to change with it.
    //
    // This drives the production SQL rather than the handler because the GUCs
    // have to be set on the connection the query runs on, and the handler owns
    // its own pooled connection. The statement text is the same one production
    // executes — that is what BuildPageQuery is for.
    const int TieOrder = 987_650_000;

    var ids = new List<long>();
    for (var i = 0; i < 3; i++)
    {
      var deckId = await NewDeckAsync($"tie-noindex-{i}");
      ids.Add(await NewCardAsync(deckId, orderInDeck: TieOrder));
    }

    // Rewrites the row, so the newest tuple version sits after its tie-mates in
    // the heap: without this the physical order agrees with the id order and a
    // sort that tie-breaks on nothing still looks correct.
    await _db.QueryAsync("update cards set question = question || '!' where id = $1", ids[0]);

    await using var conn = await _db.OpenAsync();
    foreach (var guc in new[] { "enable_indexscan", "enable_indexonlyscan", "enable_bitmapscan" })
    {
      await DbUtil.ExecuteAsync(conn, null, $"set {guc} = off", []);
    }

    var walked = new List<long>();
    var cursor = new CardsPageCursor(TieOrder - 1, long.MaxValue);

    for (var page = 0; page < 200; page++)
    {
      var (sql, parameters) = CardsPage.BuildPageQuery(null, false, null, cursor, 1);
      var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
      if (rows.Count == 0) break;

      var last = rows[^1];
      walked.Add(Convert.ToInt64(last["id"], CultureInfo.InvariantCulture));
      cursor = new CardsPageCursor(
        Convert.ToInt32(last["orderInDeck"], CultureInfo.InvariantCulture),
        Convert.ToInt64(last["id"], CultureInfo.InvariantCulture));
    }

    foreach (var id in ids) Assert.Equal(1, walked.Count(x => x == id));
    Assert.Equal(ids.OrderBy(x => x).ToList(), walked.Where(ids.Contains).ToList());
  }

  // -------------------------------------------------------------- the envelope

  [Fact]
  public async Task Page_EnvelopeMatchesThePagedDeckList()
  {
    var deckId = await NewDeckAsync("envelope");
    var first = await NewCardAsync(deckId, orderInDeck: 1);
    await NewCardAsync(deckId, orderInDeck: 2);

    var page = await FetchPageAsync(deckId, limit: 1);

    Assert.Single(page.Items);
    Assert.Equal(first, page.Ids[0]);
    Assert.True(page.HasMore);
    Assert.NotNull(page.NextCursor);

    // The cursor is the last row's full sort tuple, and it is opaque only to
    // clients: decoding it here is how the walk's position is checked at all.
    var decoded = CardsPageCursor.TryDecode(page.NextCursor);
    Assert.NotNull(decoded);
    Assert.Equal(1, decoded!.OrderInDeck);
    Assert.Equal(first, decoded.Id);

    // Item shape is the unpaged endpoint's projection, camelCased the same way.
    var item = page.Items[0];
    Assert.Equal(deckId, item.GetProperty("deckId").GetInt64());
    Assert.Equal(1, item.GetProperty("orderInDeck").GetInt32());
    Assert.Equal(0, item.GetProperty("isDeleted").GetInt32());
    foreach (var field in new[] { "stableUid", "question", "revision", "version", "createdAt", "updatedAt" })
    {
      Assert.True(item.TryGetProperty(field, out _), $"missing item field '{field}'");
    }
  }

  [Fact]
  public async Task Page_LastFullPage_ReportsHasMore_ThenAnEmptyPageEndsTheWalk()
  {
    // The documented cost of "a full page means ask again": an exactly-divisible
    // walk pays one empty request. Pinned because the alternative (fetch
    // limit + 1 and trim) is a different wire contract for the same envelope, and
    // the paged deck list already chose this one.
    var deckId = await NewDeckAsync("exact-divide");
    await NewCardAsync(deckId, orderInDeck: 1);
    await NewCardAsync(deckId, orderInDeck: 2);

    var first = await FetchPageAsync(deckId, limit: 2);
    Assert.Equal(2, first.Ids.Count);
    Assert.True(first.HasMore);
    Assert.NotNull(first.NextCursor);

    var second = await FetchPageAsync(deckId, limit: 2, cursor: first.NextCursor);
    Assert.Empty(second.Ids);
    Assert.False(second.HasMore);
    Assert.Null(second.NextCursor);

    // The other half of the same rule, and the half that costs a round trip if it
    // is wrong: a page that came back short is the end of the walk, and it says
    // so. Without this, "hasMore = any rows at all" reads as correct — every walk
    // still terminates and still delivers every row, just one request later.
    var short_ = await FetchPageAsync(deckId, limit: 3);
    Assert.Equal(2, short_.Ids.Count);
    Assert.False(short_.HasMore);
    Assert.Null(short_.NextCursor);
  }

  [Fact]
  public async Task Page_LimitIsClampedToTheAllowedRange()
  {
    var deckId = await NewDeckAsync("limit-clamp");

    // 250 cards in one statement: enough to see the upper clamp, cheap enough to
    // seed. Orders stay small so this deck sorts far away from the tie fixture.
    await _db.QueryAsync(
      """
      insert into cards (deck_id, stable_uid, question, order_in_deck)
      select $1, 'uid-' || $2 || '-' || i, 'q', i from generate_series(1, 250) i
      """,
      deckId,
      Guid.NewGuid().ToString("N"));

    Assert.Single((await FetchPageAsync(deckId, limit: 0)).Ids);
    Assert.Single((await FetchPageAsync(deckId, limit: -5)).Ids);
    Assert.Equal(200, (await FetchPageAsync(deckId, limit: 100_000)).Ids.Count);
  }

  [Fact]
  public async Task Page_MalformedCursor_Is400_AndAnotherEndpointsCursorCounts()
  {
    var deckId = await NewDeckAsync("bad-cursor");
    await NewCardAsync(deckId, orderInDeck: 1);

    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["cursor"] = "!!!not-a-cursor!!!",
    };

    var bad = await InvokePageAsync(NewSub("super"), ["super_admin"], query);
    Assert.Equal(400, bad.StatusCode);
    Assert.Contains("VALIDATION_ERROR", bad.Body!, StringComparison.Ordinal);

    // A cursor from the paged deck list is well-formed base64url JSON with a
    // valid "v" — and still not a position in this sequence. Accepting it would
    // silently restart the walk from the top.
    query["cursor"] = new AdminDecksCursor(1718000000123, "some-slug", 250).Encode();
    var foreign = await InvokePageAsync(NewSub("super"), ["super_admin"], query);
    Assert.Equal(400, foreign.StatusCode);
  }

  // ------------------------------------------------------------------ scoping

  [Fact]
  public async Task Page_SoftDeletedCards_AreExcludedUnlessSuperAdminAsks()
  {
    var deckId = await NewDeckAsync("soft-delete");
    var live = await NewCardAsync(deckId, orderInDeck: 1);
    var deleted = await NewCardAsync(deckId, orderInDeck: 2, isDeleted: 1);

    var defaultPage = await FetchPageAsync(deckId, limit: 50);
    Assert.Equal([live], defaultPage.Ids);

    var withDeleted = await FetchPageAsync(deckId, limit: 50, includeDeleted: true);
    Assert.Equal([live, deleted], withDeleted.Ids);

    // includeDeleted is a super_admin capability on the unpaged endpoint, and the
    // paged one must not be a cheaper way to ask.
    var editor = NewSub("editor");
    await GrantReadAsync(editor, deckId);
    var editorPage = await FetchPageAsync(deckId, limit: 50, includeDeleted: true, sub: editor, groups: ["editor"]);
    Assert.Equal([live], editorPage.Ids);
  }

  [Fact]
  public async Task Page_NonSuperAdmin_SeesOnlyPermittedDecks()
  {
    // The escalation guard: a paged variant that saw more rows than the endpoint
    // it pages would be a privilege escalation wearing a pagination costume.
    var permitted = await NewDeckAsync("perm-yes");
    var forbidden = await NewDeckAsync("perm-no");

    var visible = await NewCardAsync(permitted, orderInDeck: 991_000_001);
    var hidden = await NewCardAsync(forbidden, orderInDeck: 991_000_002);

    var editor = NewSub("editor");
    await GrantReadAsync(editor, permitted);

    // Deck-unscoped: the permission join, not a deckId filter, is what limits it.
    var startCursor = new CardsPageCursor(991_000_000, long.MaxValue).Encode();
    var page = await FetchPageAsync(null, limit: 50, cursor: startCursor, sub: editor, groups: ["editor"]);

    Assert.Contains(visible, page.Ids);
    Assert.DoesNotContain(hidden, page.Ids);

    // Deck-scoped at a deck the editor cannot read: refused outright, and the
    // refusal is a 403 rather than an empty page, same as the unpaged endpoint.
    var denied = await InvokePageAsync(
      editor,
      ["editor"],
      new Dictionary<string, string>(StringComparer.Ordinal) { ["deckId"] = forbidden.ToString(CultureInfo.InvariantCulture) });
    Assert.Equal(403, denied.StatusCode);

    // Not an admin at all: neither route is reachable.
    var outsider = await InvokePageAsync(NewSub("nobody"), [], new Dictionary<string, string>(StringComparer.Ordinal));
    Assert.Equal(403, outsider.StatusCode);
  }

  // -------------------------------------------------- routing / no regression

  [Fact]
  public async Task Router_SendsPageToTheKeysetHandler_AndLeavesTheFullEndpointAlone()
  {
    // Both routes through the real dispatcher: the paged path is additive only if
    // the unpaged one still answers with the same bare array it always did.
    var deckId = await NewDeckAsync("routing");
    await NewCardAsync(deckId, orderInDeck: 1);
    await NewCardAsync(deckId, orderInDeck: 2);

    var sub = NewSub("super");
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["limit"] = "1",
    };

    var fn = new RecallSmith.Lambda.VpcFunction();

    var paged = await fn.Handler(Event(PagePath, sub, ["super_admin"], query));
    Assert.Equal(200, paged.StatusCode);
    using (var doc = JsonDocument.Parse(paged.Body!))
    {
      var data = doc.RootElement.GetProperty("data");
      Assert.Equal(JsonValueKind.Object, data.ValueKind);
      Assert.Single(data.GetProperty("items").EnumerateArray());
      Assert.True(data.GetProperty("hasMore").GetBoolean());
    }

    var full = await fn.Handler(Event(FullPath, sub, ["super_admin"], query));
    Assert.Equal(200, full.StatusCode);
    using (var doc = JsonDocument.Parse(full.Body!))
    {
      var data = doc.RootElement.GetProperty("data");

      // A bare array, not an envelope, and `limit` is not a parameter it has ever
      // known: both cards come back.
      Assert.Equal(JsonValueKind.Array, data.ValueKind);
      Assert.Equal(2, data.GetArrayLength());
    }
  }

  // --------------------------------------------------------------- the planner

  [Fact]
  public async Task PageQuery_IsIndexServed_AtEnterpriseSize()
  {
    // Correct pagination that scans the whole table once per page is not an
    // improvement on the unbounded read it replaces — it is N of them. Only the
    // planner can settle which one this is, and it only answers honestly at a
    // size where a sequential scan is a real alternative. A separate database
    // keeps 20k rows out of everyone else's fixtures.
    var connectionString = await _db.CreateScratchDatabaseAsync("cardspage_plan");

    await using var conn = new Npgsql.NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);

    var deckA = Convert.ToInt64(
      (await DbUtil.QueryAsync(conn, null, "insert into decks (slug, title, author) values ('plan-a','a','t') returning id", []))[0]["id"],
      CultureInfo.InvariantCulture);
    var deckB = Convert.ToInt64(
      (await DbUtil.QueryAsync(conn, null, "insert into decks (slug, title, author) values ('plan-b','b','t') returning id", []))[0]["id"],
      CultureInfo.InvariantCulture);

    // 20k cards over two decks, so every order_in_deck value is tied across the
    // pair — the enterprise shape the issue names, and the shape where the
    // tie-break has work to do.
    await DbUtil.ExecuteAsync(
      conn,
      null,
      """
      insert into cards (deck_id, stable_uid, question, order_in_deck)
      select d.id, 'uid-' || d.id || '-' || i, 'q', i
      from (values ($1::bigint), ($2::bigint)) as d(id), generate_series(1, 10000) i
      """,
      [deckA, deckB]);
    await DbUtil.ExecuteAsync(conn, null, "analyze cards", []);

    var cursor = new CardsPageCursor(5000, 1);

    var unscoped = await ExplainAsync(conn, CardsPage.BuildPageQuery(null, false, null, cursor, 50));
    Assert.Contains("idx_cards_order_id", unscoped, StringComparison.Ordinal);
    Assert.DoesNotContain("Seq Scan", unscoped, StringComparison.Ordinal);

    // The whole tuple has to become the index condition, not just its leading
    // column. An index on (order_in_deck) alone still reads as "index scan, no
    // seq scan" while quietly degrading to Index Cond: (order_in_deck >= n) plus
    // an incremental sort — measured, and the reason this assertion is on the
    // Index Cond text rather than on the index name.
    Assert.Contains("Index Cond: (ROW(order_in_deck, id)", unscoped, StringComparison.Ordinal);

    // Deck-scoped: index-served, but deliberately NOT asserting which index.
    // Two candidates exist — idx_cards_order_id and the uq_cards_deck_order
    // constraint index — and picking between them is a cost decision that moves
    // with the deck count: this fixture has two decks, so filtering deck_id off
    // the global order index is cheap, while a catalogue of hundreds tips the
    // planner to the per-deck index (observed, both plans, same statement).
    // Pinning the winner here would be pinning the statistics, not the code.
    var scoped = await ExplainAsync(conn, CardsPage.BuildPageQuery(deckA, false, null, cursor, 50));
    Assert.Contains("Index Scan", scoped, StringComparison.Ordinal);
    Assert.DoesNotContain("Seq Scan", scoped, StringComparison.Ordinal);

    // Counter-witness for migration 017: without that index there is nothing to
    // serve a global (order_in_deck, id) range, and the deck-unscoped page falls
    // back to scanning and sorting the whole table — once per page. This is the
    // difference between paging and merely slicing.
    await DbUtil.ExecuteAsync(conn, null, "drop index idx_cards_order_id", []);
    await DbUtil.ExecuteAsync(conn, null, "analyze cards", []);

    var unindexed = await ExplainAsync(conn, CardsPage.BuildPageQuery(null, false, null, cursor, 50));
    Assert.Contains("Seq Scan", unindexed, StringComparison.Ordinal);
    Assert.Contains("Sort Key: order_in_deck, id", unindexed, StringComparison.Ordinal);
  }

  private static async Task<string> ExplainAsync(Npgsql.NpgsqlConnection conn, (string Sql, List<object?> Parameters) query)
  {
    var rows = await DbUtil.QueryAsync(conn, null, "explain (costs off) " + query.Sql, query.Parameters);
    return string.Join("\n", rows.Select(r => Convert.ToString(r["QUERY PLAN"], CultureInfo.InvariantCulture)));
  }
}
