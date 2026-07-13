using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Content;

/// <summary>
/// 纯逻辑分块规划（无 IO，可单测）：每块最多 maxCardsPerChunk 张卡，保持输入顺序。
/// </summary>
public static class ChunkPlanner
{
  public const int DefaultMaxCardsPerChunk = 500;

  public static List<List<CardExportData>> Plan(
    IReadOnlyList<CardExportData> cards,
    int maxCardsPerChunk = DefaultMaxCardsPerChunk)
  {
    if (maxCardsPerChunk < 1)
    {
      throw new ArgumentOutOfRangeException(nameof(maxCardsPerChunk), "maxCardsPerChunk must be >= 1");
    }

    var chunks = new List<List<CardExportData>>();
    for (var start = 0; start < cards.Count; start += maxCardsPerChunk)
    {
      var count = Math.Min(maxCardsPerChunk, cards.Count - start);
      var chunk = new List<CardExportData>(count);
      for (var i = 0; i < count; i++)
      {
        chunk.Add(cards[start + i]);
      }
      chunks.Add(chunk);
    }

    return chunks;
  }
}
