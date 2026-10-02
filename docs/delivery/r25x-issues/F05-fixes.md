# F05 (R25X) — review fixes: analytics export retention

Issue #705. Base `delivery/r25x-p`. Findings on P02 (`docs/delivery/r25-issues/P02-notes.md`, #695) plus the supervisor items.
Every check here is offline: no `terraform plan` or `apply` against AWS was run.

Test: `bash docs/delivery/r25x-issues/F05-retention-test.sh` (from the repo root). It needs terraform and the providers
pinned in `infra/envs/prod/.terraform.lock.hcl`, works on a temp copy of `infra/`, and prints `F05 RETENTION OK`.
The brief's scope allows no new file under `infra/` other than `*.tf`, so the `terraform test` file lives here
(`F05-lifecycle.tftest.hcl`) and the script copies it into `modules/data/tests/` of the temp copy.

### p-correctness-1
Status: fixed
- Confirmed: `infra/scripts/check-plan.py` declares `--plan` with `required=True` and reads stdin only for `--plan -`.
  Run as written against a synthetic plan, the P02 owner step exits 2 with
  `check-plan.py: error: the following arguments are required: --plan` (first run of the test, before the fix).
- Fix: `docs/delivery/r25-issues/P02-notes.md` owner step 1 now reads
  `terraform show -json p02.tfplan | python3 infra/scripts/check-plan.py --plan - --allow docs/delivery/r25-issues/P02.plan-allow.json --summary`,
  with a correction note.
- Test: `F05-retention-test.sh` part 1 extracts every check-plan.py command from P02-notes.md, runs it as written with
  `terraform show -json …` replaced by `cat <synthetic plan>`, and requires `PLAN OK 1` for the expected one-update plan and
  `PLAN VIOLATION: unlisted update` for a plan with one extra change. Failed before the fix (exit 2), passes after.

