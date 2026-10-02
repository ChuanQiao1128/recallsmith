# G04 — Server deletes the RevenueCat customer record after account deletion

Issue #694, contract `R25-00-contracts.md` §4.

## What changed (files)

- `src_C/Vpc/Runtime/RevenueCatCustomerDeletion.cs` (new): `DeleteCustomerAsync(appUserId)`.
- `src_C/Vpc/Runtime/AccountDeletion.cs`: `HandleDeleteMe` calls it after `DeleteUserDataAsync` has committed and the
  `account-delete` line is logged; the response is still `204` (the existing success status of this route) whatever RevenueCat answers.
- `src_C/deploy.sh`: maps the SSM leaf `revenuecat-secret-api-key` (under `/developercards/$ENV`) to `REVENUECAT_SECRET_API_KEY`
  for core-vpc, appended to `SSM_TO_ENV` right after `merge-env.sh` is sourced, and lists the key in `SSM_OPTIONAL_ENV`.
- `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenueCatDeleteTests.cs` (new).

## Surface shipped

- Call: `DELETE {REVENUECAT_API_BASE}/v1/subscribers/{Uri.EscapeDataString(sub)}`, `Authorization: Bearer <REVENUECAT_SECRET_API_KEY>`.
  `REVENUECAT_API_BASE` defaults to `https://api.revenuecat.com` (test seam; not set in prod).
- 5 s per attempt (CancellationTokenSource; the static HttpClient has no timeout of its own). One retry on a 5xx or a timeout;
  no retry on any other status.
- Outcomes: 2xx → `deleted`, 404 → `not_found` (both success), key missing/blank → `skipped_no_key` (no request made),
  anything else (other 4xx, 5xx twice, timeout twice, any exception) → `failed`.
- One log line per deletion: `{"tag":"revenuecat_delete","outcome":…,"status":<last HTTP status or null>,"attempts":n}`;
  `info` level, `warn` for `failed`. Never the key, the sub (raw or escaped), the URL or a response body; exceptions are swallowed
  without logging their text.
- deploy.sh: with no leaf under the path nothing is injected (`pick_keys` only picks present keys) and, because the key is optional,
  a stale copy is removed from the live environment. With the leaf present it is injected into core-vpc only (the worker's secret
  projection is unchanged).

## How it is tested

`dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~AccountDeletion|FullyQualifiedName~RevenueCat|FullyQualifiedName~DeleteMe"`
— real Postgres (Testcontainers), `HandleDeleteMe` driven as API Gateway delivers it, a fake `HttpMessageHandler` for RevenueCat:

- 200 → one call, escaped sub in the URL, Bearer header, `deleted`, user rows gone.
- 404 → `not_found`. 401 → `failed`, no retry.
- 500 then 200 → two calls, `deleted`. 500 then 503 → two calls, `failed` status 503, user still deleted (204).
- key unset / empty / blank → no call, `skipped_no_key`.
- hang twice (attempt budget lowered to 200 ms via the test seam) → two calls, `failed`, status null; hang then 204 → `deleted`.
- every case asserts the captured stdout+stderr contains neither the fake key, the sub, its escaped form, nor the body.
- deploy.sh mapping: the mapping lines are evaluated over `scripts/merge-env.sh`; `ssm_to_env` with and without the leaf and
  `drop_absent_optional` on a stale copy.
- the default constants (5 s, `https://api.revenuecat.com`, env names).
- `scripts/merge-env.test.sh` still passes.

## Owner steps

1. **Egress first.** core-vpc runs in the VPC with no egress (see `infra/modules/worker/ai_qa.tf`). Until it can reach
   `api.revenuecat.com` (NAT or another egress path — infra, out of this issue's scope), setting the key makes every account
   deletion wait up to ~10 s (two 5 s attempts) and log `outcome=failed`; the user's deletion still succeeds. Leave the leaf absent
   until egress exists; the server then logs `skipped_no_key`.
2. Create the SecureString `/developercards/prod/revenuecat-secret-api-key` with the RevenueCat **secret** API key (v1), then run
   `src_C/deploy.sh` (env injection on). Never put the value in a file or argv you commit.
3. Check CloudWatch for `tag = "revenuecat_delete"` after the next account deletion.

## Deferred

- core-vpc egress to RevenueCat (infra).
- No backfill for accounts deleted before this ships; their RevenueCat customer records remain until removed by hand.
- No Terraform resource for the new SSM leaf (scope is src_C only); the owner creates it.
