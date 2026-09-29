# H01 — trace-log-correlation: notes

Issue #513, wave R18H-S. Contract: H00 §3.3/§3.5. No route, migration, env key, dependency or Terraform.

## What was added

| File | Change |
|---|---|
| `src_C/Shared/RecallSmith.Lambda.Common/TraceContext.cs` (new) | The four constants (`EnvVar`, `UpstreamHeader`, `XrayField`, `UpstreamField`), `CurrentRoot()` (reads `_X_AMZN_TRACE_ID` on every call, no caching) and `RootFromHeader(string?)` (H00 §3.3 parse rule; pattern `^1-[0-9a-f]{8}-[0-9a-f]{24}$`, `CultureInvariant`, no `IgnoreCase`, plus an exact length-35 check; any exception ⇒ `null`). |
| `src_C/Shared/RecallSmith.Lambda.Common/Log.cs:126-129` | In `Build`, after `level`: writes `xrayTraceId` when `TraceContext.CurrentRoot()` is non-null. |
| `src_C/Shared/RecallSmith.Lambda.Common/Log.cs:142-143` | In `Embed`, a caller property named `xrayTraceId` is dropped (separate line; the `ts`/`level` line is untouched). |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs:368-418` | `BuildLine` gains `string? xrayTraceId = null, string? upstreamTraceId = null`; the ids are appended after `traceId` only when non-null (`AppendProperty`). |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs:557-560` | `Emit` passes `xrayTraceId: TraceContext.CurrentRoot()` and `upstreamTraceId: TraceContext.RootFromHeader(<x-dc-trace-id header or null>)` (`Headers.TryGetValue`; `Headers` is case-insensitive). |
| `src_C/Worker/WorkerFunction.cs:8`, `:99` | `using RecallSmith.Lambda.Common;` and the single `worker-record` `Log.Event` right after the `Processing message …` line. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/TraceContextTests.cs` (new) | 7 test methods; the generated header theory has 85 rows from `new Random(18)` (30 valid, 55 invalid). |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/TraceLogFieldsTests.cs` (new) | 15 test methods: log field order, EMF golden bytes, append order, MeasureAsync, worker-record line. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/TracePropagationTests.cs` (new) | 2 test methods: loopback `HttpListener` + `AmazonSQSClient` send. |

## How `BuildLine` keeps the base bytes

The anonymous object and `JsonSerializer.Serialize(...)` call are unchanged; only `return` became
`var line =`. With both new ids null the method returns `line` as-is, so the output is the base
output byte for byte (`Emf_NineArgumentLine_IsByteIdenticalToTheBaseLine` asserts both golden
lines with `Assert.Equal` on the whole string, with and without explicit `null` arguments). When an
id is present the final `}` is dropped and `,"xrayTraceId":…` / `,"upstreamTraceId":…` are
appended in that order, each name and value serialised with the same default `JsonSerializer`
encoder, then `}` is re-added. No serializer option changed (so `"traceId":null` stays), and the
`_aws` block (metrics and their dimension lists) is never touched: the ids are plain properties.

## Caller `xrayTraceId` is always dropped

`xrayTraceId` is reserved to the log prefix like `ts`/`level`: `Embed` drops a caller property of
that name whether or not the env is set. With the env set, the only `xrayTraceId` on the line is the
invocation's root; with it unset, the field is absent (`LogEvent_CallerXrayTraceId_IsDropped`).

## SQS propagation evidence (`TracePropagationTests`)

Resolved in `src_C/Tests/RecallSmith.Lambda.IntegrationTests/obj/project.assets.json`:
`AWSSDK.Core/4.0.0`, `AWSSDK.SQS/4.0.0`.

- `AWS_LAMBDA_FUNCTION_NAME=test-fn`, `_X_AMZN_TRACE_ID=Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1`:
  the first request the loopback listener captured carried `X-Amzn-Trace-Id` equal to the env value
  verbatim (asserted with `Assert.Equal`). Test passes.
- `AWS_LAMBDA_FUNCTION_NAME` unset, same trace env: no `X-Amzn-Trace-Id` header. Test passes.

So the SDK behaves as H00 §3.5 states: no code change is needed for the core-vpc → SQS → worker hop;
the worker's `worker-record` line reads it back from the `AWSTraceHeader` attribute.

## Interpretations of H00 §3.3

- `RootFromHeader` trims the whole value first, so a trailing newline around an otherwise valid
  bare root is accepted after trimming; a newline inside the candidate cannot pass because of the
  length-35 check.
- An empty `x-dc-trace-id` header value is treated as absent (`upstreamTraceId` omitted).
- The worker-record line serialises a missing/invalid upstream as `"upstreamTraceId":null`
  (accepted by the brief); the EMF line omits it instead, per the `BuildLine` rule.
- Test fixtures use the H00 example root and fixed lower-case hex roots; the theory data are
  generated from the seed 18.
