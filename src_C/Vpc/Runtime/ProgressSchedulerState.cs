using System.Text.Json;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class ProgressSchedulerState
{
  // Persist only scheduler fields. progressAfter may contain future client data
  // that must not silently become part of the server's storage/API contract.
  public static string? Normalize(JsonElement? progress, long eventTimeMs)
  {
    if (progress is not { ValueKind: JsonValueKind.Object }) return null;
    var p = progress.Value;
    var state = new Dictionary<string, object>();
    foreach (var key in new[] { "lapses", "hardStreak" })
      if (p.TryGetProperty(key, out var counter) && counter.ValueKind == JsonValueKind.Number
        && counter.TryGetInt32(out var n) && n >= 0) state[key] = n;

    double? Number(string key) => p.TryGetProperty(key, out var v)
      && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && double.IsFinite(n) ? n : null;
    var stability = Number("fsrsStability");
    var difficulty = Number("fsrsDifficulty");
    var anchor = Number("fsrsAnchorAt");
    var reviewed = p.TryGetProperty("fsrsReviewedAt", out _) ? Number("fsrsReviewedAt") : anchor;
    if (stability is > 0 && difficulty is >= 1 and <= 10 && anchor == eventTimeMs
      && reviewed is > 0 && reviewed <= eventTimeMs && reviewed == Math.Floor(reviewed.Value))
    {
      state["fsrsStability"] = stability.Value;
      state["fsrsDifficulty"] = difficulty.Value;
      state["fsrsAnchorAt"] = eventTimeMs;
      state["fsrsReviewedAt"] = (long)reviewed.Value;
    }
    return state.Count == 0 ? null : JsonSerializer.Serialize(state);
  }
}
