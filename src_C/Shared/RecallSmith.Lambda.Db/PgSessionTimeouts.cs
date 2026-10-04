using System.Globalization;

namespace RecallSmith.Lambda.Db;

/// <summary>
/// The server-side limits every pooled application connection starts with (enterprise audit SPC-01): Postgres'
/// <c>statement_timeout</c> and <c>idle_in_transaction_session_timeout</c>, sent as startup options in the connection
/// string (<c>Options=-c …</c>), so they hold from the first statement of every connection, survive Npgsql's reset when a
/// connection goes back to the pool (<c>RESET ALL</c> returns to the startup value), need no migration and no
/// <c>ALTER ROLE</c>, and keep working when the client is gone. Npgsql's own client-side Command Timeout (30 s, never
/// overridden in this repository) only fires while the Lambda is alive; a statement or transaction orphaned by a
/// function that timed out, crashed or was frozen ran on until it finished, or for 24 hours (the RDS default of
/// <c>idle_in_transaction_session_timeout</c>), holding its locks and one of the role's 50 connections.
/// <para>
/// A <c>set local</c> inside a transaction still overrides both for that transaction: the rollups (3 s), the anonymous
/// funnel retention (2 s) and the migration runner (0 = none, <c>Vpc.Db.Migrate</c>) do.
/// </para>
/// <para>
/// Values, from the 30 days to 2026-10-04 (read-only CloudWatch; infra/RUNBOOK.md §16 "Database timeouts"):
/// core-vpc's slowest invocation took 7.4 s (p99.9 4.2 s, 31 209 invocations) and the slowest route 9.1 s
/// (<c>POST /api/internal/automation/tick</c>, whose own budget is 20 s); API Gateway gives up at 30 s, a direct
/// <c>aws lambda invoke</c> of core-vpc only at the function's 90 s; the worker's slowest job took 4.6 s and the
/// function may run 615 s.
/// </para>
/// </summary>
public sealed record PgSessionTimeouts(int StatementTimeoutMs, int IdleInTransactionTimeoutMs)
{
  /// <summary>
  /// core-vpc. Statement 20 s: at least the automation tick's whole 20 s budget and twice the slowest route measured,
  /// and below API Gateway's 30 s integration timeout, after which a gateway caller receives no answer. core-vpc is
  /// also invoked directly, without the gateway (<c>scripts/invoke-as-admin.sh</c>: bootstrap-roles, db ping, migrate;
  /// the DR drill's copy of core-vpc, <c>infra/scripts/dr-restore-drill.sh</c>), bounded only by the 90 s Lambda
  /// timeout, so there 20 s is the effective cap: every statement on that path is small today and the migration
  /// runner lifts the limit itself (<c>Vpc.Db.Migrate.LiftTimeoutsSql</c>); a long admin statement added there needs
  /// its own <c>set local statement_timeout</c>. Idle in transaction 60 s: twice the gateway timeout, so on a gateway
  /// call it only ever ends a transaction whose caller already has its 503, and a dead function's locks go after a
  /// minute instead of a day.
  /// </summary>
  public static readonly PgSessionTimeouts Api = new(20_000, 60_000);

  /// <summary>
  /// worker-lambda. Both 600 s, the function's 615 s timeout less 15 s: a live job is never cut off (its phases run
  /// outside transactions, and its statements already carry Npgsql's 30 s client timeout); only what a dead worker
  /// left behind is ended.
  /// </summary>
  public static readonly PgSessionTimeouts Worker = new(600_000, 600_000);

  /// <summary>
  /// The profile the next data source is built with (<see cref="Pg"/> and <c>Vpc.Db.Pg</c>). <see cref="Api"/> unless
  /// the entry point names another: each Lambda constructor sets its own before any connection is opened.
  /// </summary>
  public static PgSessionTimeouts Current { get; set; } = Api;

  /// <summary>The connection string's <c>Options</c>: <c>-c statement_timeout=20000 -c idle_in_transaction_session_timeout=60000</c>.</summary>
  public string ConnectionOptions => string.Create(
    CultureInfo.InvariantCulture,
    $"-c statement_timeout={StatementTimeoutMs} -c idle_in_transaction_session_timeout={IdleInTransactionTimeoutMs}");
}
