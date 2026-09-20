using System.IO;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// Raised by McqValidation.Canonicalize. NOT a ValidationError (that class is sealed and lives in
/// src_C/Shared); every handler that canonicalises catches this type by name and answers
/// res.BadRequest(ex.Code, ex.Message).
/// </summary>
public sealed class McqValidationError : Exception
{
  public string Code { get; }

  public McqValidationError(string code, string message) : base(message)
  {
    Code = code;
  }
}

/// <summary>
/// Pure validator / canonicaliser for the optional MCQ overlay (C00 §2.9.1). No database access and
/// no I/O: it turns a client blob into the pinned compact JSON in PostgreSQL's jsonb key order so a
/// round trip through the column changes only PG's spacing.
/// </summary>
public static class McqValidation
{
  private static readonly Regex KeyRegex = new("^[a-f]$", RegexOptions.Compiled);
  private static readonly Regex QualifierChooseN = new("choose (two|three)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
  private static readonly Regex StemChooseN = new(@"\(choose (two|three)\.?\)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

  private sealed record Option(string Key, string Text, string? Why, bool Correct);

  /// <summary>
  /// Validates <paramref name="raw"/> against C00 §2.9.1 and returns the canonical compact JSON string in the pinned key
  /// order. <paramref name="question"/> null → the two stem checks (MCQ_QUALIFIER_NOT_IN_STEM, MCQ_CHOOSE_N_MISMATCH) are skipped.
  /// </summary>
  public static string Canonicalize(JsonElement raw, string? question)
  {
    // 1. top-level shape
    if (raw.ValueKind != JsonValueKind.Object)
    {
      throw new McqValidationError("MCQ_BAD_SHAPE", "mcq must be a JSON object");
    }

    // 2. version
    if (!raw.TryGetProperty("v", out var vEl) || vEl.ValueKind != JsonValueKind.Number ||
        !vEl.TryGetInt32(out var v) || v != 1)
    {
      throw new McqValidationError("MCQ_BAD_VERSION", "v must be the number 1");
    }

    // 3. options / shuffle / qualifier
    if (!raw.TryGetProperty("options", out var optionsEl) || optionsEl.ValueKind != JsonValueKind.Array)
    {
      throw new McqValidationError("MCQ_BAD_SHAPE", "options must be an array");
    }

    bool shuffle;
    if (!raw.TryGetProperty("shuffle", out var shuffleEl))
    {
      shuffle = true;
    }
    else if (shuffleEl.ValueKind == JsonValueKind.True)
    {
      shuffle = true;
    }
    else if (shuffleEl.ValueKind == JsonValueKind.False)
    {
      shuffle = false;
    }
    else
    {
      throw new McqValidationError("MCQ_BAD_SHAPE", "shuffle must be a boolean");
    }

    string? qualifier;
    if (!raw.TryGetProperty("qualifier", out var qualifierEl) || qualifierEl.ValueKind == JsonValueKind.Null)
    {
      qualifier = null;
    }
    else if (qualifierEl.ValueKind == JsonValueKind.String)
    {
      qualifier = (qualifierEl.GetString() ?? string.Empty).Trim();
    }
    else
    {
      throw new McqValidationError("MCQ_BAD_SHAPE", "qualifier must be a string or null");
    }

    // 4. option count
    var count = optionsEl.GetArrayLength();
    if (count < 3) throw new McqValidationError("MCQ_TOO_FEW_OPTIONS", "an MCQ card needs at least 3 options");
    if (count > 6) throw new McqValidationError("MCQ_TOO_MANY_OPTIONS", "an MCQ card allows at most 6 options");

    // 5. per-option shape, in stored order
    var options = new List<Option>(count);
    var index = 0;
    foreach (var optEl in optionsEl.EnumerateArray())
    {
      if (optEl.ValueKind != JsonValueKind.Object)
      {
        throw new McqValidationError("MCQ_BAD_SHAPE", $"option {index} must be an object");
      }

      if (!optEl.TryGetProperty("key", out var keyEl) || keyEl.ValueKind != JsonValueKind.String)
      {
        throw new McqValidationError("MCQ_BAD_SHAPE", $"option {index} key must be a string");
      }

      if (!optEl.TryGetProperty("text", out var textEl) || textEl.ValueKind != JsonValueKind.String)
      {
        throw new McqValidationError("MCQ_BAD_SHAPE", $"option {index} text must be a string");
      }

      if (!optEl.TryGetProperty("correct", out var correctEl) ||
          (correctEl.ValueKind != JsonValueKind.True && correctEl.ValueKind != JsonValueKind.False))
      {
        throw new McqValidationError("MCQ_BAD_SHAPE", $"option {index} correct must be a boolean");
      }

      string? why = null;
      if (optEl.TryGetProperty("why", out var whyEl))
      {
        if (whyEl.ValueKind == JsonValueKind.Null)
        {
          why = null;
        }
        else if (whyEl.ValueKind == JsonValueKind.String)
        {
          var trimmedWhy = (whyEl.GetString() ?? string.Empty).Trim();
          why = trimmedWhy.Length == 0 ? null : trimmedWhy;
        }
        else
        {
          throw new McqValidationError("MCQ_BAD_SHAPE", $"option {index} why must be a string or null");
        }
      }

      var key = keyEl.GetString() ?? string.Empty;
      var text = (textEl.GetString() ?? string.Empty).Trim();
      var correct = correctEl.ValueKind == JsonValueKind.True;
      options.Add(new Option(key, text, why, correct));
      index++;
    }

    // 6. key format
    for (var i = 0; i < options.Count; i++)
    {
      if (!KeyRegex.IsMatch(options[i].Key))
      {
        throw new McqValidationError("MCQ_KEY_SEQUENCE", $"option {i} key must match ^[a-f]$");
      }
    }

    // 7. duplicate keys
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var opt in options)
    {
      if (!seen.Add(opt.Key))
      {
        throw new McqValidationError("MCQ_DUPLICATE_OPTION_KEY", $"duplicate option key '{opt.Key}'");
      }
    }

    // 8. keys consecutive from 'a' in stored order
    for (var i = 0; i < options.Count; i++)
    {
      if (options[i].Key[0] != (char)('a' + i))
      {
        throw new McqValidationError("MCQ_KEY_SEQUENCE", $"option keys must be consecutive from 'a' (option {i})");
      }
    }

    // 9. per-option text bounds
    for (var i = 0; i < options.Count; i++)
    {
      if (options[i].Text.Length == 0)
      {
        throw new McqValidationError("MCQ_OPTION_EMPTY", $"option {i} text is empty");
      }

      if (options[i].Text.Length > 600)
      {
        throw new McqValidationError("MCQ_OPTION_TOO_LONG", $"option {i} text exceeds 600 characters");
      }
    }

    // 10. duplicate text (case-insensitive)
    for (var i = 0; i < options.Count; i++)
    {
      for (var j = i + 1; j < options.Count; j++)
      {
        if (string.Equals(options[i].Text, options[j].Text, StringComparison.OrdinalIgnoreCase))
        {
          throw new McqValidationError("MCQ_OPTION_TEXT_DUPLICATE", $"options {i} and {j} share the same text");
        }
      }
    }

    // 11. correct count
    var requiredCount = options.Count(o => o.Correct);
    if (requiredCount == 0) throw new McqValidationError("MCQ_NO_CORRECT", "at least one option must be correct");
    if (requiredCount == options.Count) throw new McqValidationError("MCQ_ALL_CORRECT", "not every option may be correct");
    if (requiredCount > 3) throw new McqValidationError("MCQ_TOO_MANY_CORRECT", "at most 3 options may be correct");

    // 12. an incorrect option must explain why
    for (var i = 0; i < options.Count; i++)
    {
      if (!options[i].Correct && options[i].Why is null)
      {
        throw new McqValidationError("MCQ_WHY_MISSING", $"incorrect option {i} needs a why");
      }
    }

    // 13. qualifier checks
    if (qualifier is not null)
    {
      if (qualifier.Length == 0)
      {
        throw new McqValidationError("MCQ_QUALIFIER_EMPTY", "qualifier must not be blank");
      }

      if (QualifierChooseN.IsMatch(qualifier))
      {
        throw new McqValidationError("MCQ_QUALIFIER_IS_CHOOSE_N", "qualifier must not be a 'choose N' marker");
      }

      if (question != null && !question.Contains(qualifier, StringComparison.OrdinalIgnoreCase))
      {
        throw new McqValidationError("MCQ_QUALIFIER_NOT_IN_STEM", "qualifier must appear in the question stem");
      }
    }

    // 14. choose-N marker vs correct count
    if (question != null)
    {
      var m = StemChooseN.Match(question);
      var expected = m.Success
        ? (m.Groups[1].Value.Equals("two", StringComparison.OrdinalIgnoreCase) ? 2 : 3)
        : 1;
      if (requiredCount != expected)
      {
        throw new McqValidationError("MCQ_CHOOSE_N_MISMATCH", $"the stem's choose-N marker expects {expected} correct, blob has {requiredCount}");
      }
    }

    // 15/16. write the canonical string in the pinned key order
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
    {
      Indented = false,
      Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    }))
    {
      writer.WriteStartObject();
      writer.WriteNumber("v", 1);
      writer.WriteStartArray("options");
      foreach (var opt in options)
      {
        writer.WriteStartObject();
        writer.WriteString("key", opt.Key);
        if (opt.Why is null) writer.WriteNull("why");
        else writer.WriteString("why", opt.Why);
        writer.WriteString("text", opt.Text);
        writer.WriteBoolean("correct", opt.Correct);
        writer.WriteEndObject();
      }

      writer.WriteEndArray();
      writer.WriteBoolean("shuffle", shuffle);
      if (qualifier is null) writer.WriteNull("qualifier");
      else writer.WriteString("qualifier", qualifier);
      writer.WriteEndObject();
    }

    return Encoding.UTF8.GetString(stream.ToArray());
  }

  /// <summary>1..3 — the only difficulties an MCQ card may carry (rarity = difficulty; snapshot CHECK, MCQ plan §3.10).</summary>
  public static bool IsMcqDifficulty(int difficulty) => difficulty is >= 1 and <= 3;

  public static bool IsMcqDifficulty(long difficulty) => difficulty is >= 1 and <= 3;
}
