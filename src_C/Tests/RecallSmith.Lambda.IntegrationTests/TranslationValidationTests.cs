using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Pure pins for TranslationValidation (card translations contract §2): no database, no collection. The golden
/// canonical strings are a synthetic MCQ card and a synthetic Q/A card; the hand-typed inputs sit in the contract's
/// written order (v, question, explanation, realWorldUsage, mcq with qualifier before options, text before why, the
/// correct option without a why) to prove the canonicaliser reorders keys into jsonb order and fills the why default.
/// Every contract code has a rejection row; the console's validator emits the same codes. The shared parity fixture
/// (content/decks/translation-fixtures.json) is the same set of cases the console's validator reads, so both sides agree
/// on the first error code of every case.
/// </summary>
public class TranslationValidationTests
{
  // ---------------------------------------------------------------- English fixtures

  private const string McqQuestion =
    "A web application stores user session data and must keep it when an instance is replaced, with the LEAST operational overhead. Which solution meets these requirements?";
  private const string McqExplanation = "DynamoDB is serverless and keeps the sessions outside the instances.";
  private const string McqUsage = "Many web frameworks ship a DynamoDB session store.";

  private static readonly string McqEnglish = McqValidation.Canonicalize(El("""
    {
      "v": 1,
      "qualifier": "LEAST operational overhead",
      "options": [
        { "key": "a", "text": "Store the sessions on the instance store volume of each instance.", "why": "Instance store data is lost when the instance stops or is replaced.", "correct": false },
        { "key": "b", "text": "Store the sessions in an Amazon DynamoDB table.", "correct": true },
        { "key": "c", "text": "Store the sessions in a self-managed Redis server on Amazon EC2.", "why": "A self-managed server adds patching and failover work, which is the overhead the question asks to avoid.", "correct": false },
        { "key": "d", "text": "Store the sessions in an Amazon EBS volume attached to one instance.", "why": "An EBS volume attaches to one instance at a time, so other instances cannot read the sessions.", "correct": false }
      ]
    }
    """), McqQuestion);

  private const string ChooseTwoQuestion =
    "A company must keep every object in a second Region and prove that no copy can be deleted for seven years. Which combination of actions meets these requirements? (Choose two.)";

  private static readonly string ChooseTwoEnglish = McqValidation.Canonicalize(El("""
    {
      "v": 1,
      "options": [
        { "key": "a", "text": "Enable versioning and S3 Cross-Region Replication.", "correct": true },
        { "key": "b", "text": "Enable S3 Transfer Acceleration.", "why": "Transfer Acceleration speeds up uploads; it never copies objects to another Region.", "correct": false },
        { "key": "c", "text": "Enable S3 Object Lock in compliance mode on the destination bucket.", "correct": true },
        { "key": "d", "text": "Deny s3:DeleteObject in the destination bucket policy.", "why": "An administrator can edit or remove a bucket policy.", "correct": false },
        { "key": "e", "text": "Enable MFA Delete on the source bucket.", "why": "MFA Delete does not cover the copy in the second Region.", "correct": false }
      ]
    }
    """), ChooseTwoQuestion);

  private static TranslationValidation.EnglishCard English(string kind) => kind switch
  {
    "mcq" => new(McqQuestion, McqExplanation, McqUsage, McqEnglish),
    "mcq-no-usage" => new(McqQuestion, McqExplanation, null, McqEnglish),
    "choose2" => new(ChooseTwoQuestion, "Replication copies every object; compliance-mode Object Lock cannot be shortened by anyone.", null, ChooseTwoEnglish),
    "qa" => new("What does Amazon S3 Versioning keep?", "Every version of every object, so an overwrite or delete can be undone.", null, null),
    "qa-no-explanation" => new("What does Amazon S3 Versioning keep?", null, null, null),
    _ => throw new ArgumentOutOfRangeException(nameof(kind)),
  };

  // ---------------------------------------------------------------- zh-CN fixtures

  private const string ZhMcqQuestion = "一个 Web 应用存储用户会话数据，替换实例时必须保留这些数据，并且运维开销最少。哪种方案满足这些要求？";

