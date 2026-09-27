# infra — Terraform for RecallSmith / DeveloperCards prod

Adoption-first infrastructure as code. E01 creates this skeleton and adopts every
existing production resource under its current name/id; nothing in AWS changes in
E01. Later Wave E issues extend these modules and are gated by `scripts/check-plan.py`.

## 1. Layout

```
infra/
  README.md                 this file
  RUNBOOK.md                adopt -> plan -> apply -> cleanups -> second-plan-empty
  .gitignore
  bootstrap/placeholder.zip  one 0-byte "README" entry; filename for every managed function
  scripts/check-plan.py     plan allow-list checker (python3 stdlib only)
  envs/prod/                the only prod root: versions, providers, backend, variables,
                            outputs, main, imports, prod.auto.tfvars.example, lock
  modules/
    identity/  IAM execution roles + Cognito (strings only, no cycles)
    data/      RDS + content/premium buckets + network data sources
    edge/      CloudFront x2, OACs, WAF (aws.use1), content bucket policy, console bucket
    api/       HTTP API, integrations, routes, authorizer, stages, core-vpc + edge-public
    worker/    SQS + worker function + event source mapping
    observability/ budget (E01); alarms/dashboard/trail arrive in E02/E04/E12
```

Module dependency direction (no cycles): `identity -> data -> edge -> api, worker -> observability`.
`identity` takes only strings and never reads another module's output.

## 2. WORKER SAFETY RULE

a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out
and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing),
`aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans
after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json)
against an explicit allow-list of resource addresses and actions — nothing else may appear as
create/update/delete.

`import {}` blocks in `.tf` files are configuration and allowed; the `terraform import` command is
not. `aws sts get-caller-identity`, `aws iam get-role`, `aws lambda get-policy`,
`aws s3api get-bucket-policy`, `aws budgets describe-*` are read-only and allowed.

## 3. Gates

Export `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"` so `init` reuses the pinned
hashicorp/aws 6.66.0 provider.

Root gate (validate only):

```
cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..
```

`..` from `envs/prod` reaches only `infra/envs`, so also run from the repo root:

```
terraform fmt -check -recursive infra
```

Worker plan recipes (read-only, `AWS_PROFILE=dev`, never `apply`):

(a) empty local state — E01–E05 (prod) and every staging-root plan. Write the gitignored
`infra/envs/prod/backend_override.tf` containing `terraform { backend "local" { path =
"<absolute path under $TMPDIR>/terraform.tfstate" } }`, then
`terraform init -input=false -reconfigure` -> `terraform plan -out=<tag>.tfplan` ->
`terraform show -json <tag>.tfplan | python3 infra/scripts/check-plan.py --plan - --allow
docs/delivery/r16-issues/<TAG>.plan-allow.json`, then delete the override.

(b) real backend, read-only — E06 onward (prod). `terraform init -input=false -reconfigure`
with the committed `backend.tf`, then `terraform plan -lock=false -input=false -out=<tag>.tfplan`
-> `terraform show -json` -> `check-plan.py`. An empty local state cannot show deletes and
re-plans earlier issues' creates, so from E06 the prod plan reads the real state read-only.

## 4. What is in state

Lands in state and is accepted (documented, admin-only, SSE-S3 encrypted): the Lambda
`environment` variables of the three adopted functions (names may be listed; values never), the
Snowflake `sts:ExternalId` (a `variable` with no default; AWS does not treat it as a secret), and
from E06 the SSM parameter placeholder values.

Never in state: the RDS master password (`password` is never set on `aws_db_instance`; rotation is
a CLI `modify-db-instance` by the supervisor), any real SSM SecureString value
(`ignore_changes = [value]`), `EXPO_TOKEN`. State is encrypted at rest in S3 (`encrypt = true`,
SSE-S3) and readable only by the admin principal.

## 5. Supervisor procedure

After merge, the supervisor (never a worker):

1. Creates the backend bucket `recallsmith-tfstate-622994489535` by CLI (versioning Enabled,
   PAB x4, SSE-S3, BucketOwnerEnforced, lifecycle noncurrent 90 d, deny non-TLS).
2. `terraform init -reconfigure` with the real backend (no override file present).
3. `terraform plan -out=e01.tfplan`.
4. `terraform show -json e01.tfplan | python3 infra/scripts/check-plan.py --plan - --allow docs/delivery/r16-issues/E01.plan-allow.json`.
5. `terraform apply e01.tfplan` (state-only; the RDS update never reaches ModifyDBInstance).
6. A second `terraform plan` checked with no `--allow`, which must print `PLAN EMPTY` before the
   next issue starts.

## 6. Change log

