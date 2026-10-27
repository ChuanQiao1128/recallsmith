using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// Raised by TranslationValidation. Like <see cref="McqValidationError"/> it is not a ValidationError: every handler
/// that canonicalises catches this type by name and answers res.BadRequest(ex.Code, ex.Message). The codes are the
/// card translations contract §2 list, shared with the console's validator.
/// </summary>
public sealed class TranslationValidationError : Exception
{
  public string Code { get; }

  public TranslationValidationError(string code, string message) : base(message)
  {
    Code = code;
  }
}

/// <summary>
/// Pure validator / canonicaliser for the optional built-in card translations (cards.translations, migration 047). No
/// database access and no I/O. A translation mirrors the card's effective English: it translates the question, the
/// explanation, the real-world usage, the MCQ qualifier and each option's text and why, keyed by the English option
/// keys. Correct marks, keys, shuffle, code, topic, source, difficulty and revision come only from the English card, so
/// a translation can never change grading. The canonical output is compact JSON in PostgreSQL's jsonb key order, so a
/// round trip through the column changes only PG's spacing.
/// </summary>
public static class TranslationValidation
{
  public const string ZhCn = "zh-CN";

  /// <summary>The v1 translation locales: Simplified Chinese only.</summary>
  public static readonly IReadOnlyList<string> SupportedLocales = [ZhCn];

  /// <summary>The English option text cap (McqValidation step 9) applies to a translated option too.</summary>
  public const int OptionMaxLength = 600;

  private static readonly string[] LocaleKeys = ["v", "question", "explanation", "realWorldUsage", "mcq", "frontHelp"];
  private static readonly string[] McqKeys = ["qualifier", "options"];
  private static readonly string[] OptionKeys = ["text", "why"];

  // A Chinese choose-N marker such as （选择两项。） or (选择 3 项): the stem's promise of how many options are correct.
  private static readonly Regex ChooseN = new(@"[（(]\s*选择?\s*(两|二|三|2|3)\s*项\s*[。.]?\s*[）)]", RegexOptions.Compiled);

  // CJK Unified Ideographs, Extension A and the compatibility block: a zh question without one was not translated.
  private static readonly Regex Cjk = new(@"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]", RegexOptions.Compiled);

  private static readonly JsonWriterOptions WriterOptions = new()
  {
    Indented = false,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
  };

  /// <summary>
  /// The English side a translation mirrors: the card's effective question, explanation and real-world usage, and its
  /// MCQ blob (canonical or as PG text; null for a Q/A card).
  /// </summary>
  public sealed record EnglishCard(string Question, string? Explanation, string? RealWorldUsage, string? Mcq, string? FrontHelp = null);

  private sealed record EnglishOption(string Key, bool HasWhy, bool Correct);

  private sealed record EnglishMcq(IReadOnlyList<EnglishOption> Options, bool HasQualifier)
  {
    public int CorrectCount => Options.Count(o => o.Correct);
  }

  private sealed record Option(string Key, string Text, string? Why);

  private sealed record Translation(string Locale, string Question, string? Explanation, string? RealWorldUsage, string? Qualifier,
    IReadOnlyList<Option>? Options, string? FrontHelp);

