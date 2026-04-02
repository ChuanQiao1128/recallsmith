using System.Threading;
using Amazon.Lambda.Core;
using RecallSmith.Lambda.Worker.Manifest;
using RecallSmith.Lambda.Worker.S3;

namespace RecallSmith.Lambda.Worker;

/// <summary>
/// SnapStart 运行时钩子
/// </summary>
internal static class SnapStartHooks
{
  private static int _registered;

  public static void RegisterOnce()
  {
    if (Interlocked.Exchange(ref _registered, 1) == 1) return;

    SnapshotRestore.RegisterBeforeSnapshot(BeforeSnapshot);
    SnapshotRestore.RegisterAfterRestore(AfterRestore);
  }

  private static ValueTask BeforeSnapshot()
  {
    ResetResources();
    return ValueTask.CompletedTask;
  }

  private static ValueTask AfterRestore()
  {
    ResetResources();
    return ValueTask.CompletedTask;
  }

  private static void ResetResources()
  {
    try { Lambda.Db.Pg.Reset(); } catch { /* best-effort */ }
    try { S3DeckUploader.Reset(); } catch { /* best-effort */ }
    try { ManifestService.Reset(); } catch { /* best-effort */ }
  }
}
