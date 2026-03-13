using System.Threading;
using Amazon.Lambda.Core;

namespace RecallSmith.Lambda.Common;

internal static class SnapStartHooks
{
  private static int _registered;

  public static void RegisterOnce()
  {
    if (Interlocked.Exchange(ref _registered, 1) == 1) return;

    // Register hooks during init. SnapStart requires this to happen before snapshot creation.
    // Keep hooks fast: AfterRestore must complete within 10 seconds or Lambda throws SnapStartTimeoutException.
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
    // Connections created before snapshot are not guaranteed to be valid after restore.
    // Reset cached clients/pools so the first real invocation rebuilds clean state.
    ResetResources();
    return ValueTask.CompletedTask;
  }

  private static void ResetResources()
  {
#if LAMBDA_VPC
    try { Vpc.Db.Pg.Reset(); } catch { /* best-effort */ }
    try { Vpc.Runtime.AdminManifest.Reset(); } catch { /* best-effort */ }
    try { Vpc.Authoring.Publish.Reset(); } catch { /* best-effort */ }
    try { Vpc.Authoring.ManifestRebuild.Reset(); } catch { /* best-effort */ }
    try { Vpc.Runtime.PremiumDeckUrl.Reset(); } catch { /* best-effort */ }
#endif

#if LAMBDA_PUBLIC
    try { Public.CognitoAdmin.CognitoClient.Reset(); } catch { /* best-effort */ }
#endif
  }
}
