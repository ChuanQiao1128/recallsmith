using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The console's source-watch routes (R18A A05, contract A00 §8.6 watch rows) through the handlers with a hand-built
/// <see cref="AuthContext"/>, against a scratch database migrated to the latest version (the list is global).
/// </summary>
[Collection(PostgresCollection.Name)]
public class WatchAdminRoutesTests
{
  private const string Scratch = "it_a05_admin";
  private const string WatchPath = "/api/v1/admin/automation/watch";
  private const string TargetsPath = "/api/v1/admin/automation/watch/targets";
  private readonly PostgresFixture _db;

  public WatchAdminRoutesTests(PostgresFixture db) => _db = db;

  private Task InScratchAsync(Func<A04Kit.Sql, Task> body) =>
    A05Kit.WithScopeAsync(_ => A05Kit.InScratchAsync(_db, Scratch, body));

  private static readonly string[] WatchTargetKeys =
  [
    "targetId", "kind", "url", "feedFormat", "deckId", "deckSlug", "itemTitlePattern", "active", "checkIntervalMinutes", "lastCheckedAt",
    "lastChangedAt", "lastStatus", "lastHttpStatus", "consecutiveFailures", "citingCards", "createdBy", "createdAt",
  ];

  private static readonly string[] WatchEventKeys =
  [
    "eventId", "targetId", "url", "kind", "oldSha256", "newSha256", "details", "recheckState", "recheckRunIds", "queueItemIds", "notificationId", "createdAt",
  ];

  private static string Url(string tag) => $"https://docs.example.com/a05/admin/{tag}/{Guid.NewGuid():N}";

  private static AuthContext Editor(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(),
    UserSub: sub,
    Username: null,
    Groups: ["editor"],
    IsSuperAdmin: false,
    IsEditor: true,
    IsAdmin: true,
    IsAgentClient: false);

  private static AuthContext Owner(string sub) => AutomationTestKit.Ctx(sub, agent: false);

  private static Task<APIGatewayProxyResponse> ListAsync(AuthContext auth, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(WatchAdminRoutes.HandleWatch, "GET", WatchPath, null, auth, query);

  private static Task<APIGatewayProxyResponse> AddAsync(AuthContext auth, object body) =>
    AutomationTestKit.CallAsync(WatchAdminRoutes.HandleTargets, "POST", TargetsPath, body, auth);

  private static Task<APIGatewayProxyResponse> UpdateAsync(AuthContext auth, string targetId, object body) =>
    AutomationTestKit.CallAsync((req, res, a) => WatchAdminRoutes.HandleTarget(req, res, a, targetId), "PUT", $"{TargetsPath}/{targetId}", body, auth);

  [Fact]
  public async Task ListWatch_ReturnsTargetsAndRecentEvents()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "list");
      var slug = (string)(await sql.ScalarAsync("select slug from decks where id = $1", deckId))!;
      var pageUrl = Url("page");
      await A05Kit.CardAsync(sql, deckId, pageUrl);
      await A05Kit.CardAsync(sql, deckId, pageUrl);
      await A05Kit.CardAsync(sql, deckId, pageUrl, isDeleted: 1);
      var pageId = await A05Kit.PageAsync(sql, pageUrl);
      var feedId = await A05Kit.FeedAsync(sql, Url("feed"), deckId, "atom", "Lambda");
      var runId = Guid.NewGuid();
      var eventId = A04Kit.Long(await sql.ScalarAsync(
        """
        insert into source_watch_events (target_id, watch_run_id, kind, old_sha256, new_sha256, details, recheck_state, recheck_run_ids)
        values ($1, $2, 'changed', $3, $4, $5::jsonb, 'started', $6) returning id
        """, pageId, Guid.NewGuid(), A05Kit.Sha("a"), A05Kit.Sha("b"), """{"citingCards": 2, "queueItemIds": [7, 9]}""", new[] { runId }));

      var data = AutomationTestKit.Data(await ListAsync(Owner("it-a05-admin")));
      Assert.Equal(["items", "recentEvents", "nextCursor"], A05Kit.Keys(data));
      var items = data.GetProperty("items").EnumerateArray().ToList();
      // The two seeded feeds of migration 034 are listed too; newest first.
      Assert.Equal(feedId, items[0].GetProperty("targetId").GetInt64());
      Assert.Equal(pageId, items[1].GetProperty("targetId").GetInt64());
      Assert.All(items, i => Assert.Equal(WatchTargetKeys, A05Kit.Keys(i)));
      Assert.Equal(2, items[1].GetProperty("citingCards").GetInt64());
      Assert.Equal(JsonValueKind.Null, items[0].GetProperty("citingCards").ValueKind);
      Assert.Equal((deckId, slug, "Lambda", "atom", 360, true), (items[0].GetProperty("deckId").GetInt64(), items[0].GetProperty("deckSlug").GetString(),
        items[0].GetProperty("itemTitlePattern").GetString(), items[0].GetProperty("feedFormat").GetString(),
        items[0].GetProperty("checkIntervalMinutes").GetInt32(), items[0].GetProperty("active").GetBoolean()));

