# A02 — Runner and authoring-queue routes: notes

Issue #407, brief `A02-runner-queue-routes.md`, contract A00 §8.4 rows 1–5, §8.5, §8.6.

## Routes added

| # | Method | Path | Dispatch (`src_C/Vpc/VpcFunction.cs`) | Handler | Auth |
|---|---|---|---|---|---|
| 1 | POST | `/api/v1/authoring/automation/runner/heartbeat` | `:313-316` | `RunnerRoutes.HandleHeartbeat` (`src_C/Vpc/Automation/RunnerRoutes.cs:39`) | RUNNER |
| 2 | POST | `/api/v1/authoring/automation/runner/claim` | `:317-320` | `RunnerRoutes.HandleClaim` (`RunnerRoutes.cs:120`) | RUNNER |
| 3 | POST | `/api/v1/authoring/automation/runner/complete` | `:321-324` | `RunnerRoutes.HandleComplete` (`RunnerRoutes.cs:246`) | RUNNER |
| 4 | GET, POST | `/api/v1/admin/automation/queue` | `:325-328` | `QueueRoutes.HandleQueue` (`src_C/Vpc/Automation/QueueRoutes.cs:37`) | GET A, POST SA |
| 5 | POST | `/api/v1/admin/automation/queue/:itemId/skip` | `:329-332` | `QueueRoutes.HandleSkip` (`QueueRoutes.cs:177`) | SA |

- The block starts with `// R18A — automation` (`VpcFunction.cs:312`), after the QA block and before `// Runtime`. A04–A06 append after `:332`.
- `RouteMetrics.StaticRoutes`: `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs:170-173`. `TemplateRoutes`: `:207`. `InternalActions` is unchanged.
- `AgentClientPolicy.AllowedSuffixes`: the three runner tuples at `src_C/Vpc/AgentClientPolicy.cs:30-32`. The class comment now names the runner as the second agent client. Nothing else in the file changed; the queue routes stay 403 `AGENT_CLIENT_FORBIDDEN` for an agent token.

## `AfterCompleteAsync` hook contract for A04

```csharp
internal static Task AfterCompleteAsync(NpgsqlConnection conn, Guid runId, long itemId, string outcome, string itemStatus, CancellationToken ct = default);
```

- **When it runs:** `HandleComplete` calls it after the complete transaction commits, on the same open connection, with no transaction open. It does **not** run on a replay (same outcome reported twice) or on any error response. The response's `decisions` counts are read **after** the hook returns, so a finalisation that changes decision rows shows up in the same response.
- **Arguments:** `outcome` is the reported `done | nothing_new | failed`. `itemStatus` is the queue item's status after the commit: `done`, `queued` (failed and requeued with backoff), `failed` (the third failed attempt, `RunnerRoutes.MaxItemAttempts = 3`), or whatever status the item already had when this run no longer held it (for example `queued` after a lease-expiry requeue). A04 sends `queue_item_failed` only when `outcome == "failed" && itemStatus == "failed"`, and `runner_run_failed` on every `outcome == "failed"` (dedupe on `runId`).
- **Must never throw.** The business commit has already happened. A02's body writes one `Log.Event("info", { tag = "automation", reason = "run_completed", runId, itemId, outcome, itemStatus })` and returns `Task.CompletedTask`. A04 replaces the body and keeps the name and signature exactly.

## §8.5 / §8.6 interpretations

- **"Missing" and `null`:** in every request body, a missing key means the same as JSON `null`. Optional fields become null; `max` and `leaseMinutes` fall back to their defaults (1 and 90).
- **Heartbeat upsert:** one `insert … on conflict (runner_id) do update … where automation_runners.owner_sub = excluded.owner_sub returning runner_id`. On an update, `host`, `runnerVersion`, `claudeVersion`, `state`, `loginExpiresAt` and `lastError` are overwritten with the reported values. `lastRunId`, `lastRunAt` and `lastRunOutcome` use `coalesce(reported, stored)`, so a runner restarted without memory does not erase the history that `complete` wrote. ISO-8601 timestamps must match `YYYY-MM-DDTHH:MM[:SS[.fffffff]](Z|±HH:MM)` and are stored as UTC.
- **Claim runner touch:** this is also one upsert statement (`insert … state 'running', runner_version null … on conflict do update set last_heartbeat_at = now(), updated_at = now() where owner matches`). It covers the brief's "update, else insert" in a single statement and cannot race. No row returned ⇒ roll back, `403 RUNNER_MISMATCH`.
- **Claim with migration 034 missing:** `AutomationMode.EffectiveAsync` then reports effective `off` / `SERVER_NOT_READY_AUTOMATION`. Claim answers `503 SERVER_NOT_READY_AUTOMATION` for that reason (A00 §0.7), not a 200 with no items. With `AUTOMATION_MODE=off` (configured), claim answers `{ mode, effectiveMode, items: [] }` without touching any table.
- **Claim locking:** the `for update skip locked` select reads `authoring_queue_items` alone. PostgreSQL refuses `FOR UPDATE` on the nullable side of an outer join, so deck liveness (`is_deleted = 0`) is read in a second query inside the same transaction. Items whose deck is deleted become `skipped` / `DECK_MISSING`, get `finished_at = now()`, and do not count toward the claimed items.
- **Complete, item transitions:** the item is updated only while `status = 'claimed' and last_run_id = runId` (the item row is locked `for update`). Failed backoff is `not_before = now() + attempts × 60 min`, using the attempts count after the claim. `last_error` is the reported `error`, possibly null. `lease_expires_at` is set to null whenever the item leaves `claimed`. `claimed_by_runner` and `claimed_at` are kept.
- **Complete, replay:** the run row is locked `for update`. A run that is not `running` and has the same `outcome` returns 200 with `replayed: true` and the current run and item status, and changes nothing. Any other outcome (including an `abandoned` run with a null outcome) answers `409 RUN_NOT_RUNNING`.
- **`RUNNER_CLIENT_REQUIRED` order:** `Auth.RequireSuperAdmin` runs first, so an editor with an agent token gets the standard `403 FORBIDDEN`. A super_admin SPA token gets `403 RUNNER_CLIENT_REQUIRED`. The method check (405) comes after both.
- **Queue add, duplicate guard:** there is no unique index on (url, deck) for open items, and the migration is frozen. The add therefore takes `pg_advisory_xact_lock(hashtextextended('automation-queue:<deckId>:<url>', 0))` before it checks for a `queued`/`claimed` item and inserts. Concurrent adds of the same pair produce exactly one item; the others get `409 QUEUE_ITEM_EXISTS`. The url must start with `https://`, parse as an absolute https URI with a host, and be at most 2048 characters.
- **Queue skip, bad id:** a non-numeric, zero or negative `itemId` answers `404 QUEUE_ITEM_NOT_FOUND` before any database access.
- **Timestamps:** every timestamp in a response uses `WebhookEvents.FormatTimestamp` (UTC, milliseconds, `Z`).
- **Error mapping:** both `42P01` and `42703` map to `503 SERVER_NOT_READY_AUTOMATION` in all five routes.

## Tests

- `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RunnerRoutesTests.cs`: the 18 named tests, plus `Complete_AfterLeaseRequeue_LeavesTheItemAlone`. They use the scratch database `it_a02_runner` (latest migrations) and `it_a02_runner_notready` (033).
- `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutomationQueueRoutesTests.cs`: the 10 named tests. They use the scratch databases `it_a02_queue` and `it_a02_queue_notready`.
- `PGDATABASE`, `AUTOMATION_MODE` and `Auth.Configure` are restored in `finally`. Response key sets are asserted in A00 contract order.
