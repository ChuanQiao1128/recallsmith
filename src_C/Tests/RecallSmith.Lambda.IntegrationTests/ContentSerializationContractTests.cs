using System.Text.Json;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// 序列化契约测试：patch / package / chunk JSON 的字段名必须与客户端契约
/// （mobile/src/content/deckRepository.ts + docs/content-delivery-v3.md）逐字节一致。
/// </summary>
public class ContentSerializationContractTests
{
  private static CardExportData MakeCard(string uid = "u1", string? codeLanguage = "csharp")
  {
    return new CardExportData
    {
      StableUid = uid,
      OrderInDeck = 1,
      Difficulty = 2,
      Question = "q",
      Explanation = "e",
      CodeLanguage = codeLanguage,
      CodeSnippet = "c",
      RealWorldUsage = "r",
      Revision = 1,
    };
  }

  private const string CardJson =
    """{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1}""";

  // What DbUtil hands back for a stored blob: PG jsonb text, PG key order, ": " / ", " spacing.
  private const string McqPgText =
    """{"v": 1, "options": [{"key": "a", "why": null, "text": "queue", "correct": true}, {"key": "b", "why": "no buffer", "text": "resize", "correct": false}, {"key": "c", "why": "one shard", "text": "stream", "correct": false}], "shuffle": true, "qualifier": null}""";

  // What ContentJson emits for it: same key order, compact.
  private const string McqJson =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private static JsonElement Mcq(string json) => JsonSerializer.Deserialize<JsonElement>(json);

  [Fact]
  public void Card_SerializesExactCamelCaseFieldNames()
  {
    var json = ContentJson.Serialize(MakeCard());
    Assert.Equal(CardJson, json);
  }

  [Fact]
  public void Card_NullCodeLanguage_SerializesAsNull()
  {
    var json = ContentJson.Serialize(MakeCard(codeLanguage: null));
    Assert.Equal(
      """{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":null,"codeSnippet":"c","realWorldUsage":"r","revision":1}""",
      json);
  }

  [Fact]
  public void DeckDelta_SerializesExactContractShape()
  {
    var delta = new DeckDeltaModel
    {
      SchemaVersion = 2,
      Slug = "s",
      FromVersion = "from-1",
      ToVersion = "to-2",
      GeneratedAtMs = 1234567890,
      Deck = new DeckSummaryModel
      {
        Slug = "s",
        Title = "T",
        Locale = "en-US",
        DeckType = 1,
        Version = "to-2",
        TotalCards = 3,
      },
      Added = new List<CardExportData> { MakeCard() },
      Updated = new List<CardExportData>(),
      Deleted = new List<string> { "gone-uid" },
    };

    var json = ContentJson.Serialize(delta);

    Assert.Equal(
      """{"schemaVersion":2,"slug":"s","fromVersion":"from-1","toVersion":"to-2","generatedAtMs":1234567890,"deck":{"slug":"s","title":"T","locale":"en-US","deckType":1,"version":"to-2","totalCards":3},"added":[""" +
      CardJson +
      """],"updated":[],"deleted":["gone-uid"]}""",
      json);
  }

  [Fact]
  public void DeckPackage_SerializesExactContractShape()
  {
    var package = new DeckPackageModel
    {
      SchemaVersion = 1,
      Slug = "s",
      Version = "to-2",
      Deck = new DeckSummaryModel
      {
        Slug = "s",
        Title = "T",
        Locale = "en-US",
        DeckType = 1,
        Version = "to-2",
        TotalCards = 3,
      },
      TotalCards = 3,
      Chunks = new List<DeckPackageChunkModel>
      {
        new()
        {
          Seq = 0,
          Path = "decks/s/builds/to-2/chunks/0.json",
          Bytes = 123,
          Sha256 = "abc",
          CardCount = 3,
        },
      },
    };

    var json = ContentJson.Serialize(package);

    Assert.Equal(
      """{"schemaVersion":1,"slug":"s","version":"to-2","deck":{"slug":"s","title":"T","locale":"en-US","deckType":1,"version":"to-2","totalCards":3},"totalCards":3,"chunks":[{"seq":0,"path":"decks/s/builds/to-2/chunks/0.json","bytes":123,"sha256":"abc","cardCount":3}]}""",
      json);
  }

