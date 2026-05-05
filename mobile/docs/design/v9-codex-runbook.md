# v9 Codex Runbook (autonomous execution)

**Audience:** codex (or any AI agent), running unattended.

**Operator intent:** owner is away. Execute Phase 1 (mechanism) end-to-end. If green, execute Phase 2 (UI deltas). Stop and report at any failure. Do not ask for clarification — defer instead.

**Hard rules — never violate:**

1. **Work on a feature branch.** Create `git checkout -b v9-autorun-{YYYYMMDD-HHMM}` before any change. All commits on this branch.
2. **Commit at every successful sub-phase.** Use clear messages: `v9 phase 1.3: poolSelection module + tests`. Owner reviews diffs by sub-phase.
3. **No new dependencies.** Do not run `npm install`, `npx expo install`, or modify `package.json` `dependencies` / `devDependencies`. v9 Phase 1 + Phase 2 are zero-dep changes by design.
4. **Do not modify these files:** `app.json`, `eas.json`, `babel.config.js` (if present), `tsconfig.json` (unless a TS error truly requires it — and then commit separately with reason).
5. **Do not modify navigation routes.** The only allowed nav change is adding optional params `{ focusSlug?: string; scrollToNew?: boolean }` to the `Library` route in `src/navigation/types.ts` (Phase 2 only).
6. **Do not touch:** `src/auth/**`, `src/premium/**`, `src/sync/**`, `src/api/**`, `src/notifications/**`. These are out of scope.
7. **Stop on test failure with max 2 fix attempts.** If a test fails, codex may make 2 targeted fix attempts. After the second failure, stop the runbook, write the failure report, exit.
8. **Never delete tests.** Tests can be edited (assertions updated) but not removed. If a test seems wrong, write an explanation in the failure report and stop.
9. **Tests are the only gate.** Codex cannot judge UI by visuals. Trust the test results. If tests pass, the phase is done.
10. **Time budget per phase:** Phase 1 should complete in ~90 minutes wall time. Phase 2 in ~120 minutes. If a single sub-phase takes more than 30 minutes, stop and report — likely a deeper issue.

---

## Pre-flight checks (do this first, before Phase 1)

```bash
cd /Users/qc/Desktop/DeveloperCards/recallsmith/mobile

# 1. Confirm clean git state
git status
# If dirty: stop. Report "uncommitted changes present" and exit.

# 2. Create branch
git checkout -b v9-autorun-$(date +%Y%m%d-%H%M)

# 3. Confirm test infra works
npm run test:typecheck
npm run test:unit
npm run test:integration
# If any of these fail BEFORE any code change: stop. Report "baseline tests fail" and list which.
```

If pre-flight passes, proceed. Otherwise stop and write `docs/qa/v9-autorun-{date}-preflight-fail.md` with the failure output and exit.

---

## Phase 1 — Mechanism (mandatory; gates Phase 2)

**Spec to follow:** `docs/design/v9.1-mechanism-spec.md`. Read it once in full before starting.

### 1.1 Create `src/features/gacha/draw/cardRarity.ts`

Implement exactly the contract in spec §2. Add unit test `tests/unit/cardRarity.test.ts` per spec §2.

**Verify:** `npm run test:unit -- cardRarity` (filename pattern). Must pass. Then `npm run test:typecheck`.

**Commit:** `v9.1 phase 1.1: cardRarity module + test`

### 1.2 Create `src/features/gacha/draw/ownedStore.ts`

Implement spec §3. Add unit test `tests/unit/ownedStore.test.ts`. Mock AsyncStorage in the test (see existing test patterns in `tests/integration/draw.screen.test.tsx` for the canonical mock shape).

**Verify:** `npm run test:unit -- ownedStore`. Must pass. `npm run test:typecheck`.

**Commit:** `v9.1 phase 1.2: ownedStore module + test`

### 1.3 Create `src/features/gacha/draw/poolSelection.ts`

Implement spec §4. Add unit test `tests/unit/poolSelection.test.ts` covering all cases listed at the end of spec §4.

For the determinism test, use a fixed seed and assert exact card stableUid sequence.

For the weighting property test, run 1000 iterations with random seeds and assert that "seen but unowned" cards surface at least 1.5x as often as "never seen" cards (statistical, not exact).