  // Golden canonical bytes — each on ONE source line.
  private const string McqCanonical = """{"zh-CN":{"v":1,"mcq":{"options":{"a":{"why":"实例停止或被替换时，实例存储中的数据会丢失。","text":"将会话存储在每个实例的实例存储卷上。"},"b":{"why":null,"text":"将会话存储在 Amazon DynamoDB 表中。"},"c":{"why":"自行管理的服务器需要打补丁和处理故障转移，这正是题目要避免的运维开销。","text":"将会话存储在 Amazon EC2 上自行管理的 Redis 服务器中。"},"d":{"why":"EBS 卷一次只能挂载到一个实例，其他实例无法读取会话。","text":"将会话存储在挂载到某一个实例的 Amazon EBS 卷中。"}},"qualifier":"运维开销最少"},"question":"一个 Web 应用存储用户会话数据，替换实例时必须保留这些数据，并且运维开销最少。哪种方案满足这些要求？","explanation":"DynamoDB 是无服务器的，会话保存在实例之外。","realWorldUsage":"许多 Web 框架都自带 DynamoDB 会话存储。"}}""";
  private const string QaCanonical = """{"zh-CN":{"v":1,"question":"Amazon S3 版本控制会保留什么？","explanation":"每个对象的每个版本，因此覆盖或删除都可以撤销。"}}""";

  // Hand-typed inputs in the contract's written order.
  private const string McqInput = """
    {
      "zh-CN": {
        "v": 1,
        "question": "  一个 Web 应用存储用户会话数据，替换实例时必须保留这些数据，并且运维开销最少。哪种方案满足这些要求？  ",
        "explanation": "DynamoDB 是无服务器的，会话保存在实例之外。",
        "realWorldUsage": "许多 Web 框架都自带 DynamoDB 会话存储。",
        "mcq": {
          "qualifier": "运维开销最少",
          "options": {
            "a": { "text": "将会话存储在每个实例的实例存储卷上。", "why": "实例停止或被替换时，实例存储中的数据会丢失。" },
            "b": { "text": "将会话存储在 Amazon DynamoDB 表中。" },
            "c": { "text": "将会话存储在 Amazon EC2 上自行管理的 Redis 服务器中。", "why": "自行管理的服务器需要打补丁和处理故障转移，这正是题目要避免的运维开销。" },
            "d": { "text": "将会话存储在挂载到某一个实例的 Amazon EBS 卷中。", "why": "EBS 卷一次只能挂载到一个实例，其他实例无法读取会话。" }
          }
        }
      }
    }
    """;

  private const string QaInput = """
    { "zh-CN": { "v": 1, "question": "Amazon S3 版本控制会保留什么？", "explanation": "每个对象的每个版本，因此覆盖或删除都可以撤销。" } }
    """;

  private static JsonElement El(string json) => JsonSerializer.Deserialize<JsonElement>(json);

  private static string? Canon(string json, string kind = "mcq", string? deckLocale = "en-US") =>
    TranslationValidation.Canonicalize(El(json), English(kind), deckLocale);

  // ---------------------------------------------------------------- canonical form

  [Fact]
  public void Canonicalize_McqCard_ProducesThePinnedBytes()
  {
    Assert.Equal(McqCanonical, Canon(McqInput));
  }

  [Fact]
  public void Canonicalize_QaCard_OmitsMcqAndUsage()
  {
    Assert.Equal(QaCanonical, Canon(QaInput, "qa"));
  }

