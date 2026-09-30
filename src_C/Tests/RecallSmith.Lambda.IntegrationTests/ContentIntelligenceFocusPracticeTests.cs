using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Content Intelligence's live query ignores focus-run practice ratings (M06)
/// against a real Postgres.
///
/// The 1.8.x client labels a rating that leaves the schedule alone as
/// reviewStage 'focus_practice'. Whether those rows reach the author-facing
/// metrics is a property of the predicate the planner applies in event_scored,
/// including its NULL semantics for older clients that send no stage, so it is
/// only decidable against real rows. Both SQL variants are covered: the
/// MCQ-filter one through the handler, and the no-MCQ-column fallback on a
/// database frozen at migration 018.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ContentIntelligenceFocusPracticeTests
{
  private readonly PostgresFixture _db;

  private const string Path = "/api/v1/authoring/content-intelligence";
  private const string FocusPractice = "focus_practice";

  public ContentIntelligenceFocusPracticeTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub(string tag) => $"it-m06-{tag}-{Guid.NewGuid():N}";

  private async Task<(long Id, string Slug)> NewDeckAsync(string tag)
  {
    var slug = $"it-m06-{tag}-{Guid.NewGuid():N}";
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
    var req = new LambdaRequest(Event(Path, sub, groups, query));
    var res = new Res(req.TraceId);
    var response = await ContentIntelligence.HandleContentIntelligence(req, res, await Auth.GetAuthContextAsync(req));
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

  private static int CardCount(JsonElement data) => data.GetProperty("summary").GetProperty("cardCount").GetInt32();

  private static List<JsonElement> Cards(JsonElement data) => data.GetProperty("cards").EnumerateArray().ToList();

  private static string CardUid(JsonElement card) => card.GetProperty("cardStableUid").GetString()!;

  /// <summary>
  /// One progress event as the client posts it. A null stage omits the
  /// reviewStage property entirely, the way pre-Z07 clients send it.
  /// </summary>
  private static Dictionary<string, object> Ev(
    long nowMs, string slug, string uid, int rating, double hoursAgo, long dwellTimeMs, string? stage)
  {
    var e = new Dictionary<string, object>(StringComparer.Ordinal)
    {
      ["eventId"] = Guid.NewGuid().ToString("D"),
      ["deckSlug"] = slug,
      ["stableUid"] = uid,
      ["rating"] = rating,
      ["eventTimeMs"] = nowMs - (long)(hoursAgo * 3_600_000),
      ["dwellTimeMs"] = dwellTimeMs,
    };
    if (stage is not null) e["reviewStage"] = stage;
    return e;
  }

  private static async Task PostAsync(string user, List<Dictionary<string, object>> events)
  {
    Assert.InRange(events.Count, 1, 200);
    var data = await LambdaHost.PostProgressEventsAsync(user, new
    {
      deviceId = "device-under-test",
      clientVersion = "1.8.0",
      clientPlatform = "ios",
      events,
    });
    Assert.Equal(events.Count, data.GetProperty("acceptedCount").GetInt32());
  }

  private async Task<long> PracticeRowCountAsync(string slug)
  {
    var rows = await _db.QueryAsync(
      "select count(*) as n from user_progress_events where deck_slug = $1 and review_stage = 'focus_practice'",
      slug);
    return Convert.ToInt64(rows[0]["n"], CultureInfo.InvariantCulture);
  }

  // Real reviews, the same table for every card of both decks in test 1:
  // per user 2-4 events at whole-hour offsets, ratings 1-4, varied dwell and
  // a mix of no stage, first_review and repeat_review.
  private static readonly (double HoursAgo, int Rating, long DwellMs, string? Stage)[][] RealTable =
  [
    [(48, 1, 9000, null), (30, 3, 5000, "first_review"), (10, 4, 2500, "repeat_review")],
    [(50, 2, 7000, "first_review"), (20, 3, 4000, "repeat_review")],
    [(60, 1, 12000, null), (40, 2, 8000, "repeat_review"), (25, 3, 6000, "repeat_review"), (5, 4, 2000, null)],
  ];

  // Practice events, deck A only: half-hour offsets so no time collides with a
  // real event, and the 70.5 h one is the earliest event of every user and
  // card, so on an unfiltered query it takes user_card_review_number 1.
  private static readonly (double HoursAgo, int Rating, long DwellMs)[][] PracticeTable =
  [
    [(70.5, 4, 1500), (15.5, 2, 3000)],
    [(70.5, 3, 1800), (35.5, 4, 1200), (12.5, 2, 2600)],
    [(70.5, 2, 3300), (45.5, 4, 900)],
  ];

  // ------------------------------------------------------------------ tests

  [Fact]
  public async Task PracticeEvents_LeaveEveryCardMetricUnchanged()
  {
    var (deckA, slugA) = await NewDeckAsync("a");
    var (deckB, slugB) = await NewDeckAsync("b");
    var cardsA = new List<string>();
    var cardsB = new List<string>();
    for (var order = 1; order <= 3; order++)
    {
      cardsA.Add(await NewCardAsync(deckA, order));
      cardsB.Add(await NewCardAsync(deckB, order));
    }

    var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var expectedPractice = 0;
    var realPerCard = RealTable.Sum(r => r.Length);

    for (var u = 0; u < RealTable.Length; u++)
    {
      var user = NewSub($"user{u}");
      var events = new List<Dictionary<string, object>>();
      for (var c = 0; c < 3; c++)
      {
        foreach (var (hoursAgo, rating, dwell, stage) in RealTable[u])
        {
          // Rotate ratings and dwell by card so the three cards differ from each other.
          var r = ((rating - 1 + c) % 4) + 1;
          var d = dwell + (1000 * c);
          events.Add(Ev(nowMs, slugA, cardsA[c], r, hoursAgo, d, stage));
          events.Add(Ev(nowMs, slugB, cardsB[c], r, hoursAgo, d, stage));
        }

        for (var i = 0; i < PracticeTable[u].Length; i++)
        {
          var (hoursAgo, rating, dwell) = PracticeTable[u][i];
          var r = 2 + ((rating - 2 + c) % 3); // stays in 2..4, like the client
          events.Add(Ev(nowMs, slugA, cardsA[c], r, hoursAgo, dwell + (500 * c), FocusPractice));
          expectedPractice++;
        }
      }

      await PostAsync(user, events);
    }

    Assert.Equal(expectedPractice, await PracticeRowCountAsync(slugA));
    Assert.Equal(0, await PracticeRowCountAsync(slugB));

    var admin = NewSub("super");
    var dataA = await GetAsync(admin, ["super_admin"], Query(("deckSlug", slugA)));
    var dataB = await GetAsync(admin, ["super_admin"], Query(("deckSlug", slugB)));

    var byUidA = Cards(dataA).ToDictionary(CardUid);
    var byUidB = Cards(dataB).ToDictionary(CardUid);
    Assert.Equal(3, byUidA.Count);
    Assert.Equal(3, byUidB.Count);

    var excluded = new HashSet<string>(StringComparer.Ordinal) { "deckSlug", "deckTitle", "cardStableUid" };
    for (var c = 0; c < 3; c++)
    {
      Assert.True(byUidA.ContainsKey(cardsA[c]), $"deck A card {c + 1} is missing");
      Assert.True(byUidB.ContainsKey(cardsB[c]), $"deck B card {c + 1} is missing");
      var a = byUidA[cardsA[c]];
      var b = byUidB[cardsB[c]];

      Assert.True(
        a.GetProperty("reviewCount").GetInt32() == realPerCard,
        $"deck A card {c + 1}: reviewCount {a.GetProperty("reviewCount").GetInt32()}, expected {realPerCard} real reviews (practice events counted?)");
      Assert.Equal(realPerCard, b.GetProperty("reviewCount").GetInt32());

      var namesA = a.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
      var namesB = b.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
      Assert.Equal(namesB, namesA);

      foreach (var name in namesA.Where(n => !excluded.Contains(n)))
      {
        var rawA = a.GetProperty(name).GetRawText();
        var rawB = b.GetProperty(name).GetRawText();
        Assert.True(rawA == rawB, $"card {c + 1} field {name}: deck A {rawA} != deck B {rawB}");
      }
    }

    var summaryA = dataA.GetProperty("summary").GetRawText();
    var summaryB = dataB.GetProperty("summary").GetRawText();
    Assert.True(summaryA == summaryB, $"summary differs: deck A {summaryA} != deck B {summaryB}");
  }

  [Fact]
  public async Task CardWithOnlyPracticeEvents_IsAbsentFromCards()
  {
    var (deck, slug) = await NewDeckAsync("only");
    var x = await NewCardAsync(deck, 1);
    var y = await NewCardAsync(deck, 2);

    var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var events = new List<Dictionary<string, object>>
    {
      Ev(nowMs, slug, x, 1, 30, 6000, null),
      Ev(nowMs, slug, x, 3, 20, 4000, "first_review"),
      Ev(nowMs, slug, x, 4, 10, 2000, "repeat_review"),
      Ev(nowMs, slug, y, 2, 28, 3000, FocusPractice),
      Ev(nowMs, slug, y, 3, 18, 2500, FocusPractice),
      Ev(nowMs, slug, y, 4, 8, 1500, FocusPractice),
    };
    await PostAsync(NewSub("reviewer"), events);
    Assert.Equal(3, await PracticeRowCountAsync(slug));

    var data = await GetAsync(NewSub("super"), ["super_admin"], Query(("deckSlug", slug)));

    var cards = Cards(data);
    Assert.DoesNotContain(cards, c => CardUid(c) == y);
    Assert.Single(cards);
    Assert.Equal(x, CardUid(cards[0]));
    Assert.Equal(1, CardCount(data));
  }

  [Fact]
  public async Task NullFirstAndRepeatReviewStages_StillCount()
  {
    var (deck, slug) = await NewDeckAsync("stages");
    var uid = await NewCardAsync(deck, 1);

    var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var events = new List<Dictionary<string, object>>
    {
      Ev(nowMs, slug, uid, 1, 60, 9000, null),
      Ev(nowMs, slug, uid, 2, 50, 7000, null),
      Ev(nowMs, slug, uid, 3, 40, 5000, "first_review"),
      Ev(nowMs, slug, uid, 4, 30, 3000, "first_review"),
      Ev(nowMs, slug, uid, 3, 20, 4000, "repeat_review"),
      Ev(nowMs, slug, uid, 4, 10, 2000, "repeat_review"),
    };
    await PostAsync(NewSub("reviewer"), events);

    var data = await GetAsync(NewSub("super"), ["super_admin"], Query(("deckSlug", slug)));

    var cards = Cards(data);
    Assert.Single(cards);
    Assert.Equal(uid, CardUid(cards[0]));
    Assert.Equal(6, cards[0].GetProperty("reviewCount").GetInt32());
  }

  [Fact]
  public async Task FallbackVariantWithoutMcqColumn_AlsoExcludesPracticeEvents()
  {
    var cs = await _db.CreateScratchDatabaseAsync("ci_m06_mig018");
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
    var slug = $"it-m06-mig18-{Guid.NewGuid():N}";
    await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);
    var deckRows = await DbUtil.QueryAsync(
      conn, null, "insert into decks (slug, title, author) values ($1, $2, $3) returning id", [slug, "deck mig18", "tests"]);
    var deckId = Convert.ToInt64(deckRows[0]["id"], CultureInfo.InvariantCulture);
    var x = $"uid-{Guid.NewGuid():N}";
    var y = $"uid-{Guid.NewGuid():N}";
    await DbUtil.ExecuteAsync(
      conn, null, "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4)", [deckId, x, "q", 1]);
    await DbUtil.ExecuteAsync(
      conn, null, "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4)", [deckId, y, "q", 2]);

    (string Uid, int Rating, int HoursAgo, string? Stage)[] rows =
    [
      (x, 1, 40, null),
      (x, 3, 30, "first_review"),
      (x, 4, 20, "repeat_review"),
      (x, 2, 45, FocusPractice),
      (x, 3, 25, FocusPractice),
      (y, 3, 35, FocusPractice),
      (y, 4, 15, FocusPractice),
    ];
    foreach (var (uid, rating, hoursAgo, stage) in rows)
    {
      await DbUtil.ExecuteAsync(
        conn,
        null,
        "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, rating, event_time, review_stage) values ($1, $2, $3, $4, $5, now() - ($6::int * interval '1 hour'), $7::text)",
        [Guid.NewGuid(), sub, slug, uid, rating, hoursAgo, stage]);
    }

    var cards = await ContentIntelligence.QueryLiveCardsAsync(conn, 7, slug, sub, true, 100);
    Assert.DoesNotContain(cards, c => Convert.ToString(c["cardStableUid"], CultureInfo.InvariantCulture) == y);
    Assert.Single(cards);
    Assert.Equal(x, Convert.ToString(cards[0]["cardStableUid"], CultureInfo.InvariantCulture));
    Assert.Equal(3, Convert.ToInt32(cards[0]["reviewCount"], CultureInfo.InvariantCulture));
  }
}
