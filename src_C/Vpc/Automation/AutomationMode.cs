using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The <c>AUTOMATION_MODE</c> switch (R18A A01, contract A00 §3). Only core-vpc reads it, from its environment, on
/// every call (never cached). <see cref="EffectiveAsync"/> turns the configured value into the effective one:
/// <c>live</c> needs a passed, unrevoked eval gate, and a database without migration 034 is always <c>off</c>.
/// </summary>
public static class AutomationMode
{
  public const string EnvName = "AUTOMATION_MODE";
  public const string Off = "off", DryRun = "dry_run", Live = "live";
  public const string EvalGateMissing = "EVAL_GATE_MISSING";
  public const string ServerNotReady = "SERVER_NOT_READY_AUTOMATION";

  private const int LoggedValueMaxLength = 20;
  private static int _invalidLogged;

  /// <summary>Trimmed, case-insensitive <c>off</c> | <c>dry_run</c> | <c>live</c>; anything else (null, empty, other) is <c>off</c>.</summary>
  public static string Parse(string? raw)
  {
    var v = (raw ?? string.Empty).Trim();
    if (v.Equals(DryRun, StringComparison.OrdinalIgnoreCase)) return DryRun;
    if (v.Equals(Live, StringComparison.OrdinalIgnoreCase)) return Live;
    return Off;
  }

  /// <summary>
  /// <see cref="Parse"/> of the environment variable, read on every call. An absent, empty or invalid value logs one
  /// <c>mode_invalid</c> warn per container (the value truncated to 20 characters).
  /// </summary>
  public static string Configured()
  {
    var raw = Environment.GetEnvironmentVariable(EnvName);
    var mode = Parse(raw);
    if (mode == Off && !(raw ?? string.Empty).Trim().Equals(Off, StringComparison.OrdinalIgnoreCase)
        && Interlocked.Exchange(ref _invalidLogged, 1) == 0)
    {
      var value = raw is null ? null : raw.Length <= LoggedValueMaxLength ? raw : raw[..LoggedValueMaxLength];
      Log.Event("warn", new { tag = "automation", reason = "mode_invalid", value });
    }
    return mode;
  }

  /// <summary>
  /// The effective mode (A00 §3.2). Configured <c>off</c> answers without touching the database. Otherwise the gate
  /// table is probed with <c>to_regclass</c> (never by catching 42P01, so this is safe inside an open transaction);
  /// a missing table is <c>off</c> / <see cref="ServerNotReady"/>. Other database errors propagate.
  /// </summary>
  public static async Task<EffectiveMode> EffectiveAsync(NpgsqlConnection conn, CancellationToken ct = default)
  {
    var configured = Configured();
    if (configured == Off) return new EffectiveMode(Off, Off, null, null, null);

    await using (var probe = new NpgsqlCommand("select to_regclass('public.automation_eval_gates') is not null", conn))
    {
      var exists = await probe.ExecuteScalarAsync(ct);
      if (exists is not true) return new EffectiveMode(configured, Off, ServerNotReady, null, null);
    }

    long? gateId = null;
    GateReviewer? reviewer = null;
    await using (var cmd = new NpgsqlCommand(
      "select id, reviewer_provider, reviewer_model, prompt_version from automation_eval_gates " +
      "where passed and revoked_at is null order by id desc limit 1", conn))
    await using (var reader = await cmd.ExecuteReaderAsync(ct))
    {
      if (await reader.ReadAsync(ct))
      {
        gateId = reader.GetInt64(0);
        reviewer = new GateReviewer(reader.GetString(1), reader.GetString(2), reader.GetString(3));
      }
    }

    if (configured == DryRun) return new EffectiveMode(DryRun, DryRun, null, gateId, reviewer);
    return gateId is null
      ? new EffectiveMode(Live, DryRun, EvalGateMissing, null, null)
      : new EffectiveMode(Live, Live, null, gateId, reviewer);
  }
}

public sealed record EffectiveMode(string Configured, string Effective, string? LiveBlockedReason, long? GateId, GateReviewer? Reviewer);

public sealed record GateReviewer(string Provider, string Model, string PromptVersion);
