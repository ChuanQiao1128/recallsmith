using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R20 V07 change impact (contract R20-00 §6): the cards a changed or gone cited page affects (exact source URL, live
/// cards only, capped), the human-review flag when the AI QA re-check is unavailable, the possibly affected cards of a
/// new release-notes item by PostgreSQL full-text search, the watch route, the emails and the status count. Everything
/// is deterministic and runs with AI QA on or off; no card is ever edited. Scratch databases, synthetic card text.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ChangeImpactTests
{
  private const string Scratch = "it_v07_impact";
  private readonly PostgresFixture _db;

  public ChangeImpactTests(PostgresFixture db) => _db = db;

  private Task InScratchAsync(Func<A04Kit.Scope, A04Kit.Sql, Task> body, int maxVersion = int.MaxValue) =>
    A05Kit.WithScopeAsync(scope => A05Kit.InScratchAsync(_db, Scratch, sql => body(scope, sql), maxVersion));

  private static string Url(string tag) => $"https://docs.example.com/v07/{tag}/{Guid.NewGuid():N}";

  private static readonly string[] AffectedKeys = ["cardId", "deckId", "deckSlug", "stableUid", "question", "quoteMissing"];
  private static readonly string[] PossiblyAffectedKeys = ["cardId", "deckId", "deckSlug", "stableUid", "question", "rank"];
  private static readonly string[] FeedItemKeys = ["id", "title", "url", "firstSeenAt", "possiblyAffectedCards"];

  private static async Task<long> CardAsync(A04Kit.Sql sql, long deckId, string question, string explanation, string? url = null, int isDeleted = 0) =>
    A04Kit.Long(await sql.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, is_deleted, source) " +
      "values ($1, $2, $3, $4, 2, (select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1), $5, $6::jsonb) returning id",
      deckId, $"v07-{Guid.NewGuid():N}"[..30], question, explanation, isDeleted,
      url is null ? null : JsonSerializer.Serialize(new { url, quote = "Synthetic quote." })));

  private static async Task<long> BaselinedPageAsync(A04Kit.Sql sql, string url, string tag)
  {
    var target = (await A05Kit.TargetsDataAsync()).GetProperty("targets").EnumerateArray().Single(t => t.GetProperty("url").GetString() == url);
    var pageId = target.GetProperty("targetId").GetInt64();
    await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "ok", A05Kit.Sha($"{tag}-v1")));
    return pageId;
  }

  private static async Task<JsonElement> LastEventDetailsAsync(A04Kit.Sql sql, long targetId) =>
    A05Kit.Json((await A05Kit.EventsAsync(sql, targetId)).Last()["details"]);

  private static Task<APIGatewayProxyResponse> WatchAsync() =>
    AutomationTestKit.CallAsync(WatchAdminRoutes.HandleWatch, "GET", "/api/v1/admin/automation/watch", null, AutomationTestKit.Ctx("it-v07-owner", agent: false));

  // ---------------------------------------------------------------- page events: affected cards

  [Fact]
  public async Task Report_PageChanged_StoresAffectedCardsByExactUrl()
  {
    await InScratchAsync(async (scope, sql) =>
    {
      var deckA = await A05Kit.DeckAsync(sql, "v07-a");
      var deckB = await A05Kit.DeckAsync(sql, "v07-b");
      var deadDeck = await A05Kit.DeckAsync(sql, "v07-dead");
      var url = Url("exact");
      var a1 = await CardAsync(sql, deckA, "Synthetic question one?", "Synthetic explanation.", url);
      var a2 = await CardAsync(sql, deckA, "Synthetic question two?", "Synthetic explanation.", url);
      var b1 = await CardAsync(sql, deckB, "Synthetic question three?", "Synthetic explanation.", url);
      await CardAsync(sql, deckA, "Deleted card?", "Synthetic explanation.", url, isDeleted: 1);
      await CardAsync(sql, deckA, "Other page?", "Synthetic explanation.", url + "?variant=1");
      await CardAsync(sql, deadDeck, "Card in a deleted deck?", "Synthetic explanation.", url);
      await sql.ScalarAsync("update decks set is_deleted = 1 where id = $1", deadDeck);
      var pageId = await BaselinedPageAsync(sql, url, "exact");
      var before = await sql.QueryAsync("select id, question, explanation, updated_at, is_deleted, revision from cards order by id");

      await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "ok", A05Kit.Sha("exact-v2"), missingQuoteCardIds: [a2]));

      var details = await LastEventDetailsAsync(sql, pageId);
      var affected = details.GetProperty("affectedCards").EnumerateArray().ToList();
      Assert.Equal([a1, a2, b1], affected.Select(c => c.GetProperty("cardId").GetInt64()).ToArray());
      // jsonb stores keys in its own order; the watch route answers them in the contract order.
      Assert.All(affected, c => Assert.Equal(AffectedKeys.Order(), A05Kit.Keys(c).Order()));
      Assert.Equal([false, true, false], affected.Select(c => c.GetProperty("quoteMissing").GetBoolean()).ToArray());
      var slugA = (string)(await sql.ScalarAsync("select slug from decks where id = $1", deckA))!;
      Assert.Equal((deckA, slugA, "Synthetic question one?"), (affected[0].GetProperty("deckId").GetInt64(),
        affected[0].GetProperty("deckSlug").GetString(), affected[0].GetProperty("question").GetString()));
      Assert.Equal(deckB, affected[2].GetProperty("deckId").GetInt64());
      // AI QA is on in this scope: both re-checks started, so no human review is flagged.
      Assert.Equal(2, scope.QaSent.Count);
      Assert.False(details.GetProperty("needsHumanReview").GetBoolean());

      // Never edits a card.
      var after = await sql.QueryAsync("select id, question, explanation, updated_at, is_deleted, revision from cards order by id");
      Assert.Equal(before.Select(r => string.Join('|', r.Values)), after.Select(r => string.Join('|', r.Values)));
    });
  }

  [Fact]
  public async Task Report_AffectedCards_AreCappedAt200()
  {
    await InScratchAsync(async (scope, sql) =>
    {
      scope.Set(QaGate.EnabledEnv, "0");
      var deckId = await A05Kit.DeckAsync(sql, "v07-cap");
      var url = Url("cap");
      await sql.ScalarAsync(
        """
        insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, source)
        select $1, 'v07-cap-' || g, 'Synthetic capped question ' || g || '?', 'Synthetic explanation.', 2, g * 10, $2::jsonb
        from generate_series(1, 205) g
        """, deckId, JsonSerializer.Serialize(new { url, quote = "Synthetic quote." }));
      var pageId = await BaselinedPageAsync(sql, url, "cap");

      await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "gone"));

      var details = await LastEventDetailsAsync(sql, pageId);
      var ids = details.GetProperty("affectedCards").EnumerateArray().Select(c => c.GetProperty("cardId").GetInt64()).ToArray();
      Assert.Equal(ChangeImpact.MaxAffectedCards, ids.Length);
      Assert.Equal(200, ChangeImpact.MaxAffectedCards);
      var expected = (await sql.QueryAsync("select id from cards where deck_id = $1 order by id limit 200", deckId)).Select(r => A04Kit.Long(r["id"])).ToArray();
      Assert.Equal(expected, ids);
      Assert.Equal(205, details.GetProperty("citingCards").GetInt32());
      Assert.True(details.GetProperty("needsHumanReview").GetBoolean());
    });
  }

  [Fact]
  public async Task Report_AiQaOff_FlagsHumanReview_AndTheEmailListsEditLinks()
  {
    await InScratchAsync(async (scope, sql) =>
    {
      scope.Set(QaGate.EnabledEnv, "0");
      var deckId = await A05Kit.DeckAsync(sql, "v07-off");
      var url = Url("qa-off");
      var c1 = await CardAsync(sql, deckId, "Synthetic question about retries?", "Synthetic explanation.", url);
      var c2 = await CardAsync(sql, deckId, "Synthetic question about limits?", "Synthetic explanation.", url);
      var pageId = await BaselinedPageAsync(sql, url, "off");
      var before = await sql.QueryAsync("select id, question, updated_at, revision from cards order by id");

      await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "ok", A05Kit.Sha("off-v2"), missingQuoteCardIds: [c2]));

      var ev = (await A05Kit.EventsAsync(sql, pageId)).Last();
      Assert.Equal(("changed", "unavailable"), ((string)ev["kind"]!, (string)ev["recheck_state"]!));
      var details = A05Kit.Json(ev["details"]);
      Assert.True(details.GetProperty("needsHumanReview").GetBoolean());
      Assert.Equal([c1, c2], details.GetProperty("affectedCards").EnumerateArray().Select(c => c.GetProperty("cardId").GetInt64()).ToArray());
      Assert.Empty(scope.QaSent);

      // The tick's step 8 sends the source_changed email with a console edit link per affected card.
      await A04Kit.TickAsync();
      var message = Assert.Single(A04Kit.Messages(scope, "Source changed"));
      var text = message.GetProperty("text").GetString()!;
      var d = deckId.ToString(CultureInfo.InvariantCulture);
      Assert.Contains($"https://console.example.com/decks/cards/edit?deckId={d}&cardId={c1.ToString(CultureInfo.InvariantCulture)}", text);
      Assert.Contains($"https://console.example.com/decks/cards/edit?deckId={d}&cardId={c2.ToString(CultureInfo.InvariantCulture)}", text);
      Assert.Contains("The AI QA re-check is unavailable: 2 card(s) need a human review.", text);
      Assert.Contains("(quote missing)", text);

      // The status counts it; the watch route shows it.
      var status = AutomationTestKit.Data(await AutomationTestKit.CallAsync(StatusRoutes.HandleStatus, "GET", "/api/v1/admin/automation/status", null,
        AutomationTestKit.Ctx("it-v07-owner", agent: false)));
      Assert.Equal(1, status.GetProperty("watch").GetProperty("needsReview").GetInt64());
      var watchEvent = AutomationTestKit.Data(await WatchAsync()).GetProperty("recentEvents").EnumerateArray()
        .First(e => e.GetProperty("targetId").GetInt64() == pageId);
      Assert.True(watchEvent.GetProperty("needsHumanReview").GetBoolean());
      Assert.Equal(2, watchEvent.GetProperty("affectedCards").GetArrayLength());
      Assert.All(watchEvent.GetProperty("affectedCards").EnumerateArray(), c => Assert.Equal(AffectedKeys, A05Kit.Keys(c)));

      var after = await sql.QueryAsync("select id, question, updated_at, revision from cards order by id");
      Assert.Equal(before.Select(r => string.Join('|', r.Values)), after.Select(r => string.Join('|', r.Values)));
    });
  }

  [Fact]
  public async Task Report_PageWithoutCitingCards_NeedsNoReview()
  {
    await InScratchAsync(async (scope, sql) =>
    {
      scope.Set(QaGate.EnabledEnv, "0");
      var url = Url("uncited");
      var pageId = await A05Kit.PageAsync(sql, url);
      await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "ok", A05Kit.Sha("uncited-v1")));

      await A05Kit.ReportDataAsync(A05Kit.Obs(pageId, url, "gone"));

      var details = await LastEventDetailsAsync(sql, pageId);
      Assert.Empty(details.GetProperty("affectedCards").EnumerateArray());
      Assert.False(details.GetProperty("needsHumanReview").GetBoolean());
    });
  }

  // ---------------------------------------------------------------- feed items: full-text search

  private static async Task<(long DeckId, long Relevant, long Partial, long Unrelated, long Deleted)> FtsCardsAsync(A04Kit.Sql sql)
  {
    var deckId = await A05Kit.DeckAsync(sql, "v07-fts");
    var relevant = await CardAsync(sql, deckId, "What do S3 conditional writes prevent?",
      "Amazon S3 conditional writes use If-None-Match, so a PUT fails when the object already exists and no write is lost.");
    var partial = await CardAsync(sql, deckId, "What is an S3 bucket?", "A bucket is a container for objects stored in Amazon S3.");
    var unrelated = await CardAsync(sql, deckId, "How does DynamoDB TTL expire items?", "Items expire after the timestamp attribute passes.");
    var deleted = await CardAsync(sql, deckId, "Do S3 conditional writes support If-None-Match?", "Amazon S3 conditional writes accept If-None-Match.",
      isDeleted: 1);
    return (deckId, relevant, partial, unrelated, deleted);
  }

  [Fact]
  public async Task PossiblyAffected_RanksTheRelevantCardFirst_AndDropsBelowTheMinimumRank()
  {
    await InScratchAsync(async (_, sql) =>
    {
      var cards = await FtsCardsAsync(sql);
      await using var conn = await sql.OpenAsync();

      var matches = await ChangeImpact.PossiblyAffectedAsync(conn, null, "Amazon S3 now supports conditional writes", null);
      Assert.Equal(cards.Relevant, matches[0].CardId);
      Assert.Equal([cards.Relevant, cards.Partial], matches.Select(m => m.CardId).ToArray());
      Assert.True(matches[0].Rank > matches[1].Rank);
      Assert.All(matches, m => Assert.True(m.Rank >= ChangeImpact.MinFeedRank));

      // One query term once ("amazon" in the bucket card) ranks 0.1, below the documented minimum 0.2.
      Assert.Equal(0.2, ChangeImpact.MinFeedRank);
      Assert.Empty(await ChangeImpact.PossiblyAffectedAsync(conn, null, "Amazon Bedrock adds a synthetic model", null));
      // Stop words only, or nothing: no query, no match.
      Assert.Empty(await ChangeImpact.PossiblyAffectedAsync(conn, null, "the and of", null));
      Assert.Empty(await ChangeImpact.PossiblyAffectedAsync(conn, null, "   ", null));
      // A deck scope keeps other decks' cards out.
      var otherDeck = await A05Kit.DeckAsync(sql, "v07-fts-other");
      Assert.Empty(await ChangeImpact.PossiblyAffectedAsync(conn, null, "Amazon S3 now supports conditional writes", otherDeck));
    });
  }

  [Fact]
  public async Task Report_NewFeedItem_StoresPossiblyAffectedCards_AndTheWatchRouteListsIt()
  {
    await InScratchAsync(async (scope, sql) =>
    {
      scope.Set(QaGate.EnabledEnv, "0");
      var cards = await FtsCardsAsync(sql);
      var feedUrl = Url("feed");
      var feedId = await A05Kit.FeedAsync(sql, feedUrl, cards.DeckId);
      var old = Url("old");
      await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("feed-1"), feedItems: [A05Kit.Item(old, "Amazon S3 conditional writes")]));
      // A baseline item is not new: it gets no analysis.
      Assert.Null((await sql.QueryAsync("select possibly_affected_cards from source_watch_feed_items where target_id = $1", feedId)).Single()["possibly_affected_cards"]);

      var fresh = Url("fresh");
      var bedrock = Url("bedrock");
      await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("feed-2"), feedItems:
      [
        A05Kit.Item(old, "Amazon S3 conditional writes"),
        new { url = fresh, title = "Amazon S3 update", summary = "S3 now supports conditional writes for more operations.", publishedAt = (string?)null },
        A05Kit.Item(bedrock, "Amazon Bedrock adds a synthetic model"),
      ]));

      var stored = (await sql.QueryAsync("select item_key, possibly_affected_cards::text as cards from source_watch_feed_items where target_id = $1", feedId))
        .ToDictionary(r => (string)r["item_key"]!, r => r["cards"] as string);
      var freshCards = A05Kit.Json(stored[A05Kit.Sha(fresh)]).EnumerateArray().ToList();
      Assert.Equal(cards.Relevant, freshCards[0].GetProperty("cardId").GetInt64());
      Assert.DoesNotContain(freshCards, c => c.GetProperty("cardId").GetInt64() is var id && (id == cards.Unrelated || id == cards.Deleted));
      Assert.All(freshCards, c => Assert.Equal(PossiblyAffectedKeys.Order(), A05Kit.Keys(c).Order()));
      Assert.True(freshCards.Count <= ChangeImpact.MaxPossiblyAffectedCards);
      Assert.Empty(A05Kit.Json(stored[A05Kit.Sha(bedrock)]).EnumerateArray());

      var data = AutomationTestKit.Data(await WatchAsync());
      Assert.Equal(["items", "recentEvents", "nextCursor", "recentFeedItems"], A05Kit.Keys(data));
      var items = data.GetProperty("recentFeedItems").EnumerateArray().ToList();
      Assert.Equal(2, items.Count);
      Assert.All(items, i => Assert.Equal(FeedItemKeys, A05Kit.Keys(i)));
      var listed = items.Single(i => i.GetProperty("url").GetString() == fresh);
      Assert.Equal(($"{feedId}:{A05Kit.Sha(fresh)}", "Amazon S3 update"), (listed.GetProperty("id").GetString(), listed.GetProperty("title").GetString()));
      Assert.EndsWith("Z", listed.GetProperty("firstSeenAt").GetString());
      Assert.Equal(cards.Relevant, listed.GetProperty("possiblyAffectedCards")[0].GetProperty("cardId").GetInt64());
      Assert.Equal(PossiblyAffectedKeys, A05Kit.Keys(listed.GetProperty("possiblyAffectedCards")[0]));

      // The weekly digest lists the item with its possibly affected cards.
      await sql.ScalarAsync("update source_watch_feed_items set first_seen_at = now() - interval '2 days' where target_id = $1", feedId);
      await A04Kit.TickAsync("digest");
      var digest = Assert.Single(A04Kit.Messages(scope, "Weekly automation digest")).GetProperty("text").GetString()!;
      var uid = (string)(await sql.ScalarAsync("select stable_uid from cards where id = $1", cards.Relevant))!;
      Assert.Contains("Release note Amazon S3 update", digest);
      Assert.Contains(uid, digest);
      Assert.Contains("Release notes: 2 new, 1 with possibly affected card(s)", digest);
      Assert.DoesNotContain("Release note Amazon Bedrock", digest);
    });
  }

  [Fact]
  public async Task BeforeMigration039_ReportAndWatchStillWork()
  {
    await InScratchAsync(async (scope, sql) =>
    {
      scope.Set(QaGate.EnabledEnv, "0");
      var cards = await FtsCardsAsync(sql);
      var feedUrl = Url("premigration");
      var feedId = await A05Kit.FeedAsync(sql, feedUrl, cards.DeckId);
      await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("pre-1"), feedItems: [A05Kit.Item(Url("a"), "Amazon S3 news")]));

      var data = await A05Kit.ReportDataAsync(A05Kit.Obs(feedId, feedUrl, "ok", A05Kit.Sha("pre-2"), feedItems: [A05Kit.Item(Url("b"), "Amazon S3 conditional writes")]));

      Assert.Equal(1, data.GetProperty("queued").GetInt32());
      var watch = AutomationTestKit.Data(await WatchAsync());
      Assert.Empty(watch.GetProperty("recentFeedItems").EnumerateArray());
      await A04Kit.TickAsync("digest");
      Assert.Contains("Release notes: 0 new, 0 with possibly affected card(s)",
        Assert.Single(A04Kit.Messages(scope, "Weekly automation digest")).GetProperty("text").GetString()!);
    }, maxVersion: 38);
  }
}

