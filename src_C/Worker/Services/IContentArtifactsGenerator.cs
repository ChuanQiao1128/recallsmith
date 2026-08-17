using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// 内容分发 v3 附加产物生成器（chunked package + delta patch + DB 元数据）
/// </summary>
public interface IContentArtifactsGenerator
{
  /// <summary>
  /// 在 deck.json 上传成功后、任务完成前调用。
  /// 完全 best-effort：任何异常都在内部记录并吞掉，绝不影响发布任务本身。
  /// </summary>
  Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload);
}
