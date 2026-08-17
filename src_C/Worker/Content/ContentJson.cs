using System.Text.Json;

namespace RecallSmith.Lambda.Worker.Content;

/// <summary>
/// 内容分发文件（deck.json / package.json / chunks / patches）的统一序列化配置。
/// 必须与 S3DeckUploader 写 deck.json 的配置完全一致：camelCase、不缩进。
/// </summary>
public static class ContentJson
{
  public static readonly JsonSerializerOptions Options = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false
  };

  public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}
