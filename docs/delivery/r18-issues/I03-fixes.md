# I03 — Observability fixes (infra + runbook): fixes per finding

Issue #528, wave r18i-p. Branch `delivery/r18ip/I03-528`. Every path is relative to the repo root. No schema
change, no new dependency, no code outside `infra/` and `docs/delivery/r18-issues/`. No metric, log field, route
or env key is renamed. The paging alarm names are all unchanged. The only new names are six action-less
children (`…-burn-6h` ×3 through `moved`, `…-burn-30m` ×3) and one dashboard widget.

**Test for every infra fix:** the I03 verify step 3 runs the real read-only plan against
`docs/delivery/r18-issues/I03.plan-allow.json` (`infra/scripts/check-plan.py --allow`). On the base tree the
allow file's 15 entries are stale and the plan is empty, so the check fails. After the fix the plan is exactly
those 15 entries: `Plan: 9 to add, 6 to change, 3 to destroy`. The 3 destroys are the delete-then-create half
of the three `moved` replaces. `check-plan.py` reports `PLAN OK 15`, `create=6 update=6 replace=3`.

Every new or changed metric-math expression (6-hour and 30-minute children, the guarded budgets over a 28-day
period, the `SEARCH` widget) was also replayed read-only through `aws cloudwatch get-metric-data` on
2026-09-29. Every result was `StatusCode = Complete` with no `Messages`. Guarded budgets: api 100 (N = 323),
sync 100 (N = 14, bad = 1; unguarded −42.9), publish 100 (N = 0).

### sre-cloud-1

Status: fixed

- `infra/modules/observability/slo_r18h.tf:48` `local.slo_sync_dormant` = "dormant at 2026-09 traffic: needs
  >= 6 sync requests in 1 h (fast) / >= 12 in 6 h (slow), and 14 arrived in total (at most 6 in an hour, 10 in
  6 h), so latency regressions show only on the dashboard and SyntheticCheckLatency". It is appended to the
  descriptions of `slo_sync_latency_burn_1h` (:261), the fast composite (:353), `slo_sync_latency_burn_6h`
  (:366) and the slow composite (:458). The math and the guards are unchanged, as the verifier asked (H00 §4 and
  §10.8 chose them).
- `slo_r18h.tf:49` `local.slo_publish_dormant` goes on the publish fast burn, 6-hour child and slow composite:
  no publish job ran in the window (read-only replay, `PublishJobsSucceeded` / `PublishJobsFailed` empty since
  2026-09-21). Q1 asks for this label on every SLO alarm whose guard is not met.
- Every sync description now says "(handler latency)", and `slo_r18h.tf:257` says the SLI excludes Lambda init.
- `infra/RUNBOOK.md:400`: the sync SLI row says it is handler latency, excluding init and cold start.
  `:411` "Dormant at 2026-09 traffic" paragraph with the replay numbers. The sync and publish rows at
  `:429-438` are marked "yes (dormant)". `:459` rewords the old "did not measure what the app waits for": the
  old alarm measured every invocation including `/internal/*`, and neither metric includes init. This follows
  the verifier's correction of the cold-start sub-claim. `:486-488`: the 2026-10-27 sync review also checks the
  guards and budget minimums.
- Did not add a new latency alarm. The verifier showed that no paging coverage was lost:
  `core-vpc-duration-p95` was just as dormant.
- Test: the verify plan check (`slo_sync_latency_burn_1h`, `_burn_5m`, `slo_sync_latency_fast_burn` and
  `slo_publish_success_fast_burn` are `update` of `alarm_description` only).

### sre-cloud-2

Status: fixed

- `infra/modules/observability/dashboard.tf:4` `local.slo_budget_min_events` = api 2000, sync 200, publish 200
  (N = 10 / budget, so one bad event costs at most 10 % of the budget).
- The budget expressions are `IF(<total> >= N, 100 * (1 - (bad / total) / <budget>), 100)`: api `:225`, sync
  `:249`, publish `:275`. The event count is now a visible value with its own label ("… in window (budget counts
  from N)"): api `:223`, sync `:247`, publish `:274`. Following the verifier, a reader sees N beside the
  100 %, so the guard cannot hide a burnt budget unnoticed.
- `infra/RUNBOOK.md:469-492`, Error-budget policy: an N table per SLO with the 2026-09 event counts, what 100 %
  below N means, and the "< 25 %" rule applying only above N.
