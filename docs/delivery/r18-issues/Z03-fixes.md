# Z03 — Infra round 3: per-finding fixes ledger

Base: `delivery/r18z-p` (= `release/1.8.0` + Z02). Scope: `infra/`, `docs/delivery/r18-issues/`.
Nothing was applied; the supervisor applies after merge against
`docs/delivery/r18-issues/Z03.plan-allow.json`.

Real-backend plan (read-only, `-lock=false`, 2026-09-27): this branch **0 to add, 2 to change,
0 to destroy**, exactly the allow-list:

| Address | Action | Changed keys |
|---|---|---|
| `module.identity.aws_iam_role_policy.webhook_dispatcher` | update | `policy` (new Sid `SsmReadSubscriptionSecrets`) |
| `module.worker.aws_sqs_queue.ai_qa_jobs` | update | `redrive_policy` (`maxReceiveCount` 2 → 3) |

The Y04 plan-shape invariant is untouched: the `console` authorizer admits only the SPA client and
`cognito-jwt-agent` admits console-dev.

### cloud-security-resilience-7

Status: partially fixed (the IAM grant, the part in this issue's paths, is fixed; the merge-env
skip, the flag flip and console generation are other roots — handoffs below)

- `infra/modules/identity/roles_r18.tf:48-56`: new statement `SsmReadSubscriptionSecrets` =
  `ssm:GetParameter` on `${local.ssm_param_prefix}/webhook-signing-secret-sub-*`, which in prod is
  `arn:aws:ssm:ap-southeast-2:622994489535:parameter/developercards/prod/webhook-signing-secret-sub-*`.
  It covers exactly the names the dispatcher builds: `settings.subscription_secret_name`
  (`services/webhook-dispatcher/src/webhook_dispatcher/settings.py:178-179`) = `<name>-sub-<id>`,
  and its rotation leaf `<name>-sub-<id>-previous`. It does not widen to any other parameter under
  the prefix (the three exact leaves stay a separate statement). A separate Sid keeps the X08
  `SsmRead` statement byte-identical in intent and makes the grant easy to find.
- Terraform never creates the `-sub-*` leaves; the owner does (README "Per-subscription secrets").
- `infra/README.md` change log: Z03 entry, with the ordering rule below.
- Safe to apply before anything else: Z02 put the per-subscription lookup behind
  `WEBHOOK_SUBSCRIPTION_SECRETS`, off in `services/webhook-dispatcher/env/prod.env.json`, so the
  grant changes no runtime behaviour until the flag is set.
- Tests:
  - `docs/delivery/r18-issues/Z03.plan-allow.json` + `infra/scripts/check-plan.py` (Z03.verify.sh
    step 3): the plan must contain `module.identity.aws_iam_role_policy.webhook_dispatcher`
    `[policy]` and nothing outside the allow file.
  - IAM policy simulation of the planned document (`aws iam simulate-custom-policy`, read-only) on
    `…/webhook-signing-secret-sub-12` and `…/webhook-signing-secret-sub-12-previous`: base tree
    `implicitDeny`, this branch `allowed`; `…/anthropic-api-key` stays `implicitDeny` (see the
    Verification section).
- Handoffs (not in `infra/`):
  - core-vpc (csr-15): `src_C/scripts/merge-env.sh` must skip SSM leaves matching
    `webhook-signing-secret-sub-*` (`SSM_NOT_ENV` pattern), before the owner creates the first
    leaf; otherwise the next core-vpc deploy fails with "unmapped SSM parameter".
  - services: set `WEBHOOK_SUBSCRIPTION_SECRETS=1` in the dispatcher's `env/prod.env.json` only
    after this grant is applied and the merge-env skip is deployed.
  - core + frontend: generate the secret when a subscription is created (put-parameter from core,
    or KMS/pgcrypto storage), show it once in WebhooksPage, and rotate the environment-wide secret
    after the first per-subscription secret is issued. Until then, the owner provisions a leaf by
    hand (dispatcher README).

### cloud-security-resilience-12

Status: fixed (infra half; the Python half landed in Z02)

- `infra/modules/worker/ai_qa.tf:9-21`: `aws_sqs_queue.ai_qa_jobs.redrive_policy.maxReceiveCount`
  = 3 (was 2), the exact setting Z02's ledger hands off. `visibility_timeout_seconds` stays 3600 (the
  handler shortens it per message; 3600 still bounds a crashed invocation). The comment now states
  why 3 (the 540-660 s later visibility only helps at 3+) and points at `AI_QA_MAX_RECEIVES`.
- `infra/RUNBOOK.md` §7 step 3: `maxReceiveCount = 3`. `infra/README.md` change log: Z03 entry
  (J15's "redrive 2" marked superseded).
- Z02 already added `_retry_soon` on the missing-internal-secret path and the final-receive give-up
  (`AI_QA_MAX_RECEIVES`, default 2 = the old redrive). With the queue at 3 and the setting at 2 the
  chunk ends one receive early with visible errors (no stall); the full effect needs the setting at 3.
- Tests: `docs/delivery/r18-issues/Z03.plan-allow.json` + `infra/scripts/check-plan.py`
  (Z03.verify.sh step 3): the plan must contain `module.worker.aws_sqs_queue.ai_qa_jobs`
  `[redrive_policy]`; on the base tree that entry is absent (no change planned).
- Handoff (services, same release): `"AI_QA_MAX_RECEIVES": "3"` in
  `services/ai-qa/env/prod.env.json` and in `tests/test_settings.py::test_prod_env_file_matches_contract`,
  then deploy ai-qa after the queue change.

## Verification

- `BASE=delivery/r18z-p AWS_PROFILE=dev bash Z03.verify.sh` → `Plan: 0 to add, 2 to change, 0 to
  destroy`, `PLAN OK 2`, `Z03 VERIFY OK`.
- `aws iam simulate-custom-policy --action-names ssm:GetParameter` on the plan's `before` (deployed)
  and `after` policy of `module.identity.aws_iam_role_policy.webhook_dispatcher`, resources under
  `arn:aws:ssm:ap-southeast-2:622994489535:parameter/developercards/prod/`:

  | Resource | before | after |
  |---|---|---|
  | `webhook-signing-secret-sub-12` | implicitDeny | allowed |
  | `webhook-signing-secret-sub-12-previous` | implicitDeny | allowed |
  | `webhook-signing-secret` | allowed | allowed |
  | `anthropic-api-key` | implicitDeny | implicitDeny |
  | `webhook-signing-secretX` | implicitDeny | implicitDeny |

## Handoffs outside this issue's paths (summary)

1. core-vpc (csr-15): `merge-env.sh` skips `webhook-signing-secret-sub-*` before any leaf exists.
2. services: `WEBHOOK_SUBSCRIPTION_SECRETS=1` (dispatcher) after 1 and this apply;
   `AI_QA_MAX_RECEIVES=3` (ai-qa) with this apply.
3. core + frontend: console generation, show-once and the environment-wide secret rotation.
4. Z02's other infra handoffs (the claim gateway route, RUNBOOK §7/§8 text, the `-previous`
   internal-secret grant) are not in this issue's findings or plan-allow file and are not done here.
