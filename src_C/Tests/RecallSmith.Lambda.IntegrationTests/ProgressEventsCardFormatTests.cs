using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The ingest tags every analytics_event_outbox payload with card_format:
/// 'mcq' when the reviewed card's cards.mcq is non-null, else 'qa' (an unknown
/// card, a deleted card and a deleted deck all read 'qa'). The value is read
/// from content the server already owns, joined in the outbox CTE.
///
/// Asserted through the outbox row rather than a statement-log probe on purpose:
/// F5 (ProgressEventsSingleStatementTests) already owns the one-statement claim
/// on the migrated fixture, and repeating a log probe here would only make this
/// class slower without proving anything new. What this class proves is the
/// value the payload carries, per card and per event.
///
/// The fallback case moves PGDATABASE to a scratch database frozen before
/// migration 019 (no cards.mcq), so it exercises the 42703 path; it restores
/// PGDATABASE in a finally so every later class in the serial collection still
/// runs against the shared database.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ProgressEventsCardFormatTests
{
  private readonly PostgresFixture _db;

  private const long OneDayMs = 24L * 60 * 60 * 1000;
  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  // The tag depends only on `mcq is not null`, never on the blob's text: this
  // is the canonical MCQ shape (C00 §2.9.1) with placeholder options, not exam
  // content, and no validation runs on a direct insert.
  private const string McqBlob = """{"v":1,"options":[{"key":"a","why":null,"text":"placeholder a","correct":true},{"key":"b","why":"placeholder why b","text":"placeholder b","correct":false},{"key":"c","why":"placeholder why c","text":"placeholder c","correct":false},{"key":"d","why":"placeholder why d","text":"placeholder d","correct":false}],"shuffle":true,"qualifier":null}""";

  public ProgressEventsCardFormatTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private int _n;

  private static string NewUser(string tag) => $"it-cardformat-{tag}-{Guid.NewGuid():N}";

  private static string NewEventId() => Guid.NewGuid().ToString("D").ToLowerInvariant();

  private static string NewSlug(string tag) => $"it-cardformat-{tag}-{Guid.NewGuid():N}";

  private static string NewUid() => $"uid-{Guid.NewGuid():N}";

  private object Ev(string eventId, string deckSlug, string stableUid)
  {
    var eventTimeMs = Base + _n++;
    return new
    {
      eventId,
      deckSlug,
      stableUid,
      rating = 3,
      eventTimeMs,
      nextReviewAtMs = eventTimeMs + OneDayMs,
      sessionId = "sess-cardformat",
      progressAfter = new { stage = 2 },
    };
  }

  private static object Batch(IEnumerable<object> events) => new
  {
    deviceId = "device-under-test",
    clientVersion = "1.2.3",
    clientPlatform = "ios",
    events = events.ToList(),
  };

  private static Task<JsonElement> PostAsync(string user, IEnumerable<object> events) =>
    LambdaHost.PostProgressEventsAsync(user, Batch(events));

  private async Task<long> NewDeckAsync(string slug, int isDeleted = 0)
  {
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author, is_deleted) values ($1, $2, $3, $4) returning id",
      slug, "deck", "tests", isDeleted);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<long> NewQaCardAsync(long deckId, string uid, int order, int isDeleted = 0)
  {
    // mcq is not named, so it keeps its column default (null): no null jsonb
    // parameter is ever bound, and this is the only kind of card that existed
    // before migration 019.
    var rows = await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck, is_deleted) values ($1, $2, 'q', 'e', $3, $4) returning id",
      deckId, uid, order, isDeleted);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<long> NewMcqCardAsync(long deckId, string uid, int order, int isDeleted = 0)
  {
    // Explicit ::jsonb cast: AddWithValue binds the blob string as text.
    var rows = await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck, is_deleted, mcq) values ($1, $2, 'q', 'e', $3, $4, $5::jsonb) returning id",
      deckId, uid, order, isDeleted, McqBlob);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<(string AggregateId, JsonElement Payload)> OutboxRowAsync(string eventId)
  {
    var rows = await _db.QueryAsync(
      "select aggregate_id, payload::text as payload from analytics_event_outbox where event_id = $1::uuid",
      eventId);
    Assert.Single(rows);
    var aggregateId = (string)rows[0]["aggregate_id"]!;
    using var doc = JsonDocument.Parse((string)rows[0]["payload"]!);
    return (aggregateId, doc.RootElement.Clone());
  }

  private async Task<int> OutboxRowsForUserAsync(string user) => Convert.ToInt32(
    await _db.ScalarAsync(
      """
      select count(*)
      from analytics_event_outbox o
      join user_progress_events e on e.event_id = o.event_id
      where e.user_sub = $1
      """,
      user),
    CultureInfo.InvariantCulture);

  // ------------------------------------------------------------------ table

  [Theory]
  [InlineData("qa", "qa")]
  [InlineData("mcq", "mcq")]
  [InlineData("card-deleted", "qa")]
  [InlineData("deck-deleted", "qa")]
  [InlineData("missing", "qa")]
  public async Task OutboxPayload_CardFormat_FollowsTheCardsRow(string kind, string expected)
  {
    var slug = NewSlug(kind);
    var uid = NewUid();

    switch (kind)
    {
      case "qa":
      {
        var deckId = await NewDeckAsync(slug);
        await NewQaCardAsync(deckId, uid, order: 1);
        break;
      }
      case "mcq":
      {
        var deckId = await NewDeckAsync(slug);
        await NewMcqCardAsync(deckId, uid, order: 1);
        break;
      }
      case "card-deleted":
      {
        // A deleted MCQ card: the c.is_deleted = 0 predicate drops it, so the
        // left join finds no live card and the tag is 'qa'.
        var deckId = await NewDeckAsync(slug);
        await NewMcqCardAsync(deckId, uid, order: 1, isDeleted: 1);
        break;
      }
      case "deck-deleted":
      {
        // A live MCQ card under a deleted deck: the d.is_deleted = 0 predicate
        // drops the deck, so the tag is 'qa'.
        var deckId = await NewDeckAsync(slug, isDeleted: 1);
        await NewMcqCardAsync(deckId, uid, order: 1);
        break;
      }
      case "missing":
        // No deck row and no card row at all: the left join finds nothing.
        break;
      default:
        throw new Xunit.Sdk.XunitException($"unhandled kind {kind}");
    }

    var user = NewUser(kind);
    var eventId = NewEventId();
    var data = await PostAsync(user, [Ev(eventId, slug, uid)]);
    Assert.Equal(1, data.GetProperty("acceptedCount").GetInt32());

    var (aggregateId, payload) = await OutboxRowAsync(eventId);
    Assert.Equal(expected, payload.GetProperty("card_format").GetString());
    Assert.Equal(uid, payload.GetProperty("card_stable_uid").GetString());
    Assert.Equal(slug, payload.GetProperty("deck_slug").GetString());
    Assert.Equal("1.2.3", payload.GetProperty("app_version").GetString());
    Assert.Equal($"{slug}:{uid}", aggregateId);
  }

  // ------------------------------------------------------------------ batch

  [Fact]
  public async Task MixedBatch_TagsEachEventByItsOwnDeckAndUid_OneOutboxRowPerEvent()
  {
    var slugA = NewSlug("mix-a");
    var slugB = NewSlug("mix-b");
    var uidQa = NewUid();
    var uidMcq = NewUid();
    var uidUnknown = NewUid();

    var deckA = await NewDeckAsync(slugA);
    await NewQaCardAsync(deckA, uidQa, order: 1);
    await NewMcqCardAsync(deckA, uidMcq, order: 2);

    // Deck B reuses uidQa on an MCQ card. uq_cards_deck_uid is per deck, so
    // this is legal; the join must key on deck AND uid, or deck B's format
    // would leak into deck A's event.
    var deckB = await NewDeckAsync(slugB);
    await NewMcqCardAsync(deckB, uidQa, order: 1);

    var user = NewUser("mix");
    var idAQa = NewEventId();
    var idAMcq = NewEventId();
    var idAUnknown = NewEventId();
    var idBQa = NewEventId();

    var events = new List<object>
    {
      Ev(idAQa, slugA, uidQa),
      Ev(idAMcq, slugA, uidMcq),
      Ev(idAUnknown, slugA, uidUnknown),
      Ev(idBQa, slugB, uidQa),
    };

    var data = await PostAsync(user, events);
    Assert.Equal(4, data.GetProperty("acceptedCount").GetInt32());
    Assert.Equal(4, await OutboxRowsForUserAsync(user));

    Assert.Equal("qa", (await OutboxRowAsync(idAQa)).Payload.GetProperty("card_format").GetString());
    Assert.Equal("mcq", (await OutboxRowAsync(idAMcq)).Payload.GetProperty("card_format").GetString());
    Assert.Equal("qa", (await OutboxRowAsync(idAUnknown)).Payload.GetProperty("card_format").GetString());
    Assert.Equal("mcq", (await OutboxRowAsync(idBQa)).Payload.GetProperty("card_format").GetString());

    // Replay the same batch: the outbox on conflict (event_id) do nothing is
    // unchanged by the join, so nothing new lands.
    var replay = await PostAsync(user, events);
    Assert.Equal(0, replay.GetProperty("acceptedCount").GetInt32());
    Assert.Equal(4, replay.GetProperty("duplicateEventIds").GetArrayLength());
    Assert.Equal(4, await OutboxRowsForUserAsync(user));
  }

  // --------------------------------------------------------------- fallback

  [Fact]
  public async Task WithoutTheMcqColumn_IngestFallsBackToTheLegacyStatement()
  {
    // Premise: the shared database really has cards.mcq, so the other cases
    // exercised the join rather than silently falling back.
    Assert.Equal(1, Convert.ToInt32(
      await _db.ScalarAsync(
        "select count(*) from information_schema.columns where table_name = 'cards' and column_name = 'mcq'"),
      CultureInfo.InvariantCulture));

    var scratchCs = await _db.CreateScratchDatabaseAsync("c10_no_mcq");
    await using var conn = new NpgsqlConnection(scratchCs);
    await conn.OpenAsync();
    // 018 = cards.topic (C05); 019 = cards.mcq (C08), deliberately not applied.
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 18);
    Assert.Equal(0, Convert.ToInt32(
      await DbUtil.ExecuteScalarAsync(
        conn, null,
        "select count(*) from information_schema.columns where table_name = 'cards' and column_name = 'mcq'",
        []),
      CultureInfo.InvariantCulture));

    var prevDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", "c10_no_mcq");
    Pg.Reset();
    try
    {
      var user = NewUser("fallback");
      var slug = NewSlug("fallback");
      var uid = NewUid();
      var eventId = NewEventId();

      // No seeding: the legacy text has no join, so the card need not exist.
      var data = await PostAsync(user, [Ev(eventId, slug, uid)]);
      Assert.Equal(1, data.GetProperty("acceptedCount").GetInt32());

      var rows = await DbUtil.QueryAsync(
        conn, null,
        "select aggregate_id, payload::text as payload from analytics_event_outbox where event_id = $1::uuid",
        [eventId]);
      Assert.Single(rows);
      var aggregateId = (string)rows[0]["aggregate_id"]!;
      using var doc = JsonDocument.Parse((string)rows[0]["payload"]!);
      var payload = doc.RootElement;

      Assert.False(payload.TryGetProperty("card_format", out _));
      Assert.Equal(uid, payload.GetProperty("card_stable_uid").GetString());
      Assert.Equal($"{slug}:{uid}", aggregateId);

      // The rest of the statement still ran: user_progress has the row.
      Assert.Equal(1, Convert.ToInt32(
        await DbUtil.ExecuteScalarAsync(
          conn, null, "select count(*) from user_progress where user_sub = $1", [user]),
        CultureInfo.InvariantCulture));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", prevDb);
      Pg.Reset();
    }

    // The env swap is undone and the tagged text is back: a fresh event on the
    // shared database carries card_format again.
    var afterUser = NewUser("fallback-after");
    var afterSlug = NewSlug("fallback-after");
    var afterUid = NewUid();
    var afterId = NewEventId();
    var afterData = await PostAsync(afterUser, [Ev(afterId, afterSlug, afterUid)]);
    Assert.Equal(1, afterData.GetProperty("acceptedCount").GetInt32());
    Assert.Equal("qa", (await OutboxRowAsync(afterId)).Payload.GetProperty("card_format").GetString());
  }
}
