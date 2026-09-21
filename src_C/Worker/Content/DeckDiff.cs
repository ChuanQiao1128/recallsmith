using System.Text.Json;
using System.Text.Json.Nodes;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Content;

/// <summary>
/// 卡组差异结果：added/updated 按新版本顺序，deleted 按旧版本顺序。
/// </summary>
public sealed class DeckDiffResult
{
  public List<CardExportData> Added { get; init; } = new();
  public List<CardExportData> Updated { get; init; } = new();
  public List<string> Deleted { get; init; } = new();
}

/// <summary>
/// 纯逻辑卡组差异计算（无 IO，可单测）。
/// updated = stableUid 同时存在于新旧两版且 11 个卡片字段任一不同。
/// </summary>
public static class DeckDiff
{
  public static DeckDiffResult Compute(IReadOnlyList<CardExportData> previous, IReadOnlyList<CardExportData> next)
  {
    var prevByUid = new Dictionary<string, CardExportData>(StringComparer.Ordinal);
    foreach (var card in previous)
    {
      var uid = card.StableUid;
      if (string.IsNullOrEmpty(uid)) continue;
      prevByUid.TryAdd(uid, card);
    }

    var nextUids = new HashSet<string>(StringComparer.Ordinal);
    var result = new DeckDiffResult();

    foreach (var card in next)
    {
      var uid = card.StableUid;
      if (string.IsNullOrEmpty(uid) || !nextUids.Add(uid)) continue;

      if (!prevByUid.TryGetValue(uid, out var prevCard))
      {
        result.Added.Add(card);
      }
      else if (CardChanged(prevCard, card))
      {
        result.Updated.Add(card);
      }
    }

    var deletedSeen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var card in previous)
    {
      var uid = card.StableUid;
      if (string.IsNullOrEmpty(uid) || nextUids.Contains(uid) || !deletedSeen.Add(uid)) continue;
      result.Deleted.Add(uid);
    }

    return result;
  }

  private static bool CardChanged(CardExportData a, CardExportData b)
  {
    return !string.Equals(a.StableUid, b.StableUid, StringComparison.Ordinal)
      || a.OrderInDeck != b.OrderInDeck
      || a.Difficulty != b.Difficulty
      || !string.Equals(a.Question, b.Question, StringComparison.Ordinal)
      || !string.Equals(a.Explanation, b.Explanation, StringComparison.Ordinal)
      || !string.Equals(a.CodeLanguage, b.CodeLanguage, StringComparison.Ordinal)
      || !string.Equals(a.CodeSnippet, b.CodeSnippet, StringComparison.Ordinal)
      || !string.Equals(a.RealWorldUsage, b.RealWorldUsage, StringComparison.Ordinal)
      || a.Revision != b.Revision
      || !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)
      || !McqEquals(a.Mcq, b.Mcq);
  }

  /// <summary>
  /// Structural jsonb equality. The current side comes from DbUtil as PG text (": " spacing),
  /// the previous side from compact deck.json — raw strings never match, so compare as trees.
  /// </summary>
  public static bool McqEquals(JsonElement? a, JsonElement? b)
  {
    if (a is null && b is null) return true;
    if (a is null || b is null) return false;
    return JsonNode.DeepEquals(JsonNode.Parse(a.Value.GetRawText()), JsonNode.Parse(b.Value.GetRawText()));
  }
}