  [Fact]
  public void DeckChunk_SerializesExactContractShape()
  {
    var chunk = new DeckChunkModel
    {
      SchemaVersion = 1,
      Slug = "s",
      Version = "to-2",
      Seq = 0,
      Cards = new List<CardExportData> { MakeCard() },
    };

    var json = ContentJson.Serialize(chunk);

    Assert.Equal(
      """{"schemaVersion":1,"slug":"s","version":"to-2","seq":0,"cards":[""" + CardJson + "]}",
      json);
  }

  [Fact]
  public void DeckExportData_DeckJson_KeepsExistingCamelCaseShape()
  {
    // deck.json 全量文件形状（客户端 RawDeckJsonFlat）：version 必须是 buildId 字符串
    var deck = new DeckExportData
    {
      Slug = "s",
      Title = "T",
      Locale = "en-US",
      DeckType = 1,
      Version = "20260428T075215Z-5ba0392a",
      TotalCards = 1,
      Cards = new List<CardExportData> { MakeCard() },
    };

    var json = ContentJson.Serialize(deck);

    Assert.Equal(
      """{"slug":"s","title":"T","locale":"en-US","deckType":1,"version":"20260428T075215Z-5ba0392a","totalCards":1,"cards":[""" + CardJson + "]}",
      json);
  }

  [Fact]
  public void Card_WithTopic_AppendsTopicLast()
  {
    var card = MakeCard();
    card.Topic = "t";

    var json = ContentJson.Serialize(card);

    Assert.Equal(
      """{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1,"topic":"t"}""",
      json);
    // The golden card plus one appended key — nothing in front of it moved.
    Assert.Equal(CardJson[..^1] + ""","topic":"t"}""", json);
  }

  [Fact]
  public void Card_NullTopic_KeepsGoldenBytes()
  {
    var card = MakeCard();
    card.Topic = null;

    Assert.Equal(CardJson, ContentJson.Serialize(card));

    var chunk = new DeckChunkModel { SchemaVersion = 1, Slug = "s", Version = "to-2", Seq = 0, Cards = new List<CardExportData> { card } };
    Assert.DoesNotContain("topic", ContentJson.Serialize(chunk), StringComparison.Ordinal);
  }

  [Fact]
  public void Card_WithTopicAndMcq_AppendsMcqLast()
  {
    var card = MakeCard();
    card.Topic = "t";
    card.Mcq = Mcq(McqPgText);

    Assert.Equal(CardJson[..^1] + ""","topic":"t","mcq":""" + McqJson + "}", ContentJson.Serialize(card));
  }

  [Fact]
  public void Card_WithMcqOnly_OmitsTopic()
  {
    var card = MakeCard();
    card.Mcq = Mcq(McqPgText);

    Assert.Equal(CardJson[..^1] + ""","mcq":""" + McqJson + "}", ContentJson.Serialize(card));
  }

  [Fact]
  public void Card_WithMcq_RoundTripsThroughContentJson()
  {
    var card = MakeCard();
    card.Topic = "t";
    card.Mcq = Mcq(McqPgText);
    var expected = CardJson[..^1] + ""","topic":"t","mcq":""" + McqJson + "}";

    // The previous-build read path: deck.json bytes -> JsonElement -> DeckDiff.
    var roundTripped = JsonSerializer.Deserialize<CardExportData>(expected, ContentJson.Options)!;

    Assert.Equal(expected, ContentJson.Serialize(roundTripped));
    Assert.Equal(JsonValueKind.Object, roundTripped.Mcq!.Value.ValueKind);
  }
}