      var ev = Assert.Single(data.GetProperty("recentEvents").EnumerateArray());
      Assert.Equal(WatchEventKeys, A05Kit.Keys(ev));
      Assert.Equal((eventId, pageId, pageUrl, "changed", "started"), (ev.GetProperty("eventId").GetInt64(), ev.GetProperty("targetId").GetInt64(),
        ev.GetProperty("url").GetString(), ev.GetProperty("kind").GetString(), ev.GetProperty("recheckState").GetString()));
      Assert.Equal([7L, 9L], ev.GetProperty("queueItemIds").EnumerateArray().Select(i => i.GetInt64()).ToArray());
      Assert.Equal(runId, ev.GetProperty("recheckRunIds")[0].GetGuid());
      Assert.Equal(2, ev.GetProperty("details").GetProperty("citingCards").GetInt32());

      // Filters and keyset paging.
      var pages = AutomationTestKit.Data(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["kind"] = "page" }));
      Assert.Equal([pageId], pages.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("targetId").GetInt64()).ToArray());
      var inactive = AutomationTestKit.Data(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["active"] = "false" }));
      Assert.All(inactive.GetProperty("items").EnumerateArray(), i => Assert.False(i.GetProperty("active").GetBoolean()));
      var first = AutomationTestKit.Data(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["limit"] = "1" }));
      var cursor = first.GetProperty("nextCursor").GetString()!;
      var second = AutomationTestKit.Data(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["limit"] = "1", ["cursor"] = cursor }));
      Assert.Equal(pageId, second.GetProperty("items")[0].GetProperty("targetId").GetInt64());

      AutomationTestKit.AssertError(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["kind"] = "blog" }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["limit"] = "101" }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await ListAsync(Owner("it-a05-admin"), new Dictionary<string, string> { ["cursor"] = "%%%" }), 400, "VALIDATION_ERROR");
      // An editor may read.
      Assert.Equal(200, (await ListAsync(Editor("it-a05-editor"))).StatusCode);
    });
  }

  [Fact]
  public async Task AddFeed_SuperAdmin_CreatesTarget()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "add");
      var url = Url("feed");

      var target = AutomationTestKit.Data(await AddAsync(Owner("it-a05-owner"), new { url, kind = "feed", feedFormat = "rss", deckId, itemTitlePattern = @"\m(S3|Lambda)\M" }));

      Assert.Equal(WatchTargetKeys, A05Kit.Keys(target));
      Assert.Equal(("feed", url, "rss", deckId, @"\m(S3|Lambda)\M", 360, "owner:it-a05-owner", true),
        (target.GetProperty("kind").GetString(), target.GetProperty("url").GetString(), target.GetProperty("feedFormat").GetString(),
          target.GetProperty("deckId").GetInt64(), target.GetProperty("itemTitlePattern").GetString(), target.GetProperty("checkIntervalMinutes").GetInt32(),
          target.GetProperty("createdBy").GetString(), target.GetProperty("active").GetBoolean()));
      Assert.Equal(JsonValueKind.Null, target.GetProperty("citingCards").ValueKind);
      Assert.Equal(1, await sql.CountAsync("select count(*) from source_watch_targets where url = $1 and kind = 'feed'", url));

      var hourly = AutomationTestKit.Data(await AddAsync(Owner("it-a05-owner"), new { url = Url("hourly"), kind = "feed", feedFormat = "html-headings", deckId, checkIntervalMinutes = 60 }));
      Assert.Equal((60, JsonValueKind.Null), (hourly.GetProperty("checkIntervalMinutes").GetInt32(), hourly.GetProperty("itemTitlePattern").ValueKind));

      object[] invalid =
      [
        new { url = Url("page"), kind = "page", feedFormat = "rss", deckId },
        new { url = Url("nokind"), feedFormat = "rss", deckId },
        new { url = "http://docs.example.com/plain", kind = "feed", feedFormat = "rss", deckId },
        new { url = "https://docs.example.com/" + new string('a', 2048), kind = "feed", feedFormat = "rss", deckId },
        new { url = Url("fmt"), kind = "feed", feedFormat = "json", deckId },
        new { url = Url("deck"), kind = "feed", feedFormat = "rss" },
        new { url = Url("interval"), kind = "feed", feedFormat = "rss", deckId, checkIntervalMinutes = 59 },
        new { url = Url("interval"), kind = "feed", feedFormat = "rss", deckId, checkIntervalMinutes = 43201 },
        new { url = Url("pattern"), kind = "feed", feedFormat = "rss", deckId, itemTitlePattern = new string('a', 1001) },
      ];
      foreach (var body in invalid) AutomationTestKit.AssertError(await AddAsync(Owner("it-a05-owner"), body), 400, "VALIDATION_ERROR");
    });
  }

  [Fact]
  public async Task AddFeed_InvalidPattern_Returns400WatchPatternInvalid()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "pattern");
      var url = Url("pattern");
      AutomationTestKit.AssertError(await AddAsync(Owner("it-a05-owner"), new { url, kind = "feed", feedFormat = "rss", deckId, itemTitlePattern = "(unclosed" }),
        400, "WATCH_PATTERN_INVALID");
      Assert.Equal(0, await sql.CountAsync("select count(*) from source_watch_targets where url = $1", url));
    });
  }

  [Fact]
  public async Task AddFeed_Duplicate_Returns409WatchTargetExists()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "dup");
      var url = Url("dup");
      AutomationTestKit.Data(await AddAsync(Owner("it-a05-owner"), new { url, kind = "feed", feedFormat = "rss", deckId }));
      AutomationTestKit.AssertError(await AddAsync(Owner("it-a05-owner"), new { url, kind = "feed", feedFormat = "atom", deckId }), 409, "WATCH_TARGET_EXISTS");
      // A seeded feed counts too.
      AutomationTestKit.AssertError(await AddAsync(Owner("it-a05-owner"),
        new { url = "https://aws.amazon.com/about-aws/whats-new/recent/feed/", kind = "feed", feedFormat = "rss", deckId }), 409, "WATCH_TARGET_EXISTS");
    });
  }

  [Fact]
  public async Task AddFeed_UnknownDeck_Returns404DeckNotFound()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "deleted");
      await sql.QueryAsync("update decks set is_deleted = 1 where id = $1", deckId);
      AutomationTestKit.AssertError(await AddAsync(Owner("it-a05-owner"), new { url = Url("deleted"), kind = "feed", feedFormat = "rss", deckId }), 404, "DECK_NOT_FOUND");
      AutomationTestKit.AssertError(await AddAsync(Owner("it-a05-owner"), new { url = Url("missing"), kind = "feed", feedFormat = "rss", deckId = 987654321 }), 404, "DECK_NOT_FOUND");
    });
  }

  [Fact]
  public async Task AddFeed_Editor_Returns403()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "editor");
      var url = Url("editor");
      Assert.Equal(403, (await AddAsync(Editor("it-a05-editor"), new { url, kind = "feed", feedFormat = "rss", deckId })).StatusCode);
      Assert.Equal(403, (await UpdateAsync(Editor("it-a05-editor"), "1", new { active = false })).StatusCode);
      Assert.Equal(0, await sql.CountAsync("select count(*) from source_watch_targets where url = $1", url));
    });
  }

  [Fact]
  public async Task UpdateTarget_ChangesActivePatternAndInterval()
  {
    await InScratchAsync(async sql =>
    {
      var deckId = await A05Kit.DeckAsync(sql, "update");
      var other = await A05Kit.DeckAsync(sql, "other");
      var id = await A05Kit.FeedAsync(sql, Url("update"), deckId, "rss", "S3");
      var key = id.ToString(CultureInfo.InvariantCulture);

      var updated = AutomationTestKit.Data(await UpdateAsync(Owner("it-a05-owner"), key,
        new { active = false, itemTitlePattern = @"\mLambda\M", checkIntervalMinutes = 120, deckId = other }));
      Assert.Equal((false, @"\mLambda\M", 120, other), (updated.GetProperty("active").GetBoolean(), updated.GetProperty("itemTitlePattern").GetString(),
        updated.GetProperty("checkIntervalMinutes").GetInt32(), updated.GetProperty("deckId").GetInt64()));

      // A subset leaves the rest alone; null clears the pattern and the deck.
      var cleared = AutomationTestKit.Data(await UpdateAsync(Owner("it-a05-owner"), key, new { itemTitlePattern = (string?)null, deckId = (long?)null }));
      Assert.Equal((false, JsonValueKind.Null, 120, JsonValueKind.Null), (cleared.GetProperty("active").GetBoolean(), cleared.GetProperty("itemTitlePattern").ValueKind,
        cleared.GetProperty("checkIntervalMinutes").GetInt32(), cleared.GetProperty("deckId").ValueKind));
      var unchanged = AutomationTestKit.Data(await UpdateAsync(Owner("it-a05-owner"), key, new { }));
      Assert.Equal(120, unchanged.GetProperty("checkIntervalMinutes").GetInt32());

      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), key, new { itemTitlePattern = "(unclosed" }), 400, "WATCH_PATTERN_INVALID");
      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), key, new { deckId = 987654321 }), 404, "DECK_NOT_FOUND");
      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), key, new { checkIntervalMinutes = 30 }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), key, new { active = "no" }), 400, "VALIDATION_ERROR");
      Assert.Equal(120, Convert.ToInt32(await sql.ScalarAsync("select check_interval_minutes from source_watch_targets where id = $1", id), CultureInfo.InvariantCulture));
    });
  }

  [Fact]
  public async Task UpdateTarget_Unknown_Returns404WatchTargetNotFound()
  {
    await InScratchAsync(async _ =>
    {
      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), "987654321", new { active = false }), 404, "WATCH_TARGET_NOT_FOUND");
      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), "abc", new { active = false }), 404, "WATCH_TARGET_NOT_FOUND");
      AutomationTestKit.AssertError(await UpdateAsync(Owner("it-a05-owner"), "-3", new { active = false }), 404, "WATCH_TARGET_NOT_FOUND");
    });
  }
}
