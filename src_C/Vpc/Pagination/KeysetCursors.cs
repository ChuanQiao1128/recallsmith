using System.Text.Json;

namespace RecallSmith.Lambda.Vpc.Pagination;

// Keyset-pagination cursors. A cursor is base64url(JSON) of the full sort tuple
// of the last row of a page. Cursors are opaque to clients: they must be echoed
// back verbatim, never parsed or constructed client-side.
//
// Timestamp precision: Postgres timestamptz has MICROSECOND precision, but the
// cursor's "u" field is milliseconds. If the reconstructed bound is off by even
// one microsecond, the strict row comparison either re-delivers a whole
// same-timestamp batch (ascending; livelocks when the batch >= limit) or skips
// rows (descending). So cursors additionally carry "f" = the microsecond
// remainder (0..999); TotalMicros() rebuilds the exact stored timestamp and the
// SQL bound uses to_timestamp(totalMicros / 1000000.0), which is exact because
// timestamps are integer microseconds and the float64 error at current epochs
// is < 0.5us. Cursors in the bare spec shape (no "f") still decode with f = 0 —
// a floor bound that can only re-deliver, never skip.
//
// Malformed input never throws — TryDecode returns null and the handler maps
// that to a 400 VALIDATION_ERROR (silently ignoring a bad cursor would restart
// the client from the beginning, which is worse than failing loudly).

public static class CursorCodec
{
  public static string ToBase64Url(byte[] bytes) =>
    Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

  public static byte[]? FromBase64Url(string? raw)
  {
    if (string.IsNullOrWhiteSpace(raw)) return null;

    var s = raw.Trim().Replace('-', '+').Replace('_', '/');
    switch (s.Length % 4)
    {
      case 1: return null;
      case 2: s += "=="; break;
      case 3: s += "="; break;
    }

    try
    {
      return Convert.FromBase64String(s);
    }
    catch (FormatException)
    {
      return null;
    }
  }

  /// <summary>
  /// The one place the envelope version is decided. Split out of TryReadCommon
  /// because not every cursor keys on a timestamp: a cursor over integer columns
  /// has no "u"/"f" to read but must still reject a future "v".
  /// </summary>
  internal static bool TryReadVersion(JsonElement root) =>
    root.TryGetProperty("v", out var v) &&
    v.ValueKind == JsonValueKind.Number &&
    v.TryGetInt32(out var version) &&
    version == 1;

  internal static bool TryReadCommon(JsonElement root, out long updatedAtMs, out int microRemainder)
  {
    updatedAtMs = 0;
    microRemainder = 0;

    if (!TryReadVersion(root)) return false;
    if (!root.TryGetProperty("u", out var u) || u.ValueKind != JsonValueKind.Number || !u.TryGetInt64(out updatedAtMs) || updatedAtMs < 0) return false;

    if (root.TryGetProperty("f", out var f))
    {
      if (f.ValueKind != JsonValueKind.Number || !f.TryGetInt32(out microRemainder) || microRemainder is < 0 or > 999) return false;
    }

    return true;
  }
}

/// <summary>
/// Cursor for GET /api/v1/sync/progress (pull). Wire shape: base64url of
/// {"v":1,"u":&lt;updatedAtMs&gt;,"d":"&lt;deckSlug&gt;","c":"&lt;stableUid&gt;","f":&lt;microRemainder&gt;}
/// ("f" optional on input) matching ORDER BY updated_at asc, deck_slug asc, stable_uid asc.
/// </summary>
public sealed record SyncPullCursor(long UpdatedAtMs, string DeckSlug, string StableUid, int MicroRemainder = 0)
{
  /// <summary>Exact stored timestamp in epoch microseconds.</summary>
  public long TotalMicros() => UpdatedAtMs * 1000 + MicroRemainder;

  public static SyncPullCursor FromTotalMicros(long updatedAtUs, string deckSlug, string stableUid) =>
    new(updatedAtUs / 1000, deckSlug, stableUid, (int)(updatedAtUs % 1000));

  public string Encode() =>
    CursorCodec.ToBase64Url(JsonSerializer.SerializeToUtf8Bytes(new
    {
      v = 1,
      u = UpdatedAtMs,
      d = DeckSlug,
      c = StableUid,
      f = MicroRemainder,
    }));

  public static SyncPullCursor? TryDecode(string? raw)
  {
    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return null;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object) return null;

