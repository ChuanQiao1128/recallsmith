using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RecallSmith.Lambda.Db;

/// <summary>One exported card as the publish snapshot digests it; jsonb columns as the PG text they are read as.</summary>
public sealed record PublishSnapshotCard(string? StableUid, int OrderInDeck, int? Difficulty, string? Question, string? Explanation,
  string? CodeLanguage, string? CodeSnippet, string? RealWorldUsage, int? Revision, string? Topic, string? McqJson, string? SourceJson);

/// <summary>
/// The digest that binds a publish build to the cards the AI QA publish gate passed (R18 Y02, backend-design-16).
/// core-vpc computes it over the rows it gated and stores it on <c>deck_publishes.qa_snapshot_sha256</c>; the Worker
/// computes it over the cards it is about to build and refuses the job (<see cref="StaleErrorCode"/>) when they
/// differ, so a card edited between the gate and the build is never published at an unreviewed hash. Both sides
/// read the same export columns in the same order; a missing text value and an empty one digest alike (the Worker
/// maps some nulls to ""), as do a missing difficulty and 2 and a missing revision and 1.
/// </summary>
public static class PublishSnapshot
{
  public const string StaleErrorCode = "AI_QA_STALE";

  /// <summary>Lowercase hex SHA-256 over the canonical JSON of <paramref name="cards"/>, in the order given (export order).</summary>
  public static string Digest(IEnumerable<PublishSnapshotCard> cards)
  {
    var payload = cards.Select(c => new object[]
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
    }).ToList();
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    return Convert.ToHexString(hash).ToLowerInvariant();
  }

  /// <summary>
  /// A card from a row with the export aliases (<c>stableUid</c>, <c>orderInDeck</c>, <c>difficulty</c>,
  /// <c>question</c>, <c>explanation</c>, <c>codeLanguage</c>, <c>codeSnippet</c>, <c>realWorldUsage</c>,
  /// <c>revision</c>, <c>topic</c>, <c>mcq</c>, <c>source</c>) as <see cref="DbUtil"/> returns it.
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
    Text(row, "source"));

  private static object? Cell(IReadOnlyDictionary<string, object?> row, string key) => row.TryGetValue(key, out var v) ? v : null;

  private static string? Text(IReadOnlyDictionary<string, object?> row, string key) => Convert.ToString(Cell(row, key), CultureInfo.InvariantCulture);
}
