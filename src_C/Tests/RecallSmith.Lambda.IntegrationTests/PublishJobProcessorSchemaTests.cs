using System.Globalization;
using System.Text.Json;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// PublishJobProcessor.LoadCardsAsync against the three schemas the Worker sees in
/// the wild: pre-018 (no topic, no mcq), 018-only (topic but no mcq), and full.
/// deploy.sh does not run migrations, and Migrate.ApplyOne commits each file in its
/// own transaction, so a failed 019 leaves a real, persistent 018-only database —
/// the Worker must survive all three. The 42703 fallback (11 -> 10 -> 9 columns)
/// keeps topic in an 018-only export and maps a missing column to null, never "".
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishJobProcessorSchemaTests
{
  private readonly PostgresFixture _db;

  public PublishJobProcessorSchemaTests(PostgresFixture db) => _db = db;

  // Authoring order (what deckImport writes): PG re-orders to v, options, shuffle, qualifier
  // and key, why, text, correct on the round trip. The raw string appears verbatim.
  private const string AuthoringOrderMcq =
    """{"v":1,"qualifier":null,"shuffle":true,"options":[{"key":"a","text":"queue","why":null,"correct":true},{"key":"b","text":"resize","why":"no buffer","correct":false},{"key":"c","text":"stream","why":"one shard","correct":false}]}""";

  // Change 7's compact canonical form (PG key order), what ContentJson emits after the round trip.
  private const string McqJson =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private static async Task<int> NewDeckAsync(Npgsql.NpgsqlConnection conn, string tag)
  {
    var rows = await DbUtil.QueryAsync(
      conn, null,
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      [$"it-c09schema-{tag}-{Guid.NewGuid():N}", $"deck {tag}", "tests"]);
    return (int)Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  [Fact]
  public async Task LoadCards_PreTopicSchema_FallsBackToLegacyColumns()
  {
    var connectionString = await _db.CreateScratchDatabaseAsync("c09_pre018");

    await using var conn = new Npgsql.NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 17);

    var deckId = await NewDeckAsync(conn, "pre018");
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4)",
      [deckId, "uid-1", "q", 1]);

    var cards = await PublishJobProcessor.LoadCardsAsync(conn, deckId);

    var card = Assert.Single(cards);
    Assert.Equal("q", card.Question);
    Assert.Null(card.Topic);
    Assert.Null(card.Mcq);
  }

  [Fact]
  public async Task LoadCards_TopicOnlySchema_KeepsTopicAndNullMcq()
  {
    var connectionString = await _db.CreateScratchDatabaseAsync("c09_only018");

    await using var conn = new Npgsql.NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 18);

    var deckId = await NewDeckAsync(conn, "only018");
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, order_in_deck, topic) values ($1, $2, $3, $4, $5)",
      [deckId, "uid-1", "q", 1, "t"]);

    var cards = await PublishJobProcessor.LoadCardsAsync(conn, deckId);

    var card = Assert.Single(cards);
    Assert.Equal("t", card.Topic);
    Assert.Null(card.Mcq);
  }

  [Fact]
  public async Task LoadCards_FullSchema_ParsesMcqAsOwnedElement()
  {
    await using var conn = await _db.OpenAsync();

    var deckId = await NewDeckAsync(conn, "full");
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, mcq) values ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [deckId, "mcq-1", "Which service buffers a burst", "queue it", 2, 1, AuthoringOrderMcq]);
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4)",
      [deckId, "qa-1", "plain question", 2]);

    var cards = await PublishJobProcessor.LoadCardsAsync(conn, deckId);

    Assert.Equal(2, cards.Count);

    var mcqCard = cards[0];
    Assert.Equal(JsonValueKind.Object, mcqCard.Mcq!.Value.ValueKind);
    // PG re-orders the stored blob to the pinned key order; the owned element survives serialisation.
    Assert.Equal(McqJson, JsonSerializer.Serialize(mcqCard.Mcq.Value, ContentJson.Options));

    var qaCard = cards[1];
    Assert.Null(qaCard.Topic);
    Assert.Null(qaCard.Mcq);
  }
}