  /// <summary>
  /// Validates <paramref name="raw"/> against the effective English card and returns the canonical compact JSON, or
  /// null for JSON null or an empty object (no translation). <paramref name="deckLocale"/> is the deck's own locale: a
  /// translation into it is refused (TRANSLATION_BAD_LOCALE); null skips that check.
  /// </summary>
  public static string? Canonicalize(JsonElement raw, EnglishCard english, string? deckLocale)
  {
    if (raw.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
    if (raw.ValueKind != JsonValueKind.Object)
    {
      throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", "translations must be a JSON object keyed by locale");
    }

    var englishMcq = ParseEnglishMcq(english.Mcq);
    var translations = new List<Translation>();
    var seenLocales = new HashSet<string>(StringComparer.Ordinal);
    foreach (var prop in raw.EnumerateObject())
    {
      if (!seenLocales.Add(prop.Name))
      {
        throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"duplicate translation locale '{prop.Name}'");
      }

      if (!SupportedLocales.Contains(prop.Name, StringComparer.Ordinal))
      {
        throw new TranslationValidationError("TRANSLATION_BAD_LOCALE", $"unsupported translation locale '{prop.Name}' (supported: {string.Join(", ", SupportedLocales)})");
      }

      if (deckLocale is not null && string.Equals(prop.Name, deckLocale.Trim(), StringComparison.OrdinalIgnoreCase))
      {
        throw new TranslationValidationError("TRANSLATION_BAD_LOCALE", $"translation locale '{prop.Name}' is the deck's own locale");
      }

      translations.Add(ParseLocale(prop.Name, prop.Value, english, englishMcq));
    }

    if (translations.Count == 0) return null;
    return Write(translations);
  }

  /// <summary>
  /// First 16 lowercase hex chars of SHA-256 over the English a translation is written against: the trimmed question,
  /// explanation and real-world usage, and the MCQ blob as a JSON tree (so canonical text and PG text hash alike).
  /// Nonempty vocabulary help appends a canonical tree; empty help preserves every legacy basis.
  /// </summary>
  public static string Basis(EnglishCard english)
  {
    var payload = new List<object?>
    {
      english.Question.Trim(),
      (english.Explanation ?? string.Empty).Trim(),
      (english.RealWorldUsage ?? string.Empty).Trim(),
      english.Mcq is null ? null : JsonNode.Parse(english.Mcq),
    };
    if (FrontHelpValidation.Normalize(english.FrontHelp) is { } help) payload.Add(JsonNode.Parse(help));
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    return Convert.ToHexString(hash).ToLowerInvariant()[..16];
  }