- Supervisor expectation (H00 §8.2 step 7 is in the control dir, outside this issue's paths): the corrected
  text is at `RUNBOOK.md:490`. It reads: "expect each budget to show its real value, or 100 % below N. Do not
  expect ~100 %: at 2026-09 volume every budget is below N. The 128 MB slow sync request leaves the sync window
  on 2026-10-25." The supervisor should replace "budgets read ~100 %" with this.
- Test: the verify plan check (`aws_cloudwatch_dashboard.prod` update of `dashboard_body`), plus the
  `get-metric-data` replay above.

### sre-cloud-3

Status: fixed

- `infra/modules/observability/slo_r18h.tf:16-24`: `local.slo_api_user_metrics` adds the detailed route series
  `hc` (`Count`, `Resource=/health`, `Method=GET`), `h5xx` (`5xx`, same route) and `m4xx` (`4xx`,
  `Resource=/api/v1/me`, `Method=GET`; the token-less probe's 401 from the JWT authorizer). Then
  `user_total = total - FILL(hc, 0) - FILL(m4xx, 0)` and `user_bad = FILL(e5xx, 0) - FILL(h5xx, 0)`. Both
  series exist in the account (`list-metrics`, detailed metrics at `gateway.tf:198`). Subtracting the `/me`
  4xx, not all of `/me`, keeps real users' authenticated `/me` requests, which answers the verifier's point that
  a route-level subtraction "does not remove the /me 401s".
- Applied to the slow-burn 6-hour child (`:150`), the new 30-minute child (`:196`) and the budget widget
  (`dashboard.tf:217-225`). As the audit suggested, the fast-burn children keep raw totals.
- `infra/RUNBOOK.md:399` (SLI row) and `:403-409` state the dilution (8 probe requests per hour, ≈ 73 % of the
  denominator) and what is excluded where. Scheduled `/api/internal/*` callbacks that pass the gateway (seen in
  the new 5xx-by-route SEARCH) are still counted, and the row says so.
- Test: the verify plan check (`slo_api_availability_burn_6h` replace, `_burn_30m` create, dashboard update),
  plus the `get-metric-data` replay (api-6h, api-30m, api-budget-28d: `Complete`).

### sre-cloud-4

Status: fixed (per contract Q2, not the audit's suggested fix)

- Contract Q2 says "the fast-burn guard sits clearly above the synthetic baseline (8 requests/h)". The audit
  suggested lowering the guard to 8 so a synthetic-only outage pages through fast burn. The contract wins
  (H00 and the round rules), so the guard went the other way. `slo_r18h.tf:91` is now
  `IF(total >= 16 AND bad >= 2, …)` (was 10), and the 1-hour burn widget matches (`dashboard.tf:296`). 16 is
  twice the probes' 8: the probes alone can never meet the guard and are at most half of any hour it measures.
  With the old 10, 8 probes plus 2 user requests with 2 5xx gave burn 40 and a page.
- The finding's underlying gap (a quiet-hour full outage in which only the probes fail) is covered by
  `developercards-prod-synthetic-check-failing` (two failed runs, ≈ 30 minutes). That alarm exists for the
  "no real traffic" case (H00 §10.8). The RUNBOOK says so at `infra/RUNBOOK.md:403-409`, and the burn-1h row
  at `:425` gives the new guard. Replay: requests other than the probes reached ≥ 8 in an hour in 7 of 183
  hours, so the fast burn is rare but live, and it is not labelled dormant.
- Test: the verify plan check (`slo_api_availability_burn_1h` update of `alarm_description`, `metric_query`).

### sre-cloud-5

Status: fixed

- Each slow burn is now a composite with the SRE-workbook short window. `slo_api_availability_slow_burn`
  (`slo_r18h.tf:242`), `slo_sync_latency_slow_burn` (`:456`) and `slo_publish_success_slow_burn` (`:612`) are
  `ALARM(…-burn-6h) AND ALARM(…-burn-30m)`, with actions on the composite only. The former single 6-hour metric
  alarms become action-less children `…-burn-6h` through `moved` blocks (`:145`, `:359`, `:517`). Their
  `alarm_name` change forces a replace, which deletes the old `…-slow-burn` metric alarm before the composite of
  that name is created, since the composite depends on the new child. New 30-minute children at `:196`, `:410`
  and `:567`. Publish's short window uses `bad >= 1` (`:45`), because it only confirms the burn is ongoing; the
  6-hour child keeps `bad >= 2`.
- Duplicate notifications: each slow composite has `actions_suppressor` = its SLO's fast burn
  (`extension_period` 1800 s, `wait_period` 300 s; `:51`, `:249`, `:463`, `:619`). The api and sync fast burns
  are composites; publish's is the single metric alarm.
- `infra/RUNBOOK.md:446-451` ("One incident, one page") covers the suppression and the reset lag: the composite
  clears when the 30-minute child clears, and the 6-hour child may stay in ALARM silently. The alarm table lists
  all ten children, and paging stays 7 alarms.
- Cost, stated in `infra/RUNBOOK.md` (end of §8) and `infra/README.md` (I03 entry): 13 new alarm-metrics
  (api 5, sync 6, publish 2) = USD 1.30, the api 6-hour child going from 2 to 5 metrics = USD 0.30, and 3
  composites × USD 0.50 = USD 1.50. That is ≈ USD 3.10/month.
- Test: the verify plan check (three `replace`, three 30-minute `create`, three composite `create`; the plan
  shows each composite's `actions_suppressor`).

### sre-cloud-6

Status: fixed

- `infra/RUNBOOK.md:533-547`, tracing rollback: the ineffective `$LATEST`-only shortcut is gone. The section
  explains why it does nothing to live traffic (the `prod` alias serves a published version that keeps its
  tracing mode) and gives two paths that act on the alias. One is the `ROLLBACK` line printed by
  `services/lambda-release.sh:70` (`update-alias` to the previous version, which also rolls back its code). The
  other reverts `tracing_config`, applies, and redeploys (`src_C/deploy.sh`, `services/deploy-python-lambda.sh`),
  or by hand runs `publish-version` then `update-alias --name prod`. Both end with the Terraform revert. The SLO
  rollback line is updated for I03 (16 SLO alarms, `moved` blocks).
- Test: none possible in code. This is a runbook-only correction; `services/lambda-release.sh:53-70` is the
  cited behaviour.

### sre-cloud-9

Status: fixed

- `infra/modules/observability/dashboard.tf:380-395`: new widget "API 5xx by route (top 10)" at y = 48,
  `SORT(SEARCH('{AWS/ApiGateway,ApiId,Method,Resource,Stage} MetricName="5xx" ApiId="<id>" Stage="<stage>"',
  'Sum', 300), SUM, DESC, 10)`. The replay returned `Complete` with per-route series (`GET /health` carries this
  week's only 5xx).
- `infra/RUNBOOK.md:423`: the fast-burn first check names the widget and also gives the SEARCH expression for the
  metrics console.
- Test: the verify plan check (`dashboard_body` update) and the `get-metric-data` replay of the SEARCH.

### I02 hand-over (For I03)

`docs/delivery/r18-issues/I02-fixes.md` says under sre-cloud-7: "For I03: no new alarm is needed; the DB outage
path above is already paging". So no alarm was added. The one-line RUNBOOK §8 note that I02 left to the infra
wave is at `infra/RUNBOOK.md:464`.

## Contract

- **Q1 (low-traffic honesty):** the three dashboard budget expressions are guarded
  (`IF(total >= N, …, 100)`) with the event count shown beside them. N is documented per SLO (api 2,000,
  sync 200, publish 200), and the RUNBOOK policy applies only above N. Every SLO alarm whose guard is not met at
  current traffic (sync-latency and publish-success: burn-1h, burn-6h, fast and slow) says "dormant at 2026-09
  traffic" in its description and in the RUNBOOK SLO table. The sync SLI is documented as handler latency,
  excluding cold-start init.
- **Q2 (users, not probes):** the api-availability budget widget and the slow burn (6-hour and 30-minute
  children) subtract `GET /health` (`Count`, `5xx`) and the `GET /api/v1/me` 4xx (the token-less probe's 401)
  with the API Gateway detailed route metrics. The 1-hour fast-burn guard is `total >= 16`, twice the probes'
  8 per hour.
- **Q3, Q4:** not touched here. They are parser and core publish-path items in `services/` and `src_C`.
- H00 stays in force. No metric, log field, IAM or env key is renamed. The paging alarm names are unchanged. §4's
  single-window slow burn becomes a two-window composite under the same name, as the issue's direction for
  sre-cloud-5 requires.
