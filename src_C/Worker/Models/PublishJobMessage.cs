using System.Text.Json.Serialization;

namespace RecallSmith.Lambda.Worker.Models;

/// <summary>
/// SQS 消息体结构
/// </summary>
public class PublishJobMessage
{
  [JsonPropertyName("jobId")]
  public string JobId { get; set; } = string.Empty;

  [JsonPropertyName("deckId")]
  public int DeckId { get; set; }

  [JsonPropertyName("adminSub")]
  public string? AdminSub { get; set; }

  [JsonPropertyName("note")]
  public string? Note { get; set; }
}
