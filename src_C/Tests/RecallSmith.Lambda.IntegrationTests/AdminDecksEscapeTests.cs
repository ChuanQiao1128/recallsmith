using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Pure unit tests for the /api/v1/admin/decks q-param ILIKE escaping.
/// The q value is always bound as a parameter (never interpolated into SQL);
/// escaping only ensures ILIKE metacharacters in user input match literally.
/// </summary>
public class AdminDecksEscapeTests
{
  [Fact]
  public void Escape_PlainText_Unchanged()
  {
    Assert.Equal("aws basics", AdminDecks.EscapeLikePattern("aws basics"));
  }

  [Fact]
  public void Escape_Percent_IsEscaped()
  {
    Assert.Equal(@"50\% off", AdminDecks.EscapeLikePattern("50% off"));
  }

  [Fact]
  public void Escape_Underscore_IsEscaped()
  {
    Assert.Equal(@"snake\_case", AdminDecks.EscapeLikePattern("snake_case"));
  }

  [Fact]
  public void Escape_Backslash_IsEscaped()
  {
    Assert.Equal(@"a\\b", AdminDecks.EscapeLikePattern(@"a\b"));
  }

  [Fact]
  public void Escape_BackslashBeforeMetachar_DoesNotDoubleEscape()
  {
    // Input "\%" (a backslash then a percent) must become "\\\%":
    // escaped backslash followed by escaped percent — 4 characters total.
    Assert.Equal(@"\\\%", AdminDecks.EscapeLikePattern(@"\%"));
  }

  [Fact]
  public void Escape_AllMetacharsCombined()
  {
    Assert.Equal(@"\%\_\\", AdminDecks.EscapeLikePattern(@"%_\"));
  }

  [Fact]
  public void Escape_EmptyString_StaysEmpty()
  {
    Assert.Equal(string.Empty, AdminDecks.EscapeLikePattern(string.Empty));
  }

  [Fact]
  public void Escape_LeavesNoUnescapedMetacharacters()
  {
    var escaped = AdminDecks.EscapeLikePattern(@"a%b_c\d%%__\\");

    // Walk the escaped pattern: every % _ \ must be preceded by an escaping backslash.
    for (var i = 0; i < escaped.Length; i++)
    {
      var ch = escaped[i];
      if (ch is '%' or '_')
      {
        Assert.True(i > 0 && escaped[i - 1] == '\\', $"unescaped '{ch}' at {i} in '{escaped}'");
      }
      else if (ch == '\\')
      {
        // Escape sequences are exactly two chars; skip the escaped char.
        Assert.True(i + 1 < escaped.Length, $"dangling backslash at {i} in '{escaped}'");
        i++;
      }
    }
  }
}
