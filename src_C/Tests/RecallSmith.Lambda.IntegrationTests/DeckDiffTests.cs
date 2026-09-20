using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// DeckDiff 纯逻辑单测：add / update / delete / no-op + 9 字段逐一敏感性
/// </summary>
public class DeckDiffTests
{
  private static CardExportData MakeCard(
    string uid,
    int orderInDeck = 1,
    int difficulty = 2,
    string question = "q",
    string explanation = "e",
    string? codeLanguage = "csharp",
    string codeSnippet = "snippet",
    string realWorldUsage = "usage",
    int revision = 1,
    string? topic = null)
  {
    return new CardExportData
    {
      StableUid = uid,
      OrderInDeck = orderInDeck,
      Difficulty = difficulty,
      Question = question,
      Explanation = explanation,
      CodeLanguage = codeLanguage,
      CodeSnippet = codeSnippet,
      RealWorldUsage = realWorldUsage,
      Revision = revision,
      Topic = topic,
    };
  }

  [Fact]
  public void Compute_IdenticalDecks_IsNoOp()
  {
    var prev = new List<CardExportData> { MakeCard("a"), MakeCard("b", orderInDeck: 2) };
    var next = new List<CardExportData> { MakeCard("a"), MakeCard("b", orderInDeck: 2) };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Empty(diff.Added);
    Assert.Empty(diff.Updated);
    Assert.Empty(diff.Deleted);
  }

  [Fact]
  public void Compute_NewUid_IsAdded()
  {
    var prev = new List<CardExportData> { MakeCard("a") };
    var next = new List<CardExportData> { MakeCard("a"), MakeCard("b", orderInDeck: 2) };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Single(diff.Added);
    Assert.Equal("b", diff.Added[0].StableUid);
    Assert.Empty(diff.Updated);
    Assert.Empty(diff.Deleted);
  }

  [Fact]
  public void Compute_MissingUid_IsDeleted()
  {
    var prev = new List<CardExportData> { MakeCard("a"), MakeCard("b", orderInDeck: 2) };
    var next = new List<CardExportData> { MakeCard("a") };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Empty(diff.Added);
    Assert.Empty(diff.Updated);
    Assert.Equal(new[] { "b" }, diff.Deleted);
  }

  [Fact]
  public void Compute_ChangedCard_IsUpdated_AndCarriesNextValues()
  {
    var prev = new List<CardExportData> { MakeCard("a", question: "old question") };
    var next = new List<CardExportData> { MakeCard("a", question: "new question") };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Empty(diff.Added);
    Assert.Empty(diff.Deleted);
    var updated = Assert.Single(diff.Updated);
    Assert.Equal("a", updated.StableUid);
    Assert.Equal("new question", updated.Question);
  }

  [Fact]
  public void Compute_MixedChanges_AllBucketsFilled_InNextOrder()
  {
    var prev = new List<CardExportData>
    {
      MakeCard("keep", orderInDeck: 1),
      MakeCard("change", orderInDeck: 2),
      MakeCard("remove", orderInDeck: 3),
    };
    var next = new List<CardExportData>
    {
      MakeCard("keep", orderInDeck: 1),
      MakeCard("change", orderInDeck: 2, revision: 2),
      MakeCard("add-first", orderInDeck: 3),
      MakeCard("add-second", orderInDeck: 4),
    };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Equal(new[] { "add-first", "add-second" }, diff.Added.Select(c => c.StableUid).ToArray());
    Assert.Equal(new[] { "change" }, diff.Updated.Select(c => c.StableUid).ToArray());
    Assert.Equal(new[] { "remove" }, diff.Deleted);
  }

  public static IEnumerable<object[]> SingleFieldMutations()
  {
    // 除 stableUid 之外的 9 个字段，逐一变化都必须触发 updated
    yield return new object[] { "orderInDeck", MakeCard("a", orderInDeck: 99) };
    yield return new object[] { "difficulty", MakeCard("a", difficulty: 3) };
    yield return new object[] { "question", MakeCard("a", question: "changed") };
    yield return new object[] { "explanation", MakeCard("a", explanation: "changed") };
    yield return new object[] { "codeLanguage", MakeCard("a", codeLanguage: "python") };
    yield return new object[] { "codeSnippet", MakeCard("a", codeSnippet: "changed") };
    yield return new object[] { "realWorldUsage", MakeCard("a", realWorldUsage: "changed") };
    yield return new object[] { "revision", MakeCard("a", revision: 9) };
    yield return new object[] { "topic", MakeCard("a", topic: "changed") };
  }

  [Theory]
  [MemberData(nameof(SingleFieldMutations))]
  public void Compute_AnySingleFieldChange_TriggersUpdated(string field, CardExportData mutated)
  {
    var prev = new List<CardExportData> { MakeCard("a") };
    var next = new List<CardExportData> { mutated };

    var diff = DeckDiff.Compute(prev, next);

    Assert.True(diff.Updated.Count == 1, $"field '{field}' change should mark the card as updated");
    Assert.Empty(diff.Added);
    Assert.Empty(diff.Deleted);
  }

  [Fact]
  public void Compute_CodeLanguageNullToValue_TriggersUpdated()
  {
    var prev = new List<CardExportData> { MakeCard("a", codeLanguage: null) };
    var next = new List<CardExportData> { MakeCard("a", codeLanguage: "go") };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Single(diff.Updated);
  }

  [Fact]
  public void Compute_TopicNullToValue_TriggersUpdated()
  {
    var prev = new List<CardExportData> { MakeCard("a", topic: null) };
    var next = new List<CardExportData> { MakeCard("a", topic: "t") };

    var diff = DeckDiff.Compute(prev, next);

    Assert.Single(diff.Updated);
  }

  [Fact]
  public void Compute_EmptyPrev_AllAdded()
  {
    var next = new List<CardExportData> { MakeCard("a"), MakeCard("b", orderInDeck: 2) };

    var diff = DeckDiff.Compute(new List<CardExportData>(), next);

    Assert.Equal(2, diff.Added.Count);
    Assert.Empty(diff.Updated);
    Assert.Empty(diff.Deleted);
  }

  [Fact]
  public void Compute_EmptyNext_AllDeleted()
  {
    var prev = new List<CardExportData> { MakeCard("a"), MakeCard("b", orderInDeck: 2) };

    var diff = DeckDiff.Compute(prev, new List<CardExportData>());

    Assert.Empty(diff.Added);
    Assert.Empty(diff.Updated);
    Assert.Equal(new[] { "a", "b" }, diff.Deleted);
  }
}
