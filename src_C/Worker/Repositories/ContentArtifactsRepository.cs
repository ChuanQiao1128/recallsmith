using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Worker.Repositories;

public class ContentArtifactsRepository : IContentArtifactsRepository
{
  /// <summary>
  /// 查找同 deck_id 最近一次 SUCCESS 的构建
  /// </summary>
  public async Task<PreviousBuildInfo?> GetLatestSuccessBuildAsync(long deckId)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      SELECT
        build_id as "buildId",
        s3_key as "s3Key"
      FROM deck_publishes
      WHERE deck_id = $1 AND status = 'SUCCESS'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [deckId]);
    if (rows.Count == 0) return null;

    var row = rows[0];
    return new PreviousBuildInfo
    {
      BuildId = Convert.ToString(row["buildId"]) ?? string.Empty,
      S3Key = Convert.ToString(row["s3Key"]) ?? string.Empty,
    };
  }

  /// <summary>
  /// 记录本次构建的内容元数据（依赖 migration 011 的新列，调用方需容忍 42703/42P01）
  /// </summary>
  public async Task UpdateContentMetadataAsync(string jobId, string contentSha256, long contentBytes, string? packageKey)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      UPDATE deck_publishes
      SET content_sha256 = $2,
          content_bytes = $3,
          package_key = $4,
          updated_at = now()
      WHERE job_id = $1
      """;

    await DbUtil.ExecuteAsync(conn, null, sql, [jobId, contentSha256, contentBytes, packageKey]);
  }

  /// <summary>
  /// 记录一条增量补丁（依赖 migration 011 的新表，调用方需容忍 42P01）
  /// </summary>
  public async Task InsertBuildPatchAsync(
    string deckSlug,
    string fromBuildId,
    string toBuildId,
    string relPath,
    string s3Key,
    string sha256,
    long bytes)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    const string sql = """
      INSERT INTO deck_build_patches (deck_slug, from_build_id, to_build_id, rel_path, s3_key, sha256, bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (deck_slug, from_build_id, to_build_id) DO NOTHING
      """;

    await DbUtil.ExecuteAsync(conn, null, sql, [deckSlug, fromBuildId, toBuildId, relPath, s3Key, sha256, bytes]);
  }
}
