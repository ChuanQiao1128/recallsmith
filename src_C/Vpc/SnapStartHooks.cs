using System.Threading;
using Amazon.Lambda.Core;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda;

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
    try { Pg.Reset(); } catch { /* best-effort */ }
    try { Vpc.Runtime.AdminManifest.Reset(); } catch { /* best-effort */ }
    try { Vpc.Authoring.Publish.Reset(); } catch { /* best-effort */ }
    try { Vpc.Authoring.ManifestRebuild.Reset(); } catch { /* best-effort */ }
    try { Vpc.Runtime.PremiumDeckUrl.Reset(); } catch { /* best-effort */ }
    try { Vpc.Analytics.OutboxPublisher.Reset(); } catch { /* best-effort */ }
    try { Vpc.Analytics.ContentIntelligenceSnapshotImport.Reset(); } catch { /* best-effort */ }
  }
}
