using Npgsql;
using Xunit.Abstractions;
using SharedPg = RecallSmith.Lambda.Db.Pg;
using VpcPg = RecallSmith.Lambda.Vpc.Db.Pg;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public sealed class ConnectionLifecycleTests(PostgresFixture db, ITestOutputHelper output)
{
  [Fact]
  public async Task ScratchConnections_DisposalLeavesNoServerConnections()
  {
    var names = new List<string>();
    var connectionStrings = new List<string>();
    try
    {
      for (var i = 0; i < 4; i++)
      {
        var name = "lifecycle_scratch_" + Guid.NewGuid().ToString("N");
        names.Add(name);
        var cs = await db.CreateScratchDatabaseAsync(name);
        connectionStrings.Add(cs);
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        Assert.Equal(1, await new NpgsqlCommand("select 1", conn).ExecuteScalarAsync());
      }

      Assert.Equal(0, await WaitForNoConnectionsAsync(names.ToArray()));
    }
    finally
    {
      // Clear only this test's pools, including when the regression is red.
      foreach (var cs in connectionStrings)
      {
        using var conn = new NpgsqlConnection(cs);
        NpgsqlConnection.ClearPool(conn);
      }
      await DropDatabasesAsync(names);
    }
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task ConcurrentColdAccess_SharesOnePool_AndResetClosesIt(bool vpc)
  {
    Func<NpgsqlDataSource?> get = vpc ? VpcPg.DataSource : SharedPg.DataSource;
    Action reset = vpc ? VpcPg.Reset : SharedPg.Reset;
    var previousDatabase = Environment.GetEnvironmentVariable("PGDATABASE");
    var name = "lifecycle_pool_" + Guid.NewGuid().ToString("N");
    var captured = new List<NpgsqlDataSource>();
    await db.CreateScratchDatabaseAsync(name);
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      reset();
      NpgsqlDataSource? previous = null;
      for (var round = 0; round < 3; round++)
      {
        const int callers = 24;
        using var barrier = new Barrier(callers);
        var sources = new NpgsqlDataSource?[callers];
        var errors = new Exception?[callers];
        var threads = Enumerable.Range(0, callers).Select(i => new Thread(() =>
        {
          try
          {
            if (!barrier.SignalAndWait(TimeSpan.FromSeconds(10)))
              throw new TimeoutException("Cold-access callers did not rendezvous.");
            sources[i] = get();
          }
          catch (Exception ex) { errors[i] = ex; }
        })).ToArray();
        foreach (var thread in threads) thread.Start();
        foreach (var thread in threads) thread.Join();
        var distinct = sources.OfType<NpgsqlDataSource>().Distinct().ToArray();
        captured.AddRange(distinct);
        Assert.All(errors, error => Assert.Null(error));
        Assert.All(sources, source => Assert.NotNull(source));

        foreach (var source in distinct)
        {
          await using var conn = await source.OpenConnectionAsync();
          Assert.Equal(name, await new NpgsqlCommand("select current_database()", conn).ExecuteScalarAsync());
        }
        var beforeReset = await CountConnectionsAsync([name]);
        reset();
        var afterReset = await WaitForNoConnectionsAsync([name]);
        output.WriteLine($"vpc={vpc}, round={round}, datasource identities={distinct.Length}, connections before reset={beforeReset}, after reset={afterReset}");
        Assert.Equal(distinct.Length, beforeReset);
        Assert.Equal(0, afterReset);
        var current = Assert.Single(distinct);
        Assert.NotSame(previous, current);
        await Assert.ThrowsAsync<ObjectDisposedException>(async () =>
        {
          await using var conn = await current.OpenConnectionAsync();
        });
        previous = current;
      }
    }
    finally
    {
      reset();
      foreach (var source in captured.Distinct()) await source.DisposeAsync();
      Environment.SetEnvironmentVariable("PGDATABASE", previousDatabase);
      reset();
      await DropDatabasesAsync([name]);
    }
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public void MissingConfigurationIsRetried_InitializationErrorIsCachedUntilReset(bool vpc)
  {
    Func<NpgsqlDataSource?> get = vpc ? VpcPg.DataSource : SharedPg.DataSource;
    Action reset = vpc ? VpcPg.Reset : SharedPg.Reset;
    var host = Environment.GetEnvironmentVariable("PGHOST");
    var max = Environment.GetEnvironmentVariable("PG_MAX");
    reset();
    try
    {
      Environment.SetEnvironmentVariable("PGHOST", "");
      Assert.Null(get());
      Environment.SetEnvironmentVariable("PGHOST", host);
      Assert.NotNull(get());
      reset();

      Environment.SetEnvironmentVariable("PG_MAX", "-1");
      var first = Assert.ThrowsAny<Exception>(() => get());
      Environment.SetEnvironmentVariable("PG_MAX", max);
      Assert.Same(first, Assert.ThrowsAny<Exception>(() => get()));
      reset();
      Assert.NotNull(get());
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGHOST", host);
      Environment.SetEnvironmentVariable("PG_MAX", max);
      reset();
    }
  }

  private async Task<int> CountConnectionsAsync(string[] names)
  {
    await using var observer = await db.OpenAsync();
    await using var command = new NpgsqlCommand(
      "select count(*)::int from pg_stat_activity where datname = any(@names)", observer);
    command.Parameters.AddWithValue("names", names);
    return (int)(await command.ExecuteScalarAsync())!;
  }

  private async Task<int> WaitForNoConnectionsAsync(string[] names)
  {
    for (var attempt = 0; attempt < 40; attempt++)
    {
      var count = await CountConnectionsAsync(names);
      if (count == 0) return 0;
      await Task.Delay(50);
    }
    return await CountConnectionsAsync(names);
  }

  private async Task DropDatabasesAsync(IEnumerable<string> names)
  {
    await using var conn = await db.OpenAsync();
    foreach (var name in names)
      await new NpgsqlCommand($"drop database if exists {name} with (force)", conn).ExecuteNonQueryAsync();
  }
}
