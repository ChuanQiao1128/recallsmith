# P03 (R26) — Infra: Snowflake IAM role and the outbox alarm/widget retired

Issue #714. Contract `R26-00-contracts.md` §3. Code only: nothing was planned against AWS or applied.

## What changed (files)

| File | Change |
|---|---|
| `infra/modules/identity/main.tf` | Removed `aws_iam_role.snowflake` (`snowflake-recallsmith-s3-role`), `aws_iam_policy.snowflake_read` (`snowflake-recallsmith-s3-read`), `aws_iam_role_policy_attachment.snowflake["read"]`. |
| `infra/modules/identity/variables.tf` | Removed variable `snowflake_external_id`. |
| `infra/modules/identity/outputs.tf` | Removed output `snowflake_role_arn` (no root output used it). |
| `infra/modules/identity/policies.tf` | `aws_iam_role_policy.core_vpc` (developercards-core-vpc-scoped) Sid `S3Content`: resource `core-vpc/analytics/*` removed; `core-vpc/content/*` kept. Only OutboxPublisher (PutObject to `analytics/raw/review_events`) and ContentIntelligenceSnapshotImport (GetObject from `analytics/marts/...`) used that prefix; R26 S01 removes both. |
| `infra/envs/prod/main.tf`, `variables.tf` | Removed the `snowflake_external_id` variable and its wiring into `module.identity`. |
| `infra/envs/prod/imports.tf` | Removed the three Snowflake import blocks (89 import blocks remain in this file). |
| `infra/envs/prod/prod.auto.tfvars.example` | Removed the Snowflake line and its comment. |
| `infra/modules/observability/alarms.tf` | Removed `aws_cloudwatch_metric_alarm.outbox_backlog` (`developercards-prod-outbox-backlog`). |
| `infra/modules/observability/dashboard.tf` | Removed the `OutboxPending` widget; "Latency p95 by Route (top 10)" now spans the row (x 0, width 24). |
| `infra/RUNBOOK.md` | §2 step 3 no longer exports `TF_VAR_snowflake_external_id`. |
| `infra/README.md` | §4 no longer lists the ExternalId as state content; §6 change-log line for P03. |
| `infra/scripts/tests/test_r26_snowflake_retired.py` | New offline unittest (see below). |
| `infra/modules/observability/tests/outbox_retired_r26.tftest.hcl` | New offline `terraform test` (mocked aws provider). |
| `docs/delivery/r26-issues/P03.plan-allow.json` | Exact allow-list for the supervisor's plan. |

Kept on purpose: `module.data` lifecycle rule `analytics-raw-400d` (it expires the exports already in the bucket).

## Exact surface (expected plan)

`docs/delivery/r26-issues/P03.plan-allow.json`, `tags_only_updates: false`, no output changes:

- delete `module.identity.aws_iam_role.snowflake`
- delete `module.identity.aws_iam_policy.snowflake_read`
- delete `module.identity.aws_iam_role_policy_attachment.snowflake["read"]`
- delete `module.observability.aws_cloudwatch_metric_alarm.outbox_backlog`
- update `module.identity.aws_iam_role_policy.core_vpc`, key `policy`
- update `module.observability.aws_cloudwatch_dashboard.prod`, key `dashboard_body`

Terraform orders the attachment delete before the role and policy deletes (dependency graph), so
`force_detach_policies = false` on the role does not block it.

## How it is tested

Tests were committed first and failed on the base (5 failures + 1 error in the unittest, 1 failed run in `terraform test`).

- `python3 -m unittest discover -s infra/scripts/tests -v` (CI `python` job): no `snowflake` in any `infra/**/*.tf`
  or the tfvars example; no `TF_VAR_snowflake_external_id` in the RUNBOOK; no `OutboxPending`/`outbox_backlog` in any
  `.tf`; the core_vpc policy has no `analytics/` resource and keeps `content/*`; `analytics-raw-400d` still exists;
  the allow-list equals the six entries above exactly and declares no `outputs`; `check-plan.py` run on a synthetic
  plan with exactly those changes passes (`PLAN OK 6`), and an extra key on core_vpc or the dashboard, an extra
  delete, a tags-only update, a missing delete, a replace or an output change each exit 1 (R26X F03); the RUNBOOK §9
  and its core-vpc rollback section state the deploy order, roll-forward-only and `confirmDestructive`; every path
  these notes name exists.
- `terraform -chdir=infra/modules/observability test` (CI `infra` job): the dashboard body has no widget mentioning
  `OutboxPending`, and the p95-by-route widget spans row y 24.
- `terraform fmt -check -recursive infra`, `terraform -chdir=infra/envs/prod validate` (offline init),
  `python3 infra/scripts/check-agent-routes.py`, and `docs/delivery/r26-issues/P03.verify.sh` (committed in R26X F03;
  it sources the delivery skill's `verify-lib.sh` and needs `BASE` exported, so it runs on the supervisor's host, not
  in CI; its targeted tests are the line above).

## Owner / supervisor steps

1. Deploy the core-vpc R26 build (S01: no OutboxPublisher, no content-intelligence import) first, and confirm it is the
   prod alias target with the read-only check in `infra/RUNBOOK.md` §9 step 1. If this apply ran first, the old
   publish and import routes would get AccessDenied on `analytics/*`; nothing else uses that prefix. This order is a
   documented gate, not a machine check: the plan is identical either way.
2. `terraform plan -lock=false` against the real backend (RUNBOOK §2), then
   `terraform show -json <tag>.tfplan | python3 infra/scripts/check-plan.py --plan - --allow docs/delivery/r26-issues/P03.plan-allow.json`.
   No `TF_VAR_snowflake_external_id` is needed any more.
3. Apply, then a second plan that must print `PLAN EMPTY`.
4. Once migration 045 has run, roll forward only (RUNBOOK §9, "Rollback of core-vpc (R26)").
5. Optional: unset any `TF_VAR_snowflake_external_id` in local shells and drop it from a local `prod.auto.tfvars`
   (an undeclared variable in a tfvars file only warns).

## Deferred

- Objects already under `core-vpc/analytics/raw/` are left to the `analytics-raw-400d` rule; deleting them now is an
  owner choice (`aws s3 rm --recursive`), not part of this issue.
- Historical `docs/delivery/r16-issues/E*.verify.sh` scripts still grep for the old Snowflake/outbox blocks; they are
  past-round artifacts outside this issue's scope and are not run by CI.
- Snowflake account-side cleanup (storage integration, stage, the trial account) is outside AWS/Terraform.