  /// <summary>
  /// The translation_basis to store next to <paramref name="translationsJson"/>: {"&lt;locale&gt;":"&lt;basis&gt;"} for every
  /// locale it carries, in jsonb key order; null when there are no translations.
  /// </summary>
  public static string? BasisJson(string? translationsJson, EnglishCard english)
  {
    var locales = Locales(translationsJson);
    if (locales.Count == 0) return null;

    var basis = Basis(english);
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, WriterOptions))
    {
      writer.WriteStartObject();
      foreach (var locale in locales.OrderBy(l => l, JsonbKeyOrder.Instance)) writer.WriteString(locale, basis);
      writer.WriteEndObject();
    }
    return Encoding.UTF8.GetString(stream.ToArray());
  }

  /// <summary>
  /// Per locale of <paramref name="translationsJson"/>: "ok" when the stored basis matches the current English, else
  /// "stale" (a missing basis is stale). Null when there are no translations.
  /// </summary>
  public static Dictionary<string, string>? Status(string? translationsJson, string? basisJson, EnglishCard english)
  {
    var locales = Locales(translationsJson);
    if (locales.Count == 0) return null;

    var current = Basis(english);
    JsonNode? stored = null;
    if (!string.IsNullOrWhiteSpace(basisJson)) stored = JsonNode.Parse(basisJson);

    var status = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (var locale in locales)
    {
      var basis = stored is JsonObject obj && obj[locale] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
      status[locale] = string.Equals(basis, current, StringComparison.Ordinal) ? "ok" : "stale";
    }
    return status;
  }

  /// <summary>
  /// The effective English of a card row with the authoring aliases (<c>question</c>, <c>explanation</c>,
  /// <c>realWorldUsage</c>, <c>mcq</c>); jsonb may be PG text or an already-converted JsonElement.
  /// </summary>
  public static EnglishCard EnglishFromRow(IReadOnlyDictionary<string, object?> row)
  {
    static string? Text(IReadOnlyDictionary<string, object?> r, string key) =>
      Convert.ToString(r.TryGetValue(key, out var v) ? v : null, CultureInfo.InvariantCulture);

    var mcq = row.TryGetValue("mcq", out var m) ? m switch
    {
      string s => s,
      JsonElement { ValueKind: JsonValueKind.Object } e => e.GetRawText(),
      _ => null,
    } : null;
    return new EnglishCard(Text(row, "question") ?? string.Empty, Text(row, "explanation"), Text(row, "realWorldUsage"), mcq, Helpers.JsonbElement(row, "frontHelp") is { } help ? FrontHelpValidation.Canonicalize(help) : null);
  }

  /// <summary>
  /// In place, for an authoring response row: <c>translations</c> becomes a JSON object (or null),
  /// <c>translationStatus</c> is added (see <see cref="Status"/>), and the internal <c>translationBasis</c> is removed.
  /// Call before the mcq cell is converted or after, both work.
  /// </summary>
  public static void ShapeRow(Dictionary<string, object?> row)
  {
    FrontHelpValidation.ShapeRow(row);
    if (!row.ContainsKey("translations")) return;

    var translations = row["translations"] switch
    {
      string s => s,
      JsonElement { ValueKind: JsonValueKind.Object } e => e.GetRawText(),
      _ => null,
    };
    var basis = row.TryGetValue("translationBasis", out var b) ? b switch
    {
      string s => s,
      JsonElement { ValueKind: JsonValueKind.Object } e => e.GetRawText(),
      _ => null,
    } : null;

    row["translationStatus"] = Status(translations, basis, EnglishFromRow(row));
    row.Remove("translationBasis");
    Helpers.JsonbCell(row, "translations");
  }

  // ------------------------------------------------------------------------------------------- parsing

  private static Translation ParseLocale(string locale, JsonElement el, EnglishCard english, EnglishMcq? englishMcq)
  {
    if (el.ValueKind != JsonValueKind.Object)
    {
      throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"translations.{locale} must be an object");
    }

    // Correct marks belong to the English card alone; one anywhere in a translation is its own error.
    if (HasCorrectKey(el))
    {
      throw new TranslationValidationError("TRANSLATION_CORRECT_MARK",
        $"translations.{locale} must not mark a correct option; correct options are marked only on the English options");
    }

    RequireKnownKeys(el, LocaleKeys, $"translations.{locale}");

    if (!el.TryGetProperty("v", out var vEl) || vEl.ValueKind != JsonValueKind.Number || !vEl.TryGetInt32(out var v) || v != 1)
    {
      throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"translations.{locale}.v must be the number 1");
    }

    var question = OptionalText(el, "question", $"translations.{locale}");
    if (question is null)
    {
      throw new TranslationValidationError("TRANSLATION_QUESTION_EMPTY", $"translations.{locale}.question is required");
    }

    if (!Cjk.IsMatch(question))
    {
      throw new TranslationValidationError("TRANSLATION_NOT_TRANSLATED", $"translations.{locale}.question contains no Chinese text");
    }

    var explanation = OptionalText(el, "explanation", $"translations.{locale}");
    var englishHasExplanation = !string.IsNullOrWhiteSpace(english.Explanation);
    if (englishHasExplanation && explanation is null)
    {
      throw new TranslationValidationError("TRANSLATION_ANSWER_EMPTY", $"translations.{locale}.explanation is required (the English card has one)");
    }
    if (!englishHasExplanation && explanation is not null)
    {
      throw new TranslationValidationError("TRANSLATION_FIELD_EXTRA", $"translations.{locale}.explanation is set but the English card has none");
    }

    var realWorldUsage = OptionalText(el, "realWorldUsage", $"translations.{locale}");
    var englishHasUsage = !string.IsNullOrWhiteSpace(english.RealWorldUsage);
    if (englishHasUsage && realWorldUsage is null)
    {
      throw new TranslationValidationError("TRANSLATION_FIELD_MISSING", $"translations.{locale}.realWorldUsage is required (the English card has one)");
    }
    if (!englishHasUsage && realWorldUsage is not null)
    {
      throw new TranslationValidationError("TRANSLATION_FIELD_EXTRA", $"translations.{locale}.realWorldUsage is set but the English card has none");
    }

    var hasMcq = el.TryGetProperty("mcq", out var mcqEl) && mcqEl.ValueKind != JsonValueKind.Null;
    if (englishMcq is not null && !hasMcq)
    {
      throw new TranslationValidationError("TRANSLATION_FIELD_MISSING", $"translations.{locale}.mcq is required (the English card is an MCQ card)");
    }
    if (englishMcq is null && hasMcq)
    {
      throw new TranslationValidationError("TRANSLATION_FIELD_EXTRA", $"translations.{locale}.mcq is set but the English card has no MCQ");
    }

    string? qualifier = null;
    List<Option>? options = null;
    if (englishMcq is not null)
    {
      (qualifier, options) = ParseMcq(locale, mcqEl, question, englishMcq);
    }

    var frontHelp = el.TryGetProperty("frontHelp", out var helpEl) ? FrontHelpValidation.Canonicalize(helpEl) : null;
    var englishHelp = FrontHelpValidation.Normalize(english.FrontHelp);
    var englishCount = englishHelp is null ? 0 : JsonSerializer.Deserialize<JsonElement>(englishHelp).GetArrayLength();
    var translatedCount = frontHelp is null ? 0 : JsonSerializer.Deserialize<JsonElement>(frontHelp).GetArrayLength();
    if (englishCount != translatedCount)
      throw new TranslationValidationError("TRANSLATION_FRONT_HELP_MISMATCH", $"translations.{locale}.frontHelp must match the English help entry count");
    return new Translation(locale, question, explanation, realWorldUsage, qualifier, options, frontHelp);
  }

  private static (string? Qualifier, List<Option> Options) ParseMcq(string locale, JsonElement mcqEl, string question, EnglishMcq englishMcq)
  {
    var path = $"translations.{locale}.mcq";
    if (mcqEl.ValueKind != JsonValueKind.Object)
    {
      throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"{path} must be an object");
    }

    RequireKnownKeys(mcqEl, McqKeys, path);

    var qualifier = OptionalText(mcqEl, "qualifier", path);
    if (englishMcq.HasQualifier != (qualifier is not null))
    {
      throw new TranslationValidationError("TRANSLATION_QUALIFIER_MISMATCH", englishMcq.HasQualifier
        ? $"{path}.qualifier is required (the English MCQ has a qualifier)"
        : $"{path}.qualifier is set but the English MCQ has none");
    }
    if (qualifier is not null && !question.Contains(qualifier, StringComparison.OrdinalIgnoreCase))
    {
      throw new TranslationValidationError("TRANSLATION_QUALIFIER_NOT_IN_STEM", $"{path}.qualifier must appear in the translated question");
    }

    if (!mcqEl.TryGetProperty("options", out var optionsEl) || optionsEl.ValueKind != JsonValueKind.Object)
    {
      throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"{path}.options must be an object keyed by the English option keys");
    }

    var byKey = new Dictionary<string, Option>(StringComparer.Ordinal);
    foreach (var opt in optionsEl.EnumerateObject())
    {
      var optPath = $"{path}.options.{opt.Name}";
      if (byKey.ContainsKey(opt.Name))
      {
        throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"duplicate option key '{opt.Name}' in {path}.options");
      }
      if (opt.Value.ValueKind != JsonValueKind.Object)
      {
        throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"{optPath} must be an object");
      }

      RequireKnownKeys(opt.Value, OptionKeys, optPath);
      var text = OptionalText(opt.Value, "text", optPath) ?? string.Empty;
      var why = OptionalText(opt.Value, "why", optPath);
      byKey[opt.Name] = new Option(opt.Name, text, why);
    }

    var englishKeys = englishMcq.Options.Select(o => o.Key).ToHashSet(StringComparer.Ordinal);
    if (!englishKeys.SetEquals(byKey.Keys))
    {
      throw new TranslationValidationError("TRANSLATION_OPTION_KEYS_MISMATCH",
        $"{path}.options keys must be exactly {string.Join(", ", englishMcq.Options.Select(o => o.Key))}");
    }

    // English stored order from here on, so errors name options deterministically.
    var options = englishMcq.Options.Select(o => byKey[o.Key]).ToList();

    foreach (var opt in options)
    {
      if (opt.Text.Length == 0)
      {
        throw new TranslationValidationError("TRANSLATION_OPTION_EMPTY", $"{path}.options.{opt.Key}.text is empty");
      }
      if (opt.Text.Length > OptionMaxLength)
      {
        throw new TranslationValidationError("TRANSLATION_OPTION_TOO_LONG", $"{path}.options.{opt.Key}.text exceeds {OptionMaxLength} characters");
      }
    }

    for (var i = 0; i < options.Count; i++)
    {
      for (var j = i + 1; j < options.Count; j++)
      {
        if (string.Equals(options[i].Text, options[j].Text, StringComparison.OrdinalIgnoreCase))
        {
          throw new TranslationValidationError("TRANSLATION_OPTION_TEXT_DUPLICATE",
            $"{path}.options.{options[i].Key} and .{options[j].Key} share the same text");
        }
      }
    }

    foreach (var english in englishMcq.Options)
    {
      if (english.HasWhy != (byKey[english.Key].Why is not null))
      {
        throw new TranslationValidationError("TRANSLATION_WHY_MISMATCH", english.HasWhy
          ? $"{path}.options.{english.Key}.why is required (the English option has a why)"
          : $"{path}.options.{english.Key}.why is set but the English option has none");
      }
    }

    var m = ChooseN.Match(question);
    var expected = m.Success ? (m.Groups[1].Value is "三" or "3" ? 3 : 2) : 1;
    if (englishMcq.CorrectCount != expected)
    {
      throw new TranslationValidationError("TRANSLATION_CHOOSE_N_MISMATCH",
        $"the translated question's choose-N marker expects {expected} correct, the English MCQ has {englishMcq.CorrectCount}");
    }

    return (qualifier, options);
  }

  /// <summary>
  /// The English MCQ facts a translation mirrors: option keys in stored order, which options carry a why, which are
  /// correct, and whether there is a qualifier. Reads canonical or PG text without re-validating the English blob
  /// (every caller validated it already).
  /// </summary>
  private static EnglishMcq? ParseEnglishMcq(string? mcq)
  {
    if (string.IsNullOrWhiteSpace(mcq)) return null;
    using var doc = JsonDocument.Parse(mcq);
    var root = doc.RootElement;
    if (root.ValueKind != JsonValueKind.Object) return null;

    var options = new List<EnglishOption>();
    if (root.TryGetProperty("options", out var optionsEl) && optionsEl.ValueKind == JsonValueKind.Array)
    {
      foreach (var opt in optionsEl.EnumerateArray())
      {
        if (opt.ValueKind != JsonValueKind.Object) continue;
        var key = opt.TryGetProperty("key", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() ?? string.Empty : string.Empty;
        var hasWhy = opt.TryGetProperty("why", out var w) && w.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(w.GetString());
        var correct = opt.TryGetProperty("correct", out var c) && c.ValueKind == JsonValueKind.True;
        options.Add(new EnglishOption(key, hasWhy, correct));
      }
    }

    var hasQualifier = root.TryGetProperty("qualifier", out var q) && q.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(q.GetString());
    return new EnglishMcq(options, hasQualifier);
  }

  /// <summary>Absent / null / blank → null; a string → trimmed; any other kind → TRANSLATION_BAD_SHAPE.</summary>
  private static string? OptionalText(JsonElement obj, string name, string path)
  {
    if (!obj.TryGetProperty(name, out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind != JsonValueKind.String)
    {
      throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"{path}.{name} must be a string");
    }
    var s = (el.GetString() ?? string.Empty).Trim();
    return s.Length == 0 ? null : s;
  }

  private static void RequireKnownKeys(JsonElement obj, IReadOnlyList<string> allowed, string path)
  {
    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var prop in obj.EnumerateObject())
    {
      if (!allowed.Contains(prop.Name, StringComparer.Ordinal))
      {
        throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"{path} has unknown key '{prop.Name}'");
      }
      if (!seen.Add(prop.Name))
      {
        throw new TranslationValidationError("TRANSLATION_BAD_SHAPE", $"{path} has duplicate key '{prop.Name}'");
      }
    }
  }

  private static bool HasCorrectKey(JsonElement el)
  {
    switch (el.ValueKind)
    {
      case JsonValueKind.Object:
        foreach (var prop in el.EnumerateObject())
        {
          if (string.Equals(prop.Name, "correct", StringComparison.OrdinalIgnoreCase) || HasCorrectKey(prop.Value)) return true;
        }
        return false;
      case JsonValueKind.Array:
        foreach (var item in el.EnumerateArray())
        {
          if (HasCorrectKey(item)) return true;
        }
        return false;
      default:
        return false;
    }
  }

  private static IReadOnlyList<string> Locales(string? translationsJson)
  {
    if (string.IsNullOrWhiteSpace(translationsJson)) return [];
    using var doc = JsonDocument.Parse(translationsJson);
    if (doc.RootElement.ValueKind != JsonValueKind.Object) return [];
    return doc.RootElement.EnumerateObject().Select(p => p.Name).ToList();
  }

  // ------------------------------------------------------------------------------------------- writing

  /// <summary>
  /// The canonical string in jsonb key order (shorter keys first, then bytewise): v, mcq, question, explanation,
  /// frontHelp, realWorldUsage; mcq: options, qualifier; option: why, text. Absent optional fields are omitted, never null.
  /// </summary>
  private static string Write(IReadOnlyList<Translation> translations)
  {
    using var stream = new MemoryStream();
    using (var writer = new Utf8JsonWriter(stream, WriterOptions))
    {
      writer.WriteStartObject();
      foreach (var t in translations.OrderBy(t => t.Locale, JsonbKeyOrder.Instance))
      {
        writer.WriteStartObject(t.Locale);
        writer.WriteNumber("v", 1);
        if (t.Options is not null)
        {
          writer.WriteStartObject("mcq");
          writer.WriteStartObject("options");
          foreach (var opt in t.Options.OrderBy(o => o.Key, JsonbKeyOrder.Instance))
          {
            writer.WriteStartObject(opt.Key);
            if (opt.Why is null) writer.WriteNull("why");
            else writer.WriteString("why", opt.Why);
            writer.WriteString("text", opt.Text);
            writer.WriteEndObject();
          }
          writer.WriteEndObject();
          if (t.Qualifier is null) writer.WriteNull("qualifier");
          else writer.WriteString("qualifier", t.Qualifier);
          writer.WriteEndObject();
        }
        writer.WriteString("question", t.Question);
        if (t.FrontHelp is not null)
        {
          writer.WritePropertyName("frontHelp");
          writer.WriteRawValue(t.FrontHelp);
        }
        if (t.Explanation is not null) writer.WriteString("explanation", t.Explanation);
        if (t.RealWorldUsage is not null) writer.WriteString("realWorldUsage", t.RealWorldUsage);
        writer.WriteEndObject();
      }
      writer.WriteEndObject();
    }

    return Encoding.UTF8.GetString(stream.ToArray());
  }

  /// <summary>PostgreSQL's jsonb object key order: shorter UTF-8 keys first, equal lengths bytewise.</summary>
  private sealed class JsonbKeyOrder : IComparer<string>
  {
    public static readonly JsonbKeyOrder Instance = new();

    public int Compare(string? x, string? y)
    {
      var a = Encoding.UTF8.GetBytes(x ?? string.Empty);
      var b = Encoding.UTF8.GetBytes(y ?? string.Empty);
      if (a.Length != b.Length) return a.Length.CompareTo(b.Length);
      return a.AsSpan().SequenceCompareTo(b);
    }
  }
}
