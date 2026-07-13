using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Content;

/// <summary>
/// 卡组摘要（patch 的 deck 字段 / package.json 的 deck 字段）。
/// 字段顺序即 JSON 输出顺序，必须与客户端契约保持一致（camelCase）。
/// </summary>
public sealed class DeckSummaryModel
{
  public string Slug { get; set; } = string.Empty;
  public string Title { get; set; } = string.Empty;
  public string Locale { get; set; } = "en-US";
  public int DeckType { get; set; }
  public string Version { get; set; } = string.Empty;
  public int TotalCards { get; set; }
}

/// <summary>
/// 增量补丁（客户端 deckRepository.ts 的 DeckDelta 形状，schemaVersion=2）。
/// </summary>
public sealed class DeckDeltaModel
{
  public int SchemaVersion { get; set; } = 2;
  public string Slug { get; set; } = string.Empty;
  public string FromVersion { get; set; } = string.Empty;
  public string ToVersion { get; set; } = string.Empty;
  public long GeneratedAtMs { get; set; }
  public DeckSummaryModel? Deck { get; set; }
  public List<CardExportData> Added { get; set; } = new();
  public List<CardExportData> Updated { get; set; } = new();
  public List<string> Deleted { get; set; } = new();
}

/// <summary>
/// 分块清单 package.json（schemaVersion=1）。
/// </summary>
public sealed class DeckPackageModel
{
  public int SchemaVersion { get; set; } = 1;
  public string Slug { get; set; } = string.Empty;
  public string Version { get; set; } = string.Empty;
  public DeckSummaryModel Deck { get; set; } = new();
  public int TotalCards { get; set; }
  public List<DeckPackageChunkModel> Chunks { get; set; } = new();
}

/// <summary>
/// package.json 中的单个分块引用。path 为 manifest 相对路径（去掉前导 "content/"）。
/// </summary>
public sealed class DeckPackageChunkModel
{
  public int Seq { get; set; }
  public string Path { get; set; } = string.Empty;
  public long Bytes { get; set; }
  public string Sha256 { get; set; } = string.Empty;
  public int CardCount { get; set; }
}

/// <summary>
/// 单个分块文件 chunks/{seq}.json（schemaVersion=1）。
/// </summary>
public sealed class DeckChunkModel
{
  public int SchemaVersion { get; set; } = 1;
  public string Slug { get; set; } = string.Empty;
  public string Version { get; set; } = string.Empty;
  public int Seq { get; set; }
  public List<CardExportData> Cards { get; set; } = new();
}
