# F04 — r25 review fixes: RevenueCat delete (issue #704)

Round r25x, wave v. Supervisor decision applied: no NAT gateway; core-vpc never calls RevenueCat. Core queues the sub in
the deletion's transaction (migration 044) and serves two HMAC routes; the notifier (outside the VPC) calls RevenueCat on
every tick. Design and owner steps: `docs/delivery/r25-issues/G04-notes.md`.

Tests (all fail on the base, where `RevenueCatDeletions`, migration 044 and `notifier.revenuecat` do not exist):

- Core: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenueCatDeleteTests.cs`
- Notifier: `services/notifier/tests/test_revenuecat.py`

### x-deploy-1

Status: fixed

Confirmed: `core_vpc.tf` has `vpc_config`, no NAT/IGW/VPC endpoint exists in `infra/`, and `ai_qa.tf` says "core-vpc has
no egress", so the G04 in-VPC call could never reach `api.revenuecat.com`. Fixed as the supervisor decided: the HTTP call
is removed from core-vpc (`RevenueCatCustomerDeletion.cs` deleted), `HandleDeleteMe` only queues the sub, and the notifier
makes the call from outside the VPC. Deploy guard: deploy.sh no longer maps the key to core-vpc, skips the leaf
(`SSM_NOT_ENV`) and removes a stale `REVENUECAT_SECRET_API_KEY` from core-vpc (`SSM_OPTIONAL_ENV` with no mapping). The old
"Owner step 2" is replaced. Still needed from the infra wave (not edited here): two API Gateway routes and the notifier's
`ssm:GetParameter` on the leaf (G04-notes, Owner steps).

Files: `src_C/Vpc/Runtime/AccountDeletion.cs`, `src_C/Vpc/Runtime/RevenueCatCustomerDeletion.cs` (removed),
`src_C/Vpc/Runtime/RevenueCatDeletions.cs`, `src_C/Vpc/Db/Migrations/044_revenuecat_deletions.sql`,
`src_C/Vpc/VpcFunction.cs`, `src_C/Vpc/Automation/AutomationTick.cs`, `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs`,
`src_C/deploy.sh`, `services/notifier/src/notifier/{revenuecat,handler,internal_client}.py`.
Tests: `RevenueCatDelete_DeleteMe_QueuesTheSubAndMakesNoOutboundCall`,
`RevenueCatDelete_DeployNeverGivesCoreVpcTheKey_AndRemovesAStaleCopy`, the `RevenueCatDelete_Pending_*`,
`RevenueCatDelete_Report_*` and `RevenueCatDelete_Retention_*` tests, and `test_revenuecat.py`.

### v-correctness-1

Status: fixed

Confirmed on the base: `SendWithRetryAsync` caught only its own `OperationCanceledException`, so an
`HttpRequestException` escaped to the outer catch and logged `attempts: 0, status: null`. The code is gone (x-deploy-1).
In the replacement, `notifier.revenuecat.delete_subscriber` catches every transport error per call and returns `None`;
the sub is still reported (`status: null`), core counts the attempt (`attempts + 1`, `last_attempt_at`), and the next tick
retries, up to 10 attempts. The notifier's log line counts it under `failed`.

Files: `services/notifier/src/notifier/revenuecat.py`, `src_C/Vpc/Runtime/RevenueCatDeletions.cs`.
Tests: `test_timeout_and_network_error_report_a_null_status` (timeout and connection reset),
`RevenueCatDelete_Report_2xxAnd404Delete_OthersCountAnAttempt` (null status → attempts 1, last_attempt_at set).

### v-security-1

Status: fixed

The same defect as v-correctness-1 (confirmed). Fixed the same way: no transport error is lost or raised; each one is
one counted attempt with a null status, retried on the next tick.

Files and tests: as v-correctness-1.

### v-security-2

Status: fixed

Confirmed: `await using var conn` stayed open across `DeleteCustomerAsync`. `HandleDeleteMe` now makes no outbound call at
all; the only work after the commit is one log line, so the connection is never held for a network wait. The notifier
holds no database connection.

Files: `src_C/Vpc/Runtime/AccountDeletion.cs`.
Test: `RevenueCatDelete_DeleteMe_QueuesTheSubAndMakesNoOutboundCall` (no `revenuecat_delete` call line; the call path no
longer exists).

### v-security-3

Status: fixed

Confirmed: the G04 mapping put the key into core-vpc's `--environment` argv and skipped the placeholder check. The key no
longer reaches core-vpc at all: the mapping is removed, the leaf is skipped and a stale copy is removed on each injecting
deploy. The notifier reads the key from SSM at runtime (SecureString, `WithDecryption`), so it is never in any argv; a
blank or placeholder value counts as missing and skips the step. Not changed (pre-existing, outside this finding): the
argv exposure of core-vpc's other secrets through `--environment`; recorded in G04-notes, Deferred.

Files: `src_C/deploy.sh`, `services/notifier/src/notifier/revenuecat.py`, `handler.py`.
Tests: `RevenueCatDelete_DeployNeverGivesCoreVpcTheKey_AndRemovesAStaleCopy`,
`test_missing_key_skips_the_whole_step` (missing, placeholder, empty, blank).

### v-tests-1

Status: fixed

Confirmed: no G04 test made the handler throw. The replacement has transport-error tests that also check nothing leaks
(key, raw and quoted sub, body), including an exception whose message carries the URL and the key.

Files: `services/notifier/tests/test_revenuecat.py`.
Test: `test_timeout_and_network_error_report_a_null_status`.

### v-tests-2

Status: fixed

Confirmed: no G04 test checked the order or a rollback. The queue insert is now inside the deletion's transaction, and a
test forces the users delete to fail (a trigger raises for that sub). It asserts the user row remains and no queue row
exists, so RevenueCat can never be told to delete the customer of an account that still exists.

Files: `src_C/Vpc/Runtime/AccountDeletion.cs`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenueCatDeleteTests.cs`.
Test: `RevenueCatDelete_RolledBackDeletion_QueuesNothing`.

### v-tests-3

Status: fixed

Confirmed: `RevenueCatDelete_TimeoutThen200_IsDeleted` skipped `AssertNoLeak`, so the note overclaimed. That test is gone
with the code it covered. Every new notifier test that makes a RevenueCat call checks the output with `assert_no_leak`,
and the core tests check that no sub reaches core's log. G04-notes now lists exactly what is checked.

Files: `services/notifier/tests/test_revenuecat.py`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenueCatDeleteTests.cs`,
`docs/delivery/r25-issues/G04-notes.md`.
Tests: every `test_revenuecat.py` case that makes a call, plus `AssertNoSub` in the core tests.

### x-interfaces-1

Status: declined

Confirmed real, but outside this issue's scope: `mobile/tests/unit/reviewNotesChecklist.test.ts:53` checks each
`review-notes-<v>.txt` only for `'Delete account'`, while `DELETE_PATH` ("Me > Settings > Account > Delete account") is
used only for the README (line 58), and `mobile/scripts/release/README.md:31` states the weaker rule. F04's allowed paths
(the verify's `require_scope`) do not include `mobile/`, so a fix here would fail verification. Fix for the G02/mobile
follow-up: in the per-file loop, assert `expect(text, file).toContain(DELETE_PATH)`, and update the README sentence.

Files: none. Test: none (not changed in this issue).