      if (!CursorCodec.TryReadCommon(root, out var updatedAtMs, out var microRemainder)) return null;
      if (!root.TryGetProperty("d", out var d) || d.ValueKind != JsonValueKind.String) return null;
      if (!root.TryGetProperty("c", out var c) || c.ValueKind != JsonValueKind.String) return null;

      return new SyncPullCursor(updatedAtMs, d.GetString()!, c.GetString()!, microRemainder);
    }
    catch (JsonException)
    {
      return null;
    }
  }
}

/// <summary>
/// Cursor for GET /api/v1/admin/decks (console deck list). Wire shape: base64url of
/// {"v":1,"u":&lt;updatedAtMs&gt;,"s":"&lt;slug&gt;","f":&lt;microRemainder&gt;}
/// ("f" optional on input) matching ORDER BY updated_at desc, slug desc.
/// </summary>
public sealed record AdminDecksCursor(long UpdatedAtMs, string Slug, int MicroRemainder = 0)
{
  /// <summary>Exact stored timestamp in epoch microseconds.</summary>
  public long TotalMicros() => UpdatedAtMs * 1000 + MicroRemainder;

  public static AdminDecksCursor FromTotalMicros(long updatedAtUs, string slug) =>
    new(updatedAtUs / 1000, slug, (int)(updatedAtUs % 1000));

  public string Encode() =>
    CursorCodec.ToBase64Url(JsonSerializer.SerializeToUtf8Bytes(new
    {
      v = 1,
      u = UpdatedAtMs,
      s = Slug,
      f = MicroRemainder,
    }));

  public static AdminDecksCursor? TryDecode(string? raw)
  {
    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return null;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object) return null;

      if (!CursorCodec.TryReadCommon(root, out var updatedAtMs, out var microRemainder)) return null;
      if (!root.TryGetProperty("s", out var s) || s.ValueKind != JsonValueKind.String) return null;

      return new AdminDecksCursor(updatedAtMs, s.GetString()!, microRemainder);
    }
    catch (JsonException)
    {
      return null;
    }
  }
}

/// <summary>
/// Cursor for GET /api/v1/authoring/cards/page (paged card list). Wire shape:
/// base64url of {"v":1,"o":&lt;orderInDeck&gt;,"i":&lt;id&gt;} matching
/// ORDER BY order_in_deck asc, id asc.
/// </summary>
/// <remarks>
/// The odd one out of the three cursors: it carries no "u"/"f" because its sort
/// tuple has no timestamp in it. The whole microsecond-remainder apparatus of
/// the other two exists to rebuild a timestamptz bound exactly; two integer
/// columns are already exact, so this cursor cannot round a page boundary at
/// all — there is nothing to round.
///
/// "i" (cards.id, bigserial) is the tie-breaker, and it is not decoration:
/// order_in_deck is unique only WITHIN a deck (uq_cards_deck_order), so any
/// listing that is not scoped to one deck sees genuine ties — every deck has an
/// order_in_deck = 1. Without the id leg, one page would end mid-tie-group and
/// the next page's `order_in_deck > o` bound would step over the rest of that
/// group, silently losing cards.
///
/// Negative "i" is rejected (bigserial ids start at 1, so a negative bound is
/// nonsense), while negative "o" is accepted — order_in_deck is a plain int
/// column with no non-negative constraint, and the console does reorder into
/// gaps.
/// </remarks>
public sealed record CardsPageCursor(int OrderInDeck, long Id)
{
  public string Encode() =>
    CursorCodec.ToBase64Url(JsonSerializer.SerializeToUtf8Bytes(new
    {
      v = 1,
      o = OrderInDeck,
      i = Id,
    }));

  public static CardsPageCursor? TryDecode(string? raw)
  {
    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return null;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object) return null;

      if (!CursorCodec.TryReadVersion(root)) return null;

      // TryGetInt32/TryGetInt64 also reject 1.5 and 1e300: the column types are
      // int4 and int8, and a bound Postgres would have to coerce is a bound the
      // client did not get from us.
      if (!root.TryGetProperty("o", out var o) || o.ValueKind != JsonValueKind.Number || !o.TryGetInt32(out var orderInDeck)) return null;
      if (!root.TryGetProperty("i", out var i) || i.ValueKind != JsonValueKind.Number || !i.TryGetInt64(out var id) || id < 0) return null;

      return new CardsPageCursor(orderInDeck, id);
    }
    catch (JsonException)
    {
      return null;
    }
  }
}
