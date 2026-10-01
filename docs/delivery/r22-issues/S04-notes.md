# S04 — Session words: 'Card X of Y', no 'Warm-up node', no empty ANSWER heading

Contract: R22-00 §5. JS-only (OTA-safe); no frozen file, package or native change.

## What changed (files)

- `mobile/src/features/gacha/session/sessionReviewHelpers.ts` — `buildSessionProgressVM` subtitle is
  `Card X of Y`: X is the card on screen (`sessionDone + 1`, 1-based, capped at Y once the run is done),
  Y is the run length (learning-step check slots included, as before). No mode label. A run with no
  limit shows `Card X`. `modeLabel` stays exported (unused by the subtitle now).
- `mobile/src/features/gacha/planner/sessionBuilder.ts` — `describeNode`: the warm-up and normal roles
  carry an empty title (was 'Warm-up node' / 'Normal node'); 'Elite recall' and 'Boss check' stay.
  The boss subtitle says "final card" and the route summary says "clear 1 card to keep momentum"
  (was "node"). Roles (`warmup`/`normal`/`elite`/`boss`) are unchanged internally.
- `mobile/src/features/gacha/selectors/homeSelectors.ts` — Home's route preview uses the same titles
  (empty for warm-up and normal). Role counting is unchanged.
- `mobile/src/features/gacha/components/RoutePreview.tsx` — no 'Warm-up' / 'Normal' badge, and no
  empty title line; Elite / Boss badges stay.
- `mobile/src/features/gacha/components/ReviewBody.tsx` — the ANSWER caption is gone. Cards have no
  short-answer field (`CardExport`: Explanation, CodeSnippet, RealWorldUsage), so no card has an
  answer section under that heading; the sections render with their own headings (EXPLANATION
  first for an explanation-only card). Hide keeps its place, right-aligned.

## Surface shipped

- Session header subtitle: `Card 1 of 5`, `Card 2 of 5`, … (never `Run 0/1 · Mixed`).
- Session header role badge: shown only for `Elite recall` / `Boss check` / `Focus review`
  (the header already hides an empty label), and only on an ordinary card: since F02
  (s-correctness-2) it is indexed by planner slot and hidden on a study card and a recall check.
  No learner-visible "node" (F02 s-correctness-4 also renamed Home's hero helper line, which said
  'Clear 1 node … capped at 5 nodes'; that line is in the view model but not rendered).
- Reveal face: QUESTION recap, then EXPLANATION / CODING SAMPLE / REAL USAGE; no ANSWER caption.

## Tests

- New `mobile/tests/unit/sessionWords.test.tsx`: subtitle wording for every mode, the cap at the last
  card, the no-limit case; no 'node' / 'Warm-up' in challenge, sweep, focus and Home preview routes;
  RoutePreview renders no empty title and no Warm-up badge. Failed on the base (commit f5c2299).
- `mobile/tests/unit/reviewBody.test.tsx`: ANSWER is absent on the reveal face; explanation-only,
  code and empty-body cards show no ANSWER caption.
- Updated pins: `session-card-learning` (subtitle helper + 5 expectations), `economy-floor`,
  `owned-gate-entry-points`, the `buildSessionProgressVM` mocks and route-node fixtures in
  `session-card`, `session-card-mcq`, `session-card-mistakes`, `session-card-focus`, `mistake-loop`,
  `sessionCardReport`, `session-store`; small pins added in `planner.test.ts` and `sweepPlanner.test.ts`.
- Gates: `npx tsc --noEmit` and `npx vitest run` (all files) pass.

## Owner steps

None. Ships with the next OTA.

## Deferred

- `test:smoke` (`tests/p2-smoke.ts`) fails to compile in a worktree whose `node_modules` is a symlink
  to the main checkout (react-native globals vs lib.dom type clash). It fails identically on the base
  commit 35b3839; its assertions (summary matches /keep momentum/) still hold.
- The session summary screen, `pull/pulls` copy and the FAQ are out of scope (§5, P1 copy pass).
