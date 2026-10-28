using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>Optional question-side vocabulary help; array order identifies matching translated entries.</summary>
public static class FrontHelpValidation
{
  public static string? Read(JsonElement body, out bool sent)
  {
    var fields = body.EnumerateObject().Where(p => p.NameEquals("frontHelp")).ToList();
    if (fields.Count > 1) throw Bad("duplicate frontHelp key");
    sent = fields.Count == 1;
    return sent ? Canonicalize(fields[0].Value) : null;
  }

  public static string? Canonicalize(JsonElement raw)
  {
    if (raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
    if (raw.ValueKind != JsonValueKind.Array) throw Bad("frontHelp must be an array");
    if (raw.GetArrayLength() > 2) throw Bad("frontHelp permits at most two entries");
    if (raw.GetArrayLength() == 0) return null;
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
    {
      writer.WriteStartArray();
      foreach (var entry in raw.EnumerateArray())
      {
        if (entry.ValueKind != JsonValueKind.Object) throw Bad("frontHelp entries must be objects");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in entry.EnumerateObject())
          if (prop.Name is not ("term" or "definition") || !keys.Add(prop.Name)) throw Bad("frontHelp entries require unique term and definition keys only");
        var term = Text(entry, "term", 80);
        var definition = Text(entry, "definition", 240);
        if (!seen.Add(term)) throw Bad("frontHelp terms must be unique");
        writer.WriteStartObject();
        writer.WriteString("term", term);
        writer.WriteString("definition", definition);
        writer.WriteEndObject();
      }
      writer.WriteEndArray();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }

  public static string? Normalize(string? json) => string.IsNullOrWhiteSpace(json) ? null : Canonicalize(JsonSerializer.Deserialize<JsonElement>(json));

  public static void ShapeRow(Dictionary<string, object?> row)
  {
    var json = Helpers.JsonbElement(row, "frontHelp");
    if (json is not null && Canonicalize(json.Value) is { } canonical) row["frontHelp"] = JsonSerializer.Deserialize<JsonElement>(canonical);
    else row.Remove("frontHelp");
  }

  private static string Text(JsonElement entry, string key, int max)
  {
    if (!entry.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String) throw Bad($"frontHelp.{key} must be a string");
    var text = value.GetString()!.Trim();
    if (text.Length < 1 || text.Length > max) throw Bad($"frontHelp.{key} must contain 1..{max} characters");
    return text;
  }

  private static TranslationValidationError Bad(string message) => new("FRONT_HELP_BAD_SHAPE", message);
}