/// <summary>R20 V07: the change-impact lines of the source_changed email and the weekly digest (pure templates).</summary>
public class ChangeImpactEmailTests
{
  private const string Console = "https://console.developercards.app";

  private static AffectedCard Affected(int i) => new(1000 + i, 12, "aws-saa-c03", $"aws-s3-synthetic-{i:D2}", $"Synthetic question {i}?", i == 1);

  [Fact]
  public void SourceChanged_ListsAtMost20AffectedCards_WithEditLinks()
  {
    var data = EmailTemplatesTests.Source() with
    {
      Decks = [], RecheckState = "unavailable", NeedsHumanReview = true, AffectedCards = [.. Enumerable.Range(1, 25).Select(Affected)],
    };
    var body = EmailTemplates.SourceChanged("live", data, Console).BodyText;

    var links = body.Split('\n').Where(l => l.Contains("/decks/cards/edit?", StringComparison.Ordinal)).ToList();
    Assert.Equal(20, links.Count);
    Assert.Equal("- aws-s3-synthetic-01 (aws-saa-c03) — Synthetic question 1? (quote missing) — https://console.developercards.app/decks/cards/edit?deckId=12&cardId=1001",
      links[0]);
    Assert.Contains("- … and 5 more affected card(s) — https://console.developercards.app/automation?tab=watch&targetId=5", body);
    Assert.Contains("The AI QA re-check is unavailable: 25 card(s) need a human review.", body);
    Assert.Contains("Affected cards: 25 (needs human review: yes)", body);
    Assert.True(body.IndexOf("NEEDS YOU", StringComparison.Ordinal) < body.IndexOf(links[0], StringComparison.Ordinal));
    Assert.True(body.IndexOf(links[^1], StringComparison.Ordinal) < body.IndexOf("DONE AUTOMATICALLY", StringComparison.Ordinal));
  }

