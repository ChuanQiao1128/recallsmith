# A01 — automation schema, mode switch and strict internal HMAC (notes)

Release R18A, wave S canary (issue #406). Contract: A00 §3, §7, §8.3, §13, §14. No route is added.

## What was added

| Where | What |
|---|---|
| `src_C/Vpc/Db/Migrations/034_automation.sql:1-15` | header (033 style): contents, the one declared exception (part 10), deploy order, idempotency |
| `src_C/Vpc/Db/Migrations/034_automation.sql:17-362` | A00 §7 parts 1–11 verbatim (A00 lines 366-711): 12 tables, indexes, the append-only function + two triggers, 3 baselines, widened `ck_webhook_subscriptions_events` (1..8), 2 feed seeds |
| `src_C/Vpc/Automation/AutomationMode.cs` | `AutomationMode` (`EnvName`, `Off`/`DryRun`/`Live`, `EvalGateMissing`, `ServerNotReady`, `Parse`, `Configured`, `EffectiveAsync`), records `EffectiveMode`, `GateReviewer` |
| `src_C/Vpc/Automation/AutomationEnv.cs` | the optional core-vpc keys of A00 §3.3 (API below) |
| `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:524-529` | `VerifyInternalSignatureStrict(LambdaRequest req, string secretEnv)` |
| `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:531` | private `VerifySignedRequest(req, secretName, secret)`: the headers / ±5 min skew / fixed-time compare / `_PREVIOUS` code, moved unchanged out of `VerifyInternalSignature(req, callerSecretEnv)`, which now resolves its secret (with the shared fallback) exactly as before and delegates |
| `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs:26` | `SubscribableEvents` = the eight names of A00 §13 |
| `src_C/Vpc/Integrations/WebhookSubscriptions.cs:230-233` | events bound `1..SubscribableEvents.Count`, message `events must be an array of 1..8 event names` |
| `src_C/Shared/RecallSmith.Lambda.Db/AutomationLedger.cs:16` | `Automations` + `auto_accept`, `auto_publish`, `source_watch` |
| `src_C/env/prod.env.json` | appended `AUTOMATION_MODE="off"`, `AUTOMATION_AUTO_PUBLISH="1"`, `AUTOMATION_SOURCE_HOSTS` (contract value); `jq -c .` byte-stable |
| `src_C/Tests/…/AutomationSchemaTests.cs` | 8 tests (the CHECK theory has 51 cases, at least one per CHECK of §7, each asserting SqlState `23514` and the constraint name) |
| `src_C/Tests/…/AutomationModeTests.cs` | 9 tests; the parser property test has 86 generated cases |
| `src_C/Tests/…/InternalSignatureStrictTests.cs` | 5 pure tests incl. the A00 §8.3 vector |
| `src_C/Tests/…/WebhookAdminRoutesTests.cs`, `AutomationLedgerTests.cs` | the named exceptions of A00 §18.3 items 1–2 only |

## `AutomationEnv` helper API (namespace `RecallSmith.Lambda.Vpc.Automation`)

Every value is read from the environment on every call; absent and blank (whitespace only) mean the default.

| Member | Returns |
|---|---|
| `AutoPublish()` | `AUTOMATION_AUTO_PUBLISH`: unset/blank ⇒ `true`, else `Qa.Env.IsTruthy(value)` |
| `SourceHosts()` | `AUTOMATION_SOURCE_HOSTS`: comma list, trimmed, lower-cased, empties dropped, `StringComparer.Ordinal` set; unset/blank ⇒ `DefaultSourceHosts` |
| `DeckSlugs()` | `AUTOMATION_DECK_SLUGS`: unset/blank ⇒ `null` (= every deck); else trimmed slugs (ordinal, case kept) |
| `QaTimeoutMinutes()` / `RunnerStaleMinutes()` / `LoginWarnDays()` | positive invariant integer, else 120 / 1440 / 5 |
| `NotifyQueueUrl()` | `AUTOMATION_NOTIFY_QUEUE_URL` trimmed; `null` when unset/blank |
| constants | `AutoPublishEnv`, `SourceHostsEnv`, `DeckSlugsEnv`, `QaTimeoutMinutesEnv`, `RunnerStaleMinutesEnv`, `LoginWarnDaysEnv`, `NotifyQueueUrlEnv`, `SourceWatchSecretEnv` (`INTERNAL_SECRET_SOURCE_WATCH`), `NotifierSecretEnv` (`INTERNAL_SECRET_NOTIFIER`), `DefaultSourceHosts`, `DefaultQaTimeoutMinutes`, `DefaultRunnerStaleMinutes`, `DefaultLoginWarnDays` |

Later issues call `Auth.VerifyInternalSignatureStrict(req, AutomationEnv.SourceWatchSecretEnv)` / `(…, AutomationEnv.NotifierSecretEnv)`.

## Interpretations

- **§7 copied byte for byte**, including the comments inside the SQL; nothing was renamed or reordered. `$$` in the plpgsql body is fine (only `$<digit>` is rewritten).
- **`AutomationMode.Configured()` warns** once per container (static `Interlocked` flag) whenever the raw value is not a spelling of `off`/`dry_run`/`live` — absent, empty and invalid alike (A00 §3.1). The `value` field is the raw value truncated to 20 characters (`null` when absent). An explicit `off` never warns.
- **`EffectiveAsync`** calls `Configured()` itself; the gate query is the brief's verbatim SQL. It probes with `to_regclass` (no exception, so a caller's open transaction survives — tested). In `dry_run` the current gate is reported for information; `live` without a gate reports `GateId`/`Reviewer` as null (brief change 2).
- **`SourceHosts()` with only separators** (e.g. `" , ,"`) falls back to the default list: a set of zero allowed hosts would silently route every draft to a human, and the contract only defines "absent ⇒ default". `DeckSlugs()` of only separators is `null` (every deck) for the same reason.
- **Test isolation:** the CHECK theory and the append-only test share one scratch database (`a01_034_checks`, created once per run behind a static lock) so 51 cases do not each migrate a database; every other schema test uses its own scratch database at 033 + 034. The mode tests use the shared database; each passed gate is revoked in `finally`, and a gate row that is inserted already revoked needs no cleanup.
- The comment line `// The shared suite database carries the same six names.` in `AutomationLedgerTests.cs` is left as is: the brief allows only the declaration and the four assertion lines to change there.