**Verify:** `npm run test:unit -- poolSelection`. Must pass. `npm run test:typecheck`.

**Commit:** `v9.1 phase 1.3: poolSelection module + tests`

### 1.4 Extend `src/features/gacha/draw/pity.ts`

Add the new exports per spec §5: `PityState`, `DEFAULT_PITY_STATE`, `loadPityState`, `savePityState`, `buildPityProgressLabelV9`.

**DO NOT** remove or modify existing exports (`MockDrawCard`, `PoolOdds`, `MockDrawResult`, `pickRarity`, `buildPityProgressLabel`, `buildMockDrawResult`). Existing `tests/unit/pity.test.ts` must still pass.

Extend `tests/unit/pity.test.ts` with new test cases per spec §5.

**Verify:** `npm run test:unit -- pity`. Must pass (both old and new cases). `npm run test:typecheck`.

**Commit:** `v9.1 phase 1.4: pity v9 extensions`

### 1.5 Create `commitDraw` and wire DrawScreen

Per spec §6:

1. Add `commitDraw` function. Place in `src/features/gacha/draw/drawState.ts` if there's room; otherwise create new file `src/features/gacha/draw/drawCommit.ts` and re-export from drawState.
2. In `src/screens/DrawScreen.tsx`, find the call site to `buildPoolDrawResult` (search the file). Replace the call with `await commitDraw(slug, drawCount)`. Map the result fields to whatever shape the route navigation expects.
3. The `MockDrawResult` shape and the `DrawCommitResult` shape are different. Bridge them: build a `MockDrawResult`-shaped object from `commitDraw`'s output for backward compat with the navigation params, OR update the navigation params shape (but ONLY if zero other consumers exist — search the codebase).
4. Mark `buildPoolDrawResult` in `src/mock/draw.ts` with a `/** @deprecated use commitDraw from features/gacha/draw */` JSDoc comment. Do not delete it.

**Verify:** `npm run test:typecheck`. Must pass. Then `npm run test:unit`. Then `npm run test:integration`.

If `tests/integration/draw.screen.test.tsx` fails because it asserts on the old mock-pool behavior:
- Update the test's mock setup to use `vi.mock('../../src/features/gacha/draw/drawCommit', ...)` (or wherever `commitDraw` lives) instead of asserting on mock card content.
- Update assertions to check that draw triggers commitDraw with correct args, and that the screen handles the response.
- DO NOT change the test's structural assertions about what UI elements render.

If `tests/unit/draw.test.ts` fails: same pattern.

**Commit:** `v9.1 phase 1.5: commitDraw wiring + DrawScreen integration`

### 1.6 Add integration test for ownership cycle

Create `tests/integration/draw-ownership-cycle.spec.tsx` per spec §8.

This test mounts a minimal DrawScreen with mocked deck data (5 cards), runs `commitDraw` 5 times, and asserts that the owned set grows correctly and pool exhaustion is detected.

Note: this test does NOT need to render the full DrawScreen UI. It can directly call `commitDraw` with the AsyncStorage mock backing it. Simpler is better.

**Verify:** `npm run test:integration -- draw-ownership-cycle`. Must pass.

**Commit:** `v9.1 phase 1.6: ownership cycle integration test`

### 1.7 Phase 1 final gate

Run the full suite:

```bash
npm run test:typecheck
npm run test:unit
npm run test:integration
```

All three must be green. If any fail, codex has 2 fix attempts (each on its own commit), then stops.

If green, write phase report:

`docs/qa/v9-autorun-{date}-phase1.md` containing:
- Branch name.
- Commits made (`git log --oneline` since branch start).
- Test summary (numbers of tests passed).
- Any deviations from the spec (and why).
- Any pre-existing test you had to update + diff snippet.

**Commit:** `v9.1 phase 1: complete + report`

---

## Phase 2 — UI deltas (no new deps)

Only proceed if Phase 1 ended green. Otherwise, stop after Phase 1.

These changes use only existing dependencies (no Reanimated, no bottom-sheet, no lucide, no haptics, no svg). Animations use React Native's built-in `Animated` API. Icons use unicode glyphs or simple shapes via View borders.

