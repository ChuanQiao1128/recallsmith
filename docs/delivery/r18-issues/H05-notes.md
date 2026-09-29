# H05 — X-Ray write grants, `Active` tracing on six functions, the synthetic check's infra (#517)

Builds on H04 (#516): `services/synthetic-check/env/prod.env.json` is the create-time environment of the new
function (the root `synthetic_check_environment` map equals it key for key).

## Base plan (before any edit)

Read-only mode (b) plan of the untouched branch point (`terraform init -input=false -reconfigure`,
`terraform plan -lock=false -input=false`, AWS_PROFILE=dev, alert_email resolved read-only from the budget
notification into a temp var file that was deleted): `No changes. Your infrastructure matches the configuration.`
No prod drift.

## Changes

| File | What |
|---|---|
| `infra/modules/identity/roles_r18h.tf` (new) | `aws_iam_role_policy.xray_write` (for_each over the seven roles, `developercards-xray-write`), `aws_iam_role.synthetic_check`, `aws_iam_role_policy.synthetic_check` (Logs only), `aws_iam_role_policy.synthetic_scheduler` (on the automation scheduler role, the synthetic check's `:prod` alias only) |
| `infra/modules/identity/variables.tf`, `outputs.tf` | `synthetic_check_function_name`; `xray_write` added to the `depends_on` of the six traced role outputs; new `synthetic_check_role_arn` |
| `infra/modules/worker/synthetic.tf` (new) | log group, function (`Active` at create), alias `prod`, invoke config, DISABLED schedule |
| `infra/modules/worker/variables.tf`, `outputs.tf` | three variables, one output |
| `infra/modules/api/core_vpc.tf`, `infra/modules/worker/function.tf` | `mode = "PassThrough"` → `mode = "Active"` only |
| `infra/modules/worker/ai_qa.tf`, `webhooks.tf`, `automation.tf` | the three-line `tracing_config { mode = "Active" }` block between `logging_config` and `lifecycle` (one each; two in automation.tf) |
| `infra/modules/observability/alarms_r18h.tf` (new) | `developercards-prod-synthetic-check-failing`, actions disabled |
| `infra/envs/prod/main.tf` | the function name for identity and worker, the role ARN and create-time environment for worker |
| `infra/README.md` §6 | dated H05 line |
| `docs/delivery/r18-issues/H05.plan-allow.json` | the 22 H00 §6.1 entries |

## Plan (real backend, read-only, `-lock=false`)

`Plan: 16 to add, 6 to change, 0 to destroy.` — the six function updates change `tracing_config` only; the new
`depends_on` on the role outputs made nothing unknown (no role, alias or function attribute turned
`(known after apply)`). `check-plan.py --allow docs/delivery/r18-issues/H05.plan-allow.json --summary`:
`PLAN OK 22`, `SUMMARY imports=0 no-op=263 create=16 update=6 delete=0 replace=0 outputs=0`.

## IAM simulation (`aws iam simulate-custom-policy` on the planned documents)

| Document | Action | Resource | Decision |
|---|---|---|---|
| developercards-xray-write | `xray:PutTraceSegments` | `*` | allowed |
| developercards-xray-write | `xray:PutTelemetryRecords` | `*` | allowed |
| developercards-synthetic-check-scoped | `logs:PutLogEvents` | `…:log-group:/aws/lambda/developercards-synthetic-check:*` | allowed |
| developercards-synthetic-check-scoped | `logs:CreateLogStream` | same | allowed |
| developercards-synthetic-scheduler-invoke | `lambda:InvokeFunction` | `…:function:developercards-synthetic-check:prod` | allowed |
| developercards-xray-write | `xray:GetTraceSummaries` | `*` | implicitDeny |
| developercards-xray-write | `xray:PutEncryptionConfig` | `*` | implicitDeny |
| developercards-xray-write | `logs:PutLogEvents` | the synthetic log group | implicitDeny |
| developercards-synthetic-check-scoped | `ssm:GetParameter` | `…:parameter/developercards/prod/internal-shared-secret` | implicitDeny |
| developercards-synthetic-check-scoped | `sqs:SendMessage` | `…:developercards-notify` | implicitDeny |
| developercards-synthetic-check-scoped | `lambda:InvokeFunction` | `…:function:core-vpc:prod` | implicitDeny |
| developercards-synthetic-check-scoped | `xray:PutTraceSegments` | `*` | implicitDeny (granted by its own xray-write policy instead) |
| developercards-synthetic-scheduler-invoke | `lambda:InvokeFunction` | `…:function:core-vpc:prod` | implicitDeny |
| developercards-synthetic-scheduler-invoke | `lambda:InvokeFunction` | `…:function:developercards-synthetic-check` (unqualified) | implicitDeny |

## Decisions

- The `core_vpc_role_arn` output had no `depends_on`; fmt realigned its `value` line when `depends_on` was added
  (allowed by the brief). The comment on it says why (Lambda rejects `Active` until the role may write traces).
- Existing `depends_on` comments on the other role outputs are kept verbatim; only the list grew.
- Both `main.tf` additions follow a blank line and a comment so fmt left existing lines byte-identical.
- No `aws_lambda_permission`: the scheduler invokes through its role, like the automation schedules.

## Follow-ups

Release step H00 §8.2.5 verifies core-vpc/worker `AWS::Lambda::Function` segments without an X-Ray VPC endpoint; if they are missing the supervisor records it here — the ≈ USD 14.60/month endpoint is an owner decision.
