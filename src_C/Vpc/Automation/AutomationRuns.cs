using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// Run finalisation (R18A A04, contract A00 §6.1): a run is final once it left <c>running</c> and none of its decisions
/// still waits for draft QA. Called after a draft-QA report, after <c>runner/complete</c> and by the tick; the run row
/// lock makes it happen exactly once. A final run's decks are then evaluated for auto-publish.
/// </summary>
public static class AutomationRuns
{
  public static readonly IReadOnlyList<string> TerminalStatuses = ["completed", "failed", "abandoned"];

  /// <summary>
  /// Finalises <paramref name="runId"/> when it is terminal, unfinalised and has no <c>qa_pending</c>/<c>qa_queued</c>
  /// decision, then runs <see cref="AutoPublisher.EvaluateAsync"/> for every deck with an <c>auto_accepted</c> (live) or
  /// <c>would_accept</c> (dry_run) decision of the run. Effective <c>off</c> writes nothing. True when this call
  /// finalised the run. Never throws.
  /// </summary>
  public static async Task<bool> TryFinalizeAsync(NpgsqlConnection conn, Guid runId, CancellationToken ct = default)
  {
    try
    {
      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      if (mode.Effective == AutomationMode.Off) return false;

      await using (var tx = await conn.BeginTransactionAsync(ct))
      {
        var runs = await DbUtil.QueryAsync(conn, tx,
          "select status, finalized_at from automation_runs where run_id = $1 for update", [runId]);
        if (runs.Count == 0 || runs[0]["finalized_at"] is not null || !TerminalStatuses.Contains((string)runs[0]["status"]!))
        {
          await tx.RollbackAsync(ct);
          return false;
        }
        var pending = await DbUtil.ExecuteScalarAsync(conn, tx,
          "select 1 from automation_draft_decisions where run_id = $1 and state in ('qa_pending', 'qa_queued') limit 1", [runId]);
        if (pending is not null)
        {
          await tx.RollbackAsync(ct);
          return false;
        }
        await DbUtil.ExecuteAsync(conn, tx, "update automation_runs set finalized_at = now(), updated_at = now() where run_id = $1", [runId]);
        await tx.CommitAsync(ct);
      }

      var decks = await DbUtil.QueryAsync(conn, null,
        """
        select distinct deck_id from automation_draft_decisions
        where run_id = $1 and state in ('auto_accepted', 'would_accept')
        order by deck_id
        """, [runId]);
      Log.Event("info", new { tag = "automation", outcome = "run_finalized", runId, decks = decks.Count });
      foreach (var deck in decks)
      {
        await AutoPublisher.EvaluateAsync(conn, Convert.ToInt64(deck["deck_id"], CultureInfo.InvariantCulture), runId, ct);
      }
      return true;
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", sqlState = pg.SqlState, where = "finalize_run", runId });
      return false;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "finalize_run_failed", runId, error = ex.Message });
      return false;
    }
  }
}