The visible-to-user changes:
- DrawScreen looks meaningfully simpler.
- DrawResult shows a collection bar and a single CTA.
- Library labels say "Missing" instead of "Unowned".
- Home shows a "Study X due cards" link and updated CTA copy.

The full v9 visual reframe (carousel, ceremony 5-phase, etc.) is **not** in this phase — it requires new deps. Owner reviews Phase 2 output and decides whether to authorize Phase 3 later.

### 2.1 DrawScreen simplification

In `src/screens/DrawScreen.tsx`:

1. Remove pity bar UI (any `PityBar`, `pity-bar` testID, related state).
2. Remove audience preference label rendering (the `audiencePref` state stays, just don't render its label).
3. Remove any "draw meta" subblock that shows wallet count as a separate row — keep wallet visible only as `× {n}` corner badge on the hero (add this badge as a simple absolute-positioned `<View>` with `<Text>` over the card stack stage).
4. Keep: back button, hero card stack, two CTAs (`Open 10` primary, `Open 1` secondary).
5. Update CTA labels: from `Pull 10` / `Pull 1` (or whatever they currently say) to `Open 10` / `Open 1`.
6. Update tests in `tests/integration/draw.screen.test.tsx` that assert on the removed elements. Add an assertion that the screen has exactly 2 primary action buttons in the footer region (testIDs `screen-draw-primary-cta` and `screen-draw-secondary-cta`).

**Verify:** `npm run test:typecheck && npm run test:unit && npm run test:integration`. Must pass.

**Commit:** `v9 phase 2.1: DrawScreen simplification`

### 2.2 DrawResultScreen — collection bar + single-CTA routing

In `src/screens/DrawResultScreen.tsx`:

1. Add a small `<View>` near the top showing `{ownedAfter}/{totalCards}` — pass these from the navigation route params. (May need to add these params to the `DrawResult` route in `src/navigation/types.ts` — this is allowed for Phase 2.)
2. Remove the secondary CTA (`Open library`).
3. The single primary CTA's label and target depend on wallet:
   - Compute `remainingPulls = walletPulls + reservePulls` from `loadRewardWalletState()`.
   - If `remainingPulls > 0`: label = `Continue draw`, onPress = `navigation.navigate('Draw', { slug })`.
   - If `remainingPulls === 0`: label = `Go to Library`, onPress = `navigation.navigate('Library', { focusSlug: slug, scrollToNew: true })`.
4. Add a `Done` text link below the primary CTA, navigates to `Home`.
5. Add testIDs: `draw-result-collection-bar`, `draw-result-done-link`. Preserve `screen-draw-result-primary-cta`. Remove `screen-draw-result-secondary-cta` from rendered tree (test impact below).

In `src/navigation/types.ts`:
- Add optional params to `Library` route: `Library: { focusSlug?: string; scrollToNew?: boolean } | undefined;`.
- Add optional params to `DrawResult` route if needed: `ownedAfter?: number; totalCards?: number;`.

Update `tests/integration/draw-result.screen.test.tsx`:
- Remove assertions for `screen-draw-result-secondary-cta`.
- Add assertion for `draw-result-collection-bar` rendering with `{n}/{m}` text.
- Add 2 cases: wallet > 0 → CTA label is `Continue draw`; wallet = 0 → label is `Go to Library`.

**Verify:** full test suite. Must pass.

**Commit:** `v9 phase 2.2: DrawResult collection bar + single CTA`

### 2.3 LibraryScreen — Owned/Missing rename

In `src/features/gacha/library/libraryMapper.ts`:
1. Find the `state` field that returns `'owned' | 'unowned'`. Add a parallel/alternate string `'missing'` and prefer it. The simplest path: change the type alias and replace literal `'unowned'` with `'missing'` throughout the file. Update any consumers.

In `src/screens/LibraryScreen.tsx`:
1. Update filter chip labels (or sheet labels if v8 sheet has landed): `Owned` / `Missing` / `All`.
2. testID: where there was `library-filter-unowned`, also add `library-filter-missing` to the same node (alias) so old tests still pass.
3. Add a small collection bar near the header: `{owned}/{total}`. Just a simple text element — no animation needed in this phase.

In `src/screens/LibraryScreen.tsx`, also:
1. Read route params `{ focusSlug?, scrollToNew? }` (now available after 2.2). If `focusSlug` present, set the active deck switcher to it. If `scrollToNew` present, schedule a scroll to the first card with `state === 'new'` (use `FlatList.scrollToIndex` if you have a ref). For Phase 2, the simpler "scroll to top of new section" is acceptable; full-blown highlight ring is deferred.

Update `tests/unit/library.test.ts`:
- Where the mapper output type asserts `'unowned'`, add support for `'missing'` (or replace).

Update `tests/integration/library-final.screen.test.tsx`:
- Add assertion that filter chips/sheet show `Missing` label (alongside or replacing `Unowned`).
- Verify route params handling: pass `{ focusSlug: 'csharp' }` and confirm deck switcher reflects.

**Verify:** full test suite. Must pass.

**Commit:** `v9 phase 2.3: Library Missing terminology + collection bar`

### 2.4 HomeScreen — minimal v9 hint (carousel deferred)

In `src/screens/HomeScreen.tsx`:

1. Update primary CTA label: when wallet has pulls and active deck is set, label = `Open {deckTitle}`. When no pulls, label stays as today's "Browse decks" or equivalent (don't break empty state).
2. Add a footer text link: `Study {n} due cards` where `n` is total due across decks. Wire it to `navigation.navigate('Challenge')` (already-existing route). If `n === 0`, link is hidden.
3. Do NOT add the pack carousel in this phase. It needs new deps.
4. Keep all existing testIDs intact.

