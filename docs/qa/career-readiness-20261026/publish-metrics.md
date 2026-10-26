# Publish metric contract and replay recovery

`PublishJobsSucceeded` and `PublishJobsFailed` are dimensionless EMF Count events for **best-effort
handler-observed outcomes, including manifest health**. They are not a ledger of database terminal
states and do not provide exactly-once accounting. Metric names, namespace selection and alarm
configuration are unchanged.

This contract retains H02's accepted manifest/crash/persistence biases and I01's suppression of good
events on terminal/absent replay. Historical sources: `docs/delivery/r18-issues/H02-notes.md` and
`docs/delivery/r18-issues/I01-fixes.md`. I01's statement that replay emits no failed gauge described
the healthy-manifest path; its existing final manifest-error path still emitted a bad event. The
change here removes that false bad event for FAILED/absent replay while preserving SUCCESS policy.

## States, events and transitions

Persisted job states are PENDING (queued), PROCESSING (acquired, or stale and recoverable), SUCCESS
(completed publish), and FAILED (terminal business/system/reaper failure). An absent row is a replay
classification, not a persisted state. SUCCESS and FAILED are terminal.

Events are SQS delivery/redrive, acquisition, publish completion, business error, system error,
manifest rebuild success/failure, and subsequent replay. `ApproximateReceiveCount >= 3` is a final
receive, including later DLQ redrives. The handler still returns a batch item failure after system or
manifest error, so queue retry/DLQ behavior is unchanged.

| From / event | Persistence and side effects | Good / bad |
|---|---|---|
| PENDING or stale PROCESSING / acquire and publish | PROCESSING → SUCCESS; upload once in the successful attempt, commit live pointer/count, run idempotent post-publish side effects, rebuild manifest | 1 / 0 after healthy manifest |
| Acquired job / business error | Persist FAILED; acknowledge only if `FailAsync` returns | 0 / 1 after successful failure write; otherwise 0 / 0 and retry |
| Processing / system error before final receive | Record attempt reason without moving the stale-acquisition clock; report item failure | 0 / 0 |
| Processing / system error on final receive | Attempt FAILED persistence; report item failure | 0 / 1 even if failure write throws |
| SUCCESS / terminal replay, manifest healthy | No reacquisition/upload; retry idempotent success side effects and rebuild manifest; acknowledge | 0 / 0 |
| FAILED or absent / replay, manifest healthy | No reacquisition/upload; rebuild manifest; acknowledge | 0 / 0 |
| SUCCESS committed in this attempt or SUCCESS replay / manifest failure | SUCCESS/live pointer remain; report item failure | 0 / 0 before final receive; 0 / 1 on final receive |
| FAILED or absent / replay, manifest failure | Terminal/absent state stays unchanged; report item failure; keep existing guarded error/failure writes | 0 / 0 on every receive |
| Fresh PROCESSING / acquisition rejected | Another worker may still own it; report item failure | 0 / 0 |

Illegal transitions remain guarded by the existing repository: FAILED cannot be acquired or completed;
SUCCESS cannot be overwritten by failure persistence. Neither terminal replay uploads a deck or moves
its live pointer. No schema, durable metric marker, migration, or new persisted state is introduced.

`IReplayOutcome.LastCallReplayOutcome` distinguishes `None`, `Succeeded`, and `FailedOrAbsent`. The
processor resets it on every call. The worker captures it per record only after `ProcessAsync` returns,
before rebuilding the manifest; an exception during processing cannot reuse the previous record's
classification. Processors without the optional interface retain the original non-replay behavior.

## Retained limitations

- SUCCESS commit → manifest failure on receive 1 → healthy SUCCESS replay on receive 2 still emits
  **zero good and zero bad events**. Replays do not invent a replacement good event. The deck is live
  and the manifest repairs, but this publish is missing from the SLI denominator.
- Repeated manifest failure through the final receive still counts bad for SUCCESS, even though the
  database says SUCCESS. This conservatively reflects stale discoverability, rather than changing
  the accepted policy into a database-only success count.
- Final system failure still counts bad if `FailAsync` cannot persist FAILED. Repeated final redrives
  of a SUCCESS with a broken manifest can each count bad; no durable deduplication is claimed.
- A crash, timeout, or lost metric log can emit nothing. Worker Lambda Errors and DLQ alarms remain
  necessary alongside publish burn alarms. Malformed bodies and acquisition contention emit nothing.
  A `{}` body currently maps to an absent replay and emits neither publish metric.

## Reproduction and focused validation

`PublishMetricRecoveryTests` uses the real repository and Testcontainers Postgres, with local uploader
and manifest fakes. It checks:

- Terminal SUCCESS/FAILED/absent replay with healthy/broken manifest before/on final receive and
  later redrive, including persisted status/live pointer and no upload.
- Initial SUCCESS commit → manifest error → replay repair, preserving live build/count and the
  retained zero-event bias; continuous manifest failure through receive 3 preserves SUCCESS and
  emits the accepted bad event; both sequences upload only once.
- Initial healthy success emits one good event; healthy replay emits none.

Before changing production source, all 18 new cases ran against base
`5d0c0cc9b108c3fbb20a30a36c7acc139ff46fe7`: 14 passed and exactly four failed (FAILED/absent,
manifest failure, receive 3/5: expected zero bad, actual one). Existing `PublishReplayGaugeTests`,
`PublishSloGaugeTests`, `WorkerFailureHandlingTests`, and `WorkerReceiveCountTests` cover replay-state
reset, business/system failures, failure-persistence exceptions, contention, and receive routing.
The focused green run of those five classes passed all 70 cases on .NET SDK 10.0.401 with the existing
pgvector/Postgres Testcontainers fixture.
Raw command/exit-code logs and TRX results are held in the A2 workflow evidence directory; full-suite
validation and independent review belong to the supervisor's integration stage.
