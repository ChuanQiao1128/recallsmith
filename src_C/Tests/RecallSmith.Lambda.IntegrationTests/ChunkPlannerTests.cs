using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// ChunkPlanner 纯逻辑单测：0/1/500/501/1500 边界 + 顺序保持
/// </summary>
public class ChunkPlannerTests
{
  private static List<CardExportData> MakeCards(int count)
  {
    var cards = new List<CardExportData>(count);
    for (var i = 0; i < count; i++)
    {
      cards.Add(new CardExportData
      {
        StableUid = $"uid-{i}",
        OrderInDeck = i + 1,
        Question = $"q{i}",
      });
    }
    return cards;
  }

  [Fact]
  public void Plan_ZeroCards_NoChunks()
  {
    var chunks = ChunkPlanner.Plan(MakeCards(0));
    Assert.Empty(chunks);
  }

  [Fact]
  public void Plan_OneCard_SingleChunk()
  {
    var chunks = ChunkPlanner.Plan(MakeCards(1));

    var chunk = Assert.Single(chunks);
    Assert.Single(chunk);
    Assert.Equal("uid-0", chunk[0].StableUid);
  }

  [Fact]
  public void Plan_Exactly500_SingleFullChunk()
  {
    var chunks = ChunkPlanner.Plan(MakeCards(500));

    var chunk = Assert.Single(chunks);
    Assert.Equal(500, chunk.Count);
  }

  [Fact]
  public void Plan_501_TwoChunks_500Plus1()
  {
    var chunks = ChunkPlanner.Plan(MakeCards(501));

    Assert.Equal(2, chunks.Count);
    Assert.Equal(500, chunks[0].Count);
    Assert.Single(chunks[1]);
    Assert.Equal("uid-500", chunks[1][0].StableUid);
  }

  [Fact]
  public void Plan_1500_ThreeFullChunks()
  {
    var chunks = ChunkPlanner.Plan(MakeCards(1500));

    Assert.Equal(3, chunks.Count);
    Assert.All(chunks, c => Assert.Equal(500, c.Count));
  }

  [Fact]
  public void Plan_PreservesInputOrderAcrossChunks()
  {
    var cards = MakeCards(1001);
    var chunks = ChunkPlanner.Plan(cards);

    var flattened = chunks.SelectMany(c => c).Select(c => c.StableUid).ToList();
    Assert.Equal(cards.Select(c => c.StableUid).ToList(), flattened);
  }

  [Fact]
  public void Plan_CustomChunkSize_Respected()
  {
    var chunks = ChunkPlanner.Plan(MakeCards(5), maxCardsPerChunk: 2);

    Assert.Equal(3, chunks.Count);
    Assert.Equal(2, chunks[0].Count);
    Assert.Equal(2, chunks[1].Count);
    Assert.Single(chunks[2]);
  }

  [Fact]
  public void Plan_InvalidChunkSize_Throws()
  {
    Assert.Throws<ArgumentOutOfRangeException>(() => ChunkPlanner.Plan(MakeCards(1), maxCardsPerChunk: 0));
  }
}
