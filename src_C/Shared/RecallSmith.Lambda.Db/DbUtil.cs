using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Db;

public static class DbUtil
{
  public static async Task<List<Dictionary<string, object?>>> QueryAsync(
    NpgsqlConnection conn,
    NpgsqlTransaction? tx,
    string sql,
    IReadOnlyList<object?> parameters)
  {
    await using var cmd = CreateCommand(conn, tx, sql, parameters);
    await using var reader = await cmd.ExecuteReaderAsync();

    var rows = new List<Dictionary<string, object?>>();
    while (await reader.ReadAsync())
    {
      var row = new Dictionary<string, object?>(StringComparer.Ordinal);
      for (var i = 0; i < reader.FieldCount; i++)
      {
        var name = reader.GetName(i);
        row[name] = await reader.IsDBNullAsync(i) ? null : reader.GetValue(i);
      }
      rows.Add(row);
    }

    return rows;
  }

  public static async Task<int> ExecuteAsync(
    NpgsqlConnection conn,
    NpgsqlTransaction? tx,
    string sql,
    IReadOnlyList<object?> parameters)
  {
    await using var cmd = CreateCommand(conn, tx, sql, parameters);
    return await cmd.ExecuteNonQueryAsync();
  }

  public static async Task<object?> ExecuteScalarAsync(
    NpgsqlConnection conn,
    NpgsqlTransaction? tx,
    string sql,
    IReadOnlyList<object?> parameters)
  {
    await using var cmd = CreateCommand(conn, tx, sql, parameters);
    var r = await cmd.ExecuteScalarAsync();
    return r is DBNull ? null : r;
  }

  public static NpgsqlCommand CreateCommand(
    NpgsqlConnection conn,
    NpgsqlTransaction? tx,
    string sql,
    IReadOnlyList<object?> parameters)
  {
    var cmd = conn.CreateCommand();
    cmd.CommandText = SqlUtil.ToNpgsql(sql);
    if (tx is not null) cmd.Transaction = tx;

    for (var i = 0; i < parameters.Count; i++)
    {
      var name = $"p{i + 1}";
      var value = parameters[i] ?? DBNull.Value;
      cmd.Parameters.AddWithValue(name, value);
    }

    return cmd;
  }
}
