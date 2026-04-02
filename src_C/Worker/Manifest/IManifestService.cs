namespace RecallSmith.Lambda.Worker.Manifest;

/// <summary>
/// Manifest 重建服务接口
/// </summary>
public interface IManifestService
{
  /// <summary>
  /// 重建并上传 manifest.json
  /// </summary>
  Task RebuildAsync();
}
