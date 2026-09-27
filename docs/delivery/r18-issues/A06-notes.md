# A06 — Automation read API and the eval gate: notes

Issue #411, wave `r18a-s`. Contract: A00 §0, §3.2, §5.2, §5.9, §6.6, §8.1, §8.4 rows 16–21, §9.5, §15.1–§15.5,
§16.2, §18, §20. Builds on A01 (migration 034, `AutomationMode.EffectiveAsync`, `AutomationEnv`), A02 (`RunnerRoutes`
helpers), A03 (`AutomationReasons`, `QaRuns.SpendTodayAsync` with draft QA), A04 (publishes, notifications) and A05
(watch tables). Nothing here sets `AUTOMATION_MODE`; no migration, no internal route, no new dependency.

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Automation/StatusRoutes.cs` (new) | `HandleStatus` (`:52`), `HandleRuns` (`:245`), `HandleDecisions` (`:404`), `HandleDecision` (`:480`). |
| `src_C/Vpc/Automation/EvalGate.cs` (new) | The §15.3 constants, `CheckNames` (`:40`), `HandleGate` (`:57`, GET A / POST SA), `HandleRevoke` (`:151`, SA), `Check` (`:195`), `LoadCurrentAsync` (used by status). |
| `src_C/Vpc/VpcFunction.cs` | Six routes after A05's lines in the `// R18A — automation` block (`:357-380`), literals verbatim. |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Statics `status`, `runs`, `decisions`, `eval-gate` (`:178-181`); templates `decisions/:draftId`, `eval-gate/:gateId/revoke` (`:218-219`). |

Tests (new, `[Collection(PostgresCollection.Name)]`): `AutomationStatusRoutesTests.cs`, `EvalGateTests.cs`. Status
tests of global counts run against their own freshly migrated scratch databases (`it_a06_status_main`,
`it_a06_status_shadow`); the other read tests share `it_a06_status` and isolate by deck or runner id; the gate tests
use `it_a06_gate` and revoke every current gate in `finally`. No existing test file changed.

