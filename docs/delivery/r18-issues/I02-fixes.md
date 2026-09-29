# I02 — Observability fixes (services): fixes per finding

Issue #527, wave r18i-p. Branch `delivery/r18ip/I02-527`. Every path is relative to the repo root. Tests run
with `uv run --python 3.12 pytest -q` in each service. No schema change, no new dependency, no infra change, no
change to a metric, alarm, log field, route or env key.

### sre-cloud-7

Status: declined (covered by `developercards-prod-notifier-errors` through the 15-minute automation tick)

The finding is right that the synthetic check cannot see the database: `GET /health` answers before any DB access
(`src_C/Vpc/VpcFunction.cs:109`), and the token-less `GET /api/v1/me` gets its 401 from the API Gateway JWT
authorizer without invoking core-vpc. The five checks are contract-defined, and a DB outage already pages within
30 minutes by another path, so no new check or alarm is needed. The exact path, read from the code and confirmed
read-only against the live account on 2026-09-29:

1. `developercards-automation-tick` (EventBridge Scheduler, `rate(15 minutes)`, live state ENABLED;
   `infra/modules/worker/automation.tf:171`) invokes `developercards-notifier:prod` with `{"job":"tick"}`.
2. The notifier POSTs `/api/internal/automation/tick`. `AutomationTick.HandleTick`
   (`src_C/Vpc/Automation/AutomationTick.cs:78`) opens a Postgres connection at `:96` and runs a query before any
   step and before the automation-mode check, so the tick touches the DB in every mode (off included). A connect
   failure (`PG_CONNECTION_TIMEOUT`, default 8 s), an authentication failure from a broken secret, or
   `too_many_connections` is caught by `RunnerRoutes.HandleError` and answered 500 (`res.Error500`). A hung core
   becomes a gateway 504 or the notifier's 28 s client timeout.
3. The notifier treats any non-2xx or failed envelope as a tick failure: `AutomationTickFailures` and then
   `raise RuntimeError` (`services/notifier/src/notifier/handler.py:372`). The invocation is a Lambda error.
4. `developercards-prod-notifier-errors` (`infra/modules/observability/alarms_r18a.tf:42`: `AWS/Lambda Errors`
   ≥ 1 in one 300 s period, 1 of 1, actions to `developercards-alerts`; live ActionsEnabled = true) pages.

Worst case, from outage start to page: under 15 min to the next tick, plus the tick itself (at most 28 s), plus one
300 s period and the evaluation lag. That is about 22 minutes, inside the 30-minute bar. `core-vpc-errors` does
**not** fire on this path, because core catches the exception and answers 500. The app's own API 5xx also feed
the api-availability burn alarms, and `developercards-prod-rds-connections` covers connection exhaustion.

