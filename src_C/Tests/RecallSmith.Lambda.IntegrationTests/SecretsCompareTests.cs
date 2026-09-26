using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Secrets.FixedTimeEquals: the shared constant-time compare used by the x-migrate-secret gates.
/// Pure — no database, no collection. The generated cases are deterministic (fixed seed) so a
/// failure is reproducible, and they assert the two properties that matter for a compare that
/// must not short-circuit: distinct inputs are never equal (and equality is symmetric), and an
/// identical value always matches its fresh copy.
/// </summary>
public class SecretsCompareTests
{
  private const int GeneratedCases = 64;

  private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  // A 64-char alphanumeric literal (a-z A-F, then G-Z 0-9 a-b): the top of the accepted range.
  private const string SixtyFour = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab";

  private static string RandomAlnum(Random rng, int length)
  {
    var chars = new char[length];
    for (var i = 0; i < length; i++) chars[i] = Alphabet[rng.Next(Alphabet.Length)];
    return new string(chars);
  }

  [Theory]
  [InlineData(null, null)]
  [InlineData("", "")]
  [InlineData(null, "a")]
  [InlineData("a", null)]
  [InlineData("", "a")]
  [InlineData("a", "")]
  public void FixedTimeEquals_NullOrEmpty_False(string? got, string? expected)
  {
    Assert.False(Secrets.FixedTimeEquals(got, expected));
  }

  [Theory]
  [InlineData("a")]
  [InlineData(SixtyFour)]
  [InlineData("café🙂")]
  public void FixedTimeEquals_Equal_True(string value)
  {
    Assert.True(Secrets.FixedTimeEquals(value, new string(value.ToCharArray())));
  }

  [Theory]
  [InlineData("a", "b")]
  [InlineData("a", "ab")]
  [InlineData("ab", "a")]
  [InlineData("Secret", "secret")]
  [InlineData("a", "a ")]
  public void FixedTimeEquals_Different_False(string got, string expected)
  {
    Assert.False(Secrets.FixedTimeEquals(got, expected));
  }

  [Theory]
  [MemberData(nameof(GeneratedPairs))]
  public void FixedTimeEquals_GeneratedPairs_NeverTrueAndSymmetric(string a, string b)
  {
    Assert.False(Secrets.FixedTimeEquals(a, b));
    Assert.False(Secrets.FixedTimeEquals(b, a));
  }

  [Theory]
  [MemberData(nameof(GeneratedSelf))]
  public void FixedTimeEquals_GeneratedSelf_True(string s)
  {
    Assert.True(Secrets.FixedTimeEquals(s, new string(s.ToCharArray())));
  }

  public static IEnumerable<object[]> GeneratedPairs()
  {
    var rng = new Random(20260922);
    for (var n = 0; n < GeneratedCases; n++)
    {
      var a = RandomAlnum(rng, rng.Next(1, 81));
      string b;
      do { b = RandomAlnum(rng, rng.Next(1, 81)); } while (b == a);
      yield return new object[] { a, b };
    }
  }

  public static IEnumerable<object[]> GeneratedSelf()
  {
    var rng = new Random(20260922);
    for (var n = 0; n < GeneratedCases; n++)
    {
      yield return new object[] { RandomAlnum(rng, rng.Next(1, 81)) };
    }
  }
}
