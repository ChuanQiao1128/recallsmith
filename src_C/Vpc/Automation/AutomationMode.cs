using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The <c>AUTOMATION_MODE</c> switch (R18A A01, contract A00 §3). Only core-vpc reads it, from its environment, on
/// every call (never cached). <see cref="EffectiveAsync"/> turns the configured value into the effective one:
/// <c>live</c> needs the newest eval gate to be passed and unrevoked, and a database without migration 034 is always
/// <c>off</c>.
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
  /// The gate is the NEWEST row of <c>automation_eval_gates</c> (R18B K2), and it counts only when it is passed and
  /// unrevoked. Revoking it, or recording a newer failed gate, drops <c>live</c> to <c>dry_run</c> on the next request;
  /// an older passed gate is never a fallback, so a revoke is a single-click kill switch.
  /// </summary>
  public static async Task<EffectiveMode> EffectiveAsync(NpgsqlConnection conn, CancellationToken ct = default)
  {
    var configured = Configured();
    if (configured == Off) return new EffectiveMode(Off, Off, null, null, null);

    bool tableExists, authorColumn;
    await using (var probe = new NpgsqlCommand(
      "select to_regclass('public.automation_eval_gates') is not null, " +
      "exists (select 1 from pg_attribute where attrelid = to_regclass('public.automation_eval_gates') " +
      "and attname = 'author_config_id' and not attisdropped)", conn))
    await using (var probeReader = await probe.ExecuteReaderAsync(ct))
    {
      await probeReader.ReadAsync(ct);
      tableExists = probeReader.GetBoolean(0);
      authorColumn = probeReader.GetBoolean(1);
    }
    if (!tableExists) return new EffectiveMode(configured, Off, ServerNotReady, null, null);

    long? gateId = null;
    GateReviewer? reviewer = null;
    string? gateAuthor = null;
    await using (var cmd = new NpgsqlCommand(
      $"select id, reviewer_provider, reviewer_model, prompt_version, {GateAuthorSql(authorColumn)} as author_config_id " +
      $"from ({EvalGate.NewestGateSql}) g where passed and revoked_at is null", conn))
    await using (var reader = await cmd.ExecuteReaderAsync(ct))
    {
      if (await reader.ReadAsync(ct))
      {
        gateId = reader.GetInt64(0);
        reviewer = new GateReviewer(reader.GetString(1), reader.GetString(2), reader.GetString(3));
        gateAuthor = reader.IsDBNull(4) ? null : reader.GetString(4);
      }
    }

    if (configured == DryRun) return new EffectiveMode(DryRun, DryRun, null, gateId, reviewer, gateAuthor);
    return gateId is null
      ? new EffectiveMode(Live, DryRun, EvalGateMissing, null, null)
      : new EffectiveMode(Live, Live, null, gateId, reviewer, gateAuthor);
  }

  /// <summary>
  /// The gate's author configuration id over <c>g</c> = an automation_eval_gates row (R18D M1): the
  /// <c>author_config_id</c> column of migration 036, or, before 036 is applied, the same value read from the stored
  /// report (<c>authored.author.authorConfigId</c>), so the binding holds whichever of code and migration comes first.
  /// </summary>
  internal static string GateAuthorSql(bool authorColumn) => authorColumn
    ? "coalesce(g.author_config_id, g.report #>> '{authored,author,authorConfigId}')"
    : "(g.report #>> '{authored,author,authorConfigId}')";
}

/// <summary>
/// The effective mode and the current gate. <see cref="GateAuthorConfigId"/> is the author configuration the gate measured
/// (R18D M1), null when the gate names none: a live auto-accept then routes every draft to a human (AUTHOR_NOT_GATED).
/// </summary>
public sealed record EffectiveMode(string Configured, string Effective, string? LiveBlockedReason, long? GateId, GateReviewer? Reviewer,
  string? GateAuthorConfigId = null);

public sealed record GateReviewer(string Provider, string Model, string PromptVersion);
