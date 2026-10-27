using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RecallSmith.Lambda.Db;

/// <summary>
/// One exported card as the publish snapshot digests it; jsonb columns as the PG text they are read as.
/// <see cref="TranslationsJson"/> (migration 047) is null for a card without translations.
/// </summary>
public sealed record PublishSnapshotCard(string? StableUid, int OrderInDeck, int? Difficulty, string? Question, string? Explanation,
  string? CodeLanguage, string? CodeSnippet, string? RealWorldUsage, int? Revision, string? Topic, string? McqJson, string? SourceJson,
  string? TranslationsJson = null, string? FrontHelpJson = null);

/// <summary>
/// The digest that binds a publish build to the cards the AI QA publish gate passed (R18 Y02, backend-design-16).
/// core-vpc computes it over the rows it gated and stores it on <c>deck_publishes.qa_snapshot_sha256</c>; the Worker
/// computes it over the cards it is about to build and refuses the job (<see cref="StaleErrorCode"/>) when they
/// differ, so a card edited between the gate and the build is never published at an unreviewed hash. Both sides
/// read the same export columns in the same order; a missing text value and an empty one digest alike (the Worker
/// maps some nulls to ""), as do a missing difficulty and 2 and a missing revision and 1. A card's translations are
/// digested only when it has some, so the digest of an untranslated card is the formula's from before migration 047
/// (no AI_QA_STALE while core-vpc and the Worker deploy apart).
/// </summary>
public static class PublishSnapshot
{
  public const string StaleErrorCode = "AI_QA_STALE";

  /// <summary>
  /// EMF gauge emitted once per publish refused as <see cref="StaleErrorCode"/>, by core-vpc (409) or by the Worker
  /// (failed job), so a gate/build race can be alarmed on rather than found in an info log (backend-design-20).
  /// </summary>
  public const string StaleMetric = "AiQaStale";

  /// <summary>Lowercase hex SHA-256 over the canonical JSON of <paramref name="cards"/>, in the order given (export order).</summary>
  public static string Digest(IEnumerable<PublishSnapshotCard> cards)
  {
    var payload = cards.Select(c =>
    {
      var fields = new List<object>
      {
        c.StableUid ?? string.Empty,
        c.OrderInDeck,
        c.Difficulty ?? 2,
        c.Question ?? string.Empty,
        c.Explanation ?? string.Empty,
        c.CodeLanguage ?? string.Empty,
        c.CodeSnippet ?? string.Empty,
        c.RealWorldUsage ?? string.Empty,
        c.Revision ?? 1,
        c.Topic ?? string.Empty,
        c.McqJson ?? string.Empty,
        c.SourceJson ?? string.Empty,
      };
      var help = NormalizeHelp(c.FrontHelpJson);
      var extended = HasFrontHelp(c.TranslationsJson, help);
      if (c.TranslationsJson is not null) fields.Add(extended ? CanonicalJson(c.TranslationsJson) : c.TranslationsJson);
      if (extended) fields.Add(new { schema = "front-help-v1", frontHelp = help is null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(help) });
      return fields.ToArray();
    }).ToList();
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    return Convert.ToHexString(hash).ToLowerInvariant();
  }

  /// <summary>
  /// A card from a row with the export aliases (<c>stableUid</c>, <c>orderInDeck</c>, <c>difficulty</c>,
  /// <c>question</c>, <c>explanation</c>, <c>codeLanguage</c>, <c>codeSnippet</c>, <c>realWorldUsage</c>,
  /// <c>revision</c>, <c>topic</c>, <c>mcq</c>, <c>source</c>, and <c>translations</c> when selected) as <see cref="DbUtil"/>
  /// returns it.
  /// </summary>
  public static PublishSnapshotCard FromRow(IReadOnlyDictionary<string, object?> row) => new(
    Text(row, "stableUid"),
    Convert.ToInt32(Cell(row, "orderInDeck") ?? 0, CultureInfo.InvariantCulture),
    Cell(row, "difficulty") is { } d ? Convert.ToInt32(d, CultureInfo.InvariantCulture) : null,
    Text(row, "question"),
    Text(row, "explanation"),
    Text(row, "codeLanguage"),
    Text(row, "codeSnippet"),
    Text(row, "realWorldUsage"),
    Cell(row, "revision") is { } r ? Convert.ToInt32(r, CultureInfo.InvariantCulture) : null,
    Text(row, "topic"),
    Text(row, "mcq"),
    Text(row, "source"),
    // Null-preserving, unlike Text: a card without translations must digest as before migration 047.
    Cell(row, "translations") is { } translations ? JsonText(translations) : null,
    Cell(row, "frontHelp") is { } help ? JsonText(help) : null);

  private static string JsonText(object value) => value is JsonElement element ? element.GetRawText() : Convert.ToString(value, CultureInfo.InvariantCulture)!;

  public static string? NormalizeHelp(string? json)
  {
    if (string.IsNullOrWhiteSpace(json)) return null;
    using var doc = JsonDocument.Parse(json);
    if (doc.RootElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ||
        doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() == 0) return null;
    return CanonicalJson(json);
  }

  public static bool HasFrontHelp(string? translations, string? help)
  {
    if (NormalizeHelp(help) is not null) return true;
    if (string.IsNullOrWhiteSpace(translations)) return false;
    using var doc = JsonDocument.Parse(translations);
    return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.EnumerateObject().Any(locale =>
      locale.Value.ValueKind == JsonValueKind.Object && locale.Value.TryGetProperty("frontHelp", out var value) && NormalizeHelp(value.GetRawText()) is not null);
  }

  /// <summary>Compact JSON in PostgreSQL jsonb key order, independent of source spacing and object insertion order.</summary>
  public static string CanonicalJson(string json)
  {
    using var doc = JsonDocument.Parse(json);
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
      WriteCanonical(writer, doc.RootElement);
    return Encoding.UTF8.GetString(stream.ToArray());
  }

  private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
  {
    if (value.ValueKind == JsonValueKind.Object)
    {
      writer.WriteStartObject();
      foreach (var prop in value.EnumerateObject().OrderBy(p => Encoding.UTF8.GetByteCount(p.Name)).ThenBy(p => p.Name, StringComparer.Ordinal))
      {
        writer.WritePropertyName(prop.Name);
        WriteCanonical(writer, prop.Value);
      }
      writer.WriteEndObject();
    }
    else if (value.ValueKind == JsonValueKind.Array)
    {
      writer.WriteStartArray();
      foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item);
      writer.WriteEndArray();
    }
    else value.WriteTo(writer);
  }

  private static object? Cell(IReadOnlyDictionary<string, object?> row, string key) => row.TryGetValue(key, out var v) ? v : null;

  private static string? Text(IReadOnlyDictionary<string, object?> row, string key) => Convert.ToString(Cell(row, key), CultureInfo.InvariantCulture);
}
