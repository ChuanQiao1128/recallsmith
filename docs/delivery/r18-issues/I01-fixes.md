# I01 — Observability fixes (server): publish gauge on replays (Q4), .NET trace-header parser parity (Q3)

Fix round for R18H (issue #526). Scope: `src_C/` only; the Python side of Q3 (the five `tracectx.py`
copies) belongs to the services wave and is not changed here. Every new test below was run against the
pre-fix source first and failed (7 failures: the 5 replay tests and the two 513-char vectors).

### backend-tracing-1

Status: fixed

A replayed SQS message for a job that is already terminal (SUCCESS or FAILED) or absent is still acknowledged
(empty `BatchItemFailures`, manifest rebuild unchanged) but no longer emits `PublishJobsSucceeded`.

- `src_C/Worker/Services/IReplayOutcome.cs` (new): optional `public interface IReplayOutcome { bool LastCallWasTerminalReplay { get; } }`.
  Public rather than internal because the Worker assembly has no `InternalsVisibleTo`; adding one was not needed.
  `IPublishJobProcessor` and every existing fake are unchanged.
- `src_C/Worker/Services/PublishJobProcessor.cs:15,33,37,55`: implements `IReplayOutcome`; the flag is reset at the
  start of every `ProcessAsync` and set in the "acknowledging replay" branch (`row is null` or status SUCCESS/FAILED).
- `src_C/Worker/WorkerFunction.cs:120`: the success gauge is emitted only when
  `!(_processor is IReplayOutcome replay && replay.LastCallWasTerminalReplay)`. No failed gauge was ever emitted on
  that path (it does not throw), so none is emitted now either.

Deviation from the audit's suggestion: the flag is also set for a SUCCESS replay, not only FAILED/absent, because
contract refinement Q4 names all three ("terminal (FAILED/SUCCEEDED) or absent"). The SUCCESS job's good event was
already counted when it first reached SUCCESS, so this only removes a double count. H02-notes "Accepted biases"
(a) and (d) are superseded by this change (that file is left as the historical record of H02).

Tests (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishReplayGaugeTests.cs`, new file; `PublishSloGaugeTests.cs` is byte-identical):
- `TerminalReplay_EmitsNoGauge_AndAcknowledges` — fake implementing `IReplayOutcome` returning true: zero gauges, empty `BatchItemFailures`, rebuild still called.
- `NotAReplay_StillEmitsOneSucceededGauge` — same fake returning false: one success gauge.
- `RedriveOfFailedOrAbsentJob_EmitsNoGauge` (FAILED @ receive 1 and 4, absent row) — the real `PublishJobProcessor` behind the real handler: zero gauges, acknowledged, uploader untouched.
- `ReplayFlag_IsResetOnEveryCall` — a FAILED replay sets the flag; the next call (PROCESSING, not acquired) clears it.

The SUCCESS replay is covered through the fake only: the real processor's SUCCESS branch runs
`AfterPublishSucceededAsync`, which writes to the shared test database.

### backend-tracing-4

Status: partially fixed

This issue owns the .NET side of Q3 (the Python file cited by the finding is under `services/`, outside this issue's
allowed paths `src_C/.*`, `docs/delivery/r18-issues/.*`).

- `src_C/Shared/RecallSmith.Lambda.Common/TraceContext.cs:23,53`: new `public const int MaxHeaderChars = 512`; an
  input longer than that (measured before trimming, as in Python `len(value) > MAX_HEADER_CHARS`) returns null.
  The `Root=` rule (segment must start with exactly `Root=` after trimming; first such segment decides) was already
  the .NET behaviour and is unchanged; its doc comment now states it.
- `src_C/Tests/RecallSmith.Lambda.IntegrationTests/TraceContextTests.cs:83`: `SharedVectors()` — the literal vector
  table below, to be copied verbatim into each Python `test_tracectx.py` by the services-side issue.
  The existing seeded generator (`GeneratedHeaders`) and all existing tests are kept.

Tests: `TraceContextTests.RootFromHeader_MatchesTheSharedVectors` (30 rows; the two 513-char rows fail on the
pre-fix code), `TraceContextTests.MaxHeaderChars_Is512`.

Shared vectors (R = `1-5759e988-bd862e3fe1be46a994272793`; `PadTo(s, n)` appends `x` up to n chars,
`LeftPad(s, n)` prepends spaces up to n chars; `\t` is a tab):

| # | input | expected |
|---|---|---|
| 1 | `R` | R |
| 2 | `Root=R;Parent=53995c3f42cd8ad8;Sampled=1` | R |
| 3 | `Parent=53995c3f42cd8ad8;Root=R;Sampled=0` | R |
| 4 | `Parent=53995c3f42cd8ad8;Sampled=1;Root=R` | R |
| 5 | `  Root=R ; Parent=53995c3f42cd8ad8 ;  Sampled=1  ` | R |
| 6 | `Root= R ;Sampled=1` | R |
| 7 | `\tR\t` | R |
| 8 | `Root =R;Sampled=1` | null |
| 9 | `Root\t=R` | null |
| 10 | `root=R;Sampled=1` | null |
| 11 | `ROOT=R` | null |
| 12 | `Rootx=R` | null |
| 13 | `Root==R` | null |
| 14 | `Root=<R upper-cased>;Sampled=1` | null |
| 15 | `Root=;Parent=53995c3f42cd8ad8;Sampled=1` | null |
| 16 | `Root=1-XYZ;Root=R` | null |
| 17 | `Root=Rx;Parent=53995c3f42cd8ad8` | null |
| 18 | `Parent=53995c3f42cd8ad8;Sampled=1` | null |
| 19 | `R junk` | null |
| 20 | `2-5759e988-bd862e3fe1be46a994272793` | null |
| 21 | `1-5759e988-bd862e3fe1be46a99427279` | null |
| 22 | `Root` | null |
| 23 | `=` | null |
| 24 | empty string | null |
| 25 | three spaces | null |
| 26 | null / None | null |
| 27 | `PadTo("Root=R;Lineage=", 512)` | R |
| 28 | `PadTo("Root=R;Lineage=", 513)` | null |
| 29 | `LeftPad(R, 512)` | R |
| 30 | `LeftPad(R, 513)` | null |

## Contract

- Q3 (.NET side): `TraceContext.RootFromHeader` rejects inputs over 512 chars and accepts a `Root` segment only when
  it starts with exactly `Root=`; the shared table above is in `TraceContextTests.SharedVectors`. Rows 8 and 9 fail
  on the current Python parser (`key.strip() == "Root"`) until the services-side copy lands; every other row already
  matches Python.
- Q4: `PublishJobProcessor` reports a terminal/absent replay through `IReplayOutcome`; `WorkerFunction` then emits
  neither `PublishJobsSucceeded` nor `PublishJobsFailed`. Metric names, dimensions and the H00 §4.3 emission points
  are otherwise unchanged.
- Q1, Q2: not touched (infra/runbook scope).
