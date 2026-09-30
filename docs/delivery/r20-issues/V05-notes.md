# V05 notes: card reports API (learner report-a-card, console triage, webhook, status, digest)

Issue #559, contract R20-00 §3 and §4. Zero model cost: no code path added here calls a model; the optional
triage hook only starts an existing AI QA run, which stays off while `AI_QA_ENABLED=0`.

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Db/Migrations/037_card_reports.sql` | New table `card_reports` (§4 columns and CHECKs), partial unique index `uq_card_reports_open (user_sub, stable_uid) where status='open'`, `idx_card_reports_status_created (status, created_at desc)`, plus `idx_card_reports_user_created (user_sub, created_at desc)` for the learner list and the daily count. Widens `ck_webhook_subscriptions_events` with `card.reported` (1..9 events, the 034 part 10 precedent). Idempotent, no extension. |
| `src_C/Vpc/Reports/CardReports.cs` | New. All four handlers, the env readers, the triage hook, and the status/digest counters. |
| `src_C/Vpc/VpcFunction.cs` | Dispatch for the three paths (after the automation block, before Runtime). |
| `src_C/Shared/RecallSmith.Lambda.Db/WebhookEvents.cs` | `SubscribableEvents` gains `card.reported`. |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Known routes: `/api/v1/admin/card-reports`, `/api/v1/user/card-reports`, template `/api/v1/admin/card-reports/:reportId/resolve`. |
| `src_C/Vpc/Automation/StatusRoutes.cs` | `automation/status` gains `cardReports: {open, openedLast7d}`. |
| `src_C/Vpc/Automation/EmailTemplates.cs`, `src_C/Vpc/Automation/AutomationTick.cs` | `WeeklyDigestData` gains `CardReportsOpen`, `CardReportsNew` (default 0); the digest DETAILS gain `Card reports: N open (M new this week)` after the Emails line. |
| `src_C/Vpc/Runtime/AccountDeletion.cs` | `DELETE /api/v1/me` also deletes the learner's `card_reports` rows (the user-keyed-table guard test requires it). The table is checked with `to_regclass` first, so a pre-037 database skips the step instead of failing the transaction. `AccountDeletionResult` gains a trailing `CardReportRows = 0`, logged as a count. |
| `src_C/env/prod.env.json` | `CARD_REPORTS_ENABLED "1"`, `CARD_REPORT_DAILY_LIMIT "5"`, `CARD_REPORT_AI_TRIAGE "0"`. |
| `docs/runbooks/automation-operations.md` | New section "Card reports (R20 V05)". |

## API surface shipped

All responses use the `Res` envelope. No response carries `user_sub` or an email.

Learner (`Auth.RequireUser`: 401 bad token, 403 no sub):

- `POST /api/v1/user/card-reports` body `{deckSlug, stableUid, reason, note?, clientVersion?}`
  - `deckSlug`, `stableUid`: strings, trimmed, 1..128. `reason` ∈ `wrong_answer|outdated|unclear|typo|other`.
    `note`: string or null, trimmed, ≤500 after the trim, empty → null. `clientVersion`: string or null, trimmed, ≤64, empty → null.
  - `200 {reportId, status:"open", duplicate:false}`; an open report by the same user for the same `stableUid` →
    `200 {reportId:<existing>, status:"open", duplicate:true}` (no new row, no webhook, not counted, answered even at the limit).
  - `400 VALIDATION_ERROR` (also for invalid JSON), `404 CARD_NOT_FOUND` (deck slug or card uid unknown or deleted; since R20X F02 also a card
    the learner cannot see: a `coming`/`retired` deck, or a premium deck without an active entitlement),
    `429 REPORT_DAILY_LIMIT` (reports created by the user since 00:00 UTC, any status, ≥ limit),
    `503 CARD_REPORTS_DISABLED`, `503 NOT_READY`.
- `GET /api/v1/user/card-reports?limit=50` (1..100) → `{items:[{reportId, deckSlug, stableUid, question, reason, status,
  resolution, resolutionNote, createdAt, resolvedAt}]}`, own reports only, newest first, `question` ≤200 chars (null when the card row is gone). Corrected in R20X F02: this read
  the live `cards` row, the admin's working copy with possibly unpublished edits; it now returns the question captured when
  the report was created (`card_reports.question`, migration `041_card_reports_question.sql`), null for older reports.
  The learner's own note is not echoed back (not in the §4 shape).

Console (`Auth.RequireAdmin`):

- `GET /api/v1/admin/card-reports?status=open|resolved|all&deckId=&limit=50&cursor=` (default `open`, limit 1..100) →
  `{items:[{reportId, deckId, deckSlug, cardId, stableUid, question, reason, note, status, resolution, resolutionNote,
  clientVersion, createdAt, resolvedAt}], nextCursor}`. Newest first by id; `nextCursor` is the same base64url id cursor
  as the drafts list. `deckId` given → `Helpers.RequireDeckRead` (403 without the grant). Non-super_admin without
  `deckId` → only decks with `can_read=1`. super_admin sees all.
- `POST /api/v1/admin/card-reports/:reportId/resolve` body `{resolution, note?}` (`fixed|wont_fix|duplicate|invalid`,
  note ≤500 after trim) → `{reportId, status:"resolved", resolution}`. Deck write (`Helpers.RequireDeckWrite`,
  super_admin always allowed; a report without a deck id is super_admin only). `404 REPORT_NOT_FOUND` (unknown or non-numeric id),
  `409 ALREADY_RESOLVED` (the update is `where status='open'`, so a race resolves once).

Side effects:

- Webhook `card.reported` `{reportId, deckSlug, stableUid, reason, createdAt}` after commit, new reports only.
- `automation/status.cardReports = {open, openedLast7d}`: open = status open; openedLast7d = created in the last 7 days, any status. Zeros before 037.
- Weekly digest line `Card reports: N open (M new this week)`: N = open now, M = created in the digest week `[from, to+1d)`. Zeros before 037.
- AI triage hook (`CardReports.TriageAsync`): only when `CARD_REPORT_AI_TRIAGE` is truthy, calls
  `QaRuns.StartCardsRunAsync(conn, deckId, [cardId], "card_report", "card_report", profile: null)`. With AI QA off
  that returns null: nothing recorded, report stays for the human. It never throws and never touches the note.

Concurrency: the POST runs in one transaction under `pg_advisory_xact_lock(hashtext('card_reports:' || user_sub))`, so the
duplicate check, the daily count and the insert of one learner are serialised (tested with 6 parallel posts at limit 2).

Missing table: every route catches SQLSTATE 42P01/42703 → `503 NOT_READY` ("Run the database migration (037_card_reports)").

Logging: `tag=card_reports` lines carry only `reportId`, `deckId`, `reason`, `resolution`, outcome. The note, the
resolution note and the user sub are never logged.

## Tests

`src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardReportsTests.cs` (36 cases incl. an 11-row invalid-body theory):
happy path with a hostile note stored as is; empty note → null and the 500-after-trim cap; validation; 404 for unknown
deck, unknown uid, deleted card, deleted deck; duplicates (same id, `duplicate:true`, not counted, answered at the
limit, other learners unaffected, re-report after resolve); daily limit (yesterday's reports ignored, resolved-today
counted, per user, read per call); concurrent posts never exceed the limit; learner 401/403/405; disabled 503 (and unset = on);
learner GET shape, ownership, order, truncation, no note/sub; console list shape, note present, no sub/email, keyset
paging, status filter, validation; deck scoping (grant, 403 on other deck, no grant = empty, super_admin all); console
401/403 (incl. a non-console token); resolve 403 without write, validation, happy path, 409, 404; webhook data keys
with no note/user and no event for a duplicate; the widened CHECK; triage off, on with AI QA off (no run, returns null,
no throw), on with AI QA on (one `scope=cards` run of that card, message without note or sub); status field counts;
digest line; digest week counter; account deletion removes only the learner's reports; the pre-037 scratch database (all four routes 503 NOT_READY, status and counters zero, account deletion skips the table).

Updated: `AutomationStatusRoutesTests.cs` (status contract gains `cardReports`), `EmailTemplatesTests.cs` (digest
golden gains the line), `RouteMetricsTests.cs` (the two static routes label themselves), `WebhookAdminRoutesTests.cs` (nine subscribable events; the too-many case is now ten), `AccountDeletionTests.cs` (`card_reports` is a user-keyed table; seeded and counted).

Commands run:

- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~CardReport"` (from `src_C`): 36 passed.
- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (from `src_C`): full suite, 2787 passed, 0 failed.