  [Fact]
  public void SourceChanged_RecheckStarted_ListsAffectedCardsUnderDetails()
  {
    var data = EmailTemplatesTests.Source() with { AffectedCards = [Affected(2)] };
    var body = EmailTemplates.SourceChanged("live", data, Console).BodyText;

    Assert.DoesNotContain("need a human review", body);
    Assert.Contains("Affected cards: 1 (needs human review: no)", body);
    Assert.Contains("Affected card aws-s3-synthetic-02 (aws-saa-c03) — Synthetic question 2? — https://console.developercards.app/decks/cards/edit?deckId=12&cardId=1002", body);
    Assert.True(body.IndexOf("DETAILS", StringComparison.Ordinal) < body.IndexOf("Affected card aws-s3", StringComparison.Ordinal));
  }

  [Fact]
  public void WeeklyDigest_ListsFeedItemsWithPossiblyAffectedCards()
  {
    var item = new DigestFeedItem("Amazon S3 adds synthetic writes", "https://aws.amazon.com/about-aws/whats-new/2026/09/synthetic/",
      [new PossiblyAffectedCard(1001, 12, "aws-saa-c03", "aws-s3-synthetic-01", "Synthetic question?", 0.7)]);
    var data = EmailTemplatesTests.Digest() with { FeedItemsNew = 3, FeedItems = [item] };
    var body = EmailTemplates.WeeklyDigest("live", data, Console).BodyText;

    Assert.Contains("- 1 release note(s) may affect existing cards — https://console.developercards.app/automation?tab=watch", body);
    Assert.Contains("Release notes: 3 new, 1 with possibly affected card(s)", body);
    Assert.Contains("Release note Amazon S3 adds synthetic writes (https://aws.amazon.com/about-aws/whats-new/2026/09/synthetic/): possibly affects " +
      "aws-s3-synthetic-01 (aws-saa-c03, rank 0.70) — https://console.developercards.app/decks/cards/edit?deckId=12&cardId=1001", body);
  }
}
