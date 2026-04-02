namespace RecallSmith.Lambda.Worker.S3;

/// <summary>
/// S3 卡组上传接口
/// </summary>
public interface IS3DeckUploader
{
  /// <summary>
  /// 上传卡组 JSON 到 S3
  /// </summary>
  Task UploadAsync(string s3Key, DeckExportData data);
}

/// <summary>
/// 卡组导出数据
/// </summary>
public class DeckExportData
{
  public string Slug { get; set; } = string.Empty;
  public string Title { get; set; } = string.Empty;
  public string Locale { get; set; } = "en-US";
  public int DeckType { get; set; }
  public string Version { get; set; } = "1";
  public int TotalCards { get; set; }
  public List<CardExportData> Cards { get; set; } = new();
}

/// <summary>
/// 卡片导出数据
/// </summary>
public class CardExportData
{
  public string StableUid { get; set; } = string.Empty;
  public int OrderInDeck { get; set; }
  public int Difficulty { get; set; } = 2;
  public string Question { get; set; } = string.Empty;
  public string Explanation { get; set; } = string.Empty;
  public string? CodeLanguage { get; set; }
  public string CodeSnippet { get; set; } = string.Empty;
  public string RealWorldUsage { get; set; } = string.Empty;
  public int Revision { get; set; } = 1;
}
