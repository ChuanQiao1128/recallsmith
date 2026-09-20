using System.Text.Json.Serialization;

namespace RecallSmith.Lambda.Worker.S3;

/// <summary>
/// S3 卡组上传接口
/// </summary>
public interface IS3DeckUploader
{
  /// <summary>
  /// 上传卡组 JSON 到 S3，返回上传字节的 sha256（小写 hex）与字节长度
  /// </summary>
  Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data);

  /// <summary>
  /// 上传任意 JSON 文本到 S3（UTF-8 编码），返回 sha256（小写 hex）与字节长度
  /// </summary>
  Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl);

  /// <summary>
  /// 下载 S3 上的 JSON 文本（bucket 解析规则与 UploadAsync 一致）
  /// </summary>
  Task<string> DownloadJsonAsync(string s3Key);
}

/// <summary>
/// 上传结果：sha256 为上传的精确 UTF-8 字节的小写 hex 摘要
/// </summary>
public sealed class S3UploadResult
{
  public string Sha256 { get; set; } = string.Empty;
  public long Bytes { get; set; }
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

  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string? Topic { get; set; }
}
