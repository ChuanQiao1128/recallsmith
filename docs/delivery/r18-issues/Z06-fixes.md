# Z06 — console round 3: per-finding fixes ledger

Issue #390, wave r18z-c. Scope: `frontend/` and this directory only. Every
fix below first got a test that fails on the base `delivery/r18z-c` tree
(checked by reverting `frontend/src` and re-running the named tests), then the
fix. Paths are relative to `frontend/`.

Gates run on the final tree: `npx tsc -b` (clean), `npx eslint .` (0 errors;
the one warning, `DeckListPage.tsx` `react-hooks/exhaustive-deps` at the
publish-jobs effect, is pre-existing and untouched), `npx vitest run`
(127 files, 1170 tests, all pass), `npx playwright test` (4 smokes, all pass).

Server-side halves that sit outside Z06's paths (`src_C`) are named under the
finding as hand-offs; the console reads each field when it is present and
keeps its current behaviour when it is not.

### frontend-console-19

Status: fixed

Root cause: `useUnsavedChangesGuard`'s blocker returned on `!moves` before it
read the one-shot allowance, so a `setSearchParams` that landed on the same URL
(the review queue's auto-selected draft, where the URL never carries a
`draftId`) left the allowance armed. The next real navigation, over new edits
on the auto-opened draft, went through with no prompt.

- `src/hooks/useUnsavedChangesGuard.ts:54-57`: the blocker now reads and clears
  the allowance on every call, moving or not
  (`const allow = allowRef.current; allowRef.current = false; if (!moves || allow) return false; return dirty;`).
  The doc comment now says it covers exactly the next navigation attempt.
- `src/pages/ReviewQueuePage.tsx:427`: `decide()` arms the allowance only when
  the URL carries a `draftId` (`if (draftIdParam !== null) guard.allowNextNavigation();`),
  i.e. only when the navigation will move.

Tests:
- `tests/reviewQueuePage.test.tsx` › "guards edits on the draft that auto-opens
  after an accept (frontend-console-19, round 3)": lands on `/review?deckId=7`,
  Accepts 41, 42 auto-opens, Edit, change the question, click "AI QA" → the
  confirm is asked and the page stays.
- `tests/unsavedChangesGuard.test.tsx` › "spends the allowance on a navigation
  that does not move (frontend-console-19, round 3)".
- The existing "does not ask again after the edits are accepted" still passes
  (it now passes on the intended path, not on the leak).

### frontend-console-23

Status: partially fixed (console side fixed; the server's `data.limits.estUsdPerCard` is a hand-off)

- `src/lib/qaReview.ts:86-97`: the estimate now prices a card at what the server
  reserves against the cap. `QA_EST_USD_PER_CARD_DEFAULT = 0.05` mirrors
  `QaRuns.DefaultEstUsdPerCard`; `estimateQaCostUsd(cardCount, perCardUsd)` uses
  the rate the status reports when present. The token-price constants
  ($0.045/card) are gone: they priced something the server never reserves.
- `src/api/qa.ts:268` and `QaStatus.estUsdPerCard`: read `data.limits.estUsdPerCard`
  when the server sends it; `src/lib/qaReview.ts:74` carries it in `QaLimits`.
- `src/pages/DeckQaPage.tsx:399`: the estimate, the cap warning and Start use it.
- `src/lib/qaReview.ts:236-245`: an `AI_QA_DAILY_CAP` refusal keeps the server's
  text (spent, reserved, this run's estimate) and adds "Narrow the scope, or try
  again after midnight UTC."; with no server text the fixed line now says the
  same thing instead of "has reached the daily cap".
- `src/pages/DeckQaPage.tsx:443`: after that refusal the status is reloaded, so
  the limits line catches up with the spend the refusal was computed from.

Hand-off (outside `frontend/`): QaRuns.cs `data.limits` should add
`estUsdPerCard` (the `AI_QA_EST_USD_PER_CARD` value). Until then the console
prices at the server's documented default, which is what the server reserves
unless the env var is overridden.

Tests:
- `tests/deckQaPage.test.tsx` › "prices the run at the server's per-card
  reservation and warns before the server refuses (frontend-console-23)" (the
  finding's example: cap $10, $2 spent, 170 cards → $8.50, warning shown; a
  reported $0.04 rate wins).
- `tests/deckQaPage.test.tsx` › "maps a run already in progress and the daily
  cap to plain messages": assertion inverted as the finding asks (it pinned the
  discarding of the server text; it now pins that the text is kept and the
  status is reloaded).
- `tests/qaReview.test.ts` › "estimates cost at the server's per-card
  reservation, the reported rate first (frontend-console-23)" (updated from
  $0.045, which the finding makes wrong) and the `AI_QA_DAILY_CAP` cases in
  "uses the server run limits…".
