# F06 — R24 review fixes: funnel route (round r24x, wave p)

Issue #659. Reviews P01 (`POST /api/v1/public/events`, issue #640). Contract `R24-00-contracts.md` §3.3.

### p-tests-1

Status: fixed

Finding: the P01 gate (grep for the route literal, the allow file, `terraform fmt`, offline `validate`,
`check-agent-routes.py`) passes on the base and does not check the route's key, auth, integration or throttle.

Confirmed before the fix. `docs/delivery/r24x-issues/F06-route-guard-test.sh` applies nine mutations to a temp
copy of `infra/modules/api/gateway.tf` and runs `terraform validate` on `infra/envs/prod`. On the base commit
(04c6ace, test only) every mutation still validated (`exit=1`, nine `FAIL mutation still validates` lines):
route deleted with the throttle kept, auth `none` → `mobile`, auth `none` → `console`, greedy key
`POST /api/v1/public/{proxy+}` on the route, greedy key on both route and throttle, integration `core_vpc` →
`edge_public`, throttle 10/5 → 50/25, throttle removed, an extra throttle key with no route. The reviewer is also
right that the gate's grep matched the `route_throttles` line and that `check-agent-routes.py` reads only
`auth = "agent"` routes.

Fix (root cause: nothing in the offline gate asserts the route's values). `infra/modules/api/gateway.tf` gets
three locals, `route_guard_public_events`, `route_guard_errors` and `route_guard_ok`. `terraform validate`
evaluates locals that depend only on literals. `route_guard_ok` calls `tobool()` on the joined error messages
when the list is not empty, so validate fails and prints every broken rule (`ROUTE GUARD: ...`). The rules:

- every `route_throttles` key is the `route_key` of a route in `local.routes` (an orphan key would fail the
  stage update at apply time; this also catches the route being deleted while its throttle stays);
- every `auth = "none"` route other than the `OPTIONS` preflights is an exact `METHOD /path` key (X08);
- `routes.public_events` is `route_key = "POST /api/v1/public/events"`, `integration = "core_vpc"`,
  `auth = "none"` (the route resource maps `none` to `authorization_type = "NONE"` and no authorizer);
- `route_throttles["POST /api/v1/public/events"]` is `{ burst = 10, rate = 5 }`. Both stages, `default` and
  `dev`, build `route_settings` from `route_throttles`, so this one check covers both.

Locals create no resources, so the plan is unchanged: P01.plan-allow.json still applies as it is.

After the fix, `bash docs/delivery/r24x-issues/F06-route-guard-test.sh` prints `ok` for the unmutated config
and for all nine mutations, each rejected with its own `ROUTE GUARD` message, then `F06 ROUTE GUARD OK`
(exit 0). The test counts a rejection only when validate fails with the guard's message, not with some other
error.

Not done as suggested: a mocked-provider `terraform test` suite under `infra/modules/api/tests/`. That
path is outside this issue's scope, and the verify script's tests command does not run `terraform test` on
`modules/api`. The guard runs inside the `validate` that the gate and CI already run, so it needs no new
runner. A `terraform test` that asserts the planned `authorization_type` and the stage `route_settings` values
is still a reasonable follow-up.

Files changed:
- `infra/modules/api/gateway.tf`: the route guard locals.
- `docs/delivery/r24x-issues/F06-route-guard-test.sh`: the mutation test (fails on base, passes after the fix).
- `docs/delivery/r24-issues/P01-notes.md`: corrects the note that the checks it listed gated the route.
- `infra/README.md` §6: change-log line.
- `docs/delivery/r24x-issues/F06-fixes.md`: this ledger.

Test: `bash docs/delivery/r24x-issues/F06-route-guard-test.sh`, plus the F06 gate
(`terraform fmt -check -recursive infra`, offline `init` + `validate` of `infra/envs/prod`,
`python3 infra/scripts/check-agent-routes.py`).