## Routes (A00 §8.4 rows 16–21)

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/api/v1/admin/automation/status` | A (editors allowed) | `StatusRoutes.HandleStatus` |
| GET | `/api/v1/admin/automation/runs` | A | `StatusRoutes.HandleRuns` |
| GET | `/api/v1/admin/automation/decisions` | A | `StatusRoutes.HandleDecisions` |
| GET | `/api/v1/admin/automation/decisions/:draftId` | A | `StatusRoutes.HandleDecision` |
| GET, POST | `/api/v1/admin/automation/eval-gate` | GET A, POST SA | `EvalGate.HandleGate` |
| POST | `/api/v1/admin/automation/eval-gate/:gateId/revoke` | SA | `EvalGate.HandleRevoke` |

Every read route is GET only (405 otherwise), maps `42P01`/`42703` to `503 SERVER_NOT_READY_AUTOMATION` and a bad
filter/limit/cursor to `400 VALIDATION_ERROR`. Agent-client tokens are refused by `AgentClientPolicy` before dispatch
(`403 AGENT_CLIENT_FORBIDDEN`). No route returns a recipient address, a secret, a token or page text.

## Status definitions (A00 §16.2)

- `mode` = `AutomationMode.EffectiveAsync` + `AutomationEnv.AutoPublish()`; `evalGate` = the current gate or null.
- `runners[].stale` = `last_heartbeat_at < now() − AUTOMATION_RUNNER_STALE_MINUTES`; `loginExpiresInDays` = days until
  `login_expires_at`, one decimal, null when unknown. Runners are ordered by `runner_id`.
- `queue.due` = `queued`, `not_before <= now()` and a deck; `doneLast7d` = `done` with `finished_at` in the last 7 days.
- `decisions24h.byState` always lists the six §5.2 states (zeros included); `byReason` lists only the reasons that
  occur (ordinal order). `publishes7d.byState` always lists the five §6.6 states.
- `shadow` over `would_accept` decisions created in the last 30 days; `agreementRate = humanAccepted / humanDecided`
  rounded to 4 dp (away from zero), null when `humanDecided = 0`.
- `spend.todayUsd` / `reservedUsd` from `QaRuns.SpendTodayAsync` (`reservedUsd = OpenCards × AI_QA_EST_USD_PER_CARD`),
  `automationTodayUsd` = today's (UTC) `automation_draft_decisions.estimated_cost_usd`, `dailyCapUsd` =
  `AI_QA_DAILY_USD_CAP` (default 10), both env values read with `QaRuns.DecimalEnv`.
- `watch.failing` = targets with `consecutive_failures >= 3`; `changes7d` = `changed`/`gone` events of the last 7 days.
- `notifications.sent24h` = `sent` with `sent_at` in the last 24 h; `failed24h` = `failed` with `updated_at` in the
  last 24 h; `queued` = `queued` or `enqueue_failed`; `lastSentAt` = the latest `sent_at`.

Runs: `counts.submitted` = the run's decisions; `publishes` = rows with the run's `run_id` or whose `card_ids` overlap
the run's `accepted_card_id`s (the `AutomationTick` summary rule), ordered by id. Decisions: `qa` is null while
`qa_job_id` is null; `question` is cut to 200 UTF-16 units (never inside a surrogate pair). Detail: `card` =
`DraftCard.Parse(stored).ToJson(includeGrounding: false)` (a stored card that no longer parses is returned as stored
minus `source.grounding`); `findings` by id; `events` by id.

## Cursor rule

Runs (`started_at desc, run_id`) and decisions (`created_at desc, draft_id`) page with
`base64url({"v":1,"at":"<ISO>","id":"<id>"})` (`CursorCodec.ToBase64Url` / `FromBase64Url`, version checked with
`CursorCodec.TryReadVersion`). `at` is the last row's stored timestamp in UTC with **microseconds**
(`yyyy-MM-ddTHH:mm:ss.ffffffZ`), so the bound is exact; `id` is the run uuid (`D` format) or the draft id as a decimal
string. The next page is `ts < at or (ts = at and id > cursorId)`, so a same-timestamp batch never repeats or skips.
Anything else (bad base64, not an object, `v ≠ 1`, `at` not in that format, wrong id type) ⇒ `400 VALIDATION_ERROR`.

## Eval gate

POST body = the §15.4 report. Unparseable JSON ⇒ `400 BAD_REQUEST` (the §8.1 convention). Malformed ⇒
`400 EVAL_GATE_INVALID`: not an object; `v ≠ 1`; `kind ≠ "automation-gate"`; `reviewer`/`seeded`/`authored` not
objects; `reviewer.provider|model|promptVersion` not strings; `reviewer.secondProvider|secondModel` missing or neither
string nor null; any count (`reps`, `tp`, `fn`, `wouldAccept`, `wouldAcceptCorrect`, `wouldAcceptCards`,
`defectiveLabeled`, `defectEscaped`) not a non-negative integer; `wouldAcceptCorrect > wouldAccept` or
`defectEscaped > defectiveLabeled`; `recallCi95` / `autoAcceptPrecisionCi95` not two numbers; `perClassRecall` not an
object of numbers; `controlFalsePositiveRate`, `controlUnscoredRate`, `unscoredRate` not numbers. Top-level `passed`
and `failures` are checks, not shape.

`Check` returns these names (in this order, `EvalGate.CheckNames`); `400 EVAL_GATE_FAILED` carries them in
`error.failures` and in the message:

| Check | Fails when |
|---|---|
| `passed` | `passed ≠ true` |
| `failures` | `failures` is not an empty array |
| `reviewer.provider` | not in `AutomationGateProviders` (`bedrock-converse`, exact) |
| `reviewer.model` | blank |
| `reviewer.promptVersion` | `≠ QaRuns.PromptVersion` |
| `reviewer.secondProvider` | not null |
| `reviewer.secondModel` | not null |
| `seeded.reps` | `< 2` |
| `authored.reps` | `< 2` |
| `seeded.recall` | `tp / (tp + fn) < 0.90` or `tp + fn = 0` |
| `seeded.recallCiLower` | `recallCi95[0] < 0.85` |
| `seeded.perClassRecall` | empty, or any value `< 0.75` |
| `seeded.controlFalsePositiveRate` | `> 0.20` |
| `seeded.controlUnscoredRate` | `> 0.02` |
| `authored.autoAcceptPrecision` | `wouldAcceptCorrect / wouldAccept < 0.97` or `wouldAccept = 0` |
| `authored.autoAcceptPrecisionCiLower` | `autoAcceptPrecisionCi95[0] < 0.93` |
| `authored.wouldAcceptCards` | `< 120` |
| `authored.defectEscapeRate` | `defectEscaped / defectiveLabeled > 0.20` or `defectiveLabeled = 0` |
| `authored.unscoredRate` | `> 0.05` |

The report's own `recall`, `autoAcceptPrecision` and `defectEscapeRate` are ignored: core re-computes them from the
counts. Pass ⇒ one `automation_eval_gates` row (`passed = true`, `report_sha256` = lowercase hex SHA-256 of the raw
body bytes, `report` = the body, `created_by_sub` = the caller) whose `metrics` are `seededRecall`,
`seededRecallCiLower`, `autoAcceptPrecision`, `autoAcceptPrecisionCiLower`, `wouldAcceptCards`, `defectEscapeRate`,
`controlFalsePositiveRate`, `seededReps`, `authoredReps` (jsonb: key order is PostgreSQL's). GET ⇒
`{ current, history }` (latest 20 by id desc). Revoke ⇒ `revoked_at = now()`, `revoked_by_sub`; 404
`EVAL_GATE_NOT_FOUND` (unknown or non-numeric), 409 `EVAL_GATE_REVOKED`. A revoke takes effect on the next request:
`EffectiveAsync` reads the latest passed, unrevoked gate on every call.
