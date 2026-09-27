namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// The pg_trgm similarity algorithm in process, for databases where the extension cannot be installed
/// (contract §3.4, §8.2). Text is lower-cased; words are maximal runs of letters/digits; each word is padded
/// with two spaces before and one after; the trigrams of all words form one set; similarity is
/// |A∩B| / |A∪B| computed in float4, so the result equals PostgreSQL's similarity() bit for bit.
/// Pure: no I/O, no state.
/// </summary>
public static class Trigram
{
  public static IReadOnlySet<string> Trigrams(string? text)
  {
    var set = new HashSet<string>(StringComparer.Ordinal);
    if (text is null) return set;

    var lower = text.ToLowerInvariant();
    var i = 0;
    while (i < lower.Length)
    {
      if (!char.IsLetterOrDigit(lower[i]))
      {
        i++;
        continue;
      }

      var start = i;
      while (i < lower.Length && char.IsLetterOrDigit(lower[i])) i++;

      var padded = "  " + lower.Substring(start, i - start) + " ";
      for (var j = 0; j + 3 <= padded.Length; j++) set.Add(padded.Substring(j, 3));
    }

    return set;
  }

  public static float Similarity(string? a, string? b)
  {
    var setA = Trigrams(a);
    var setB = Trigrams(b);
    if (setA.Count == 0 || setB.Count == 0) return 0f;

    var inter = 0;
    foreach (var t in setA)
    {
      if (setB.Contains(t)) inter++;
    }

    // float, not double: pg_trgm divides two float4 values, and the parity tests compare bit for bit.
    return (float)inter / (float)(setA.Count + setB.Count - inter);
  }
}
