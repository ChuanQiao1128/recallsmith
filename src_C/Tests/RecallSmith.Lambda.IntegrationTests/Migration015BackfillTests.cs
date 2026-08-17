using System.Globalization;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Migration 015 is a one-shot repair, and a repair can only be tested against
/// the damage. So this class builds a database frozen at 014, plants the exact
/// row the old ingest used to write (a due date centuries out), runs 015, and
/// checks that the card came back.
///
/// The damage is self-sealing: an exiled card is never due, so the user never
/// rates it, so no later event ever reaches the new ingest clamp for that row.
/// A migration that never runs correctly here is a migration that leaves those
/// cards lost forever, and nothing in production would report it.
/// </summary>
[Collection(PostgresCollection.Name)]
public class Migration015BackfillTests
{
  private readonly PostgresFixture _db;

  public Migration015BackfillTests(PostgresFixture db) => _db = db;

  [Fact]
  public async Task Migration015_PullsExiledDueDatesBackAndBumpsUpdatedAt()
  {
    // A separate database, not the shared one: the point is a schema that
    // stops at 014, and the shared database is already at 015.
    var connectionString = await _db.CreateScratchDatabaseAsync("mig015");

    await using var conn = new Npgsql.NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 14);

    var applied = await DbUtil.ExecuteScalarAsync(
      conn, null, "select count(*) from information_schema.columns where table_name = 'user_progress' and column_name = 'srs_stage'", []);
    Assert.Equal(1, Convert.ToInt32(applied, CultureInfo.InvariantCulture));

    const string user = "it-mig015-user";
    await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub, email) values ($1, $2)", [user, "mig015@example.test"]);

    // Three rows, one per branch of 015's WHERE clause.
    //   exiled   -> repaired
    //   sane     -> untouched (its due date is inside the horizon)
    //   anchorless -> untouched (no last_reviewed_at to repair against)
    await DbUtil.ExecuteAsync(
      conn,
      null,
      """
      insert into user_progress
        (user_sub, deck_slug, stable_uid, status, last_rating, last_reviewed_at, review_count, due_at, updated_at)
      values
        ($1, 'd', 'exiled',     1, 3, now() - interval '1 day', 1, timestamptz '2500-01-01 00:00:00+00', now() - interval '30 days'),
        ($1, 'd', 'sane',       1, 3, now() - interval '1 day', 1, now() + interval '3 days',            now() - interval '30 days'),
        ($1, 'd', 'anchorless', 1, 3, null,                     1, timestamptz '2500-01-01 00:00:00+00', now() - interval '30 days')
      """,
      [user]);

    var before = await ReadAsync(conn, user);
    Assert.Equal(3, before.Count);

    // The damage has to be real at the moment 015 runs, or the assertions below
    // would pass just as happily against a row that was never poisoned.
    Assert.True(
      Convert.ToDouble(before["exiled"]["horizon_s"], CultureInfo.InvariantCulture) > 100.0 * 365 * 24 * 60 * 60,
      "the exiled row must still be centuries out before 015 runs");

    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 15);

    var after = await ReadAsync(conn, user);

    var exiled = after["exiled"];
    Assert.Equal(
      90.0 * 24 * 60 * 60,
      Convert.ToDouble(exiled["horizon_s"], CultureInfo.InvariantCulture),
      precision: 3);

    // The bump is the half of the repair that reaches the devices: clients pull
    // by updated_at, so a fix that leaves it alone repairs the server row and
    // nothing else.
    Assert.True(
      Convert.ToDateTime(exiled["updated_at"], CultureInfo.InvariantCulture) >
      Convert.ToDateTime(before["exiled"]["updated_at"], CultureInfo.InvariantCulture),
      "015 must bump updated_at, or the poisoned due date stays cached on every device");

    foreach (var uid in new[] { "sane", "anchorless" })
    {
      Assert.Equal(before[uid]["due_at"], after[uid]["due_at"]);
      Assert.Equal(before[uid]["updated_at"], after[uid]["updated_at"]);
    }
  }

  private static async Task<Dictionary<string, Dictionary<string, object?>>> ReadAsync(
    Npgsql.NpgsqlConnection conn,
    string user)
  {
    var rows = await DbUtil.QueryAsync(
      conn,
      null,
      """
      select
        stable_uid, due_at, updated_at,
        extract(epoch from due_at) - extract(epoch from last_reviewed_at) as horizon_s
      from user_progress
      where user_sub = $1
      """,
      [user]);

    return rows.ToDictionary(r => (string)r["stable_uid"]!, r => r, StringComparer.Ordinal);
  }
}