What changed:
- `services/synthetic-check/README.md`: new section "What it does not prove: the database". It covers the gap
  ("the synthetic proves edge, CDN and console reachability, not RDS"), the alarm path above, and the follow-up
  (an auth-free `GET /health?deep=1` running `SELECT 1` is a core route change outside this issue's paths). The
  cost row now says that only the 2,880 `/health` requests invoke core-vpc and that the `/api/v1/me` requests stop
  at the JWT authorizer. This corrects the H00 §9 "checks 1 and 5" wording on the service side.
- `services/notifier/tests/test_db_outage_paging.py` pins steps 1, 3 and 4. They pass on the current code by design:
  this proves existing coverage and is not a fix.
  - `test_a_failed_tick_answer_raises_so_the_invocation_is_a_lambda_error[500|502|503|504]`
  - `test_an_unreachable_core_raises_too`
  - `test_the_tick_timeout_ends_before_the_gateway_and_lambda_timeouts`
  - `test_the_tick_runs_every_15_minutes_and_notifier_errors_pages_within_5_minutes` (reads `automation.tf` and
    `alarms_r18a.tf`: schedule rate and input, alarm metric, threshold, period, actions, no `actions_enabled`)

Left to the infra/docs wave (outside `services/` and `docs/delivery/r18-issues/`): the one-line RUNBOOK §8 note
and the H00 §9 cost-row wording. Suggested text for both is the README section above.

For I03: no new alarm is needed; the DB outage path above is already paging.

### sre-cloud-8

Status: fixed

- `services/synthetic-check/src/synthetic_check/checks.py:47` `RUN_DEADLINE_S = 40.0`. This is the wall-time
  budget of one run, 20 s under the 60 s Lambda timeout (`infra/modules/worker/synthetic.tf:18`).
- `checks.py:255` `_call_bounded`: each check runs in a daemon worker thread, which the caller joins with the
  remaining budget. A worker still alive at the deadline raises `CheckFailed(TIMEOUT)`. This bounds what a socket
  timeout cannot: `getaddrinfo` (DNS), and a slow-drip body whose every recv arrives inside the per-operation
  timeout. An abandoned worker holds only its own sockets, each with the per-request timeout, and is frozen with the
  sandbox when the invocation returns.
- `checks.py:275` `run_checks(settings, deadline_s=None)`: before each check, if the deadline has passed, the check
  is recorded as `TIMEOUT` (`status` None, `ms` 0) without sending a request. The handler is unchanged and always
  writes its one EMF line and one log line with per-check codes. `CHECK_TIMEOUT_SECONDS` is unchanged (still at
  most 10 s): the run deadline makes lowering it unnecessary.
- `services/synthetic-check/README.md`: the "One invocation" step 3, the "Every request" paragraph and the
  `TIMEOUT` row describe the deadline.

Tests (`services/synthetic-check/tests/test_deadline.py`; all fail on the base, which has no `RUN_DEADLINE_S` or
`deadline_s`, and the DNS and slow-drip runs take tens of seconds):
- `test_deadline_is_well_under_the_lambda_timeout`: reads `synthetic.tf` and checks that the deadline is at most
  the Lambda timeout minus 15 s.
- `test_a_stalled_check_is_timeout_and_the_rest_are_not_run`
- `test_dns_stall_is_bounded_by_the_deadline`: `socket.getaddrinfo` blocks, and all five checks are `TIMEOUT`
  in under 1.5 s.
- `test_slow_drip_body_is_bounded_by_the_deadline`: one byte every 0.2 s against a 1 s per-operation timeout.
- `test_handler_writes_the_emf_line_when_the_deadline_is_hit`

The existing `test_timeout_is_timeout` (per-request timeout gives TIMEOUT, about 1 s) is unchanged and still
passes.

### backend-tracing-3

Status: fixed (test coverage; nothing leaks today, so no source change)

Following the verifier, the negative assertions run at **handler level**, so a leak added in `handler.py` (which
builds the subscriber headers) or in a shared header builder is caught, not only one in `delivery.py` or
`fetch.py`:
- `services/webhook-dispatcher/tests/test_trace_no_leak.py`
  `test_subscriber_post_carries_no_trace_header_or_root`. `_X_AMZN_TRACE_ID` is set and the SQS record carries an
  `AWSTraceHeader`. The handler's own headers go through the real `delivery.post_json` to a loopback subscriber.
  The test asserts that no `x-dc-trace-id` key is sent (neither in the handler's dict nor on the wire), and that no
  header value, path or body contains either root. It also checks that the delivery log line carries
  `upstreamTraceId`, which proves the root was bound during the POST.
- `services/source-watcher/tests/test_trace_no_leak.py`
  `test_watched_site_requests_carry_no_trace_header_or_root`. A full handler run with `_X_AMZN_TRACE_ID` set and an
  upstream root bound. The real `fetch()` sends robots.txt and the page to a loopback "site". No request to it
  carries the header or either root. The core calls do carry `x-dc-trace-id`, so the run had a root to leak.

Both tests pass on the current code, as intended, because the finding is a coverage gap. Mutation check, run
locally and reverted: adding `headers["x-dc-trace-id"] = str(tracectx.upstream())` in
`webhook_dispatcher/handler.py`, or sending the `_X_AMZN_TRACE_ID` value as a header from `source_watcher/fetch.py`,
makes the matching test fail.

### backend-tracing-4

Status: fixed (Python side; the .NET side is the src_C issue's)

- All five byte-identical copies of `tracectx.py` changed identically (`services/{ai-qa,notifier,source-watcher,
  synthetic-check,webhook-dispatcher}/src/*/tracectx.py:31-35`): `segment = part.strip(); if
  segment.startswith("Root="): val = segment[len("Root="):].strip()`. This is the .NET rule, so `Root =1-…` and
  `Root\t=1-…` are now rejected. The 512-character cap, counted before trimming, was already in place and is
  unchanged. The docstring names the .NET twin.
- A shared literal vector table (`SHARED_VECTORS`, 32 rows) and `test_shared_vectors_match_the_dotnet_parser` are
  appended to every service's `tests/test_tracectx.py`. The rows include the Q3 edges: `Root =…`, `Root\t=…`,
  `xRoot=…`, `root=`/`ROOT=`, `Root==…`, first `Root=` segment wins, trailing `;`, a whitespace-padded bare root,
  and the length boundary at 512 and 513 characters, both as a `Lineage` pad and as leading whitespace, which
  pins "counted before trimming". The test fails on the base (`Root =…` returned the root) and passes after.
  A simulation of the current .NET `RootFromHeader` over the same table matches every row except the two
  513-character rows. That is the missing .NET length cap, which the src_C side of Q3 adds; it should copy
  `SHARED_VECTORS` into `TraceContextTests` as-is.
- Existing tests: unchanged. The seeded property test still passes.

## Contract

- **Q3 (tracing parser parity), Python side:** Python accepts exactly the .NET grammar. The Root segment must start
  exactly `Root=`, the first such segment wins, whitespace around segments and after `=` is trimmed, and a raw
  header over 512 characters is rejected. The same literal vector table is in all five Python suites, ready to copy
  into the .NET suite.
- **Q1, Q2, Q4:** not touched by this issue. They are dashboard/alarm/RUNBOOK and core publish-path items, outside
  `services/`.
- H00 stays in force: no metric, alarm, log field, IAM or env key renamed or added. `AutomationTickFailures`,
  `SyntheticCheckSuccess` and `SyntheticCheckLatency` are unchanged, and the synthetic's EMF shape is unchanged.
