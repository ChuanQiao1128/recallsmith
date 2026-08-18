using System.Runtime.CompilerServices;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

// SnapStartHooks is internal because Lambda, not application code, is supposed to call it.
// The tests are the exception: what the restore hook does is invalidate and rebuild
// process-wide pools, and there is no way to assert that from outside the process. Widening
// the type to public instead would advertise a call that no handler should ever make.
[assembly: InternalsVisibleTo("RecallSmith.Lambda.IntegrationTests")]