### p-security-1
Status: fixed
- Same defect as p-correctness-1 (same line of P02-notes.md, the reviewer's line number differs). Fixed by the same edit,
  which also adds the suggested `--summary`; same test.

### p-tests-1
Status: fixed
- Same defect as p-correctness-1; same edit and test. The command now matches the `--plan -` convention of
  `infra/README.md` and `docs/delivery/r24-issues/P01-notes.md`.

### p-tests-2
Status: fixed
- Confirmed: on the base the only failing-first check was the grep for `analytics-raw-400d`; fmt and validate accept any
  prefix or day count, nothing checked that `noncurrent-90d` was unchanged, and `P02.plan-allow.json` was never run
  against a plan. E.g. prefix `analytics/` (which would expire `analytics/marts/`) kept every gate green.
- Fix (tests only; `infra/modules/data/buckets.tf` is correct and unchanged):
  - `docs/delivery/r25x-issues/F05-lifecycle.tftest.hcl` — plan-mode `terraform test`, `mock_provider "aws"` (the
    `aws_kms_alias` data source gets an ARN-shaped default because rds.tf validates it). Asserts: the content bucket has
    exactly the rules `noncurrent-90d`, `analytics-raw-400d` in that order; `noncurrent-90d` enabled, no and/tag filter,
    noncurrent 90, abort multipart 7, no expiration or transitions; `analytics-raw-400d` enabled, prefix `analytics/raw/`,
    expiration 400 days (no date), noncurrent 30, no multipart abort, no transitions; premium keeps its single
    `noncurrent-90d` (90 / 7, no expiration).
  - An unset filter prefix is unknown at plan time, so `filter {}` cannot be asserted in the tftest; the script also
    compares the `noncurrent-90d` block text with the original block, byte for byte.
  - Ten mutations of buckets.tf must each fail (all do): prefix widened to `analytics/`, 400 → 40 days, raw noncurrent
    30 → 90, rule id renamed, rule disabled, multipart abort dropped from `noncurrent-90d`, content noncurrent 90 → 60,
    a prefix on `noncurrent-90d`'s filter, the raw rule removed, a 400-day expiration added to premium.
  - check-plan.py runs: `P02.plan-allow.json` admits the synthetic one-update plan (`PLAN OK 1`) and rejects an extra
    update and a replace of the lifecycle resource.
- `docs/delivery/r25-issues/P02-notes.md` "How it is tested" gains a correction saying what the original checks did not cover.

## Supervisor items

### Notifier reads the RevenueCat secret key
- `infra/modules/identity/roles_r18a.tf`: `aws_iam_role_policy.notifier` statement `SsmRead` (the one that grants
  `notify-recipient`) adds `${local.ssm_param_prefix}/revenuecat-secret-api-key`, i.e.
  `arn:aws:ssm:<region>:<account>:parameter/developercards/prod/revenuecat-secret-api-key`, action `ssm:GetParameter`
  only. No KMS statement: the file's header records that the notifier's SecureStrings use the AWS-managed `aws/ssm` key,
  whose key policy already allows decrypt through SSM, and notify-recipient is granted the same way.
- The parameter itself is not a Terraform resource (contract R25-00 §4: the owner creates it); the grant on a missing
  parameter is harmless and the notifier skips its step when the parameter is absent.

### API Gateway routes for core's new internal routes
- Today the notifier reaches core-vpc's internal routes through the HTTP API with one exact `auth = "none"` route per
  path (`POST /api/internal/automation/tick`, `…/notifications/report`; X08: exact keys, never `{proxy+}`), and core-vpc
  checks the HMAC signature. Any other path falls to `ANY /{proxy+}` with the console JWT, so the notifier's calls, which carry
  no JWT, would get 401 without new routes. So routes are needed.
- `infra/modules/api/gateway.tf` adds, the same way, `internal_revenuecat_deletions` = `GET /api/v1/internal/revenuecat-deletions`
  and `internal_revenuecat_deletions_report` = `POST /api/v1/internal/revenuecat-deletions/report`, both `core_vpc` / `none`,
  with `route_throttles` burst 20 / rate 10 (as the other internal callbacks) on both stages. The route guard in the same
  file accepts them (exact keys, throttle keys have routes); the `?limit=50` query string does not affect route matching.
- Paths are the ones the R25X F04 brief specifies for core. If F04 ships different paths (the older internal routes use
  `/api/internal/…`), these two route keys and throttle keys must be renamed to match before the plan.

### Plan allow-list
`docs/delivery/r25x-issues/F05.plan-allow.json` (P02's allow file is unchanged): exactly six changes —
`module.data.aws_s3_bucket_lifecycle_configuration.content` update `rule` (P02); `module.identity.aws_iam_role_policy.notifier`
update `policy`; creates of `module.api.aws_apigatewayv2_route.this["internal_revenuecat_deletions"]` and
`["internal_revenuecat_deletions_report"]`; `module.api.aws_apigatewayv2_stage.default` and `.dev` update `route_settings`.
`tags_only_updates` false. The test proves it admits that synthetic plan (`PLAN OK 6`) and rejects an extra update, a missing
route (stale entry) and a lifecycle update that also changes `bucket`.

## Owner / supervisor steps (never run by workers)
1. After F04 and F05 are merged: `terraform plan -out=f05.tfplan` in `infra/envs/prod`, then
   `terraform show -json f05.tfplan | python3 infra/scripts/check-plan.py --plan - --allow docs/delivery/r25x-issues/F05.plan-allow.json --summary`.
   Expected: `PLAN OK 6`, 2 to add, 4 to change, 0 to destroy.
2. Apply the saved plan with or after the core-vpc release that serves the two routes; a second plan must be empty.
3. Check: `aws s3api get-bucket-lifecycle-configuration --bucket core-vpc` lists `noncurrent-90d` and `analytics-raw-400d`.

## Gates run
- `bash docs/delivery/r25x-issues/F05-retention-test.sh` — pass (`F05 RETENTION OK`).
- `terraform fmt -check -recursive infra`, `terraform -chdir=infra/envs/prod init -backend=false -input=false -lockfile=readonly`
  + `validate`, `python3 infra/scripts/check-agent-routes.py` — pass (the new routes are `auth = "none"`; the agent route set is unchanged).
