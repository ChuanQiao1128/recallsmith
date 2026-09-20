# C04 — E4 exam sweep mode (`exam-sweep-mode`)

A fourth study mode, `'sweep'`, that serves the deck's **owned, already-learned** cards longest-unseen first, sized so the whole learned set is covered in `SWEEP_SPREAD_DAYS = 7` days at ≤ 5 cards a run, entered from a `Review all · N` button in the Library header, and — per economy-v2 R8 — paying **no** per-card pull (R1 is skipped; R2 still fires if the sweep happens to clear today's due cards). Pure JS/TS: planner (`pickSweep`, `buildSweepRoute`, `planChallengeRoute.mode`), the four `StudyMode` unions, `modeLabel`, one constant, the `SessionCardScreen` mode plumbing, the Library CTA, and one new fast-check suite. No Home entry (C00 §6 #8), no new dependency, no frozen-file edit.

## Context

The tree you receive is `delivery/r16-c-economy` **after C01, C02, C03 and C07 have merged** (C00 §4: C04 deps = C03 + C07). Line numbers below were read on the wave base (`main@52594fe`); files that C01/C02/C03/C07 also edit will have drifted — for those, locate by the quoted anchor text, not by number, and re-read the file before editing. Files only C04 touches (`sessionPlanner.ts`, `sessionReviewHelpers.ts`) are exact.

What the tree looks like today (base):

- **Modes.** `mobile/src/navigation/types.ts:2` `export type StudyMode = 'learn-new' | 'review-due' | 'mixed';` is the route-param type (`SessionCard.mode?: StudyMode`, `:173-179`). The same three literals are repeated, not imported, in three more unions: `mobile/src/features/gacha/contracts.ts:68` `mode: 'mixed' | 'review-due' | 'learn-new';` (on `ChallengeRoute`, `:65-75`), `mobile/src/features/gacha/planner/sessionPlanner.ts:83` `mode: 'review-due' | 'learn-new' | 'mixed';` (on `pickNextCard`), `mobile/src/features/gacha/session/sessionReviewHelpers.ts:51` `mode: 'review-due' | 'learn-new' | 'mixed';` (on `buildRatedSessionState`). `modeLabel` (`sessionReviewHelpers.ts:21-25`) returns `'Review Due'` / `'Learn'` / `'Mixed'` (default) and feeds the run header subtitle `Run ${done}/${limit} · ${modeLabel(mode)}` (`:39`). After C03, `contracts.ts` has three extra lines in `DeckSummary` (a two-line doc comment + `masteredCount?: number;`, C03 change 1), so the `ChallengeRoute.mode` line sits at `:71` — anchor on the quoted text.
- **Picking.** `pickNextCard` (`sessionPlanner.ts:79-135`) builds `cards` sorted by `OrderInDeck` (`:19-21`, `:90`) and a `progressMap` (`:93`); `pickWith` (`:95-116`) scans deck order twice — honouring `avoidUid`, then ignoring it. The three predicates (`:127-130`) each start with `owns(card)`; the comment at `:118-126` says a fourth pick "must remember `owns` — if you are adding one, add it". Bucket dispatch is `:132-134`. `isLearnedProgress` (`lastReviewedAt > 0`, `progressSelectors.ts:16-18`) is already imported (`:5`). There is no ordered-by-`lastReviewedAt` scan anywhere; sweep needs its own.
- **Planning.** `planChallengeRoute` (`sessionPlanner.ts:137-153`) takes `{ deck, progress, now?, ownedSet? }`, counts due/new (`countDueToday :50-53`, `countNewAvailable :55-57`; `countLearned :59-61` exists and is unused here) and returns `buildChallengeRoute(...)`. `buildChallengeRoute` (`sessionBuilder.ts:33-75`, edited by C02 — do not touch it) hardcodes `mode: 'mixed'` (`:67`), `minimumGoal: SESSION_MIN_GOAL` (`:69`), and builds nodes through `resolveRouteRole` (`sessionRoles.ts:3-15`: index 0 → `warmup`, last → `boss` if `hasBoss`, `max(1, total-2)` → `elite` if `hasElite`, else `normal`) with `describeNode` (`sessionBuilder.ts:5-31`, module-private). Constants: `SESSION_MAIN_ROUTE_DEFAULT = 5` (`constants.ts:7`), `SESSION_MIN_GOAL = 1` (`:8`); after C01 `:9` is `FREE_PULL_CAP = 60`; the file ends at `:11` `MASTERY_STAGE_THRESHOLD = 4`. There is no `SWEEP_SPREAD_DAYS`.
- **Screen.** `mobile/src/screens/SessionCardScreen.tsx` reads `const { mode = 'mixed', completionRoute = 'summary' } = route.params ?? {};` (`:94`). `planChallengeRoute` is called three times **without** `mode`: the load-time plan (`:321-326`, `const plannedChallenge = planChallengeRoute({ deck: deckForStudy, progress: nextProgress, now, ownedSet: nextOwned })`), the `minimumGoal` fallback inside `handleRating` (`:463-470`, `plannedMinimumGoal ?? planChallengeRoute({ deck, progress: nextState.updatedProgress, now: nowAtRating, ownedSet }).minimumGoal`) and the render-time `doneMinimumGoal` (`:568-569`, one line: `plannedMinimumGoal ?? planChallengeRoute({ deck, progress, now, ownedSet }).minimumGoal`). `pickNextCard` (`:332-340`) and `buildRatedSessionState` (`:405-415`) already pass `mode`. The trial gate checks `mode === 'learn-new' || mode === 'mixed'` at `:309` and `:448` — sweep is outside it by construction and those lines are not edited. After C01 the rating path calls `settleRatingReward({ …, newCardEligible: true, … })` (C00 §2.3) inside `handleRating`, after `saveDeckProgress` and before `recordSessionRating`; after C02 it computes `forecastLine(computeTomorrowLoad({ … }))` right after that step (C00 §2.5). Both are C04 anchors (change 6).
- **Library.** `mobile/src/features/gacha/library/LibraryHeader.tsx` props (`:105-126`, after C07 also `topics` / `topicFilter` / `onSelectTopic`) render, in order: the empty-collection banner (`:157-176`, `library-open-first-pack-cta`), the Pokedex title bar `styles.headerTopBar` (`:179-204`, `library-collection-bar` inside), the deck switcher (`:207-235`), C07's topic chip row, the status chip row (`:241-271`), and the hidden test probes (`:275-292`). `mobile/src/screens/LibraryScreen.tsx` builds `vm = buildLibraryVM({ … })` (`:164-175`, after C07 with `topicFilter`), and mounts `<LibraryHeader …/>` as `ListHeaderComponent` (`:349-382`) with `onOpenFirstPack` navigating `navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug })` (`:376-378`). `vm.counts.masteredCount` / `vm.counts.learningCount` (`libraryMapper.ts:197-198`) count rows with status `mastered` / `learning` — a row is `mastered`/`learning` iff it is not `missing` and `isLearnedProgress` holds (`:125-132`) — i.e. exactly the owned learned cards a sweep serves. `libraryScreenStyles.ts` has `retryButton` (`:40-48`, ink pill) and `retryText` (`:49`) — reuse them; the styles file is not in scope.
- **Rewards.** `settleRatingReward` (C01, `rewards/sessionRewards.ts`) already takes `newCardEligible: boolean` (C00 §2.3: "false in sweep mode (R8): R1 is skipped, R2 is still evaluated. C01's caller passes true; C04 passes mode !== 'sweep'"). `resolveSessionReward` / `accumulateRewardOutcome` / `EMPTY_REWARD_OUTCOME` (C01, `rewards/rewardResolver.ts`) and `ZERO_REWARD_STEP` (C01, `sessionRewards.ts`) are pure and are what the new unit test drives. Nothing in the reward modules changes in C04.

What C00 decided (binding; §2.7, §6 #8):

- The fourth value is `'sweep'`, appended to exactly the four unions above; `modeLabel('sweep') === 'Review all'`; `constants.ts` gains `export const SWEEP_SPREAD_DAYS = 7;`.
- `pickNextCard` mode `'sweep'` → `pickSweep()`: candidates are cards where `owns(card) && isLearnedProgress(progressEntry) && card.StableUid !== avoidUid`, ordered by `(progress.lastReviewedAt asc, card.OrderInDeck asc)`; falls back to ignoring `avoidUid` like `pickWith`; the due bucket is ignored; `null` when nothing is learned.
- `planChallengeRoute` gains `mode?: StudyMode`; `mode === 'sweep'` → `buildSweepRoute({ slug, deckTitle, learnedCount: countLearned(progress, ownedSet), dueCount, newCount })`; otherwise unchanged.
- `buildSweepRoute`: `dailyTarget = Math.ceil(learnedCount / SWEEP_SPREAD_DAYS)`; `limit = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget))`; `mode: 'sweep'`; `minimumGoal: SESSION_MIN_GOAL`; nodes via `resolveRouteRole` with `hasElite = false, hasBoss = false`; summary `` `${deckTitle} · ${learnedCount} learned card${learnedCount === 1 ? '' : 's'} · about ${dailyTarget} a day for ${SWEEP_SPREAD_DAYS} days` ``.
- `SessionCardScreen`: the three `planChallengeRoute` calls pass `mode`; the C01 pay hook receives `newCardEligible: mode !== 'sweep'`; the C02 forecast line is skipped when `mode === 'sweep'`; the trial gate is untouched; `scheduleNextReview` is untouched — a sweep rating reschedules exactly like any other mode.
- Entry point is **Library only**: `LibraryHeader` props gain `onStartSweep?: () => void; sweepCount?: number;` and render `<Pressable testID="library-sweep-cta" accessibilityRole="button" accessibilityLabel="Review all learned cards">` with text `` `Review all · ${sweepCount}` `` only when `onStartSweep && sweepCount > 0`; `LibraryScreen` passes `sweepCount={vm.counts.learningCount + vm.counts.masteredCount}` and `onStartSweep={() => navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug, mode: 'sweep' })}`. The wave table's "Library/Home 入口" is narrowed to Library (C00 §6 #8: a second Home entry collides with C03 and the A-wave `home-primary-cta` contract); `HomeScreen.tsx` is out of scope.
- One C00 sentence needs reading with care: §2.7 says "`buildRatedSessionState` treats `'sweep'` like `'mixed'` for `pickNextCard`". That means the helper **forwards `mode` unchanged** (it already does, `sessionReviewHelpers.ts:84`) and `pickNextCard` does the sweep pick; it does **not** mean remapping `'sweep'` to `'mixed'` before the call — a remap would make the second card of a sweep a due/updated/new pick and break the ordering property. The only edit to that helper is the union at `:51` and `modeLabel`.

Why: economy-v2 R8 (`docs/economy-v2-learn-to-earn-2026-09-19.md:33`) — the sweep "只重排期、不付 R1；只有它顺带清空了当天到期卡时才触发 R2"; the wave row (`docs/delivery-wave-1.6-plan-2026-09-19.md:108`) — "已拥有卡按最久未见排序、N 天分完 … 每卡不给抽"; the release plan Q2 (`docs/release-1.6.0-plan-2026-09-19.md:292`) — "No per-card pulls (sweep cards are not NEW); only the once-per-day due-clear bonus applies … unit-test that it earns nothing per card." The 15/30/60-day ladder hides mastered cards from the due bucket; a sweep is the only way to re-see them before an exam (`:284`).

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables: OTA-only, frozen files, do-not-touch list), §1.1 (your row in the file map and the test-file list), §2.7 (this issue, verbatim contract), §2.3 (`settleRatingReward` input — `newCardEligible`), §2.5 (`forecastLine`, what you skip), §3.1 "C04" (which existing tests may change), §3.2 `sweepPlanner.test.ts`, §3.3, §5 (verify conventions), §6 #8.
2. `mobile/src/features/gacha/planner/sessionPlanner.ts:1-153` (whole file — you edit `:79-153`).
3. `mobile/src/features/gacha/planner/sessionBuilder.ts` (whole; `describeNode :5-31`, the C02-edited `buildChallengeRoute`, which you leave alone) and `sessionRoles.ts:1-15`.
4. `mobile/src/features/gacha/session/sessionReviewHelpers.ts:21-25`, `:47-100`.
5. `mobile/src/features/gacha/contracts.ts` `ChallengeRoute` (`:65-75` on base) and `OwnedGate` (`:94`); `mobile/src/navigation/types.ts:1-4`, `:173-179`; `mobile/src/features/gacha/constants.ts` (11 lines); `mobile/src/features/gacha/selectors/progressSelectors.ts:10-30`.
6. `mobile/src/screens/SessionCardScreen.tsx` — `:92-125` (params/state), `:300-350` (load-time plan + first pick), `:396-512` (`handleRating`, now with C01's `settleRatingReward` and C02's `forecastLine`), `:567-570` (`doneMinimumGoal`).
7. `mobile/src/features/gacha/library/LibraryHeader.tsx:105-141` (props, after C07) and `:178-236` (title bar → deck switcher); `mobile/src/screens/LibraryScreen.tsx:160-180` (VM) and `:349-382` (header mount); `mobile/src/features/gacha/library/libraryMapper.ts:192-198`, `:249-258` (`counts`); `libraryScreenStyles.ts:40-49`.
8. `mobile/src/features/gacha/rewards/sessionRewards.ts` and `rewardResolver.ts` as C01 left them (the exported names you import in tests: `settleRatingReward`, `ZERO_REWARD_STEP`, `RatingRewardStep`, `accumulateRewardOutcome`, `EMPTY_REWARD_OUTCOME`, `resolveSessionReward`).
9. Tests you extend: `mobile/tests/unit/planner.test.ts` (whole, 118 lines — its `sampleDeck`/`sampleProgress` fixtures), `mobile/tests/unit/sessionRewards.test.ts` (C01's file — copy its AsyncStorage/user-scope harness for your one added case), `mobile/tests/integration/library-final.screen.test.tsx:1-162` (mocks + `flush`/`collectText`) and `:164-182` (the `2/3` fixture case). Property-test style: `mobile/tests/unit/scheduler.properties.test.ts:1-40`; `mobile/src/review/model.ts:85-140` (`scheduleNextReview`) for the reschedule property.

## Constraints

- **Scope (the ONLY files that may change):** `mobile/src/features/gacha/constants.ts`, `mobile/src/navigation/types.ts`, `mobile/src/features/gacha/contracts.ts`, `mobile/src/features/gacha/planner/sessionPlanner.ts`, `mobile/src/features/gacha/planner/sessionBuilder.ts`, `mobile/src/features/gacha/session/sessionReviewHelpers.ts`, `mobile/src/screens/SessionCardScreen.tsx`, `mobile/src/features/gacha/library/LibraryHeader.tsx`, `mobile/src/screens/LibraryScreen.tsx`, `mobile/tests/unit/sweepPlanner.test.ts` (new), `mobile/tests/unit/planner.test.ts` (add-only), `mobile/tests/unit/sessionRewards.test.ts` (add-only), `mobile/tests/integration/library-final.screen.test.tsx` (add-only). Nothing else: no `HomeScreen.tsx`, `homeSelectors.ts`, `libraryMapper.ts`, `libraryScreenStyles.ts`, `sessionStore.ts`, `SessionSummaryScreen.tsx`, `summaryMapper.ts`, `rewards/*`, `featureFlags.ts`, `remoteConfig.ts`, `ChallengeScreen.tsx`, `tests/unit/session-store.test.ts`, `tests/p2-smoke.ts`.
- **Frozen files (gacha-v7 §2.1; C00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also zero diff: `mobile/src/review/storage.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts` (C00 §0 do-not-touch).
- **OTA rule (C00 §0):** Wave C ships as an `eas update` on runtimeVersion 1.6.0. Do not touch `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; add no dependency, no native module, no `@sentry/*`; no `npm install`, `npm ci`, `expo prebuild`, network. `fast-check` (`mobile/package.json:66`) is already a devDependency.
- **Economy (C00 §0):** the only rules are economy-v2 §2 R1–R10 and §3 4'. R8 is implemented by passing `newCardEligible: mode !== 'sweep'` — you add no threshold, no copy line stating a rule, no new reward path. `SWEEP_SPREAD_DAYS = 7` is a pacing constant, not an economy rule.
- **Banned literals in any added line:** the six terms of `docs/delivery/r16-issues/B00-contracts.md` §0 (the driver greps your diff case-insensitively; C00 §0 deliberately does not spell them out and neither does this brief — read B00 §0 once). Use "work around", "sidestep", "guard", "probe", "sensor". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in your diff. No `JSX.Element` in a signature (use `React.JSX.Element` or omit; C00 §6 #23).
- **Purity:** `sessionPlanner.ts` and `sessionBuilder.ts` stay free of React, `require(`, `Date.now`, `Math.random`, AsyncStorage (verify greps). `pickSweep` takes `now` only through the existing parameter and does not use it.
- **Existing tests:** only the three files named above change, and only by appending `it(` cases (every existing `it('…'` title stays byte-identical; verify greps them). `tests/unit/library.test.ts:102-123` (six filter keys), `tests/integration/session-card.screen.test.tsx` (mocks `sessionPlanner` wholesale — unaffected), `tests/unit/ownedGatePredicates.test.ts`, `tests/integration/owned-gate-entry-points.spec.tsx` and `economy-floor.spec.tsx` (real planner, non-sweep modes) must stay green untouched.
- **No Home entry, no feature flag, no remote-config key** for the sweep (C00 §0 do-not-touch, §6 #8).
- Typecheck is `tsc --noEmit` with `strict: true` over `src` **and** `tests` (`mobile/tsconfig.json:4`), so `sweepCount?: number` needs a default before `sweepCount > 0`, and test fixtures cast with `as any` like `planner.test.ts:23,30`.

## Changes required

1. **`mobile/src/features/gacha/constants.ts`** — append after `MASTERY_STAGE_THRESHOLD` (last line):
   ```ts
   // Sweep pacing: a "Review all" run is sized so the deck's learned cards are
   // covered once over this many days (economy-v2 R8 — a sweep pays no per-card pull).
   export const SWEEP_SPREAD_DAYS = 7;
   ```
   The export line is byte-exact: `export const SWEEP_SPREAD_DAYS = 7;`. Nothing else in the file moves (C01's `FREE_PULL_CAP = 60` at `:9` stays).

2. **The four unions + `modeLabel`** — append `| 'sweep'` to each, exact resulting lines:
   - `mobile/src/navigation/types.ts:2` → `export type StudyMode = 'learn-new' | 'review-due' | 'mixed' | 'sweep';`
   - `mobile/src/features/gacha/contracts.ts` `ChallengeRoute.mode` (`:68` base, `:71` after C03) → `  mode: 'mixed' | 'review-due' | 'learn-new' | 'sweep';`
   - `mobile/src/features/gacha/planner/sessionPlanner.ts:83` → `  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';`
   - `mobile/src/features/gacha/session/sessionReviewHelpers.ts:51` → `  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';`
   - `sessionReviewHelpers.ts:21-25` `modeLabel`: insert `  if (mode === 'sweep') return 'Review all';` after the `'learn-new'` line (`:23`), before `return 'Mixed';`. No other change to the helper: `buildRatedSessionState` keeps forwarding `mode` to `pickNextCard` (`:84`) unchanged.

3. **`mobile/src/features/gacha/planner/sessionBuilder.ts`** — add `SWEEP_SPREAD_DAYS` to the constants import (`:1` → `import { SESSION_MAIN_ROUTE_DEFAULT, SESSION_MIN_GOAL, SWEEP_SPREAD_DAYS } from '../constants';`) and append, after `buildChallengeRoute` (do not edit `buildChallengeRoute` or `describeNode`):
   ```ts
   /**
    * Exam sweep (economy-v2 R8): every owned learned card, longest-unseen first,
    * spread over SWEEP_SPREAD_DAYS days at the normal run cap. No elite/boss
    * nodes — the run is a pass over known material, not a pressure check.
    */
   export function buildSweepRoute(params: {
     slug: string;
     deckTitle: string;
     learnedCount: number;
     dueCount: number;
     newCount: number;
   }): ChallengeRoute {
     const { slug, deckTitle, learnedCount, dueCount, newCount } = params;
     const dailyTarget = Math.ceil(learnedCount / SWEEP_SPREAD_DAYS);
     const limit = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget));

     const nodes: RoutePreviewNode[] = Array.from({ length: limit }).map((_, index) => {
       const role = resolveRouteRole({ index, total: limit, hasElite: false, hasBoss: false });
       const meta = describeNode(role);
       return {
         id: `${role}-${index}`,
         role,
         title: meta.title,
         subtitle: meta.subtitle,
       };
     });

     const summary = `${deckTitle} · ${learnedCount} learned card${learnedCount === 1 ? '' : 's'} · about ${dailyTarget} a day for ${SWEEP_SPREAD_DAYS} days`;

     return {
       slug,
       deckTitle,
       mode: 'sweep',
       limit,
       minimumGoal: SESSION_MIN_GOAL,
       dueCount,
       newCount,
       nodes,
       summary,
     };
   }
   ```
   `learnedCount = 0` yields `dailyTarget 0`, `limit 1`, a one-node route the screen closes at once (`pickSweep` returns null) — reachable only by a direct navigate, since the Library hides the CTA at 0.

4. **`mobile/src/features/gacha/planner/sessionPlanner.ts`**
   a. Imports: `:3` → `import type { ChallengeRoute, OwnedGate } from '../contracts';`; `:4` → `import { buildChallengeRoute, buildSweepRoute } from './sessionBuilder';`; add `import type { StudyMode } from '../../../navigation/types';` (a type-only import — `navigation/types.ts` itself imports only types, so no runtime edge is created).
   b. `pickNextCard`: widen the union (change 2) and add the fourth pick after `pickNew` (`:130`), keeping the `owns` conjunct the comment at `:118-126` asks for:
   ```ts
   // Sweep: every owned learned card, longest-unseen first, deck order as the
   // tie-break; the due bucket is deliberately ignored (economy-v2 R8). A card
   // just rated carries lastReviewedAt = now and so sinks to the end on its own.
   const pickSweep = () => {
     const ranked = cards
       .map((card) => ({ card, progressEntry: progressMap.get(card.StableUid) }))
       .filter(
         (entry): entry is { card: CardExport; progressEntry: CardProgress } =>
           !!entry.progressEntry && owns(entry.card) && isLearnedProgress(entry.progressEntry),
       )
       .sort(
         (a, b) =>
           (a.progressEntry.lastReviewedAt ?? 0) - (b.progressEntry.lastReviewedAt ?? 0) ||
           a.card.OrderInDeck - b.card.OrderInDeck,
       );
     const first = ranked.find((entry) => !avoidUid || entry.card.StableUid !== avoidUid) ?? ranked[0] ?? null;
     return first ? { card: cardMap.get(first.card.StableUid)!, progress: first.progressEntry } : null;
   };
   ```
   and dispatch, inserted as the first branch at `:132`: `if (mode === 'sweep') return pickSweep();` (the three existing lines stay as they are).
   c. `planChallengeRoute` (`:137-153`) becomes:
   ```ts
   export function planChallengeRoute(params: {
     deck: DeckExport;
     progress: CardProgress[];
     now?: Date;
     ownedSet?: OwnedGate;
     mode?: StudyMode;
   }): ChallengeRoute {
     const { deck, progress, now = new Date(), ownedSet = null, mode } = params;
     const dueCount = countDueToday(progress, now, ownedSet);
     const newCount = countNewAvailable(progress, ownedSet);

     if (mode === 'sweep') {
       return buildSweepRoute({
         slug: deck.Slug,
         deckTitle: deck.Title,
         learnedCount: countLearned(progress, ownedSet),
         dueCount,
         newCount,
       });
     }

     return buildChallengeRoute({
       slug: deck.Slug,
       deckTitle: deck.Title,
       dueCount,
       newCount,
     });
   }
   ```
   Every existing caller (`ChallengeScreen.tsx:69`, the tests) passes no `mode` and gets today's result byte-for-byte.

5. **`mobile/src/features/gacha/library/LibraryHeader.tsx`**
   a. Props (`type Props`, after C07's `onSelectTopic`): append
   ```ts
   /** "Review all · N" sweep entry (economy-v2 R8). Rendered only when both are
    *  given and sweepCount > 0; the button starts a 'sweep' SessionCard run. */
   onStartSweep?: () => void;
   sweepCount?: number;
   ```
   and destructure `onStartSweep,` and `sweepCount = 0,` in the component signature (the default is what keeps `sweepCount > 0` legal under `strict`).
   b. Render, immediately after the `styles.headerTopBar` `View` closes and before the deck-switcher `ScrollView` (`{deckOptions.length > 1 ? (`):
   ```tsx
   {onStartSweep && sweepCount > 0 ? (
     <Pressable
       testID="library-sweep-cta"
       accessibilityRole="button"
       accessibilityLabel="Review all learned cards"
       style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
       onPress={onStartSweep}
     >
       <Text style={styles.retryText} numberOfLines={1}>
         {`Review all · ${sweepCount}`}
       </Text>
     </Pressable>
   ) : null}
   ```
   Existing styles only (`retryButton`, `retryText`, `pressed`); no edit to `libraryScreenStyles.ts`. Nothing else in the header moves — the filter chips, C07's topic chips and the hidden probes stay byte-identical.

6. **`mobile/src/screens/LibraryScreen.tsx`** — in the `<LibraryHeader …/>` mount, add two props next to `openFirstPackHasPulls` (each on one line, verbatim — the verify greps them):
   ```tsx
   sweepCount={vm.counts.learningCount + vm.counts.masteredCount}
   onStartSweep={() => navigation.navigate('SessionCard', { slug: vm.selectedDeckSlug, mode: 'sweep' })}
   ```
   No new state, no change to `refresh`, the FlatList `key`, or `keyExtractor`.

7. **`mobile/src/screens/SessionCardScreen.tsx`** — four edits, all keyed on `mode` (`:94`), nothing else:
   a. Load-time plan (anchor `const plannedChallenge = planChallengeRoute({`): add `mode,` after `ownedSet: nextOwned,`.
   b. `handleRating` `minimumGoal` fallback (anchor `plannedMinimumGoal ??` followed by the multi-line `planChallengeRoute({`): add `mode,` after `ownedSet,`.
   c. Render-time `doneMinimumGoal` (one line): `plannedMinimumGoal ?? planChallengeRoute({ deck, progress, now, ownedSet }).minimumGoal` → `plannedMinimumGoal ?? planChallengeRoute({ deck, progress, now, ownedSet, mode }).minimumGoal`.
   d. Economy: in C01's `settleRatingReward({ … })` call, replace `newCardEligible: true,` with `newCardEligible: mode !== 'sweep',` (R8: no R1; R2 is still evaluated by the function). In C02's forecast statement (C02 change 3d, right after `recordRewardStep(...)`) prefix the inner call so the line is skipped in a sweep; the text `mode === 'sweep' ? null : forecastLine(` must appear verbatim, so the statement becomes:
      ```ts
      setLoadForecast(
        mode === 'sweep' ? null : forecastLine(
          computeTomorrowLoad({
            progress: nextState.updatedProgress,
            now: nowAtRating,
            ownedSet,
            newCardsLearnedToday: rewardStep.newCardsLearnedToday,
          }),
        ),
      );
      ```
      (`rewardStep` is C01's variable name — keep whatever C01 used; only the `mode === 'sweep' ? null : ` prefix is new.) Do not touch the trial gate (`mode === 'learn-new' || mode === 'mixed'`, two sites), the `Settlement`/`SessionSummary` navigations, or `requestPause`.
   The run header now reads `Run n/limit · Review all` through `modeLabel` with no further change.

8. **`mobile/tests/unit/sweepPlanner.test.ts` (new, fast-check)** — pure: imports `fc from 'fast-check'`, `pickNextCard`, `planChallengeRoute`, `countLearned` from `sessionPlanner`, `buildSweepRoute` from `sessionBuilder`, `buildRatedSessionState`, `modeLabel` from `sessionReviewHelpers`, `scheduleNextReview` from `review/model`, `SWEEP_SPREAD_DAYS`, `SESSION_MAIN_ROUTE_DEFAULT` from `constants`, and `accumulateRewardOutcome`, `EMPTY_REWARD_OUTCOME`, `resolveSessionReward` from `rewards/rewardResolver`, `ZERO_REWARD_STEP` from `rewards/sessionRewards`. No `vi.mock`, no storage. Arbitraries: a deck of 1–12 cards (`StableUid` `c${i}`, `OrderInDeck` a random permutation of 1..n, `Difficulty` 1–3, `Revision` 1), per-card progress that is either new (`{ stage: 0, nextReviewAt: 0 }`) or learned (`stage` 0–6, `lastReviewedAt` in `[1e12, 2e12]`, `nextReviewAt` either before or after `now` so both due and not-due learned cards occur), and `ownedSet` as `null` or a random subset. Cases, each its own `it`, titles verbatim:
   1. `it('orders a sweep by longest-unseen first over owned learned cards only', …)` — `fc.assert`: `pickNextCard({ deck, progress, now, mode: 'sweep', ownedSet })` returns the candidate with the smallest `(lastReviewedAt, OrderInDeck)` among owned learned cards, never an unowned or new card, and `null` iff there is no owned learned card.
   2. `it('walks the whole learned set once in lastReviewedAt order when each pick is rated', …)` — `fc.assert`: starting from the fixture, repeat `learned` times: pick with `avoidUid` = previous uid, rate it with `scheduleNextReview(progress, rating, nowAtStep)` where `nowAtStep` strictly increases from `2e12 + 1`, replace the entry. The sequence of picked uids equals the learned uids sorted by `(lastReviewedAt asc, OrderInDeck asc)` and contains no repeats.
   3. `it('ignores the due bucket in sweep mode', …)` — example: two learned cards where the *due* one (`nextReviewAt` yesterday) has the newer `lastReviewedAt` and the not-due one is older; `mode: 'sweep'` picks the older card, `mode: 'review-due'` picks the due one.
   4. `it('spreads the learned count over SWEEP_SPREAD_DAYS days and caps a run at five', …)` — `fc.assert` over `learnedCount` 0–500: `buildSweepRoute({ slug, deckTitle, learnedCount, dueCount: 0, newCount: 0 })` has `limit === Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, Math.ceil(learnedCount / SWEEP_SPREAD_DAYS)))`, `mode === 'sweep'`, `minimumGoal === 1`, `nodes.length === limit`, `nodes[0].role === 'warmup'`, no `elite`/`boss` node, and `summary` contains `` `about ${Math.ceil(learnedCount / SWEEP_SPREAD_DAYS)} a day for 7 days` ``; plus the literal check that `SWEEP_SPREAD_DAYS === 7`.
   5. `it('plans a sweep route from deck progress and leaves the other modes untouched', …)` — `planChallengeRoute({ deck, progress, now, mode: 'sweep', ownedSet })` returns `mode 'sweep'` with `limit` derived from `countLearned(progress, ownedSet)` and carries the same `dueCount`/`newCount` as the non-sweep plan; `planChallengeRoute({ deck, progress, now, ownedSet })` deep-equals `planChallengeRoute({ …, mode: 'mixed' })` and has `mode 'mixed'` (fc or the `planner.test.ts` fixture — either is fine).
   6. `it('reschedules a sweep rating exactly like any other mode', …)` — `fc.assert` over rating ∈ {again, hard, good, easy} and a learned card: `buildRatedSessionState({ mode: 'sweep', … }).updatedOne` equals `{ ...scheduleNextReview(current.progress, rating, now), lastSeenRevision: 1 }` and equals the `mode: 'mixed'` result's `updatedOne`; `remainingDueCount` is identical between the two modes.
   7. `it('a full sweep run resolves to zero pulls and leaves the wallet untouched', …)` — `fc.assert` over `limit` 1–5, `sessionDone` 0–limit, wallet `{ availablePulls: 0–60, reservePulls: 0–5 }`: fold `sessionDone` copies of `{ ...ZERO_REWARD_STEP, newCardsLearnedToday: k }` through `accumulateRewardOutcome(outcome, step, `c${i}`)` (three arguments, C01 change 5) starting from `EMPTY_REWARD_OUTCOME`; `resolveSessionReward({ sessionDone, sessionLimit: limit, minimumGoal: 1, wallet, reward: outcome }).rewardPulls === 0`, `walletAfter.availablePulls === wallet.availablePulls`, `walletAfter.reservePulls === wallet.reservePulls`, `outcome.newCardPulls === 0` — even when `sessionDone === limit` (a full sweep run pays nothing by itself: R8 + R9).
   8. `it('labels sweep mode Review all', …)` — `modeLabel('sweep') === 'Review all'`; `'review-due'`/`'learn-new'`/`'mixed'` unchanged.
   At least three `fc.assert(` calls in the file (verify counts).

9. **`mobile/tests/unit/planner.test.ts` (add-only)** — inside `describe('countDueToday / pickNextCard')`, append `it('picks the longest-unseen learned card in sweep mode even when another card is due', …)`: progress where card `'2'` is due yesterday with `lastReviewedAt: TODAY_MS - 1000` and card `'3'` is due tomorrow with `lastReviewedAt: TODAY_MS - 5000` (cards `'1'`/`'4'` new as in `sampleProgress`); `mode: 'sweep'` → `'3'`; `mode: 'review-due'` → `'2'`; `mode: 'sweep', avoidUid: '3'` → `'2'`. Every existing `it` title and assertion is byte-identical.

10. **`mobile/tests/unit/sessionRewards.test.ts` (add-only, C01's harness)** — append `it('never pays a new-card pull in sweep mode however the cards are rated, and pays the due clear at most once', …)`: `fc.assert` over a sequence of 1–8 ratings on a card whose `progressBefore` marks it **new** (so the seed does not pre-mark it): `settleRatingReward({ …, newCardEligible: false, dueBefore: 0, remainingDueCount: 0, … })` every step reports `newCardPaid === false`, `pulls === 0`, and afterwards `(await readNewCardLedger(slug)).ledger[uid]` is `undefined` (the seed wrote nothing for a new card and R8 never stamps it — R1 stays available to a later eligible run); then one further step with `newCardEligible: false, dueBefore: 2, remainingDueCount: 0` reports `dueClearPaid === true, pulls === 1`, and a repeat of it the same day reports `dueClearPaid === false`. Reset storage between property runs the way C01's cases do.

11. **`mobile/tests/integration/library-final.screen.test.tsx` (add-only)** — two cases appended inside `describe('LibraryScreen v9')`, titles verbatim:
    1. `it('shows the Review all CTA with the learned count and starts a sweep', …)` — default fixture (csharp: card 2 learning, card 3 mastered → owned learned = 2). `const navigate = vi.fn()` passed as `navigation={{ navigate } as any}`; after `flush()`, `library-sweep-cta` is present, its `accessibilityLabel` is `'Review all learned cards'`, its `Text` child's `children` is `'Review all · 2'`; `act(() => cta.props.onPress())` → `expect(navigate).toHaveBeenCalledWith('SessionCard', { slug: 'csharp', mode: 'sweep' })`.
    2. `it('hides the Review all CTA when nothing has been learned', …)` — `mockDecksBySlug.csharp = makeDeck('csharp', 'C# Interview', [{ uid: '9', order: 1, difficulty: 1, question: 'Q9' }])` (no progress entry matches, so learning + mastered = 0); after `flush()`, `findAllByProps({ testID: 'library-sweep-cta' })` has length 0 and `library-card-9` is present.

Estimated size: planner ~45 lines, builder ~40, unions/labels 6, screen 4 lines, header ~20, Library 2, new test ~200, three add-only cases ~90.

## Acceptance

Run from the worktree root; `docs/delivery/r16-issues/C04.verify.sh` re-runs exactly these.

1. Scope files exist (fails on base): `mobile/tests/unit/sweepPlanner.test.ts`; and the deps landed: `mobile/tests/unit/sessionRewards.test.ts` + `export async function settleRatingReward` in `rewards/sessionRewards.ts` (C01), `mobile/src/features/gacha/planner/loadForecast.ts` (C02), `masteredCount?: number;` in `contracts.ts` (C03), `mobile/src/features/gacha/library/topics.ts` (C07).
2. Literal guards (exit 0): the four union lines and `if (mode === 'sweep') return 'Review all';`; `export const SWEEP_SPREAD_DAYS = 7;`; in `sessionBuilder.ts` `export function buildSweepRoute(`, `Math.ceil(learnedCount / SWEEP_SPREAD_DAYS)`, `Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget))`, `mode: 'sweep',`, `hasElite: false, hasBoss: false`, `a day for ${SWEEP_SPREAD_DAYS} days`; in `sessionPlanner.ts` `import type { StudyMode } from '../../../navigation/types';`, `import { buildChallengeRoute, buildSweepRoute } from './sessionBuilder';`, `mode?: StudyMode;`, `const pickSweep = `, `if (mode === 'sweep') return pickSweep();`, `learnedCount: countLearned(progress, ownedSet),`, `owns(entry.card) && isLearnedProgress(entry.progressEntry)`; in `SessionCardScreen.tsx` `newCardEligible: mode !== 'sweep',`, `mode === 'sweep' ? null : forecastLine(`, `planChallengeRoute({ deck, progress, now, ownedSet, mode }).minimumGoal`, exactly three `planChallengeRoute({` calls each containing `mode`, and no `newCardEligible: true`; in `LibraryHeader.tsx` `onStartSweep?: () => void;`, `sweepCount?: number;`, `sweepCount = 0,`, `testID="library-sweep-cta"`, `accessibilityLabel="Review all learned cards"`, `` {`Review all · ${sweepCount}`} ``, `onStartSweep && sweepCount > 0`; in `LibraryScreen.tsx` the two one-line props of change 6; planner/builder purity (no `from 'react`, `require(`, `Date.now`, `Math.random`, `AsyncStorage`); test titles of changes 8–11 present (`grep -F "it('<title>'"`), every pre-existing title of `planner.test.ts` and `library-final.screen.test.tsx` still present, `from 'fast-check'` + ≥ 3 `fc.assert(` in `sweepPlanner.test.ts`, ≥ 8 `it(` there; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any scope file.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit/sweepPlanner.test.ts tests/unit/planner.test.ts tests/unit/sessionRewards.test.ts tests/integration/library-final.screen.test.tsx tests/unit/ownedGatePredicates.test.ts tests/unit/library.test.ts tests/integration/session-card.screen.test.tsx tests/integration/owned-gate-entry-points.spec.tsx --reporter=dot` — exit 0.
5. Scope + frozen + OTA guard (exit 0): `mb=$(git merge-base HEAD delivery/r16-c-economy)`; `git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/review/storage.ts mobile/src/screens/HomeScreen.tsx mobile/src/features/gacha/selectors/homeSelectors.ts mobile/src/features/gacha/library/libraryMapper.ts mobile/src/features/gacha/library/libraryScreenStyles.ts mobile/src/features/gacha/rewards mobile/src/config mobile/vitest.config.ts mobile/tests/setup mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json`; `grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json`; `grep -Fq '"version": "1.6.0"' mobile/app.json`; `grep -Fq '"vite": "7.2.4"' mobile/package.json`; no `@sentry` under `mobile/src`; `{ git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests; }` filtered by the scope allow-list of the Constraints section is empty.

## Verify

```sh
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C04.verify.sh
```
(runtime ≈ 1–2 min: one `tsc --noEmit` + eight targeted vitest files; no network.) The driver then runs the full mobile root gate — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan on your diff. Everything that is green on the base must still be green.

## Do NOT

- Do NOT add a Home entry, a feature flag, a remote-config key, or a `mobile/src/features/gacha/library/libraryScreenStyles.ts` style; do NOT edit `HomeScreen.tsx`, `homeSelectors.ts`, `libraryMapper.ts`, `sessionStore.ts`, `SessionSummaryScreen.tsx`, `summaryMapper.ts`, anything under `rewards/`, `ChallengeScreen.tsx`.
- Do NOT remap `'sweep'` to `'mixed'` anywhere (helper, screen, or planner) — the second pick of a sweep must still be `pickSweep`.
- Do NOT pay anything per sweep card, and do NOT suppress R2 (`newCardEligible: false` is the whole of R8; `settleRatingReward` still evaluates `dueBefore > 0 && remainingDueCount === 0`).
- Do NOT change `buildChallengeRoute`, `describeNode`, `resolveRouteRole`, `countLearned`, `pickWith`, the trial gate, or `scheduleNextReview`.
- Do NOT edit an existing `it(` case or its title; do NOT touch `tests/unit/session-store.test.ts` or `tests/p2-smoke.ts`.
- Do NOT run `npm install`, `npm ci`, `expo prebuild`, `eas …`, or anything that touches `package.json` / the lock / `app.json`; do NOT run git or npm inside `/Users/qc/src/recallsmith` (the shared checkout) — only in your worktree.
- Standing rules: no `git push`, no PR, never touch `main`, no test gutting (no `.skip`, no `.only`, no `@ts-ignore`, no `eslint-disable`).
