using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// Run finalisation (R18A A04, contract A00 §6.1): a run is final once it left <c>running</c> and none of its decisions
/// still waits for draft QA. Called after a draft-QA report, after <c>runner/complete</c> and by the tick; the run row
/// lock makes it happen exactly once. A final run's decks are then evaluated for auto-publish; the evaluation intent (the
/// deck's <c>waiting</c> row) is written in the finalisation transaction, so an evaluation lost to a crash, a timeout or
/// a transient error is retried by the tick's re-evaluation of <c>waiting</c> rows.
/// </summary>
public static class AutomationRuns
{
  public static readonly IReadOnlyList<string> TerminalStatuses = ["completed", "failed", "abandoned"];

  /// <summary>Test seam (InternalsVisibleTo): runs after the finalisation commit and before the evaluations.</summary>
  internal static Func<Guid, Task>? TestAfterCommitSeam;

  /// <summary>
  /// Finalises <paramref name="runId"/> when it is terminal, unfinalised and has no <c>qa_pending</c>/<c>qa_queued</c>
  /// decision, opening (or appending to) the deck's <c>automation_publishes</c> row in the same transaction for every
  /// deck with an <c>auto_accepted</c> (live) or <c>would_accept</c> (dry_run) decision of the run, then runs
  /// <see cref="AutoPublisher.EvaluateAsync"/> for each of them. Effective <c>off</c> writes nothing. True when this
  /// call finalised the run. Never throws; a swallowed failure emits the <c>AutomationStepFailures</c> gauge.
  /// </summary>
  public static async Task<bool> TryFinalizeAsync(NpgsqlConnection conn, Guid runId, CancellationToken ct = default)
  {
    try
    {
      var mode = await AutomationMode.EffectiveAsync(conn, ct);
      if (mode.Effective == AutomationMode.Off) return false;

      List<Dictionary<string, object?>> decks;
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
        decks = await DbUtil.QueryAsync(conn, tx,
          """
          select distinct deck_id from automation_draft_decisions
          where run_id = $1 and state in ('auto_accepted', 'would_accept')
          order by deck_id
          """, [runId]);
        foreach (var deck in decks)
        {
          await AutoPublisher.OpenRunRowAsync(conn, tx, Convert.ToInt64(deck["deck_id"], CultureInfo.InvariantCulture), runId, mode.Effective, ct);
        }
        await tx.CommitAsync(ct);
      }
      if (TestAfterCommitSeam is { } seam) await seam(runId);

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
      AutomationFailures.Record();
      return false;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "finalize_run_failed", runId, error = ex.Message });
      AutomationFailures.Record();
      return false;
    }
  }
}
