using System.Text.Json;
using System.Text.Json.Nodes;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Pure pins for McqValidation.Canonicalize (C00 §2.9.1): no database, no collection.
/// The two golden canonical strings are the §4.3 cards of the MCQ plan run through the
/// change-2 algorithm; the hand-typed inputs sit in the doc's written order (v, qualifier,
/// options as key/text/why/correct, no shuffle, correct options without a why) to prove the
/// canonicaliser reorders keys and fills the shuffle / qualifier / why defaults.
/// </summary>
public class McqValidationTests
{
  // Golden canonical bytes — each on ONE source line (brief change 5).
  private const string SqsCanonical = """{"v":1,"options":[{"key":"a","why":"Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.","text":"Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.","correct":false},{"key":"b","why":null,"text":"Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.","correct":true},{"key":"c","why":"A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.","text":"Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.","correct":false},{"key":"d","why":"Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.","text":"Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.","correct":false}],"shuffle":true,"qualifier":"LEAST operational overhead"}""";
  private const string S3Canonical = """{"v":1,"options":[{"key":"a","why":null,"text":"Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.","correct":true},{"key":"b","why":"Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.","text":"Enable S3 Transfer Acceleration on the source bucket.","correct":false},{"key":"c","why":null,"text":"Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.","correct":true},{"key":"d","why":"A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.","text":"Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.","correct":false},{"key":"e","why":"MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.","text":"Enable MFA Delete on the source bucket.","correct":false}],"shuffle":true,"qualifier":null}""";

  private const string SqsQuestion = "An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?";
  private const string S3Question = "A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)";

  // Hand-typed inputs in the doc's written order.
  private const string SqsInput = """
    {
      "v": 1,
      "qualifier": "LEAST operational overhead",
      "options": [
        { "key": "a", "text": "Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.", "why": "Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.", "correct": false },
        { "key": "b", "text": "Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.", "correct": true },
        { "key": "c", "text": "Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.", "why": "A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.", "correct": false },
        { "key": "d", "text": "Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.", "why": "Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.", "correct": false }
      ]
    }
    """;

  private const string S3Input = """
    {
      "v": 1,
      "options": [
        { "key": "a", "text": "Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.", "correct": true },
        { "key": "b", "text": "Enable S3 Transfer Acceleration on the source bucket.", "why": "Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.", "correct": false },
        { "key": "c", "text": "Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.", "correct": true },
        { "key": "d", "text": "Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.", "why": "A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.", "correct": false },
        { "key": "e", "text": "Enable MFA Delete on the source bucket.", "why": "MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.", "correct": false }
      ]
    }
    """;

  private static JsonElement El(string json) => JsonSerializer.Deserialize<JsonElement>(json);

  [Fact]
  public void Canonicalize_SqsCard_ProducesThePinnedBytes()
  {
    var el = El(SqsInput);
    Assert.Equal(SqsCanonical, McqValidation.Canonicalize(el, SqsQuestion));
  }

  [Fact]
  public void Canonicalize_S3ChooseTwoCard_ProducesThePinnedBytes()
  {
    var el = El(S3Input);
    Assert.Equal(S3Canonical, McqValidation.Canonicalize(el, S3Question));
  }