Update `tests/integration/home.screen.test.tsx` and related:
- Adjust CTA label expected string for the wallet-has-pulls case.
- Add assertion that `Study X due cards` link appears when there are due cards.

**Verify:** full test suite. Must pass.

**Commit:** `v9 phase 2.4: Home CTA label + study link`

### 2.5 Phase 2 final gate

```bash
npm run test:typecheck
npm run test:unit
npm run test:integration
```

If green, write final report `docs/qa/v9-autorun-{date}-phase2.md` containing:
- All commits in this run (`git log --oneline` since branch start).
- Test count summary.
- List of files changed (counted by `git diff --stat main...HEAD`).
- Anything notable: tests that needed reshaping, any spec deviation, any decision codex made independently.
- A "what's left" section listing things the spec asked for that codex deferred (and why).

**Commit:** `v9 phase 2: complete + report`

Push the branch:

```bash
git push -u origin HEAD
```

Done.

---

## Failure handling (universal)

If at any point a step fails and 2 fix attempts have been used:

1. Stop immediately. Do not move to next sub-phase.
2. Write `docs/qa/v9-autorun-{date}-FAILURE.md` with:
   - Phase + sub-phase number where failure occurred.
   - The exact error message (paste verbatim).
   - The 2 fix attempts you tried, with diff snippets.
   - Your hypothesis of what's going wrong.
   - What the next investigator should check first.
3. Commit the failure report.
4. Push the branch.
5. Exit cleanly.

Do NOT:
- Continue to a later phase hoping things will work out.
- Disable / skip / `xit` failing tests.
- Catch & suppress errors in source to make tests pass.
- Make speculative changes outside the spec to "try fixing".

---

## What "done" looks like for the owner

When owner returns:
- Branch `v9-autorun-{date}` exists on the remote.
- Either a `phase1` + `phase2` report (success path) or a `FAILURE` report.
- All commits are reviewable by sub-phase via `git log --oneline`.
- Owner can `git checkout` the branch and run `npm test` to verify locally.
- If success: owner reviews diffs, decides whether to merge or iterate.
- If failure: owner reads the FAILURE report and decides next step.

---

## Out of scope for this run (do NOT do)

- Pack carousel on Home (needs Reanimated).
- 5-phase ceremony rewrite (needs Reanimated).
- Bottom sheet for Library filter (needs @gorhom/bottom-sheet).
- New iconography (lucide).
- Haptics (expo-haptics).
- SVG-based tear lines (react-native-svg).
- Removing `buildPoolDrawResult` from `src/mock/draw.ts` (only deprecate, don't delete).
- Touching the 5 v9-untouched screens (Challenge, SessionCard, SessionSummary, Deck, Settings) — they remain on v7 visuals for this run.
- Native rebuilds (`npx expo prebuild`, `pod install`, `gradlew`).

These are all tracked for a future "v9 phase 3" run after owner review.