  [Fact]
  public void Canonicalize_IsStable_AfterPgSpacedRoundTrip()
  {
    // Re-space the canonical string as PG would — same order, different spacing.
    var reSpaced = JsonSerializer.Serialize(El(McqCanonical), new JsonSerializerOptions { WriteIndented = true });
    var el = El(reSpaced);

    var zh = el.GetProperty("zh-CN");
    Assert.Equal(new[] { "v", "mcq", "question", "explanation", "realWorldUsage" }, zh.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(new[] { "options", "qualifier" }, zh.GetProperty("mcq").EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(new[] { "why", "text" }, zh.GetProperty("mcq").GetProperty("options").GetProperty("a").EnumerateObject().Select(p => p.Name).ToArray());

    Assert.Equal(McqCanonical, TranslationValidation.Canonicalize(el, English("mcq"), "en-US"));
  }

  [Fact]
  public void Canonicalize_OrdersOptionsByKey_AndTreatsBlankWhyAsNull()
  {
    var blob = JsonNode.Parse(McqInput)!.AsObject();
    var options = blob["zh-CN"]!["mcq"]!["options"]!.AsObject();
    var reversed = new JsonObject();
    foreach (var key in new[] { "d", "c", "b", "a" }) reversed[key] = options[key]!.DeepClone();
    reversed["b"]!["why"] = "   ";
    blob["zh-CN"]!["mcq"]!["options"] = reversed;

    Assert.Equal(McqCanonical, Canon(blob.ToJsonString()));
  }

  [Fact]
  public void Canonicalize_NullAndEmptyObject_AreNoTranslation()
  {
    Assert.Null(Canon("null"));
    Assert.Null(Canon("{}"));
  }

  [Fact]
  public void Canonicalize_SkipsTheDeckLocaleCheck_WhenTheDeckIsUnknown()
  {
    Assert.Equal(McqCanonical, Canon(McqInput, deckLocale: null));
  }

  [Fact]
  public void Canonicalize_LeavesChineseUnescaped()
  {
    var outStr = Canon(McqInput)!;
    Assert.Contains("运维开销最少", outStr);
    Assert.DoesNotContain("\\u", outStr);
  }

  [Theory]
  [InlineData("（选择两项。）")]
  [InlineData("(选择两项)")]
  [InlineData("（选两项）")]
  [InlineData("（选择 2 项。）")]
  [InlineData("（选择二项.）")]
  public void Canonicalize_ChooseTwoCard_AcceptsTheChineseMarker(string marker)
  {
    var blob = ChooseTwoBlob($"一家公司必须在第二个区域保留每个对象，并证明七年内任何副本都无法删除。哪种操作组合满足这些要求？{marker}");
    var outStr = TranslationValidation.Canonicalize(El(blob.ToJsonString()), English("choose2"), "en-US");
    Assert.NotNull(outStr);
    Assert.Contains("\"qualifier\":null", outStr);
  }

  // ---------------------------------------------------------------- rejections

  [Theory]
  [MemberData(nameof(Rejections))]
  public void Canonicalize_RejectsEveryCode(string code, string json, string kind, string? deckLocale)
  {
    var ex = Assert.Throws<TranslationValidationError>(() => TranslationValidation.Canonicalize(El(json), English(kind), deckLocale));
    Assert.Equal(code, ex.Code);
  }

  private static readonly string[] ContractCodes =
  [
    "TRANSLATION_BAD_SHAPE", "TRANSLATION_BAD_LOCALE", "TRANSLATION_QUESTION_EMPTY", "TRANSLATION_ANSWER_EMPTY",
    "TRANSLATION_FIELD_MISSING", "TRANSLATION_FIELD_EXTRA", "TRANSLATION_OPTION_KEYS_MISMATCH", "TRANSLATION_CORRECT_MARK",
    "TRANSLATION_OPTION_EMPTY", "TRANSLATION_OPTION_TOO_LONG", "TRANSLATION_OPTION_TEXT_DUPLICATE", "TRANSLATION_WHY_MISMATCH",
    "TRANSLATION_QUALIFIER_MISMATCH", "TRANSLATION_QUALIFIER_NOT_IN_STEM", "TRANSLATION_CHOOSE_N_MISMATCH", "TRANSLATION_NOT_TRANSLATED",
  ];

  [Fact]
  public void Rejections_CoverEveryContractCode()
  {
    Assert.Equal(ContractCodes.Order().ToArray(), Rejections().Select(r => (string)r[0]!).Distinct().Order().ToArray());
  }

  [Fact]
  public void TranslationValidationError_CarriesTheCode_AndIsNotAValidationError()
  {
    Exception ex = new TranslationValidationError("TRANSLATION_BAD_SHAPE", "m");
    Assert.False(ex is ValidationError);
    Assert.False(ex is McqValidationError);
    Assert.Equal("TRANSLATION_BAD_SHAPE", ((TranslationValidationError)ex).Code);
    Assert.Equal("m", ex.Message);
  }

  // ---------------------------------------------------------------- shared parity fixture

  // An array of { name, english: { question, explanation, realWorldUsage, mcq }, translations, expectFirstCode | null }.
  // english.mcq is the authoring MCQ blob (v, qualifier, shuffle, options[] with key/text/why/correct) or null. No case
  // depends on the deck's locale; both sides check it against an English deck.
  private const string FixturePath = "content/decks/translation-fixtures.json";
  private const string FixtureDeckLocale = "en-US";

  private static readonly Lazy<JsonElement> Fixture = new(() => El(File.ReadAllText(Path.Combine(RepoRoot(), FixturePath))));

  private static string RepoRoot()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, FixturePath))) dir = dir.Parent;
    return dir?.FullName ?? throw new FileNotFoundException($"no {FixturePath} above {AppContext.BaseDirectory}");
  }

  public static IEnumerable<object[]> FixtureCaseNames() =>
    Fixture.Value.EnumerateArray().Select(c => new object[] { c.GetProperty("name").GetString()! });

  private static TranslationValidation.EnglishCard FixtureEnglish(JsonElement english)
  {
    static string? Text(JsonElement el, string name) => el.GetProperty(name) is { ValueKind: JsonValueKind.String } s ? s.GetString() : null;

    var question = english.GetProperty("question").GetString()!;
    var mcq = english.GetProperty("mcq") is { ValueKind: JsonValueKind.Object } blob ? McqValidation.Canonicalize(blob, question) : null;
    return new(question, Text(english, "explanation"), Text(english, "realWorldUsage"), mcq);
  }

  [Theory]
  [MemberData(nameof(FixtureCaseNames))]
  public void SharedFixture_FirstErrorCode_OrSuccess(string name)
  {
    var c = Fixture.Value.EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
    var english = FixtureEnglish(c.GetProperty("english"));
    var translations = c.GetProperty("translations");
    var expected = c.GetProperty("expectFirstCode") is { ValueKind: JsonValueKind.String } code ? code.GetString() : null;

    if (expected is null)
    {
      var canonical = TranslationValidation.Canonicalize(translations, english, FixtureDeckLocale);
      if (canonical is not null) Assert.Equal(canonical, TranslationValidation.Canonicalize(El(canonical), english, FixtureDeckLocale));
    }
    else
    {
      var ex = Assert.Throws<TranslationValidationError>(() => TranslationValidation.Canonicalize(translations, english, FixtureDeckLocale));
      Assert.Equal(expected, ex.Code);
    }
  }

  [Fact]
  public void SharedFixture_KeepsTheSharedShape_AndCoversEveryContractCode()
  {
    var cases = Fixture.Value.EnumerateArray().ToList();
    Assert.True(cases.Count >= 15, $"the shared fixture has {cases.Count} cases; it needs at least 15");

    foreach (var c in cases)
    {
      Assert.Equal(new[] { "name", "english", "translations", "expectFirstCode" }, c.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(new[] { "question", "explanation", "realWorldUsage", "mcq" }, c.GetProperty("english").EnumerateObject().Select(p => p.Name).ToArray());
      Assert.False(string.IsNullOrWhiteSpace(c.GetProperty("name").GetString()));
      var code = c.GetProperty("expectFirstCode");
      Assert.True(code.ValueKind == JsonValueKind.Null || ContractCodes.Contains(code.GetString()), $"unknown expectFirstCode {code}");
    }

    var names = cases.Select(c => c.GetProperty("name").GetString()).ToList();
    Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());

    var codes = cases.Select(c => c.GetProperty("expectFirstCode")).Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!);
    Assert.Equal(ContractCodes.Order().ToArray(), codes.Distinct().Order().ToArray());
    Assert.Contains(cases, c => c.GetProperty("expectFirstCode").ValueKind == JsonValueKind.Null);
  }

  // ---------------------------------------------------------------- basis and status

  [Fact]
  public void Basis_Is16Hex_AndTheSameForCanonicalAndPgText()
  {
    var canonical = English("mcq");
    var pgSpaced = canonical with { Mcq = JsonSerializer.Serialize(El(McqEnglish), new JsonSerializerOptions { WriteIndented = true }) };
    var basis = TranslationValidation.Basis(canonical);

    Assert.Matches(new Regex("^[0-9a-f]{16}$"), basis);
    Assert.Equal(basis, TranslationValidation.Basis(pgSpaced));
    Assert.Equal(basis, TranslationValidation.Basis(canonical with { Question = "  " + McqQuestion + "\n" }));
  }

  [Fact]
  public void Basis_ChangesWithEveryEnglishField()
  {
    var english = English("mcq");
    var basis = TranslationValidation.Basis(english);
    var whyEdited = McqEnglish.Replace("Instance store data is lost", "Instance store data disappears", StringComparison.Ordinal);

    Assert.NotEqual(basis, TranslationValidation.Basis(english with { Question = McqQuestion + " Choose one." }));
    Assert.NotEqual(basis, TranslationValidation.Basis(english with { Explanation = "Edited." }));
    Assert.NotEqual(basis, TranslationValidation.Basis(english with { RealWorldUsage = null }));
    Assert.NotEqual(basis, TranslationValidation.Basis(english with { Mcq = whyEdited }));
    Assert.NotEqual(basis, TranslationValidation.Basis(english with { Mcq = null }));
  }

  [Fact]
  public void BasisJson_StampsEveryLocale_AndIsNullWithoutTranslations()
  {
    var english = English("mcq");
    Assert.Equal($$"""{"zh-CN":"{{TranslationValidation.Basis(english)}}"}""", TranslationValidation.BasisJson(McqCanonical, english));
    Assert.Null(TranslationValidation.BasisJson(null, english));
  }

  [Fact]
  public void Status_IsOkForTheCurrentEnglish_StaleOtherwise()
  {
    var english = English("mcq");
    var basis = TranslationValidation.BasisJson(McqCanonical, english);

    Assert.Equal("ok", TranslationValidation.Status(McqCanonical, basis, english)!["zh-CN"]);
    Assert.Equal("stale", TranslationValidation.Status(McqCanonical, basis, english with { Explanation = "Edited." })!["zh-CN"]);
    Assert.Equal("stale", TranslationValidation.Status(McqCanonical, null, english)!["zh-CN"]);
    Assert.Null(TranslationValidation.Status(null, basis, english));
  }

  [Fact]
  public void ShapeRow_ReplacesTheInternalBasisWithAStatus()
  {
    var english = English("mcq");
    var row = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["question"] = english.Question,
      ["explanation"] = english.Explanation,
      ["realWorldUsage"] = english.RealWorldUsage,
      ["mcq"] = english.Mcq,
      ["translations"] = McqCanonical,
      ["translationBasis"] = TranslationValidation.BasisJson(McqCanonical, english),
    };

    TranslationValidation.ShapeRow(row);

    Assert.False(row.ContainsKey("translationBasis"));
    Assert.Equal(JsonValueKind.Object, Assert.IsType<JsonElement>(row["translations"]).ValueKind);
    Assert.Equal("ok", Assert.IsType<Dictionary<string, string>>(row["translationStatus"])["zh-CN"]);

    var untranslated = new Dictionary<string, object?>(StringComparer.Ordinal) { ["question"] = "q", ["translations"] = null, ["translationBasis"] = null };
    TranslationValidation.ShapeRow(untranslated);
    Assert.Null(untranslated["translations"]);
    Assert.Null(untranslated["translationStatus"]);
  }

  // ---------------------------------------------------------------- helpers

  private static JsonObject McqBlob() => JsonNode.Parse(McqInput)!.AsObject();

  private static JsonObject Zh(JsonObject blob) => blob["zh-CN"]!.AsObject();

  private static JsonObject Options(JsonObject blob) => Zh(blob)["mcq"]!["options"]!.AsObject();

  private static JsonObject ChooseTwoBlob(string question) => new()
  {
    ["zh-CN"] = new JsonObject
    {
      ["v"] = 1,
      ["question"] = question,
      ["explanation"] = "复制会拷贝每个对象；合规模式的对象锁定任何人都无法缩短。",
      ["mcq"] = new JsonObject
      {
        ["qualifier"] = null,
        ["options"] = new JsonObject
        {
          ["a"] = new JsonObject { ["text"] = "启用版本控制和 S3 跨区域复制。" },
          ["b"] = new JsonObject { ["text"] = "启用 S3 Transfer Acceleration。", ["why"] = "传输加速只加快上传，从不把对象复制到另一个区域。" },
          ["c"] = new JsonObject { ["text"] = "在目标存储桶上启用合规模式的 S3 对象锁定。" },
          ["d"] = new JsonObject { ["text"] = "在目标存储桶策略中拒绝 s3:DeleteObject。", ["why"] = "管理员可以修改或删除存储桶策略。" },
          ["e"] = new JsonObject { ["text"] = "在源存储桶上启用 MFA Delete。", ["why"] = "MFA Delete 不覆盖第二个区域中的副本。" },
        },
      },
    },
  };

  private static object?[] Row(string code, JsonNode blob, string kind = "mcq", string? deckLocale = "en-US") =>
    [code, blob.ToJsonString(), kind, deckLocale];

  public static IEnumerable<object?[]> Rejections()
  {
    // BAD_SHAPE: not an object, a locale that is not an object, an unknown key, v != 1, options as an array, an
    // unknown option key, a wrong type
    yield return ["TRANSLATION_BAD_SHAPE", "[]", "mcq", "en-US"];
    yield return Row("TRANSLATION_BAD_SHAPE", new JsonObject { ["zh-CN"] = "一个问题" });
    { var b = McqBlob(); Zh(b)["codeSnippet"] = "print(1)"; yield return Row("TRANSLATION_BAD_SHAPE", b); }
    { var b = McqBlob(); Zh(b)["v"] = 2; yield return Row("TRANSLATION_BAD_SHAPE", b); }
    { var b = McqBlob(); Zh(b).Remove("v"); yield return Row("TRANSLATION_BAD_SHAPE", b); }
    { var b = McqBlob(); Zh(b)["mcq"]!["options"] = new JsonArray(new JsonObject { ["text"] = "选项" }); yield return Row("TRANSLATION_BAD_SHAPE", b); }
    { var b = McqBlob(); Options(b)["a"]!["key"] = "a"; yield return Row("TRANSLATION_BAD_SHAPE", b); }
    { var b = McqBlob(); Zh(b)["mcq"]!["shuffle"] = false; yield return Row("TRANSLATION_BAD_SHAPE", b); }
    { var b = McqBlob(); Zh(b)["explanation"] = 42; yield return Row("TRANSLATION_BAD_SHAPE", b); }

    // BAD_LOCALE: an unsupported locale, and the deck's own locale
    { var b = new JsonObject { ["zh-TW"] = Zh(McqBlob()).DeepClone() }; yield return Row("TRANSLATION_BAD_LOCALE", b); }
    yield return Row("TRANSLATION_BAD_LOCALE", McqBlob(), "mcq", "zh-CN");

    // QUESTION_EMPTY / ANSWER_EMPTY
    { var b = McqBlob(); Zh(b)["question"] = "   "; yield return Row("TRANSLATION_QUESTION_EMPTY", b); }
    { var b = McqBlob(); Zh(b).Remove("question"); yield return Row("TRANSLATION_QUESTION_EMPTY", b); }
    { var b = McqBlob(); Zh(b).Remove("explanation"); yield return Row("TRANSLATION_ANSWER_EMPTY", b); }

    // FIELD_MISSING / FIELD_EXTRA: realWorldUsage, mcq and explanation presence mirror the English card
    { var b = McqBlob(); Zh(b).Remove("realWorldUsage"); yield return Row("TRANSLATION_FIELD_MISSING", b); }
    { var b = McqBlob(); Zh(b).Remove("mcq"); yield return Row("TRANSLATION_FIELD_MISSING", b); }
    yield return Row("TRANSLATION_FIELD_EXTRA", McqBlob(), "mcq-no-usage");
    { var b = JsonNode.Parse(QaInput)!.AsObject(); Zh(b)["mcq"] = Zh(McqBlob())["mcq"]!.DeepClone(); yield return Row("TRANSLATION_FIELD_EXTRA", b, "qa"); }
    yield return Row("TRANSLATION_FIELD_EXTRA", JsonNode.Parse(QaInput)!, "qa-no-explanation");

    // OPTION_KEYS_MISMATCH: a missing key and an extra key
    { var b = McqBlob(); Options(b).Remove("d"); yield return Row("TRANSLATION_OPTION_KEYS_MISMATCH", b); }
    { var b = McqBlob(); Options(b)["e"] = new JsonObject { ["text"] = "多出来的选项。", ["why"] = "多余。" }; yield return Row("TRANSLATION_OPTION_KEYS_MISMATCH", b); }

    // CORRECT_MARK anywhere in a translation
    { var b = McqBlob(); Options(b)["b"]!["correct"] = true; yield return Row("TRANSLATION_CORRECT_MARK", b); }
    { var b = McqBlob(); Zh(b)["mcq"]!["correct"] = new JsonArray("b"); yield return Row("TRANSLATION_CORRECT_MARK", b); }

    // OPTION_EMPTY / OPTION_TOO_LONG / OPTION_TEXT_DUPLICATE
    { var b = McqBlob(); Options(b)["a"]!["text"] = "   "; yield return Row("TRANSLATION_OPTION_EMPTY", b); }
    { var b = McqBlob(); Options(b)["a"]!.AsObject().Remove("text"); yield return Row("TRANSLATION_OPTION_EMPTY", b); }
    { var b = McqBlob(); Options(b)["a"]!["text"] = new string('选', 601); yield return Row("TRANSLATION_OPTION_TOO_LONG", b); }
    { var b = McqBlob(); Options(b)["c"]!["text"] = Options(b)["a"]!["text"]!.GetValue<string>(); yield return Row("TRANSLATION_OPTION_TEXT_DUPLICATE", b); }

    // WHY_MISMATCH: a why the English option lacks, and a missing why the English option has
    { var b = McqBlob(); Options(b)["b"]!["why"] = "这是正确答案。"; yield return Row("TRANSLATION_WHY_MISMATCH", b); }
    { var b = McqBlob(); Options(b)["a"]!.AsObject().Remove("why"); yield return Row("TRANSLATION_WHY_MISMATCH", b); }

    // QUALIFIER_MISMATCH both ways, QUALIFIER_NOT_IN_STEM
    { var b = McqBlob(); Zh(b)["mcq"]!["qualifier"] = null; yield return Row("TRANSLATION_QUALIFIER_MISMATCH", b); }
    { var b = ChooseTwoBlob("哪种操作组合满足这些要求？（选择两项。）"); Zh(b)["mcq"]!["qualifier"] = "要求"; yield return Row("TRANSLATION_QUALIFIER_MISMATCH", b, "choose2"); }
    { var b = McqBlob(); Zh(b)["mcq"]!["qualifier"] = "最安全"; yield return Row("TRANSLATION_QUALIFIER_NOT_IN_STEM", b); }

    // CHOOSE_N_MISMATCH both ways: a marker on a single-answer card, no marker on a choose-two card, the wrong N
    { var b = McqBlob(); Zh(b)["question"] = ZhMcqQuestion + "（选择两项。）"; yield return Row("TRANSLATION_CHOOSE_N_MISMATCH", b); }
    yield return Row("TRANSLATION_CHOOSE_N_MISMATCH", ChooseTwoBlob("哪种操作组合满足这些要求？"), "choose2");
    yield return Row("TRANSLATION_CHOOSE_N_MISMATCH", ChooseTwoBlob("哪种操作组合满足这些要求？(选择三项)"), "choose2");

    // NOT_TRANSLATED: the zh question carries no Chinese at all
    { var b = McqBlob(); Zh(b)["question"] = McqQuestion; Zh(b)["mcq"]!["qualifier"] = "LEAST operational overhead"; yield return Row("TRANSLATION_NOT_TRANSLATED", b); }
  }
}