- 2026-09-22 E01 — adopted 93 resources (imports only); plan = 93 imports + 1 provider-side RDS update; no AWS change.
- 2026-09-22 E02 — safety switches: RDS deletion protection + 14-day backups, S3 versioning + noncurrent-90d lifecycle, log retention 90/30 d, multi-region CloudTrail into a locked bucket, budget $60, provider default_tags; devcards-content-dev: deletion pending owner OK (E00 §6 #15).
- 2026-09-2x E03: DLQ developercards-publish-jobs-dlq (14 d) + redrive 3, publish queue visibility 3700 s, ESM → worker-lambda:prod with ReportBatchItemFailures and window 0; outputs publish_dlq_arn/publish_dlq_name.
- 2026-09-22 E04: SNS developercards-alerts (+email, policy), 12 alarms, RDS event subscription, API access log /aws/apigateway/developercards-api (30 d) + detailed metrics on both stages, dashboard developercards-prod; code: JSON Log lines, Log.Event, EMF namespace DeveloperCards, EmitGauge OutboxPending.
- 2026-09-22 E05: worker-lambda moved to developercards-worker-lambda-role; core-vpc-role-joizyiwt lost AmazonEC2FullAccess/AmazonRDSFullAccess/AmazonSQSFullAccess/AmazonS3FullAccess/AWSLambdaSQSQueueExecutionRole; snowflake-recallsmith-s3-role lost AmazonS3FullAccess; six import blocks dropped from envs/prod/imports.tf (87 remain). Supervisor: publish-version + update-alias prod on worker-lambda right after apply.
- 2026-09-23 E06: identity/ssm.tf — five SecureString placeholders /developercards/prod/{pg-password,migrate-secret,internal-shared-secret,rc-webhook-auth-production,rc-webhook-auth-development}; values by supervisor put-parameter (ignored by state); deploy.sh injects them at deploy time.
- 2026-09-26 E08: second JWT authorizer cognito-jwt-mobile (mobile pool) beside cognito-jwt; the ANY /{proxy+} route split by prefix so console prefixes ($default, proxy, authoring, admin, publish jobs, edge ai/billing/admin-cognito) demand a console token and mobile prefixes (sync, draw-state, user, premium, me, entitlements, premium-url and premium-url-dev) demand a mobile token, while /health and the two RevenueCat webhooks stay unauthenticated; the three duplicate core-vpc integrations collapsed to one and their two adopted duplicate-integration import blocks dropped from envs/prod/imports.tf (85 remain); stage default throttles unchanged (still the validated variables) plus lower per-route throttles on sync and draw-state (40/20) and the webhooks (20/10, 10/5); reserved concurrency 40 / 2 on core-vpc / worker-lambda; console pool MFA ON (TOTP), tokens 1 h / 1 h / 30 d, localhost callbacks moved onto a new console-dev client. Owner enrols TOTP at next login. console-dev client id: `5au94igdq00nipsst7spsqepb7` (supervisor, 2026-09-26).
- 2026-09-26 E09: zone Z0284954BSN00C8BF94Q adopted (registrar-created); ACM wildcard certs (us-east-1 + ap-southeast-2); api./cdn./console. + apex/www records; site bucket developercards-site-622994489535 + distribution; spa callbacks + CORS gain console.developercards.app. site_distribution_id `EML9BSZ8EXMQ1` (supervisor, 2026-09-26).
- 2026-09-27 J05 — outbound webhooks: SQS developercards-webhook-events (visibility 180 s, 4 d) + DLQ developercards-webhook-events-dlq (14 d, redrive 5); Python Lambda developercards-webhook-dispatcher (python3.12/arm64, outside the VPC, reserved concurrency 2, placeholder code, alias prod, ESM batch 1 / max concurrency 2 / ReportBatchItemFailures); role developercards-webhook-dispatcher-role reading exactly /developercards/prod/webhook-signing-secret and /developercards/prod/internal-shared-secret; send-only grants developercards-core-vpc-webhooks-send and developercards-worker-webhooks-send; SecureString placeholder /developercards/prod/webhook-signing-secret; route POST /api/internal/webhooks/{proxy+} (NONE, 20/10 on both stages); alarms webhook-dlq-nonempty and webhook-dispatcher-errors; code: merge-env.sh SSM_NOT_ENV, prod.env.json WEBHOOK_EVENTS_QUEUE_URL. Supervisor after apply: set the signing secret with put-parameter (random 32-byte hex); deploy the dispatcher code with services/deploy-python-lambda.sh at release.
- 2026-09-27 J06 — local MCP server auth: console JWT authorizer cognito-jwt audience gains the console-dev client (`console_extra_audiences = [module.identity.console_dev_client_id]` beside the SPA client); console-dev gains callback `http://localhost:8976/callback` and logout `http://localhost:8976/` (5173 entries kept first); `src_C/env/prod.env.json` AUTH_CONSOLE_CLIENT_IDS binds both clients (SPA, console-dev). core-vpc honours the binding only after the release deploy of core-vpc; mobile authorizer, SPA client and pool unchanged.
- 2026-09-27 J15 — AI QA: SQS developercards-ai-qa-jobs (visibility 3600 s, 4 d) + DLQ developercards-ai-qa-jobs-dlq (14 d, redrive 2: one retry, then the DLQ); Python Lambda developercards-ai-qa (python3.12/arm64, 512 MB / 600 s, reserved concurrency 2, outside the VPC, placeholder code, alias prod, ESM batch 1 / max concurrency 2 / ReportBatchItemFailures); role developercards-ai-qa-role with policy developercards-ai-qa-scoped, Sids SqsConsume, Logs, SsmRead (exactly /developercards/prod/anthropic-api-key and /developercards/prod/internal-shared-secret), BedrockMantleInference, BedrockInvokeProfile, BedrockInvokeFoundationModel — the only Bedrock grant in the account: Mantle CreateInference on project/* in ap-southeast-2 plus InvokeModel/InvokeModelWithResponseStream on the global.anthropic.claude-opus-5 inference profile, with the anthropic.claude-opus-5 foundation models reachable only through it (bedrock:InferenceProfileArn condition); send-only grant developercards-core-vpc-ai-qa-send (the worker gets none); SecureString placeholder /developercards/prod/anthropic-api-key (skipped by merge-env.sh SSM_NOT_ENV); route POST /api/internal/ai-qa/{proxy+} (NONE, 20/10 on both stages); alarms ai-qa-dlq-nonempty and ai-qa-errors; code: prod.env.json AI_QA_QUEUE_URL. The function is created with AI_QA_ENABLED=0. Owner steps (§7.9): provider access (Bedrock use-case form, or AI_PROVIDER=anthropic with the key put into the placeholder) and the flag flip after the eval gate; the ai-qa code deploys with services/deploy-python-lambda.sh at release.
