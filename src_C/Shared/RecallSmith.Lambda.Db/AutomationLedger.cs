using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Db;

/// <summary>
/// Automation Ledger writer (R18 J08, contract §9.2): one <c>automation_events</c> row per automation run,
/// idempotent on <c>dedupe_key</c>. Minutes are never stored here; the ledger routes derive them at query
/// time from the current baselines. Best-effort (contract §0.8): <see cref="RecordAsync"/> never throws, and a
/// database without migration 028 produces one warn line. Every dropped write also emits one
/// <see cref="WriteFailuresMetric"/> gauge.
/// </summary>
public static class AutomationLedger
{
  public static readonly IReadOnlyList<string> Automations = ["publish_pipeline", "bulk_import", "ai_draft_review", "ai_qa_review", "webhook_notification", "publish_gate"];

  public const int MaxRefLength = 200;

  /// <summary>EMF gauge (namespace DeveloperCards, no dimensions) emitted once per dropped write, so the
  /// ledger's write-loss rate can be alarmed on.</summary>
  public const string WriteFailuresMetric = "LedgerWriteFailures";

  /// <summary>
  /// Inserts one event row in a single statement (<c>on conflict (dedupe_key) do nothing</c>). Never throws.
  /// Call it after the work it measures has committed, on a connection that is not inside a transaction.
  /// Pass <see cref="AutomationEvent.DeckId"/> only when it names a real deck; an unknown deck id fails the
  /// foreign key and the event is dropped with a warn line.
  /// </summary>
  public static async Task RecordAsync(NpgsqlConnection conn, AutomationEvent e, CancellationToken ct = default)
  {
    try
    {
      var details = e.Details is null ? null : JsonSerializer.Serialize(e.Details);
      var reference = e.Ref is { Length: > MaxRefLength } r ? r[..MaxRefLength] : e.Ref;
      object? occurredAt = e.OccurredAt is { } at ? at.UtcDateTime : null;

      await using var cmd = DbUtil.CreateCommand(conn, null,
        """
        insert into automation_events (automation, occurred_at, units, outcome, actual_minutes, defects_caught, deck_id, ref, source, dedupe_key, details)
        values ($1, coalesce($2::timestamptz, now()), $3, $4, $5::numeric, $6, $7::bigint, $8::text, $9, $10::text, $11::jsonb)
        on conflict (dedupe_key) do nothing
        """,
        [e.Automation, occurredAt, e.Units, e.Outcome, e.ActualMinutes, e.DefectsCaught, e.DeckId, reference, e.Source, e.DedupeKey, details]);
      await cmd.ExecuteNonQueryAsync(ct);
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "ledger", reason = "schema_not_ready", sqlState = pg.SqlState, automation = e.Automation });
      RouteMetrics.EmitGauge(WriteFailuresMetric, 1);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "ledger", reason = "record_failed", automation = e.Automation, error = ex.Message });
      RouteMetrics.EmitGauge(WriteFailuresMetric, 1);
    }
  }
}

public sealed record AutomationEvent(string Automation, int Units, string Outcome, decimal? ActualMinutes = null,
  int DefectsCaught = 0, long? DeckId = null, string? Ref = null, string? DedupeKey = null, object? Details = null,
  string Source = "live", DateTimeOffset? OccurredAt = null);