- `tests/qaApi.test.ts` › "reads the run limits and today's spend…" (reads
  `estUsdPerCard`).

### frontend-console-24

Status: fixed

- `src/pages/DeckQaPage.tsx:82-88, 191-194, 410-424`: scope and the "Selected
  cards" ids live in one `ScopeState { forDeckId, scope, ids }`; the page derives
  `scope`/`selected` only when `forDeckId === deckId`, else `'changed'` and an
  empty set — the same keyed-by-deck pattern as every other state on the page.
  `chooseScope`/`toggleCard` write the current deck's key.

Tests:
- `tests/deckQaPage.test.tsx` › "drops the selected cards when the deck changes
  under the mounted page (frontend-console-24)": selects a card on deck 7,
  `router.navigate('/decks/qa?deckId=8')` on the same mounted page, expects
  Changed cards, 0 cards, Start disabled, every checkbox unchecked, and a new
  selection sends deck 8's id only.

### frontend-console-25

Status: fixed

- `src/components/CardForm.tsx:441`: the form's error box has `id="card-form-error"`
  and `role="alert"`, so every refusal (the review queue's lint and
  `STABLE_UID_TAKEN`, the source checks, a server message) is announced.
- `src/components/CardForm.tsx:96-108, 366-382, 416-418`: an error from a source
  check sets `errorField: 'source'`; then `sourceUrl` and `sourceQuote` get
  `aria-invalid="true"` and `aria-describedby="source-help card-form-error"`.
  `#source-help` is linked in both variants now, not only for drafts.
- `src/pages/WebhooksPage.tsx:297, 311, 334`: a successful Save, Enable/Disable
  and Delete write "Subscription X saved/disabled/enabled/deleted." to the
  page's live region.

Tests:
- `tests/cardFormSource.test.tsx` › "announces a source refusal and ties it to
  the source inputs (frontend-console-25)" and "announces a refusal that comes
  back from onSubmit (frontend-console-25)".
- `tests/webhooksPage.test.tsx` › "announces a save, a disable and a delete, not
  only the table change (frontend-console-25)".

### frontend-console-26

Status: fixed

- `src/pages/LedgerPage.tsx:357-364`: the Hours saved tile reads
  "Live: 11.3 h · Inferred from history: 3.0 h" — two parallel, disjoint parts
  of the headline. "measured/default" is kept only for the baseline line
  ("On measured baselines: … · on default baselines: …").
- `src/api/ledger.ts:12-16`: the type comment no longer calls `live` "measured".

Tests:
- `tests/ledgerPage.test.tsx` › "splits hours saved into live and inferred
  history…": updated as the finding asks (it pinned "Live (measured)" and
  "of which inferred from history"); it now also asserts neither phrase remains.

### frontend-console-27

Status: fixed

- `src/components/console/ConsoleShell.tsx:53-63, 99-104, 124-172`: each
  section link gets `aria-current="page"` and an active look
  (`bg-indigo-50 border-indigo-300 text-indigo-700`) when it is the section on
  screen, and every link carries the HITL pages' focus-visible ring. The links
  are grouped: Decks, Review queue, AI QA, Content Intelligence, then Automation
  ledger, then the super_admin sections (Webhooks, Admin Management).
- `src/components/console/consoleNav.ts:37-49`: `consoleSectionFor(pathname)`
  maps a path to its section (the deck list and its card/deck pages are Decks;
  `/decks/qa` is AI QA). It lives here, not in ConsoleShell, because
  `react-refresh/only-export-components` forbids a non-component export there.

Tests:
- `tests/consoleNavEverywhere.test.tsx` › "marks the link of the page on screen
  with aria-current and an active look, and no other" and "orders the links
  authoring first, then the ledger, then the super_admin sections".
- `tests/contentIntelligencePage.test.tsx` › "groups the section links into one
  navigation landmark": order updated (the finding changes it) and
  aria-current asserted.
- `tests/e2e/authoringConsole.spec.ts` Smoke 3 asserts `aria-current="page"`
  on each HITL link after its click.
- `tests/deckListSplitParity.test.tsx`: B1 hashes and the diagnostic snapshot
  re-measured, with the verification recorded above the table (markup outside
  `<nav>` identical; +78 B of focus-ring classes per link; no other change).

### frontend-console-28

Status: fixed

- `package.json`/`package-lock.json`: one devDependency, `@axe-core/playwright`
  pinned at `4.13.0` (it brings `axe-core` 4.13.0); lockfile updated, integrity
  hashes verified against the tarballs. No runtime dependency.
- `tests/e2e/authoringConsole.spec.ts:478-495`: Smoke 3 runs
  `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()` after each
  of the four HITL routes renders and expects zero violations.
- `tests/e2e/authoringConsole.spec.ts:505-689`: new Smoke 4 opens the review
  queue with a grounded draft (draft view, reject form, edit form with a source
  error) and AI QA with a run and findings (and the Selected cards list) and
  scans each state.