## Owner steps

1. Deploy the code, then run the migration (`scripts/invoke-as-admin.sh ... /api/v1/admin/db/migrate`) so 037 applies.
2. Leave `CARD_REPORT_AI_TRIAGE` at `"0"` until Bedrock is allowlisted and `AI_QA_ENABLED` is on.
3. The mobile flag (`features.cardReport.enabled`, V11) stays off until the App Store privacy label covers
   user-submitted report text (R20-00 §9 step 4).

## Deferred / notes

- No admin-audit row on resolve (the §4 contract does not ask for one; `resolved_by_sub` and `resolved_at` record who and when).
- No per-report email (contract).
- `requested_by_sub = card_report` makes a triage run count as a "human run" in the digest's AI QA spend split
  (the split only separates `automation`).
- The unique open report is per `(user_sub, stable_uid)` as the contract fixes it, so the same uid in two decks shares one open report per learner.

## R20X F02 corrections

See `docs/delivery/r20-issues/F02-fixes.md` (finding s-security-2). `POST /api/v1/user/card-reports` looked the card up by
slug and uid only, so any signed-in learner could confirm that a card of a coming, retired or premium deck exists and read
its current question through the GET. Now only cards the learner can see are reportable, and the GET returns the question
captured at report time. Tests: `CardReport_Post_OnlyCardsTheLearnerCanSee`,
`CardReport_GetMine_ReturnsTheQuestionCapturedAtReportTime_NotTheWorkingCopy`.
