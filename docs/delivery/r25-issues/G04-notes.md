# G04 — RevenueCat customer record deleted with the account

Issue #694 (G04), revised by #704 (R25X F04). Contract `R25-00-contracts.md` §4.

## Revised in R25X F04: core queues, the notifier calls RevenueCat

The first version (G04) called RevenueCat from core-vpc right after the deletion. That cannot work: core-vpc is a VPC
Lambda with no egress (no NAT gateway, internet gateway or VPC endpoint; `infra/modules/worker/ai_qa.tf` "core-vpc has no
egress"), so with the key set every deletion would have waited ~10 s for two timeouts and deleted nothing. A NAT gateway
was rejected for cost. F04 follows the existing out-of-VPC pattern (the notifier, like the dispatcher):

1. **core-vpc never calls RevenueCat.** `RevenueCatCustomerDeletion.cs` (the HTTP call) is removed, and deploy.sh no
   longer maps the key to core-vpc.
2. **Queue (migration `044_revenuecat_deletions.sql`).** Table `revenuecat_deletions (sub text primary key,
   requested_at timestamptz not null default now(), attempts int not null default 0, last_status int null,
   last_attempt_at timestamptz null)`. Additive and idempotent, no extension. `AccountDeletion.DeleteUserDataAsync` inserts
   the caller's sub (`on conflict do nothing`) **in the same transaction** as the deletion, so a rolled-back deletion
   queues nothing. Before 044 the insert is skipped (checked with `to_regclass` first, like `card_reports`).
3. **Internal routes on core-vpc** (`src_C/Vpc/Runtime/RevenueCatDeletions.cs`), verified exactly like the notifier's tick
   and report routes: `Auth.VerifyInternalSignatureStrict` against `INTERNAL_SECRET_NOTIFIER` (+`_PREVIOUS`):
   - `GET /api/v1/internal/revenuecat-deletions?limit=50` → `data.subs`: subs with `attempts < 10` requested within
     30 days, oldest first; `limit` 1..50 (default 50, larger values are capped, anything else is 400). The GET has an
     empty body, so the signature covers `"<ts>."`.
   - `POST /api/v1/internal/revenuecat-deletions/report` with `[{"sub": "...", "status": <int 100..599> | null}]` (at most
     50 items) → 2xx or 404 deletes the row; anything else (null = timeout or network error) sets
     `attempts = attempts + 1`, `last_status`, `last_attempt_at = now()`. Answers `{deleted, retried, unknown}`.
   - Both 503 before migration 044. RouteMetrics labels both paths exactly.
4. **Retention.** The tick's own `revenuecat_deletions_retention` step (next to `anon_funnel_retention`) deletes rows
   requested more than 30 days ago, whatever their state, so a sub never outlives the account by more than 30 days. Like
   every tick step it runs only while the automation mode is not `off`.
5. **Notifier** (`services/notifier/src/notifier/revenuecat.py`). On `{"job":"tick"}`, after forwarding the tick to core
   (whatever core answered), it reads the SecureString `/developercards/prod/revenuecat-secret-api-key` lazily (cached
   300 s like the other leaves; missing, unreadable, blank or placeholder ⇒ the whole step is skipped and logs
   `outcome=skipped_no_key`), fetches the pending subs, calls `DELETE https://api.revenuecat.com/v1/subscribers/{quoted sub}`
   with `Authorization: Bearer <key>` and a 5 s timeout per call (stdlib `urllib`), and posts every status back in one
   report. No in-process retry: core counts the attempt and the next tick (15 min) tries again, up to 10 attempts. A call
   is started only while at least 17 s of the Lambda's time remain; the rest waits for the next tick. A failed tick still
   runs the step and still raises afterwards. The digest job does not run it.
6. **Logs.** Core logs counts only (`account-delete` gains `revenueCatQueued`; the report logs
   `{tag: revenuecat_delete, outcome: reported, deleted, retried, unknown}`; retention logs `outcome: expired, rows`). The
   notifier logs `{event: revenuecat_delete, outcome: done, pending, deferred, deleted, not_found, failed, reported}`, or
   `skipped_no_key` / `pending_failed` / `report_failed` / `error`. Never the key, a sub (raw or escaped), a URL or a
   RevenueCat body.

Personal data: the sub stays in `revenuecat_deletions` after the account is gone, only until RevenueCat confirms (2xx/404)
or for at most 30 days. It is the identifier RevenueCat needs; nothing else about the user is kept.

## Files

- `src_C/Vpc/Db/Migrations/044_revenuecat_deletions.sql` (new)
- `src_C/Vpc/Runtime/RevenueCatDeletions.cs` (new); `src_C/Vpc/Runtime/RevenueCatCustomerDeletion.cs` (removed)
- `src_C/Vpc/Runtime/AccountDeletion.cs` (queue insert in the transaction; no outbound call)
- `src_C/Vpc/VpcFunction.cs` (exact-match dispatch of the two routes), `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs`
- `src_C/Vpc/Automation/AutomationTick.cs` (`revenuecat_deletions_retention` step)
- `src_C/deploy.sh`: the G04 mapping is gone. The leaf is added to `SSM_NOT_ENV` (it lives under the same SSM path, and an
  unmapped leaf is otherwise a hard error) and `REVENUECAT_SECRET_API_KEY` to `SSM_OPTIONAL_ENV` with no mapping, so every
  injecting deploy removes a stale copy the G04 mapping may have left on core-vpc. The key can no longer reach core-vpc.
- `services/notifier/src/notifier/revenuecat.py` (new), `handler.py` (tick step), `internal_client.py` (signed `get`)
- Tests: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenueCatDeleteTests.cs` (rewritten),
  `services/notifier/tests/test_revenuecat.py` (new), `services/notifier/tests/conftest.py` (fake core answers GET and the
  two new routes)

## How it is tested

`dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~AccountDeletion|FullyQualifiedName~RevenueCat|FullyQualifiedName~DeleteMe"`
(real Postgres):

- DELETE me → 204, user gone, one queue row (attempts 0), `revenueCatQueued = 1`, no `revenuecat_delete` call line, the sub
  never in the captured output. A second deletion keeps the existing row.
- Rolled-back deletion (a trigger raises on the users delete for that sub) → user still there, nothing queued.
- GET: unsigned, wrong secret, unset `INTERNAL_SECRET_NOTIFIER` → 403; POST → 405; oldest first; attempts ≥ 10 and rows
  older than 30 days left out; `limit=2`, `limit=500` capped, default 50 of 55; `0`/`-1`/`abc` → 400.
- Report: auth as above; 200/204/404 delete; 503/401/null count an attempt with `last_status` and `last_attempt_at`;
  an unknown sub is counted; non-array, missing/empty sub, string or out-of-range status, more than 50 items → 400.
- Retention deletes only rows older than 30 days (exhausted or not); the tick registers the step.
- deploy.sh: with the leaf under the path, `ssm_to_env` skips it without error and the key never reaches core-vpc's
  secrets; a stale `REVENUECAT_SECRET_API_KEY` is dropped from the live environment.

`cd services/notifier && uv run --python 3.12 pytest -q` (fake urlopen for RevenueCat, loopback fake core that verifies the
HMAC): 200/204 deleted, 404, 500/401 failed and reported, timeout and connection reset reported as `null`, missing /
placeholder / blank key skips the whole step (no GET), exact signed report payload, empty queue, GET failure, report
failure, low remaining time defers, digest does not run it, failed tick still runs it and still raises. Every case checks
the output never contains the key, a sub (raw or quoted) or the body.

## Owner steps (not done by any worker)

1. Infra (the infra wave; not edited here):
   - API Gateway: the notifier reaches core through the public gateway (`CORE_API_BASE`), and `infra/modules/api/gateway.tf`
     only lets exact internal keys through without the console JWT. Two routes are needed, like the existing
     `internal_automation_*` rows: `GET /api/v1/internal/revenuecat-deletions` and
     `POST /api/v1/internal/revenuecat-deletions/report` (integration `core_vpc`, auth `none`, a throttle row each).
     Until then the request falls to the JWT-protected `ANY /{proxy+}` route, the notifier logs `pending_failed` every tick and nothing is deleted.
   - Notifier role (`infra/modules/identity/roles_r18a.tf`): `ssm:GetParameter` on
     `/developercards/prod/revenuecat-secret-api-key`. Until then the read fails and the step logs `skipped_no_key`.
2. Run migration 044 (console Migrate button) after the core deploy.
3. Create the SecureString `/developercards/prod/revenuecat-secret-api-key` with the RevenueCat **secret** API key (v1).
   Never in a file or argv. Core-vpc does not need a redeploy for it; deploy.sh skips the leaf.
4. Deploy the notifier (`services/deploy-python-lambda.sh notifier`) and core (`src_C/deploy.sh`), then check CloudWatch
   for `revenuecat_delete` lines after the next account deletion.

## Deferred

- No backfill for accounts deleted before this ships; their RevenueCat customer records remain until removed by hand.
- No Terraform resource for the SSM leaf; the owner creates it.
- deploy.sh still passes core-vpc's merged environment (the other secrets) as an `--environment` argv value; this predates
  R25 and no longer includes any RevenueCat key (see `docs/delivery/r25x-issues/F04-fixes.md`, v-security-3).
