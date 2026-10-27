using System.Text.Json;
using RecallSmith.Lambda.Vpc.Qa;

// The caller obtains these JSON rows from local PostgreSQL jsonb, preserving its
// nested key order exactly as production CardContentHash reads it from the DB.
if (args.Length != 1) throw new ArgumentException("Usage: HashCards POSTGRES_NORMALIZED_JSONL");
var rows = new List<object>();
var seen = new HashSet<string>(StringComparer.Ordinal);
foreach (var line in File.ReadLines(args[0]))
{
    using var document = JsonDocument.Parse(line);
    var card = document.RootElement;
    var uid = card.GetProperty("stableUid").GetString() ?? throw new InvalidDataException("Missing UID");
    if (!seen.Add(uid) || rows.Count >= 500) throw new InvalidDataException("Duplicate UID or too many cards");
    var cells = new Dictionary<string, object?>();
    foreach (var field in new[] { "question", "explanation", "codeSnippet", "codeLanguage", "realWorldUsage", "topic" })
        cells[field] = card.TryGetProperty(field, out var value) && value.ValueKind != JsonValueKind.Null ? value.GetString() : null;
    cells["difficulty"] = card.GetProperty("difficulty").GetInt32();
    foreach (var field in new[] { "mcq", "source", "translations", "frontHelp" })
        cells[field] = card.TryGetProperty(field, out var value) && value.ValueKind != JsonValueKind.Null ? value.GetRawText() : null;
    rows.Add(new { stableUid = uid, cardContentHash = CardContentHash.Compute(cells),
                   schema = CardContentHash.Schema(cells), orderInDeck = card.GetProperty("orderInDeck").GetInt32() });
}
if (rows.Count == 0) throw new InvalidDataException("No cards");
Console.WriteLine(JsonSerializer.Serialize(rows));