- The scans found real failures, fixed here: the ledger's range line and the
  HITL pages' deck line (`text-slate-500` on `bg-slate-100`, about 4.3:1 →
  `text-slate-600`; `LedgerPage.tsx:410`, `ReviewQueuePage.tsx:495`,
  `DeckQaPage.tsx:548`), the deck line's "Cards" link distinguished by colour
  alone (now underlined), the code preview's language label
  (`text-slate-400` → `text-slate-500`) and the highlight.js comment colour
  (`src/components/codePreview.css`, #5c6370 → #9ca3af on #282c34).
- The second-draft guard test is under frontend-console-19.

Tests: `npx playwright test` › "each HITL route loads its own chunk from the
built bundle and renders its heading" and "the review queue and AI QA with a
deck open pass a WCAG 2 A/AA scan". Before the fixes above, the first failed on
`color-contrast: p[data-testid="ledger-range"]` and the second on
`link-in-text-block` and `color-contrast: .text-[10px], .hljs-comment`.

### automation-16

Status: partially fixed (the console sends the time and shows the draft count; a QA-resolution count in the ledger response is a server hand-off)

- `src/api/qa.ts:355-364`: `resolveQaFinding` takes `reviewMs`.
- `src/pages/DeckQaPage.tsx`: a visibility-aware triage clock (the draft
  review's `ReviewClock`, capped at `REVIEW_MS_CAP`, 30 min, as
  `QaRuns.ParseResolveBody` caps) starts when the shown run's findings appear
  and restarts after each resolution, so time on a run is split across its
  findings rather than counted once per finding; `onResolve` sends it
  (`:509`).
- `src/api/ledger.ts:58, 213` and `src/pages/LedgerPage.tsx:382-385`: the
  `agentDrafts.reviewNotMeasured` count the API already returns is read and
  shown in the AI draft quality tile ("N decision(s) without measured review
  time").

Hand-off (outside `frontend/`): the ledger response has no count of QA
resolutions without a review time; LedgerRoutes.cs would need to add one
before the console can show it.

Tests:
- `tests/deckQaPage.test.tsx` › "sends the visible triage time with each
  resolution (automation-16)" (12 s → ≈12 000 ms; restarts; capped at 30 min).
- `tests/qaApi.test.ts` › "sends the measured triage time with a resolution
  (automation-16)".
- `tests/ledgerPage.test.tsx` › "shows the AI draft quality tile from
  agentDrafts (automation-4)" (now also the unmeasured count);
  `tests/ledgerApi.test.ts` › "keeps the live/backfill split…" (reads it).
- Two existing resolve assertions in `tests/deckQaPage.test.tsx` now expect
  `reviewMs: expect.any(Number)` in the body, which this finding requires.

### automation-1

Status: partially fixed (sweep button and stranded-row rule done; `enqueuedAt` in the delivery list and any schedule are server hand-offs)

- `src/api/webhooks.ts:152-170`: `sweepWebhookDeliveries()` posts
  `/api/v1/admin/webhooks/deliveries/sweep` and reads `swept`, `resent`,
  `enqueueFailures`, `deliveryIds`.
- `src/pages/WebhooksPage.tsx:376-408, 655-668`: a "Re-send stranded
  deliveries" button (the page is super_admin-only) with a double-click guard;
  the result ("Re-sent 2 of 3 stranded deliveries; 1 failed to enqueue again.",
  "No stranded deliveries to re-send.", or the error) is shown and written to
  the live region, and the delivery log reloads.
- `src/lib/webhookRules.ts:158-178`: `isRedeliverable(status, row, now)` also
  allows a `'queued'` row the list reports with `enqueuedAt: null` that has sat
  `WEBHOOK_STRANDED_AFTER_MS` (10 min, the server's `SweepStuckAfter`). A row
  whose `enqueuedAt` the server does not report is treated as in flight, so
  today's list keeps today's behaviour. `src/api/webhooks.ts:34-38` types the
  optional field; `WebhooksPage.tsx:786` passes the row.

Hand-off (outside `frontend/`): WebhookDeliveries.cs should add
`enqueued_at as "enqueuedAt"` to the list query; a scheduled sweep, or a
RUNBOOK §7 note that the enqueue-failures alarm is the only trigger, belongs to
the infra/docs owners.

Tests:
- `tests/webhooksPage.test.tsx` › "re-sends stranded deliveries from the page
  and announces the result (automation-1)" and "offers Redeliver for a queued
  delivery that was never sent and has sat 10 minutes (automation-1)".
- `tests/webhooksApi.test.ts` › "sweeps stranded deliveries through POST
  /api/v1/admin/webhooks/deliveries/sweep (automation-1)".
- `tests/webhookRules.test.ts` › "offers redelivery only for settled
  deliveries" (extended with the stranded cases).

### automation-6

Status: fixed

- `src/lib/webhookRules.ts:34-74`: `WEBHOOK_VERIFY_SNIPPET` reads both
  `x-developercards-signature` and `x-developercards-signature-previous`,
  accepts a match on either, checks each against `/^[0-9a-f]{64}$/`, and
  compares the decoded 32-byte digests with `timingSafeEqual`.
  `WEBHOOK_PREVIOUS_SIGNATURE_HEADER` names the header.
- `src/pages/WebhooksPage.tsx:846-852`: the page's verification text tells the
  integrator to accept either header during a rotation.

Tests: `tests/webhookRules.test.ts` › "verifies the §6.3 vector sent as the
primary or the rotation header (automation-6)" runs the snippet as pasted
(minus the ESM wrapper) against the §6.3 vector as the primary, as the previous
signature beside a wrong primary, and alone as the previous one, and refuses
upper-case, short, wrong and body-tampered signatures without throwing.

### automation-17

Status: partially fixed (console chain done; an additive `qa.run.completed` webhook event is a server hand-off, replaced here by the in-page notice the finding offers as the alternative)

- `src/pages/ReviewQueuePage.tsx`: when AI QA is enabled for the deck (GET
  qa/status), the review queue offers "Run AI QA on accepted cards" (off by
  default, since a run spends model budget); Accept and Accept with edits then
  send `runQa: true` (`:436, :450`). The outcome shows what became of the
  chained run: "AI QA review queued." with an "Open AI QA run" link to
  `qaPageHref(deckId, runId)`, or "AI QA did not start: <message>." — chain
  errors are surfaced, not dropped (`chainedQaText`, `:110-124`; `:548-562`).
- `src/api/drafts.ts:226-257`, `src/types/draft.ts`: `acceptDraft` sends
  `runQa` and reads the response's `qa` block.
- `src/api/httpFailure.ts:52-66`, `src/types/api.ts`: a failure envelope's
  `error.runId` and `error.qaRun` are kept.
- `src/pages/DeckListPage.tsx:500-518`: an `AI_QA_REQUIRED` refusal links to
  `qaPageHref(deckId, error.runId)` and, when the gate's chained run did not
  start, says so ("AI QA could not start a review run: …").
- `src/pages/DeckQaPage.tsx:341, 799-809`: when a run the page was watching
  finishes with no blocker and the refreshed gate no longer blocks, the page
  says "The review finished with no blockers" with a "Publish now from the deck
  list" link, so the author need not keep polling.

Tests:
- `tests/reviewQueuePage.test.tsx` › "offers to chain an AI QA run on accept
  when AI QA is on, and says what became of it (automation-17)".
- `tests/draftsApi.test.ts` › "sends runQa and reads the chained AI QA run back
  (automation-17)".
- `tests/deckListQaGate.test.tsx` › "links the refusal to the run the gate
  chained, and says when it could not start (automation-17)".
- `tests/apiEnvelopeOnHttpError.test.ts` › "keeps the chained run of a 409
  AI_QA_REQUIRED from the publish gate (automation-17)".
- `tests/deckQaPage.test.tsx` › "says the deck can be published once a watched
  run finishes with no blocker (automation-17)".

### ai-agent-24

Status: partially fixed (console side of the r18z-c contract; the MCP server (Z05) and core-vpc (Z01) sides belong to those waves)

The cross-wave contract fixes the placement at
`card.source.grounding = { chunkId, sourceId, matched: true, quoteChars }`,
which is where the console already read it. Console changes:

- `src/pages/ReviewQueuePage.tsx:723-731`: a draft with no grounding now says
  so — "Not grounded · Submitted outside the MCP server: check the quote against
  the source yourself." — instead of looking the same as a checked draft.
- `src/types/draft.ts`: the `DraftGrounding` comment now states the r18z-c
  contract (sent inside `card.source`, kept on the draft, stripped on accept).
- Accept with edits already rebuilds `source` as `{ url, quote }`
  (`src/lib/draftReview.ts` `formValuesToDraftCard`), so grounding never
  reaches a published card from the console; the new test pins it.

Tests:
- `tests/reviewQueuePage.test.tsx` › "shows the contract grounding from GET
  drafts and drops it from an edited accept (ai-agent-24)": the exact contract
  shape through `normalizeDraft`, rendered as "Chunk chunk-4 of source src-9 ·
  48 characters quoted", and an edited accept whose `card.source` is exactly
  `{ url, quote }`.
- `tests/reviewQueuePage.test.tsx` › "shows where the quote was grounded when
  the draft carries it, and nothing otherwise" (extended: the not-grounded
  notice).
- `tests/e2e/authoringConsole.spec.ts` Smoke 4 renders a grounded draft from
  the contract shape in the built bundle.
