# RUNBOOK — RecallSmith / DeveloperCards infra

## 1. Adopt (E01, once)

E01 writes `imports.tf` with 93 `import {}` blocks that adopt every existing production resource
under its current name/id. The only plan is state-only: 93 `importing` entries, all `no-op` except
one provider-side `update` on the RDS instance (`apply_immediately`, `skip_final_snapshot`,
`final_snapshot_identifier` — attributes that never reach `ModifyDBInstance`), plus the root
outputs appearing as `create` because the worker plans against an empty local state. The supervisor
creates the state bucket and applies after merge (see README §5). `imports.tf` stays in `envs/prod`
for the whole wave; deleting it is the first post-wave chore.

## 2. Plan (every issue)

Read-only, `AWS_PROFILE=dev`, never `apply`/`import`. For E01–E05 (prod) and every staging root,
use an empty local state via a gitignored override:

1. Write `infra/envs/prod/backend_override.tf`:
   ```hcl
   terraform {
     backend "local" {
       path = "<absolute path under $TMPDIR>/terraform.tfstate"
     }
   }
   ```
   (Terraform's `_override.tf` merge replaces the `backend` block; the S3 bucket is never contacted.)
2. `terraform -chdir=infra/envs/prod init -input=false -reconfigure`.
3. Supply the Snowflake ExternalId read-only:
   `TF_VAR_snowflake_external_id="$(aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text)"`.
4. `terraform -chdir=infra/envs/prod plan -input=false -out=<tag>.tfplan`.
5. `terraform -chdir=infra/envs/prod show -json <tag>.tfplan > <tag>.plan.json`.
6. `python3 infra/scripts/check-plan.py --plan <tag>.plan.json --allow docs/delivery/r16-issues/<TAG>.plan-allow.json` (run from repo root).
7. Remove `infra/envs/prod/backend_override.tf` and the plan files.

From E06 the prod plan reads the real backend read-only (`init -reconfigure` with the committed
`backend.tf`, `plan -lock=false`); the override recipe stays for the staging roots.

## 3. Apply (supervisor only)

`terraform init -reconfigure` with the real backend (no override file), then
`terraform plan -out=<tag>.tfplan`, the allow-list check, `terraform apply <tag>.tfplan`, the
issue's post-apply CLI cleanups, and the second plan (§5).

## 4. Post-apply cleanups

Supervisor CLI after each apply (never a worker, never a file in git): stray log groups, stale
secrets, unattached policies, old Lambda versions / provisioned concurrency / SnapStart, and the
stray aliases are removed by `aws ... delete-*`. E01 itself has no cleanups; nothing in AWS changes.

## 5. Second plan must be empty

After apply the supervisor runs a second `terraform plan` and checks it with no `--allow`; it must
print `PLAN EMPTY` (every entry `no-op`, nothing importing, no effective output change) before the
next issue's worker may reach its verify.

## 6. Drift you will see

- Lambda alias versions move with every `src_C/deploy.sh` run; they are ignored via
  `ignore_changes = [function_version, description]` on each alias and
  `ignore_changes = [..., publish, environment, description]` on each function.
- `engine_version = "17.9"` must be reconciled by hand after an RDS auto-minor upgrade.
- Provisioned concurrency, Lambda versions and SnapStart are not state.
- `aws_cognito_user_group.editor.role_arn` names a role that does not exist
  (`developercards-api-role-l4jacdsb`); it stays dangling in E01 (nulling it is E08).
- `imports.tf` stays until the wave ends; blocks are removed only by the issue that destroys an
  adopted resource (E05, E08), never added to.
