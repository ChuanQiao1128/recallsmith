# P02 (R25) — core-vpc bucket: analytics/raw/ retention

Issue #695, contract R25-00 §5.

## What changed
- `infra/modules/data/buckets.tf` — `aws_s3_bucket_lifecycle_configuration.content` (bucket `core-vpc`, see `infra/envs/prod/main.tf` `content_bucket_name`) gains a second rule:
  - `id = "analytics-raw-400d"`, `status = "Enabled"`
  - `filter { prefix = "analytics/raw/" }`
  - `expiration { days = 400 }`
  - `noncurrent_version_expiration { noncurrent_days = 30 }`
  The existing rule `noncurrent-90d` (empty filter, noncurrent 90 days, abort incomplete multipart uploads after 7 days) is byte-for-byte unchanged. The premium bucket's lifecycle is untouched.
- `infra/README.md` §6 — change-log line.
- `docs/delivery/r25-issues/P02.plan-allow.json` — allow-list: exactly one change, `module.data.aws_s3_bucket_lifecycle_configuration.content` update with key `rule` (format of `docs/delivery/r24-issues/P01.plan-allow.json`).

## Effective behaviour per key
- `analytics/raw/**` (today `analytics/raw/review_events/...jsonl` written by `src_C/Vpc/Analytics/OutboxPublisher.cs` when the Lambda falls back to `CONTENT_BUCKET`): current version expires 400 days after creation (versioned bucket, so S3 adds a delete marker and the data becomes noncurrent); noncurrent versions are removed 30 days after becoming noncurrent. Both rules match these keys; S3 evaluates every matching rule and, for conflicting expirations, uses the earliest, so noncurrent = 30 days. Incomplete multipart uploads still abort after 7 days via `noncurrent-90d`.
- Every other key (`content/`, `analytics/marts/`, ...): only `noncurrent-90d` matches — unchanged behaviour. `analytics/marts/` is not affected because the prefix ends in `raw/`.

## How it is tested
- Base check that fails before the change: `P02.verify.sh` step 2 `require_grep infra/modules/data/buckets.tf analytics-raw-400d` (absent on base).
- `terraform fmt -check -recursive infra` — PASS.
- `terraform -chdir=infra/envs/prod init -backend=false -input=false -lockfile=readonly && terraform -chdir=infra/envs/prod validate` — PASS (offline, no AWS).
- No `terraform plan` or `apply` against AWS was run (worker rule, infra/README.md §2).

## Owner / supervisor steps
1. After merge: `terraform plan -out=p02.tfplan` in `infra/envs/prod`, then `terraform show -json p02.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r25-issues/P02.plan-allow.json`. Expected: 0 to add, 1 to change, 0 to destroy.
2. Apply the saved plan. Check: `aws s3api get-bucket-lifecycle-configuration --bucket core-vpc` lists both `noncurrent-90d` and `analytics-raw-400d`.
3. A second plan must be empty.

## Deferred / notes
- The brief says "S3 applies the most specific rule per object"; S3 actually applies all matching rules and picks the earliest expiration on conflict. The outcome is what the brief wants (30-day noncurrent for `analytics/raw/`, 90 days elsewhere), noted here for accuracy.
- Expired-object delete markers left after the 400-day expiry are not cleaned up: `expired_object_delete_marker` cannot share a rule with `expiration { days }`, and a separate rule was outside the task. They cost nothing in storage; a follow-up can add one if listing noise matters.
- The separate analytics bucket from R16 E13 (`developercards-analytics-*`, prefix `raw/`) is not in scope of this issue.
