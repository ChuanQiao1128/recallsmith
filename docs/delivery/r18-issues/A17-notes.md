# A17 — Automation on the existing console pages (#422)

Frontend only, against contract A00 §16.3. The server fields (§5.10 `automation`, the QA run's
`requestedBySub`, the §13 events and the §14 ledger automations) belong to wave S; here they are
contract-only, and every test mocks the network.

## What was added

- `frontend/src/types/draft.ts`: `DraftAutomation` (with `DraftAutomationQa` and
  `DraftAutomationFinding`). One type serves GET drafts (state/reason/mode) and GET drafts/:draftId
  (plus the optional detail keys); `DraftSummary.automation` is optional, so `Draft` inherits it and
  the untouched test fixtures still type-check.
- `frontend/src/api/drafts.ts`: `normalizeDraftAutomation`. A block without a non-empty `state`, a
  `null` block or a missing key (a server before migration 034) becomes `null`. The detail keys are
  copied only when present in the response.
- `frontend/src/api/qa.ts`: `QaRun.requestedBySub` (optional), read by `normalizeQaRun`.
- `frontend/src/lib/automationSurfaces.ts`: the run-origin labels (verbatim, U+2014), the draft badge
  text and tone, and the `/automation?draftId=` link.
- `frontend/src/features/automation/DraftAutomationPanel.tsx`: the detail panel of the review queue.
  Presentational: no `role`, no raw `<button>`, no hook.
- Review queue: a badge in the list, the panel as the first child of the detail's right-hand column,
  and `automationHref={AUTOMATION_HREF}` on the shell.
- AI QA page: a `qa-run-origin` badge in the Scope cell of "Past runs", and the shell link.
- `WEBHOOK_EVENTS`: the four §13 events after the original four (the server accepts 1..8).
- Ledger: labels for `auto_accept`, `auto_publish`, `source_watch`; `orderedLedgerAutomations` feeds
  the events filter with the six seeded automations, then every other one the baselines or the report
  return. `LEDGER_AUTOMATIONS` is unchanged.

## Decisions

- **No label was missing from A16's `automationRules.ts`.** The state and reason labels come from
  `decisionStateLabel`/`decisionReasonLabel`; nothing had to be mapped locally.
- **`humanAction`** (`accepted | edited_accepted | rejected`, A00 §5.2) is shown as
  "A person accepted / edited and accepted / rejected this draft." with the words mapped inside the
  panel; an unknown value shows as itself.
- **The reason detail of `QA_ERROR`** goes through `qaItemErrorLabel`, so an item error code reads
  as the AI QA page reads it.
