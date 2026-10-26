# SLO evidence review, 27 October 2026 (Pacific/Auckland)

Retain the configured sync target of 95% of handler requests within 2,000 ms and the existing event guards for now. The latest available read-only capture contains 228 sync samples, enough to exceed the 200-event dashboard minimum, but does not establish a full period on one identified source version. No alarm or production configuration changed in this review.

## Evidence used

The [26 October UTC observation](operations.md) covers a requested 28-day window and records current alias snapshots, exact queries, returned sample counts and limits. It was collected immediately before this local-date review. Its [source responses](operations-source.json) contain 21 sync push, 136 progress and 71 draw-state samples; weighted percentile-rank buckets put those observed handler samples within 2,000 ms. API availability's probe-adjusted denominator is 10,557, above its 2,000-event minimum. Publish has 16 observed good events, below its 200-event minimum, and no returned failed-event datapoints.

The two met minimums are statements about the captured window, not capacity claims. The publish denominator is incomplete by design; repaired successes, process death and lost metric logs can be missing. The [publish metric contract](publish-metrics.md) describes these limits.

## Decisions and remaining checks

| Question from the runbook | Decision or remaining evidence |
|---|---|
| Recalibrate sync target after 28 days at 512 MB | Keep the current target. The capture starts before the recorded 29 September memory change, and qualified Lambda configuration was denied to the read-only role. It cannot prove the requested full period at that configuration or attribute every sample to one source revision. |
| Lower event minimums? | Do not lower them based on this observation. Sync and API already exceed their existing dashboard minimums; publish remains below its minimum and has accounting gaps. |
| Are the fast/slow sync guards useful at this volume? | Hourly returned sample counts can be inspected, but a complete rolling 6-hour/30-minute alarm replay and an alert recovery exercise have not been run. Retain the guards pending that evidence; no claim of paging coverage is added. |
| Is this end-to-end performance or successful sync? | Neither follows from handler latency. Obtain client timing, initialization context and business success/failure counts on a known deployed version. |
| Is the service cost verified? | Actual billing-period cost remains UNKNOWN. Infrastructure estimates are not an invoice, and no paid measurement was initiated. |

The review closes the evidence-reading and decision-recording step for this date. It leaves the full-period version/configuration verification, guard replay, business success measurements and actual cost open. These gaps must remain visible in portfolio claims and the workflow acceptance status.