  [Fact]
  public void Canonicalize_IsStable_AfterPgSpacedRoundTrip()
  {
    // Re-space the canonical string as PG would (": " / ", ") — same order, different spacing.
    var reSpaced = JsonSerializer.Serialize(El(SqsCanonical), new JsonSerializerOptions { WriteIndented = true });
    var el = El(reSpaced);

    Assert.Equal(
      new[] { "v", "options", "shuffle", "qualifier" },
      el.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(
      new[] { "key", "why", "text", "correct" },
      el.GetProperty("options")[0].EnumerateObject().Select(p => p.Name).ToArray());

    Assert.Equal(SqsCanonical, McqValidation.Canonicalize(el, SqsQuestion));
  }

  [Fact]
  public void Canonicalize_DefaultsShuffleTrue_AndNullQualifier()
  {
    var blob = new JsonObject
    {
      ["v"] = 1,
      ["options"] = new JsonArray(
        Opt("a", "Alpha choice", true, null),
        Opt("b", "Bravo choice", false, "b is wrong"),
        Opt("c", "Charlie choice", false, "c is wrong")),
    };

    var outStr = McqValidation.Canonicalize(El(blob.ToJsonString()), null);
    Assert.EndsWith("\"shuffle\":true,\"qualifier\":null}", outStr);
    Assert.StartsWith("{\"v\":1,\"options\":[{\"key\":\"a\",\"why\":null,", outStr);

    blob["shuffle"] = false;
    var offStr = McqValidation.Canonicalize(El(blob.ToJsonString()), null);
    Assert.Contains("\"shuffle\":false", offStr);
  }

  [Fact]
  public void Canonicalize_SkipsStemChecks_WhenQuestionIsNull()
  {
    // No stem given: MCQ_QUALIFIER_NOT_IN_STEM and MCQ_CHOOSE_N_MISMATCH must not fire.
    Assert.Equal(SqsCanonical, McqValidation.Canonicalize(El(SqsInput), null));
    Assert.Equal(S3Canonical, McqValidation.Canonicalize(El(S3Input), null));
  }

  [Fact]
  public void Canonicalize_DropsUnknownKeys()
  {
    var extraOpt = Opt("a", "Alpha choice", true, null);
    extraOpt["bar"] = true;
    var blob = new JsonObject
    {
      ["v"] = 1,
      ["foo"] = 1,
      ["options"] = new JsonArray(
        extraOpt,
        Opt("b", "Bravo choice", false, "b is wrong"),
        Opt("c", "Charlie choice", false, "c is wrong")),
    };

    var outStr = McqValidation.Canonicalize(El(blob.ToJsonString()), null);
    Assert.DoesNotContain("foo", outStr);
    Assert.DoesNotContain("bar", outStr);
  }

  [Fact]
  public void Canonicalize_LeavesApostrophesAndNonAsciiUnescaped()
  {
    var blob = new JsonObject
    {
      ["v"] = 1,
      ["options"] = new JsonArray(
        Opt("a", "it's über", true, null),
        Opt("b", "plain bravo", false, "b is wrong"),
        Opt("c", "plain charlie", false, "c is wrong")),
    };

    var outStr = McqValidation.Canonicalize(El(blob.ToJsonString()), null);
    Assert.Contains("it's über", outStr);
    Assert.DoesNotContain("\\u", outStr);
  }

  [Theory]
  [MemberData(nameof(Rejections))]
  public void Canonicalize_RejectsEveryCode(string code, string json, string? question)
  {
    var el = El(json);
    var ex = Assert.Throws<McqValidationError>(() => McqValidation.Canonicalize(el, question));
    Assert.Equal(code, ex.Code);
  }

  [Theory]
  [InlineData(0, false)]
  [InlineData(1, true)]
  [InlineData(2, true)]
  [InlineData(3, true)]
  [InlineData(4, false)]
  public void IsMcqDifficulty_AcceptsOneToThreeOnly(int difficulty, bool expected)
  {
    Assert.Equal(expected, McqValidation.IsMcqDifficulty(difficulty));
    Assert.Equal(expected, McqValidation.IsMcqDifficulty((long)difficulty));
    // A silent (int) cast of 2^32 + 1 would wrap to 1; the long overload must reject it.
    Assert.False(McqValidation.IsMcqDifficulty(4294967297L));
  }

  [Fact]
  public void McqValidationError_CarriesTheCode_AndIsNotAValidationError()
  {
    Exception ex = new McqValidationError("MCQ_BAD_SHAPE", "m");
    Assert.False(ex is ValidationError);
    Assert.Equal("MCQ_BAD_SHAPE", ((McqValidationError)ex).Code);
    Assert.Equal("m", ex.Message);
  }

  // ---------------------------------------------------------------- helpers

  private static JsonObject Opt(string key, string text, bool correct, string? why)
  {
    var o = new JsonObject
    {
      ["key"] = key,
      ["text"] = text,
      ["correct"] = correct,
    };
    if (why is not null) o["why"] = why;
    return o;
  }

  /// <summary>A valid 4-option blob (one correct); each rejection row mutates a fresh copy.</summary>
  private static JsonObject ValidBlob() => new()
  {
    ["v"] = 1,
    ["options"] = new JsonArray(
      Opt("a", "Alpha choice", false, "a is wrong"),
      Opt("b", "Bravo choice", true, null),
      Opt("c", "Charlie choice", false, "c is wrong"),
      Opt("d", "Delta choice", false, "d is wrong")),
  };

  public static IEnumerable<object?[]> Rejections()
  {
    // 1. not an object
    yield return new object?[] { "MCQ_BAD_SHAPE", "123", null };

    // 2. wrong version
    {
      var b = ValidBlob();
      b["v"] = 2;
      yield return new object?[] { "MCQ_BAD_VERSION", b.ToJsonString(), null };
    }

    // 3. too few options
    {
      var b = ValidBlob();
      b["options"] = new JsonArray(Opt("a", "Alpha", false, "a"), Opt("b", "Bravo", true, null));
      yield return new object?[] { "MCQ_TOO_FEW_OPTIONS", b.ToJsonString(), null };
    }

    // 4. too many options
    {
      var b = ValidBlob();
      b["options"] = new JsonArray(
        Opt("a", "Alpha", false, "a"), Opt("b", "Bravo", true, null), Opt("c", "Charlie", false, "c"),
        Opt("d", "Delta", false, "d"), Opt("e", "Echo", false, "e"), Opt("f", "Foxtrot", false, "f"),
        Opt("g", "Golf", false, "g"));
      yield return new object?[] { "MCQ_TOO_MANY_OPTIONS", b.ToJsonString(), null };
    }

    // 5. key not in [a-f]
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[0]!["key"] = "1";
      yield return new object?[] { "MCQ_KEY_SEQUENCE", b.ToJsonString(), null };
    }

    // 6. duplicate key
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[2]!["key"] = "b";
      yield return new object?[] { "MCQ_DUPLICATE_OPTION_KEY", b.ToJsonString(), null };
    }

