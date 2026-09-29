# H02 — publish SLO gauges: notes

The worker now writes one dimensionless EMF gauge (value 1, unit `Count`, namespace `METRICS_NAMESPACE` or
`DeveloperCards`) through `RouteMetrics.EmitGauge` at each terminal outcome of a publish job. These are the
good/bad events for the publish-success SLO (H00 §4.3). Nothing else changed: the batch response, log text,
`FailAsync` / `RecordAttemptErrorAsync` arguments and H01's `worker-record` line are all the same as before.

## Constants

- `WorkerFunction.PublishSucceededMetric = "PublishJobsSucceeded"` — `src_C/Worker/WorkerFunction.cs:63`
- `WorkerFunction.PublishFailedMetric = "PublishJobsFailed"` — `src_C/Worker/WorkerFunction.cs:66`

## The three placements

| Outcome | Line | Anchor |
|---|---|---|
| success | `src_C/Worker/WorkerFunction.cs:118` | next line after `LogWithJobId(jobId, "Processing completed successfully");` |
| business failure, `FailAsync` succeeded | `src_C/Worker/WorkerFunction.cs:128` | next line after `LogWithJobId(jobId, "Job marked as FAILED");`, inside the `try` |
| system failure on the last receive (`receiveCount >= MaxReceiveCount`) | `src_C/Worker/WorkerFunction.cs:150` | first statement in the `if`, before its `try`, so it is emitted once whether or not `FailAsync` succeeds |

No gauge for: a malformed body, `JobNotAcquiredException`, a business failure whose `FailAsync` throws (SQS
redelivers it, so a later receive decides), or a system error before the last receive.

## Tests

`src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishSloGaugeTests.cs` (`[Collection(PostgresCollection.Name)]`
because it redirects `Console`; in-file fake processor, no database rows). Every outcome test also checks the
returned `SQSBatchResponse` and which jobs reached `FailAsync`.

- `Constants_MatchTheContract`
- `Success_EmitsOneSucceededGauge`
- `BusinessError_FailAsyncOk_EmitsOneFailedGauge`
- `BusinessError_FailAsyncThrows_EmitsNoGauge`
- `SystemError_OnFinalReceive_EmitsOneFailedGauge`
- `SystemError_OnFinalReceive_FailAsyncThrows_StillEmitsOneFailedGauge`
- `SystemError_AfterMaxReceive_EmitsOneFailedGauge` (receive 5, a DLQ redrive)
- `SystemError_BeforeFinalReceive_EmitsNoGauge` (receive 1 and 2)
- `ManifestRebuildThrows_BeforeFinalReceive_EmitsNoGauge`
- `MalformedBody_EmitsNoGauge` (`not-json`, `null`, `{"jobId":null}`)
- `JobNotAcquired_EmitsNoGauge`
- `MixedBatch_CountsEachTerminalOutcomeOnce`
- `GaugeLine_IsDimensionlessCountInTheDefaultNamespace`
- `MetricsDisabled_EmitsNothing`

The brief asked for `{}` as a malformed body. It is not one today: `PublishJobMessage.JobId` defaults to `""`,
so `ParseMessage` accepts `{}` and the job goes down the normal path. The worker's parsing is out of scope,
so the test uses bodies that the worker really does reject, and bias (d) below covers `{}`.

## Accepted biases

(a) **A replay counts as a success again.** When a finished job is redelivered, `PublishJobProcessor.ProcessAsync`
fails to acquire it and returns quietly because the row is `SUCCESS` or `FAILED` (the `:44` branch), and the
worker logs "Processing completed successfully" and emits `PublishJobsSucceeded`. H00 §4.3 accepts this for
`SUCCESS` rows. The same branch also acknowledges a replay of a `FAILED` row (for example after the reaper
failed a stuck job), and that is counted as a success too. The SLO alarms **can see** these events, but only
as good events they cannot tell apart from real successes, so this bias makes the success ratio look better
than it is. It does not make the ratio look worse.

(b) **A committed success whose manifest rebuild keeps failing counts as a failure.** If the job committed
`SUCCESS` but the in-process manifest rebuild throws on every receive, the last receive takes the system-error
path and emits `PublishJobsFailed`, although the deck was published. `FailAsync` does not overwrite `SUCCESS`
(`WorkerFailureHandlingTests.FailJob_DoesNotOverwriteSuccess`). The SLO alarms **can see** this as a bad event.
It pushes the ratio towards burning, which is the safe direction: the manifest really is stale.

(c) **A crash or timeout emits nothing.** If the worker process dies, times out or runs out of memory, no line is
written for that attempt. After the last receive the message goes to the DLQ without a `PublishJobsFailed`.
The SLO alarms **cannot see** these failures. That is why H00 §4.3 keeps `developercards-prod-worker-errors`
(Lambda `Errors`) and `developercards-prod-dlq-nonempty` next to the burn-rate alarms.

(d) **A `{}` body (no `jobId`) counts as a success.** It parses to job id `""`. The real processor finds no row,
treats it as an absent-row replay, and acknowledges it, so the worker emits `PublishJobsSucceeded`. The SLO
alarms **can see** it as a good event (same direction as (a)). Only an enqueue bug could produce such a message,
and the publish route always sets `jobId`.
