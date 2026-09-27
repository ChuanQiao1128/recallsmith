# G04 — Automation console round 6 (R18G, wave C)

Issue #507. Scope: `frontend/` and this ledger. The base is `delivery/r18g-c` (`release/r18e` @ 5ac399d).
Every new test below fails on the base: with the base `frontend/src`, 9 of the 16 tests in
`reviewVerdictShown.test.tsx` and 7 of the 11 tests in the new `automationConsoleRound6.test.tsx` fail. The
4 that pass there are the control cases: live mode, the would_accept filter, the unfiltered list, and the
dry-run wording. The new Playwright case fails on the base `RunsTab.tsx` with
`color-contrast: td:nth-child(9) > .text-slate-500.text-xs`. Nothing outside `frontend/` changed, and no
server change was needed.

Gates: `npm run lint` passes with 0 errors (one existing warning in `DeckListPage.tsx`, not touched here).
`npx vitest run` passes 1401 of 1401. `npm run build` passes. `npx playwright test` passes 16 of 16,
including all 12 tests of `tests/e2e/automationConsole.spec.ts`.

## Findings

### frontend-console-38
Status: fixed (P4)

- `frontend/src/features/automation/DraftAutomationPanel.tsx:51-75`: removed the branch that showed the
  findings before the decision, along with its `qaFindingsShown` prop. Every blinded dry-run draft now
  renders the same neutral panel.
  - The copy no longer claims "hidden for every dry-run draft". It now reads: the verdict, reason and
    findings stay hidden until you decide, and blocker or major QA issues, if any, show when you accept,
    before the card is created. Every blinded draft gets the same sentence, so it tells nothing.
  - `FindingList` is exported for reuse.
- New `frontend/src/features/automation/QaFindingsStep.tsx`: a modal dialog titled "AI QA found a
  blocker or major issue".
  - It lists the reviewer and the blocker and major findings, and offers `Back` and `Accept anyway`.
  - Focus opens on Back, Tab stays inside the dialog, and Escape or a press on the overlay means Back.
- `frontend/src/pages/ReviewQueuePage.tsx:476-534`: `confirmQaFindings(draft)` runs after the click and
  before the request, in both `onAccept` and `onAcceptEdited`. It applies only when
  `automationQaFindingsShown(...)` is true.
  - Opening the step calls `markVerdictSeen(draftId)`. So the accept, or any later decision after Back,
    sends `verdictShown: true`.
  - Back cancels the request. In the edit form it leaves the form open with the message "Not accepted
    yet: you went back to the draft after reading the AI QA findings."
  - A would-accept draft never gets the step, so its decision stays blind.
  - Reject needs no step and keeps the after-decision reveal (`revealedOf`).
  - The dialog is rendered at `:1055-1057`. If the page unmounts, a pending step resolves as Back.
- `frontend/src/lib/automationSurfaces.ts:52-84`: `verdictShownFor` no longer treats a flagged draft as
  shown. The panel no longer shows its findings, so the only source of "shown" is the recorded reveal.
  `automationQaFindingsShown` keeps its rule and now decides only whether the step opens.
- Tests (`frontend/tests/reviewVerdictShown.test.tsx`):
  - `renders a flagged draft and a would-accept draft with the identical neutral panel before the
    decision`
  - `keeps the flagged findings out of the page until Accept is clicked`
  - `shows the blocker and major findings in a step after Accept, before the request`
  - `records the verdict as seen when the person backs out, so a later reject is not blind`
  - `goes back on Escape`
  - `shows the step for Accept with edits too, and backing out keeps the form open`
  - `never shows the step for a would-accept draft, whose accept stays blind`
  - `rejects a flagged draft without a step, blind`
- Existing assertions I updated because this finding makes the old behaviour wrong:
  - `decides the pure rule`: `verdictShownFor(QA_FLAGGED, 'pending', false)` is now `false`, and a case
    with `seenElsewhere=true` was added.
  - `shows the blocker and major findings before the decision, without the decision link` asserted that
    the two panels differ. The identical-panel test above replaces it.
  - `warns after accepting a blinded QA-flagged draft …` now clicks `Accept anyway` in the step.
