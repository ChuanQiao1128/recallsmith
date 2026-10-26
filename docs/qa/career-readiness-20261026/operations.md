# Operations observation, 26 October 2026

A read-only CloudWatch observation found 228 sync handler samples and 16 publish-success events in the requested 28-day window. These observations describe a small running service; they do not establish load capacity or a complete per-job success rate.

## Window and identity

- Collection: 2026-10-26 10:43:30 UTC, `ap-southeast-2`, existing `devcards-agent-readonly` role.
- Requested window: 2026-09-28 10:43:30 to 2026-10-26 10:43:30 UTC. CloudWatch rounded the bucket origin to 10:40 UTC; queries use 3,600-second buckets. Sample counts refer to the returned buckets.
- Alias snapshots: `core-vpc:prod` points to version **85**; `worker-lambda:prod` points to **37**, with no weighted routing in either response.
- The [latest successful CD run](https://github.com/ChuanQiao1128/recallsmith/actions/runs/39899509568), created 2026-10-23 04:17:10 UTC, has source `298b15421441787536ea729ee23f06aff2391eba`. This run is supporting release history. The full observation window spans multiple releases, and alias snapshots alone do not prove which source version served every sample.
- Reading qualified Lambda configuration was explicitly denied. No stronger role was used; deployed runtime/code-hash attribution remains **UNKNOWN**.

[Source responses and query arguments](operations-source.json) retain the metric dimensions, returned datapoints and SHA-256 of each original response. Logs are restricted to timing/memory fields from REPORT records; no credentials, request payloads or user identifiers are included.

## Observations

| Measurement | Returned observations | Interpretation |
|---|---:|---|
| API Gateway requests | 18,090 | Includes probes and callbacks; not a user count |
| API Gateway 5xx | 0 in returned buckets | Does not establish functional success or exclude client-side errors |
| Availability denominator after existing probe subtraction | 10,557 | `18,090 - 2,714 health - 2,667 me-4xx - 2,152 sync-probe-4xx`; matches the runbook formula, including its approximation |
| Sync push | 21 samples | 21 within 2,000 ms |
| Sync progress | 136 samples | 136 within 2,000 ms |
| Draw-state sync | 71 samples | 71 within 2,000 ms |
| PublishJobsSucceeded | 16 | Observed best-effort handler outcomes, not a durable job ledger |
| PublishJobsFailed | No datapoints | Missing metric data is not proof that every job succeeded |
| core-vpc invocations / errors / throttles | 13,579 / 0 / 0 | Function-level, includes internal invocations; missing metric buckets remain missing |
| worker-lambda invocations / errors / throttles | 17 / 0 / 0 | No claim that invocation count equals publish count |

The sync result uses `PR(:2000)` weighted by each matching bucket's `SampleCount`; all 63 nonempty sample buckets have a corresponding percentile-rank bucket. This is dispatch **handler latency**, excluding Lambda initialization, network and client work. Hourly p95 ranges were 51.0 to 242.7 ms (push), 14.6 to 457.0 ms (progress) and 78.2 to 738.6 ms (draw-state). An average of those hourly p95 values would not be a window p95.

The existing minimum is 200 sync samples: 228 now exceeds it. Publish's 16 observed good events remain below its minimum of 200. Keep the scheduled 27 October target/guard review: this early observation is not a complete 28 days at 512 MB, and it does not justify changing alarm thresholds by itself. API availability excludes selected probe routes through an approximation; remaining internal callbacks and unwanted requests still affect its denominator.

## Cold and warm observations

The first filtered log page in the seven-day request returned eight REPORT records, all at 512 MB. Five include initialization (795.73 to 905.52 ms; handler duration 251.77 to 424.43 ms); three omit initialization (handler duration 73.42 to 99.65 ms). This is a sparse first-page observation, not a controlled cold/warm benchmark. The records do not identify the sync route or prove end-to-end latency.

## Evidence still needed

- A current-source controlled cold/warm run with request volume and client-side latency.
- Sync business success/failure counts. A latency sample or absence of Lambda errors does not prove sync success.
- A complete publish outcome ledger if an exact per-job rate is required; current replay/recovery limits are described in the runbook.
- An actual billing-period cost total. No Cost Explorer query or other paid measurement was initiated. Terraform estimates remain estimates.
- The 27 October SLO policy review and, if needed, a separate authorized change to alarm guards. No alarm, deployment or production data was changed here.