    // 7. empty option text
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[0]!["text"] = "   ";
      yield return new object?[] { "MCQ_OPTION_EMPTY", b.ToJsonString(), null };
    }

    // 8. option text too long
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[0]!["text"] = new string('x', 601);
      yield return new object?[] { "MCQ_OPTION_TOO_LONG", b.ToJsonString(), null };
    }

    // 9. duplicate option text
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[2]!["text"] = "Alpha choice";
      yield return new object?[] { "MCQ_OPTION_TEXT_DUPLICATE", b.ToJsonString(), null };
    }

    // 10. no correct option
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[1]!["correct"] = false;
      ((JsonArray)b["options"]!)[1]!["why"] = "b is wrong too";
      yield return new object?[] { "MCQ_NO_CORRECT", b.ToJsonString(), null };
    }

    // 11. too many correct (4 of 6)
    {
      var b = ValidBlob();
      b["options"] = new JsonArray(
        Opt("a", "Alpha", true, null), Opt("b", "Bravo", true, null), Opt("c", "Charlie", true, null),
        Opt("d", "Delta", true, null), Opt("e", "Echo", false, "e"), Opt("f", "Foxtrot", false, "f"));
      yield return new object?[] { "MCQ_TOO_MANY_CORRECT", b.ToJsonString(), null };
    }

    // 12. all correct
    {
      var b = ValidBlob();
      b["options"] = new JsonArray(
        Opt("a", "Alpha", true, null), Opt("b", "Bravo", true, null), Opt("c", "Charlie", true, null));
      yield return new object?[] { "MCQ_ALL_CORRECT", b.ToJsonString(), null };
    }

    // 13. incorrect option missing why
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[0]!.AsObject().Remove("why");
      yield return new object?[] { "MCQ_WHY_MISSING", b.ToJsonString(), null };
    }

    // 14. qualifier blank
    {
      var b = ValidBlob();
      b["qualifier"] = "   ";
      yield return new object?[] { "MCQ_QUALIFIER_EMPTY", b.ToJsonString(), null };
    }

    // 15. qualifier is a choose-N marker
    {
      var b = ValidBlob();
      b["qualifier"] = "choose two";
      yield return new object?[] { "MCQ_QUALIFIER_IS_CHOOSE_N", b.ToJsonString(), null };
    }

    // 16. qualifier not present in the stem
    {
      var b = ValidBlob();
      b["qualifier"] = "Zephyr constraint";
      yield return new object?[] { "MCQ_QUALIFIER_NOT_IN_STEM", b.ToJsonString(), "A plain question with no such phrase?" };
    }

    // 17a. stem marker "(Choose two.)" but only one correct
    {
      var b = ValidBlob();
      yield return new object?[] { "MCQ_CHOOSE_N_MISMATCH", b.ToJsonString(), "Pick the winners. (Choose two.)" };
    }

    // 17b. two correct but no marker in the stem
    {
      var b = ValidBlob();
      ((JsonArray)b["options"]!)[0]!["correct"] = true;
      ((JsonArray)b["options"]!)[0]!.AsObject().Remove("why");
      yield return new object?[] { "MCQ_CHOOSE_N_MISMATCH", b.ToJsonString(), "Pick the single best answer." };
    }
  }
}
