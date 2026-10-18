using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RecallSmith.Lambda.Vpc.Qa;

/// <summary>
/// The content hash an AI QA review is bound to (R18 J13, contract §7.3). Only core-vpc computes it, always
/// over a row read back from the database with <see cref="CardColumnsSql"/>; the ai-qa Lambda echoes it.
/// jsonb arrives as PG text, whose key order PG normalises; parsing it with <see cref="JsonNode"/> and
/// re-serialising removes PG's spacing while keeping that order, so equal content always hashes equal. Translations
/// (migration 047) join the payload only when the card has some, so every existing review stays bound to its hash.
/// They are read through the row's jsonb image (<c>to_jsonb(c) -&gt; 'translations'</c>), which is SQL null both for a
/// null cell and for a schema that has not run 047 yet, so these selects never fail with 42703 in the window between
/// a code deploy and the console's Migrate.
/// </summary>
public static class CardContentHash
{
  public const string CardColumnsSql = """
    c.id, c.stable_uid as "stableUid", c.order_in_deck as "orderInDeck", c.question, c.explanation,
    c.code_snippet as "codeSnippet", c.code_language as "codeLanguage", c.real_world_usage as "realWorldUsage",
    c.difficulty, c.topic, c.mcq, c.source, nullif(to_jsonb(c) -> 'translations', 'null'::jsonb) as translations
    """;

  /// <summary>Lowercase hex SHA-256 of the canonical JSON array of the card's reviewable content.</summary>
  public static string Compute(IReadOnlyDictionary<string, object?> row)
  {
    var payload = new List<object?>
    {
      (Text(row, "question") ?? string.Empty).Trim(),
      (Text(row, "explanation") ?? string.Empty).Trim(),
      Text(row, "codeSnippet") ?? string.Empty,
      (Text(row, "codeLanguage") ?? string.Empty).Trim(),
      (Text(row, "realWorldUsage") ?? string.Empty).Trim(),
      Convert.ToInt32(Cell(row, "difficulty") ?? 2, CultureInfo.InvariantCulture),
      Text(row, "topic") ?? string.Empty,
      Node(Cell(row, "mcq")),
      Node(Cell(row, "source")),
    };
    if (Node(Cell(row, "translations")) is { } translations) payload.Add(translations);

    var json = JsonSerializer.Serialize(payload);
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
    return Convert.ToHexString(hash).ToLowerInvariant();
  }

  private static object? Cell(IReadOnlyDictionary<string, object?> row, string key) =>
    row.TryGetValue(key, out var v) ? v : null;

  private static string? Text(IReadOnlyDictionary<string, object?> row, string key) =>
    Convert.ToString(Cell(row, key), CultureInfo.InvariantCulture);

  private static JsonNode? Node(object? value) => value switch
  {
    null => null,
    string s => JsonNode.Parse(s),
    JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
    JsonElement e => JsonNode.Parse(e.GetRawText()),
    _ => throw new ArgumentException($"Unsupported jsonb cell type {value.GetType().Name}", nameof(value)),
  };
}
