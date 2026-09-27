using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Review;

/// <summary>A DraftCard failed validation. <see cref="Code"/> is the wire error code (contract §8.1).</summary>
public sealed class DraftCardError : Exception
{
  public string Code { get; }

  public DraftCardError(string code, string message) : base(message)
  {
    Code = code;
  }
}

/// <summary>
/// The one JSON shape of an AI-authored card (contract §8.1): what the MCP tool posts, what
/// <c>ai_drafts.card</c> stores and what accept turns into a <c>cards</c> row. Pure: no database, no I/O.
/// <see cref="McqJson"/> and <see cref="SourceJson"/> hold the canonical compact JSON produced by
/// <see cref="McqValidation.Canonicalize"/> and <see cref="Helpers.NormalizeSource"/>.
/// </summary>
public sealed record DraftCard(string StableUid, int Difficulty, string? Topic, string Question, string Explanation,
  string? CodeSnippet, string? CodeLanguage, string? RealWorldUsage, string? McqJson, string SourceJson)
{
  public static readonly IReadOnlyList<string> Keys = ["stableUid", "difficulty", "topic", "question", "explanation",
    "codeSnippet", "codeLanguage", "realWorldUsage", "mcq", "source"];

  public const int MaxStableUidLength = 128;

  // frontend/src/lib/cardRules.ts UID_PATTERN
  private static readonly Regex UidPattern = new("^[a-z0-9]+(?:[-_][a-z0-9]+)*$", RegexOptions.CultureInvariant);

  /// <summary>Validates <paramref name="el"/>; the first failing rule wins, in contract order. Throws <see cref="DraftCardError"/>.</summary>
  public static DraftCard Parse(JsonElement el)
  {
    // 1. shape
    if (el.ValueKind != JsonValueKind.Object) throw new DraftCardError("VALIDATION_ERROR", "card must be an object");

    // 2. unknown keys
    foreach (var prop in el.EnumerateObject())
    {
      if (!Keys.Contains(prop.Name)) throw new DraftCardError("VALIDATION_ERROR", $"card has unknown key {prop.Name}");
    }

    // 3. stableUid
    if (!el.TryGetProperty("stableUid", out var uidEl) || uidEl.ValueKind != JsonValueKind.String)
    {
      throw new DraftCardError("BAD_UID_FORMAT", "stableUid is required");
    }
    var stableUid = uidEl.GetString() ?? string.Empty;
    if (stableUid.Length > MaxStableUidLength || !UidPattern.IsMatch(stableUid))
    {
      throw new DraftCardError("BAD_UID_FORMAT",
        $"stableUid must match ^[a-z0-9]+(?:[-_][a-z0-9]+)*$ (max {MaxStableUidLength})");
    }

    // 4. question
    var question = RequiredText(el, "question");
    if (question is null) throw new DraftCardError("MISSING_QUESTION", "question is required");

    // 5. explanation
    var explanation = RequiredText(el, "explanation");
    if (explanation is null) throw new DraftCardError("MISSING_ANSWER", "explanation is required");

    // 6. difficulty
    if (!el.TryGetProperty("difficulty", out var difEl) || difEl.ValueKind != JsonValueKind.Number ||
        !difEl.TryGetInt32(out var difficulty) || difficulty is < 0 or > 4)
    {
      throw new DraftCardError("BAD_DIFFICULTY", "difficulty must be an integer in 0..4");
    }

    // 7. topic
    string? topic;
    try
    {
      topic = el.TryGetProperty("topic", out var topicEl) ? Helpers.NormalizeTopic(topicEl) : null;
    }
    catch (ValidationError ex)
    {
      throw new DraftCardError("VALIDATION_ERROR", ex.Message);
    }

    // 8. optional text fields
    var codeSnippet = OptionalString(el, "codeSnippet", trim: false);
    var codeLanguage = OptionalString(el, "codeLanguage", trim: true);
    var realWorldUsage = OptionalString(el, "realWorldUsage", trim: true);

    // 9. source (required for a draft, quote included)
    if (!el.TryGetProperty("source", out var sourceEl) || sourceEl.ValueKind == JsonValueKind.Null)
    {
      throw new DraftCardError("SOURCE_REQUIRED", "source is required for a draft");
    }
    string sourceJson;
    try
    {
      sourceJson = Helpers.NormalizeSource(sourceEl)!;
    }
    catch (ValidationError ex)
    {
      throw new DraftCardError("VALIDATION_ERROR", ex.Message);
    }
    using (var sourceDoc = JsonDocument.Parse(sourceJson))
    {
      if (sourceDoc.RootElement.GetProperty("quote").ValueKind == JsonValueKind.Null)
      {
        throw new DraftCardError("SOURCE_REQUIRED", "source.quote is required for a draft");
      }
    }

    // 10. mcq
    string? mcqJson = null;
    if (el.TryGetProperty("mcq", out var mcqEl) && mcqEl.ValueKind != JsonValueKind.Null)
    {
      try
      {
        mcqJson = McqValidation.Canonicalize(mcqEl, question);
      }
      catch (McqValidationError ex)
      {
        throw new DraftCardError(ex.Code, ex.Message);
      }
      if (!McqValidation.IsMcqDifficulty(difficulty))
      {
        throw new DraftCardError("MCQ_DIFFICULTY_RANGE", "difficulty must be 1..3 for an MCQ card");
      }
    }

    return new DraftCard(stableUid, difficulty, topic, question, explanation, codeSnippet, codeLanguage, realWorldUsage, mcqJson, sourceJson);
  }

  /// <summary>Canonical compact JSON object, keys in <see cref="Keys"/> order.</summary>
  public string ToJson()
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream))
    {
      writer.WriteStartObject();
      writer.WriteString("stableUid", StableUid);
      writer.WriteNumber("difficulty", Difficulty);
      WriteNullableString(writer, "topic", Topic);
      writer.WriteString("question", Question);
      writer.WriteString("explanation", Explanation);
      WriteNullableString(writer, "codeSnippet", CodeSnippet);
      WriteNullableString(writer, "codeLanguage", CodeLanguage);
      WriteNullableString(writer, "realWorldUsage", RealWorldUsage);
      writer.WritePropertyName("mcq");
      if (McqJson is null) writer.WriteNullValue();
      else writer.WriteRawValue(McqJson);
      writer.WritePropertyName("source");
      writer.WriteRawValue(SourceJson);
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }

  /// <summary>Missing, non-string or blank → null; otherwise the trimmed text.</summary>
  private static string? RequiredText(JsonElement el, string key)
  {
    if (!el.TryGetProperty(key, out var v) || v.ValueKind != JsonValueKind.String) return null;
    var s = (v.GetString() ?? string.Empty).Trim();
    return s.Length == 0 ? null : s;
  }

  private static string? OptionalString(JsonElement el, string key, bool trim)
  {
    if (!el.TryGetProperty(key, out var v) || v.ValueKind == JsonValueKind.Null) return null;
    if (v.ValueKind != JsonValueKind.String) throw new DraftCardError("VALIDATION_ERROR", $"{key} must be a string or null");
    var s = v.GetString() ?? string.Empty;
    if (!trim) return s;
    s = s.Trim();
    return s.Length == 0 ? null : s;
  }

  private static void WriteNullableString(Utf8JsonWriter writer, string key, string? value)
  {
    if (value is null) writer.WriteNull(key);
    else writer.WriteString(key, value);
  }
}
