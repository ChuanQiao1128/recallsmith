# F04 — Automation console round 5 (R18F, wave C)

Issue #499. Scope: `frontend/` and this ledger. The base is `delivery/r18f-c`. Every new test below
fails there. I checked by running it with the base `frontend/src`: 12 of the 13 new page and rule
tests fail, and so do the two new TOLERATED tests (`tolerates nothing`, `fails when the server stops
pinning status.live`). Nothing outside `frontend/` changed, and no server change was needed.

Gates: `npm run lint` passes with 0 errors (one existing warning in `DeckListPage.tsx`, not
touched here). `npx vitest run` passes 1383 of 1383. `npm run build` passes.

## Findings

### frontend-console-35
Status: fixed (console side; the server side needs no change for O2)

(a) Runs table (O2):
- `frontend/src/features/automation/RunsTab.tsx:259`: each row now computes
  `splitShown = runSplitShown(...)` once.
  - The counts (`:288`) use it, as before.
  - So does the Publishes cell (`:304-305`, now `data-testid="automation-run-publishes-<runId>"`).
    While the split is hidden, that cell shows `hidden until every draft is decided`
    (`RUN_PUBLISH_HIDDEN_TEXT`, `frontend/src/lib/automationRules.ts:267`), the batch email's wording.
- The cell is hidden even when the run has no publish. A dash there would tell that no draft of the
  run would be accepted.
- The run's Decisions section never showed publishes, so the table cell was the only place to fix.

(b) Overview, while `status.mode.effective` is not `live` (`automationCountsBlind`,
`automationRules.ts:274`; an unknown mode counts as blind, as in `runSplitShown`). Code:
`frontend/src/features/automation/OverviewTab.tsx:126-127, 149-170, 186-192, 211, 356-362`.
- Open exceptions:
  - Hidden: "Drafts waiting for you" (`backlog.humanPending`, with its open-exceptions link) and
    "Oldest waiting since". A non-null oldest routed date also shows that a routed draft exists.
  - Shown in their place: the existing dry-run review-queue line.
  - The "Publishes waiting for you" count stays, because the weekly digest keeps `HumanPublishes`
    in dry run.
  - Hidden: the deck and reason list of those publishes (`humanPublishItems`). A note says the decks
    show on the Runs tab once every draft of their run is decided.
- Decisions (24 h), table and chart: `qa_pending`, `qa_queued`, `would_accept` and `human` are added
  into one row, "Waiting for you or decided".
  - Rules: `BLIND_DECISION_STATES` and `decisionStateBars(..., blind)`, `automationRules.ts:713-735`.
  - `auto_accepted` and `superseded` keep their own rows, because neither can be a pending draft.
  - The "Routed to a person" link goes.
- The by-reason table shows one line saying it is hidden, because only a routed draft has a reason.
- Not changed: the 7-day publishes by state. The digest keeps those in dry run too. I did not take
  the cross-wave alternative, blind-aware numbers from status, because it needs a server change.
  The client-side rule removes every channel the finding names.

Tests:
- `frontend/tests/automationConsoleRound5.test.tsx`
  - `the Runs table hides the publish outcome of a run with pending drafts (frontend-console-35, O2)`:
    - shows no publish state of a dry-run run with pending drafts
    - hides an empty publish list the same way
    - shows the publish once the run's decisions are all loaded and none is pending
    - shows the publish in live mode
  - `the dry-run Overview keeps its counts blind (frontend-console-35)`:
    - no routed-draft count, no per-state would-accept or routed count, no reasons and no publish decks
    - keeps them blind in off mode too
    - shows every count in live mode
- `frontend/tests/automationRulesRound5.test.ts` › `the blind 24-hour split (frontend-console-35)`
- `frontend/tests/e2e/automationConsole.spec.ts`
  - The dense Overview scan now expects the blind publishes note in dry run.
  - New test: the dense live Overview scan (routed count, publish decks), which passes axe.

Existing assertions updated, because the finding makes their old behaviour wrong. They asserted, on
the default dry-run fixture, the very counts that must now be hidden. Each test now runs with an
effective mode of `live`, and its assertions are unchanged:
- `automationConsoleFixes.test.tsx` › `shows the open backlog on the Overview and links it to the
  open exceptions`
- `automationConsoleRound2.test.tsx` › `lists each deck and reason and links its AI QA page and the
  Runs tab`, `points at the Runs tab when the server does not list the decks yet`, and `names the
  drafts link by what it opens, not by its digit (frontend-console-19)`
- `e2e/automationConsole.spec.ts` › the dense dry-run Overview. Its publish-deck list assertion moved
  to the new live test.

### frontend-console-36
Status: fixed

- `frontend/src/lib/automationRules.ts:254`: `decisionListShowsVerdict({ state, reason, openOnly })`
  returns `state !== '' || reason !== '' || openOnly`. The server's `open=true` lists routed rows only.
- `frontend/src/features/automation/DecisionsTab.tsx:153` passes `openOnly`.
- The seen-record effect (`:159-160`) now records only the rows on screen.
- `isOpenDecision` (`automationRules.ts:542`) now checks `state === 'human' && humanAction === null`,
  which is the server's OpenDecisionSql without the run-status part. Without the state check, an
  older server that ignored `open=true` could have put a pending would-accept row on screen with its
  verdict shown.

Tests:
- `automationRulesRound5.test.ts` › `the verdict an open-only list shows (frontend-console-36)`:
  both rule cases.
- `automationConsoleRound5.test.tsx` › `the open-only Decisions list shows the verdict
  (frontend-console-36)`:
  - `?tab=decisions&open=1` shows `Needs you` with no Reveal button, shows the filter note, and
    records the row as seen.
  - A would-accept row that an older server sends is neither listed nor recorded.

Existing test calls updated for the new required parameter, with their assertions unchanged:
- `automationRulesRound4.test.ts:36-39` (`openOnly: false`)
- `automationConsoleRules.test.ts:68-69` (`state: 'human'`)

### frontend-console-37
Status: fixed

- `frontend/tests/automationContractDrift.test.ts:104`:
  - `const TOLERATED: Record<string, string[]> = {};`
  - The `GATE_KEYS.includes('authorConfigId')` conditional is removed, and so is the comment about
    the tolerance "ending by itself".
- `:181`: the `live` section is checked unconditionally. It used to be checked only
  `if ('live' in STATUS)`, which is the same kind of silent tolerance.
- New `describe('no key the console reads hides behind a toleration (frontend-console-37)')`:
  - `tolerates nothing`
  - `fails when the server stops pinning status.live`
  - `fails when the server stops pinning evalGate.authorConfigId`

  The last two build a raw response without the key and prove that the reverse check throws.

## Contract

- O2 (blind Runs table): I implemented it with the same guard as the N5 state split,
  `runSplitShown(counts, effectiveMode, loadedDecisions)`. While the effective mode is not live, the
  Publishes cell of any run that may have an undecided draft shows `hidden until every draft is
  decided`, in the batch email's words. The outcome shows once the counts alone prove nothing is
  pending, or once the run's opened decision list is complete and none of its rows is hidden. The run
  detail (its Decisions section) shows no publish outcome.
- N5/N6 on the Overview: the dry-run Overview now follows the weekly digest's treatment.
  - No routed-pending count.
  - No 24-hour split between the states a pending draft can be in, and no split by reason.
  - No deck list of publishes waiting for a person.
- O1 is not in this wave's paths (services/ai-qa and src_C), so this change does not touch it.