- The Playwright spec never asserted the old flagged panel, so it needed no change for this finding.

### frontend-console-39
Status: fixed (the minimal client option; the server-side `decided` filter on GET …/status is for the
backend wave)

- `frontend/src/features/automation/OverviewTab.tsx:458-472`: while the counts are blind (any effective
  mode but live), the Publishes (7 days) card leaves out `would_publish` and `human`. In their place is
  one line, "Dry-run outcome: hidden until every draft is decided" (`data-testid="automation-publishes-blind"`,
  the Runs cell's `RUN_PUBLISH_HIDDEN_TEXT`). Waiting, Publishing and Published still show.
- `frontend/src/lib/automationRules.ts:288-296`: `BLIND_PUBLISH_STATES`, with the rationale.
- Tests (`frontend/tests/automationConsoleRound6.test.tsx`):
  - `shows one hidden Dry-run outcome line in place of the would-publish and needs-you counts`
  - `keeps it blind in off mode`
  - `shows the split in live mode`
- The e2e dense Overview asserts the line (`tests/e2e/automationConsole.spec.ts`).
- Not done: making the go-live "human-route reasons" review work without de-blinding. That needs the
  server to apply the digest's `decided`/`publishDecided` filters in `StatusRoutes.cs`, which is
  `src_C`, outside this issue's paths.

### frontend-console-40
Status: fixed

- `frontend/src/lib/automationRules.ts:298-313`:
  - `decisionListWithholdsPending(filters)` is true for a verdict-revealing filter
    (`decisionListShowsVerdict`), except `state=would_accept`. That filter names the shadow
    agreement's own population. The drafts it leaves out are not counted by that agreement.
  - `PENDING_WITHHELD_TEXT` is the count-free note.
- `frontend/src/features/automation/DecisionsTab.tsx:155-171, 265-272`:
  - Such a list drops every pending dry-run row (`decisionVerdictHidden`), so the routed set can no
    longer reveal the would-accept complement by elimination.
  - The mark-as-seen effect marks only the rows on screen.
  - The note shows whenever the filter withholds, even when nothing was left out, so it tells nothing.
  - The open-only "N decided by a person is hidden" count uses the open filter alone (`openShown`), so
    it never counts withheld rows.
- Tests (`frontend/tests/automationConsoleRound6.test.tsx`):
  - `lists no pending dry-run row under state=human and records none as seen` (the audit's probe
    `?tab=decisions&state=human`)
  - `shows the note even when no pending row was left out, so it tells nothing`
  - `keeps the pending rows of a would_accept list and records them as seen`
  - `leaves the unfiltered list as it was: every row listed, the pending ones hidden`
- Existing tests I updated because this finding makes the old behaviour wrong:
  - `automationConsoleRound4.test.tsx`: `records the rows of any state-filtered list as seen, the open
    exceptions too` and `records the rows of a reason-filtered list as seen` are replaced by
    `records the rows of a would_accept-filtered list as seen` and `withholds the pending dry-run rows
    of the open exceptions and of a reason-filtered list`.
  - `automationConsoleRound5.test.tsx` (frontend-console-36): the open-only test now uses a live routed
    row (`shows each live routed row and the filter note with only the checkbox ticked`). The
    dropped-row test now also asserts the pending routed row is withheld and not recorded.
  - Filter and paging tests whose subject is not blinding now use `mode: 'live'` rows, because a
    pending dry-run row is withheld under their filter. Their assertions did not change:
    - `automationConsoleFixes.test.tsx`: `reads its filters from the URL, writes them back, and filters
      to open items`, and both `Load more never mixes two lists` Decisions tests.
    - `automationConsoleRound2.test.tsx`: the three `open exceptions come from the server` tests.
  - Two label tests call `markVerdictSeen(41)` first. They had depended on an earlier test in the same
    file recording draft 41 as seen through a filtered list:
    - `labels a QA_ERROR detail, the mode and the statuses`
    - `labels the run kind, the watch kind and feed format, and a finding severity`

### frontend-console-41
Status: partially fixed ((a) and (b) fixed; (c) declined: `docs/runbooks` is another wave's root)

- (a) `frontend/src/features/automation/OverviewTab.tsx:186-209`: `humanPublishItems` are no longer gated
  on `blind`. The server lists live rows only (`OpenHumanPublishSql` has `p.mode = 'live'`). Their drafts
  were auto-accepted, so their decks tell no dry-run verdict.
  - After a rollback or a gate revoke, the decks and reasons stay listed with their AI QA links.
  - `BLIND_PUBLISHES_TEXT`, which falsely said the decks reveal a verdict, is removed.
  - The routed-draft count stays blind.
  - `frontend/tests/support/automationFixtures.ts` has a comment that these are live rows.
- (b) `frontend/src/lib/automationRules.ts:278-286` adds `blindNotePrefix(effective)`, which returns
  "Dry run", "Automation off" or "Outside live mode". `OverviewTab.tsx:130, 213, 359` use it for the
  review-queue line and the by-reason note. Off mode no longer says "Dry run".
- (c) Declined: `docs/runbooks/automation-operations.md:288-290` is not in this issue's allowed paths.
  The issue's "Do NOT" list forbids touching docs/runbooks. The runbook owner should change that line
  to: the dry-run Overview merges the states a pending draft can be in into one row, hides the split
  by reason, and hides the would-publish / needs-you split of the 7-day publishes.
- Tests (`frontend/tests/automationConsoleRound6.test.tsx`):
  - `lists the live publishes waiting for a person by deck outside live mode`
  - `words the blind notes by mode: never "Dry run" in off mode`
  - `keeps the dry-run words in dry run`
- Existing assertion I updated because this finding makes the old behaviour wrong:
  `automationConsoleRound5.test.tsx` no longer expects the deck list to be absent in dry run. The
  test is renamed `shows no routed-draft count, no per-state would-accept or routed count and no
  reasons`.
- The e2e dense dry-run Overview now expects the two listed decks, not `automation-backlog-publishes-blind`.

### frontend-console-42
Status: fixed

- `frontend/src/features/automation/RunsTab.tsx:299, 306`: both hidden notes now use `text-slate-600`
  (6.78:1 on `bg-indigo-50`) instead of `text-slate-500` (4.26:1).
- Tests:
  - `draws both hidden notes in text-slate-600 on the indigo-50 row the email link opens`
    (`automationConsoleRound6.test.tsx`).
  - New Playwright case `the dry-run run the batch email links, highlighted with its hidden-split notes,
    has no axe violation` (`tests/e2e/automationConsole.spec.ts`). It opens
    `/automation?tab=runs&runId=<RUN_ID>` in dry run with a run whose drafts may be pending. On the base
    classes it reports `color-contrast`.

## Contract

- P4 (one neutral blind panel): implemented in the review queue.
  - Every blinded pending dry-run draft renders the same neutral `DraftAutomationPanel`, and the list
    badge was already identical.
  - For a QA_FLAGGED draft with blocker + major > 0 (`automationQaFindingsShown`), Accept and Accept
    with edits open `QaFindingsStep` after the click and before the request, with `Accept anyway` and
    `Back`.
  - Opening the step calls `markVerdictSeen(draftId)`. `verdictShownFor` then answers true through
    `verdictSeenElsewhere`, so the accept, or any later decision, sends `verdictShown: true`.
  - Reject has no step. A would-accept draft never sees one, so its decision is still sent as blind.
- P1–P3 are not in this wave's paths (core-vpc, src_C, tools/mcp-server), so this change does not touch
  them.
- K1–K7, L1–L6, M1–M6, N1–N6 and O1–O2 stay in force. N5 is tightened: filtered Decisions lists withhold
  pending dry-run rows. O2's Runs guard is unchanged apart from the note colour.
