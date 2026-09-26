namespace RecallSmith.Lambda.Worker.Repositories;

/// <summary>
/// 内容分发 v3 元数据访问接口（deck_publishes 扩展列 + deck_build_patches）
/// </summary>
public interface IContentArtifactsRepository
{
  /// <summary>
  /// 查找同 deck_id 最近一次 SUCCESS 的构建（当前任务处于 PROCESSING，天然被排除）
  /// </summary>
  Task<PreviousBuildInfo?> GetLatestSuccessBuildAsync(long deckId);

  /// <summary>
  /// 记录本次构建 deck.json 的 sha256 / 字节数 / package.json 相对路径（migration 011 之后可用）
  /// </summary>
  Task UpdateContentMetadataAsync(string jobId, string contentSha256, long contentBytes, string? packageKey);

  /// <summary>
  /// 记录一条增量补丁（幂等：唯一键冲突时 DO NOTHING）
  /// </summary>
  Task InsertBuildPatchAsync(
    string deckSlug,
    string fromBuildId,
    string toBuildId,
    string relPath,
    string s3Key,
    string sha256,
    long bytes);
}

/// <summary>
/// 上一次成功构建的信息
/// </summary>
public class PreviousBuildInfo
{
  public string BuildId { get; set; } = string.Empty;
  public string S3Key { get; set; } = string.Empty;
}
