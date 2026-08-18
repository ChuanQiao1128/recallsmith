using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Pure unit tests for the keyset-pagination cursor codecs
/// (sync pull cursor + admin decks cursor): round-trips, wire shape,
/// and malformed-input rejection. No database required.
/// </summary>
public class KeysetCursorTests
{
  private static string B64Url(string json) =>
    CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(json));

  // ---------- SyncPullCursor ----------

  [Fact]
  public void SyncPull_RoundTrip_PreservesAllFields()
  {
    var original = new SyncPullCursor(1718000000123, "aws-basics", "uid-42", MicroRemainder: 700);

    var decoded = SyncPullCursor.TryDecode(original.Encode());

    Assert.NotNull(decoded);
    Assert.Equal(original, decoded);
    Assert.Equal(1718000000123700, decoded!.TotalMicros());
  }

  [Fact]
  public void SyncPull_FromTotalMicros_SplitsMsAndRemainder()
  {
    var cursor = SyncPullCursor.FromTotalMicros(1718000000123999, "deck", "uid");

    Assert.Equal(1718000000123, cursor.UpdatedAtMs);
    Assert.Equal(999, cursor.MicroRemainder);
    Assert.Equal(1718000000123999, cursor.TotalMicros());
  }

  [Fact]
  public void SyncPull_RoundTrip_UnicodeAndSpecialChars()
  {
    var original = new SyncPullCursor(0, "中文-deck/π", "uid \"quoted\" & <weird>");

    var decoded = SyncPullCursor.TryDecode(original.Encode());

    Assert.NotNull(decoded);
    Assert.Equal(original, decoded);
  }

  [Fact]
  public void SyncPull_Encode_IsBase64Url_NoPaddingOrUnsafeChars()
  {
    // Unicode payload forces byte patterns that produce '+' / '/' in plain base64.
    var encoded = new SyncPullCursor(9007199254740991, "中文🚀", "ûid?&=").Encode();

    Assert.Matches("^[A-Za-z0-9_-]+$", encoded);
  }

  [Fact]
  public void SyncPull_Decode_AcceptsSpecWireShape_WithoutMicroRemainder()
  {
    // Bare spec shape {"v":1,"u":<updatedAtMs>,"d":"<deckSlug>","c":"<stableUid>"}
    // (no "f") must decode with MicroRemainder = 0 (floor bound: safe, never skips).
    var raw = B64Url("{\"v\":1,\"u\":1718000000123,\"d\":\"aws-basics\",\"c\":\"uid-42\"}");

    var decoded = SyncPullCursor.TryDecode(raw);

    Assert.NotNull(decoded);
    Assert.Equal(1718000000123, decoded!.UpdatedAtMs);
    Assert.Equal("aws-basics", decoded.DeckSlug);
    Assert.Equal("uid-42", decoded.StableUid);
    Assert.Equal(0, decoded.MicroRemainder);
  }

  [Fact]
  public void SyncPull_Decode_ToleratesUnknownExtraFields()
  {
    var raw = B64Url("{\"v\":1,\"u\":5,\"d\":\"a\",\"c\":\"b\",\"future\":true}");

    Assert.NotNull(SyncPullCursor.TryDecode(raw));
  }

  [Theory]
  [InlineData(null)]                 // absent
  [InlineData("")]                   // empty
  [InlineData("   ")]                // whitespace
  [InlineData("!!!not-base64!!!")]   // invalid alphabet
  [InlineData("abcde")]              // length % 4 == 1 (never valid base64)
  public void SyncPull_Decode_RejectsNonBase64Input(string? raw)
  {
    Assert.Null(SyncPullCursor.TryDecode(raw));
  }

  [Theory]
  [InlineData("not json at all")]                                // not JSON
  [InlineData("[1,2,3]")]                                        // not an object
  [InlineData("\"just a string\"")]                              // not an object
  [InlineData("{}")]                                             // all fields missing
  [InlineData("{\"u\":1,\"d\":\"a\",\"c\":\"b\"}")]              // missing v
  [InlineData("{\"v\":2,\"u\":1,\"d\":\"a\",\"c\":\"b\"}")]      // unsupported version
  [InlineData("{\"v\":\"1\",\"u\":1,\"d\":\"a\",\"c\":\"b\"}")]  // v wrong type
  [InlineData("{\"v\":1,\"d\":\"a\",\"c\":\"b\"}")]              // missing u
  [InlineData("{\"v\":1,\"u\":-1,\"d\":\"a\",\"c\":\"b\"}")]     // negative u
  [InlineData("{\"v\":1,\"u\":\"123\",\"d\":\"a\",\"c\":\"b\"}")]// u wrong type
  [InlineData("{\"v\":1,\"u\":1.5,\"d\":\"a\",\"c\":\"b\"}")]    // u not an integer
  [InlineData("{\"v\":1,\"u\":1,\"c\":\"b\"}")]                  // missing d
  [InlineData("{\"v\":1,\"u\":1,\"d\":null,\"c\":\"b\"}")]       // d null
  [InlineData("{\"v\":1,\"u\":1,\"d\":\"a\"}")]                  // missing c
  [InlineData("{\"v\":1,\"u\":1,\"d\":\"a\",\"c\":7}")]          // c wrong type
  [InlineData("{\"v\":1,\"u\":1,\"d\":\"a\",\"c\":\"b\",\"f\":-1}")]    // f below range
  [InlineData("{\"v\":1,\"u\":1,\"d\":\"a\",\"c\":\"b\",\"f\":1000}")]  // f above range (would double-count ms)
  [InlineData("{\"v\":1,\"u\":1,\"d\":\"a\",\"c\":\"b\",\"f\":\"7\"}")] // f wrong type
  public void SyncPull_Decode_RejectsMalformedPayload(string json)
  {
    Assert.Null(SyncPullCursor.TryDecode(B64Url(json)));
  }

  [Fact]
  public void SyncPull_Decode_AcceptsPaddedBase64Variant()
  {
    // Clients must echo cursors verbatim, but a padded standard-base64 variant
    // of a valid payload should not be rejected by the padding restorer.
    var padded = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"v\":1,\"u\":1,\"d\":\"a\",\"c\":\"b\"}"));

    Assert.NotNull(SyncPullCursor.TryDecode(padded));
  }

  // ---------- AdminDecksCursor ----------

  [Fact]
  public void AdminDecks_RoundTrip_PreservesAllFields()
  {
    var original = new AdminDecksCursor(1718000000999, "csharp-advanced", MicroRemainder: 250);

    var decoded = AdminDecksCursor.TryDecode(original.Encode());

    Assert.NotNull(decoded);
    Assert.Equal(original, decoded);
    Assert.Equal(1718000000999250, decoded!.TotalMicros());
  }

  [Fact]
  public void AdminDecks_Encode_UsesSpecWireShape()
  {
    // {"v":1,"u":<updatedAtMs>,"s":"<slug>","f":<microRemainder>}
    var bytes = CursorCodec.FromBase64Url(new AdminDecksCursor(123, "slug-x", 45).Encode());
    Assert.NotNull(bytes);

    using var doc = JsonDocument.Parse(bytes!);
    Assert.Equal(1, doc.RootElement.GetProperty("v").GetInt32());
    Assert.Equal(123, doc.RootElement.GetProperty("u").GetInt64());
    Assert.Equal("slug-x", doc.RootElement.GetProperty("s").GetString());
    Assert.Equal(45, doc.RootElement.GetProperty("f").GetInt32());
  }

  [Fact]
  public void AdminDecks_Decode_BareSpecShape_DefaultsMicroRemainderToZero()
  {
    var decoded = AdminDecksCursor.TryDecode(B64Url("{\"v\":1,\"u\":9,\"s\":\"a\"}"));

    Assert.NotNull(decoded);
    Assert.Equal(0, decoded!.MicroRemainder);
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("%%%%")]
  public void AdminDecks_Decode_RejectsNonBase64Input(string? raw)
  {
    Assert.Null(AdminDecksCursor.TryDecode(raw));
  }

  [Theory]
  [InlineData("{}")]                             // all fields missing
  [InlineData("{\"v\":1,\"u\":1}")]              // missing s
  [InlineData("{\"v\":1,\"s\":\"a\"}")]          // missing u
  [InlineData("{\"v\":1,\"u\":-5,\"s\":\"a\"}")] // negative u
  [InlineData("{\"v\":0,\"u\":1,\"s\":\"a\"}")]  // unsupported version
  [InlineData("{\"v\":1,\"u\":1,\"s\":null}")]   // s null
  [InlineData("{\"v\":1,\"u\":1,\"s\":42}")]     // s wrong type
  public void AdminDecks_Decode_RejectsMalformedPayload(string json)
  {
    Assert.Null(AdminDecksCursor.TryDecode(B64Url(json)));
  }

  // ---------- CardsPageCursor ----------

  [Fact]
  public void CardsPage_RoundTrip_PreservesBothLegs()
  {
    var original = new CardsPageCursor(4200, 9007199254740993);

    var decoded = CardsPageCursor.TryDecode(original.Encode());

    Assert.NotNull(decoded);
    Assert.Equal(original, decoded);
  }

  [Fact]
  public void CardsPage_Encode_UsesSpecWireShape()
  {
    // {"v":1,"o":<orderInDeck>,"i":<id>} — no "u"/"f": this keyset has no
    // timestamp leg, so there is no microsecond remainder to carry.
    var bytes = CursorCodec.FromBase64Url(new CardsPageCursor(17, 8123).Encode());
    Assert.NotNull(bytes);

    using var doc = JsonDocument.Parse(bytes!);
    Assert.Equal(1, doc.RootElement.GetProperty("v").GetInt32());
    Assert.Equal(17, doc.RootElement.GetProperty("o").GetInt32());
    Assert.Equal(8123, doc.RootElement.GetProperty("i").GetInt64());
    Assert.False(doc.RootElement.TryGetProperty("u", out _));
    Assert.False(doc.RootElement.TryGetProperty("f", out _));
  }

  [Fact]
  public void CardsPage_Decode_AcceptsNegativeOrderInDeck()
  {
    // order_in_deck is a plain int column with no non-negative constraint, and
    // reordering into a gap below the first card is a normal console move.
    var decoded = CardsPageCursor.TryDecode(B64Url("{\"v\":1,\"o\":-3,\"i\":9}"));

    Assert.NotNull(decoded);
    Assert.Equal(-3, decoded!.OrderInDeck);
  }

  [Fact]
  public void CardsPage_Decode_ToleratesUnknownExtraFields()
  {
    Assert.NotNull(CardsPageCursor.TryDecode(B64Url("{\"v\":1,\"o\":1,\"i\":2,\"future\":\"yes\"}")));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("   ")]
  [InlineData("%%%%")]
  [InlineData("abcde")]
  public void CardsPage_Decode_RejectsNonBase64Input(string? raw)
  {
    Assert.Null(CardsPageCursor.TryDecode(raw));
  }

  [Theory]
  [InlineData("{}")]                                 // all fields missing
  [InlineData("[1,2]")]                              // not an object
  [InlineData("{\"o\":1,\"i\":2}")]                  // missing v
  [InlineData("{\"v\":2,\"o\":1,\"i\":2}")]          // unsupported version
  [InlineData("{\"v\":\"1\",\"o\":1,\"i\":2}")]      // v wrong type
  [InlineData("{\"v\":1,\"i\":2}")]                  // missing o
  [InlineData("{\"v\":1,\"o\":1}")]                  // missing i
  [InlineData("{\"v\":1,\"o\":null,\"i\":2}")]       // o null
  [InlineData("{\"v\":1,\"o\":\"1\",\"i\":2}")]      // o wrong type
  [InlineData("{\"v\":1,\"o\":1.5,\"i\":2}")]        // o not an integer
  [InlineData("{\"v\":1,\"o\":2147483648,\"i\":2}")] // o overflows int4
  [InlineData("{\"v\":1,\"o\":1,\"i\":\"2\"}")]      // i wrong type
  [InlineData("{\"v\":1,\"o\":1,\"i\":-1}")]         // negative id: bigserial starts at 1
  public void CardsPage_Decode_RejectsMalformedPayload(string json)
  {
    Assert.Null(CardsPageCursor.TryDecode(B64Url(json)));
  }

  [Fact]
  public void Cursors_AreNotInterchangeable()
  {
    // A sync-pull cursor must not decode as an admin-decks cursor (missing "s")
    // and vice versa (missing "d"/"c"), and neither is a position in the card
    // sequence (missing "o"/"i"). All three are well-formed base64url JSON with
    // a valid "v", so nothing but the field set separates them.
    var syncRaw = new SyncPullCursor(1, "deck", "uid").Encode();
    var adminRaw = new AdminDecksCursor(1, "deck").Encode();
    var cardsRaw = new CardsPageCursor(1, 2).Encode();

    Assert.Null(AdminDecksCursor.TryDecode(syncRaw));
    Assert.Null(SyncPullCursor.TryDecode(adminRaw));

    Assert.Null(CardsPageCursor.TryDecode(syncRaw));
    Assert.Null(CardsPageCursor.TryDecode(adminRaw));
    Assert.Null(SyncPullCursor.TryDecode(cardsRaw));
    Assert.Null(AdminDecksCursor.TryDecode(cardsRaw));
  }
}
