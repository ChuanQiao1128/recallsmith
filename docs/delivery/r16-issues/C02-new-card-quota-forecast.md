# C02 — E2+E3 new-card quota + tomorrow-load forecast (`new-card-quota-forecast`)

Two pure changes and one line of UI. (E2, R6) `buildChallengeRoute` stops rationing new cards: the 1–2 `effectiveNew` quota and the `Math.max(dueCount, 1)` floor go, the route length becomes `max(1, min(5, due + new))`, so one fresh card plans a one-node route the user can actually full-clear (the F10 dead end). (E3, R7) a new pure module `loadForecast.ts` turns "how many new cards did I learn today" plus the deck's progress into a one-line forecast — `At this pace, about N cards come due tomorrow.` — on the 20th new card of the day and every 10th after it; `SessionCardScreen` renders it under the progress header after a rating, never as a dialog, never blocking the next card. Five existing test literals move with the formula; nothing else in the app changes. Depends on C01 (the forecast reads `newCardsLearnedToday` off the `RatingRewardStep` that C01's `settleRatingReward` returns in `handleRating`).

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`, before C01 merges; your worktree is cut after C01, so `SessionCardScreen.tsx` line numbers below are base numbers and will have shifted — anchor on the quoted text, not the number):

- `mobile/src/features/gacha/planner/sessionBuilder.ts:33-75` `buildChallengeRoute({ slug, deckTitle, dueCount, newCount })`. `:40` `const hasTodayWork = dueCount > 0 || newCount > 0;`; `:41` `const effectiveNew = dueCount > 0 ? Math.min(newCount, 1) : Math.min(newCount, 2);` (the quota R6 removes); `:42-44` `const limit = hasTodayWork ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, Math.max(dueCount, 1) + effectiveNew)) : 1;` — the `Math.max(dueCount, 1)` is the F10 root cause: due 0 / new 1 → 1 + 1 = **2**, a two-node route with one card to put in it (`docs/home-review-and-launch-copy-2026-09-17.md:57` "另立 issue", which is this one). `:46` `const hasBoss = dueCount >= 3;`, `:47` `const hasElite = dueCount >= 2 || effectiveNew >= 1;`. Nodes `:49-58` via `resolveRouteRole` (`sessionRoles.ts:3-15`: index 0 warmup, last = boss when `hasBoss`, `max(1, total-2)` = elite when `hasElite`). Summary `:60-62` says `${newCount} fresh` (stays). Return `:64-74` (`mode: 'mixed'`, `minimumGoal: SESSION_MIN_GOAL`; C04 adds a sweep later — not you). `SESSION_MAIN_ROUTE_DEFAULT = 5` and `SESSION_MIN_GOAL = 1` at `constants.ts:7-8` (untouched).
- The Home route preview duplicates the same formula at `mobile/src/features/gacha/selectors/homeSelectors.ts:114-124` (`fresh = min(newToday, 2)`, `max(due, 1) + …`). **C03 aligns it, not you** (C00 §6 #7: "C02 changes the planner only; C03 (deps C02) aligns the preview. Between the two merges the integration branch's Home preview may disagree with the session length — accepted"). No test compares the two.
- Consequences of the new formula, pinned by tests (C00 §2.5): due 3/new 2 → **5**, due 1/new 2 → **3**, due 2/new 2 → **4**, due 1/new 1 → 2 (unchanged), **due 0/new 1 → 1**. Which existing tests move was established by running the whole mobile suite with the §2.5 formula applied on a scratch copy of the tree (2026-09-21): exactly 5 failures in 4 files —
  - `mobile/tests/unit/planner.test.ts:42` `expect(challenge.limit).toBe(4)` (due 3/new 2) and `:65` `expect(planned.limit).toBe(2)` (due 1/new 2);
  - `mobile/tests/unit/ownedGatePredicates.test.ts:105` `expect(planned.limit).toBe(3)` (ungated due 2/new 2); `:223` `expect(planned.limit).toBe(2)` (gated due 1/new 1) stays — **C00 §3.1 says `:224`; the tree has the assertion at `:223`** (`:224` is the closing `});`);
  - `mobile/tests/integration/economy-floor.spec.tsx:511` `expect(blob).toContain('Run 0/2')` — a real (unmocked) planner over one owned new card, so the header now reads `Run 0/1`; **C00 §3.1 lists this file as byte-identical for C01 and does not list it for C02 — that is a C00 omission; the literal is a direct consequence of the F10 fix and C02 owns it** (its comment `:507-510` "plus the warm-up slot planChallengeRoute always adds" describes the old formula and is rewritten with it);
  - `mobile/tests/integration/owned-gate-entry-points.spec.tsx:375` `'Clear today’s run (2 cards) for +2 free pulls.'` — `ChallengeScreen` renders `COPY.fullClearLine(challengeRoute.limit)` (`mobile/src/screens/ChallengeScreen.tsx:31`, template `Clear today’s run (${limit} cards) for +2 free pulls.`, no singular form) over the same one-owned-card fixture, so the text becomes `(1 cards)`; **also missing from C00 §3.1 — C02 owns the literal; `ChallengeScreen.tsx` itself stays untouched (C00 §6 #20 keeps that old-rule copy through Wave C)**. Its comment `:372-374` is rewritten too.
  - `mobile/tests/p2-smoke.ts:44` `assert.equal(challenge.limit, 4)` and `:65` `assert.equal(plannedChallenge.limit, 2)` are typechecked (`tsc --noEmit`, `tsconfig.json` has no `include`) but never run in CI; C00 §6 #19: keep it compiling and move the literals, nothing more. C01 also edits this file below `:115`; your two lines are above.
  - `mobile/tests/integration/home.screen.test.tsx:196` `'Full clear: 2 cards'` comes from `buildGoalVM` (`homeSelectors.ts:410-416`, due + new) and is unaffected; `challenge.screen.test.tsx` mocks `planChallengeRoute` (`:67-71`) and is unaffected; `owned-gate-entry-points.spec.tsx:310` `Run 0/1` is the zero-owned case and stays 1.
- R7 (`docs/economy-v2-learn-to-earn-2026-09-19.md:32`): "当天第 20、30、40… 张新卡学完时显示一行『照这个节奏明天约有 N 张复习』，N 由当前进度按阶梯推算；没有确认框". C00 §2.5 fixes the module, the two constants, the `TomorrowLoad` shape, the copy and the testID (all repeated verbatim in Changes required). "Current progress under the ladder" = `buildUpcoming(progress, now, 2, ownedSet)[1].count` (`mobile/src/features/gacha/selectors/progressSelectors.ts:47-77`): scheduled cards whose `nextReviewAt` falls on tomorrow's local day (`formatDateKey`, `mobile/src/review/model.ts:221-226`; overdue cards clamp to today, so they never count as tomorrow). The count you feed it, `newCardsLearnedToday`, is C01's `RatingRewardStep.newCardsLearnedToday` = `countPaidOnDay(ledger, now)` for **this deck's** ledger after the step (C00 §2.3) — R7 is therefore per deck, which is what C00 decided.
- `mobile/src/screens/SessionCardScreen.tsx` (926 lines on base). Load effect `:202-213` resets per-run state (`setSessionDone(0)`, `setShowAnswer(false)` at `:207-208`); `handleRating` `:396-512`: `buildRatedSessionState` `:405-415` → `recordReviewEvent` `:421-434` → `saveDeckProgress` `:446` → trial check `:447-460` → `recordSessionRating` `:461` → `advanceSession` `:462` → navigation when `!nextState.nextCurrent` `:479-508`. C01 inserts its pay hook immediately after `saveDeckProgress` and before the trial block (`:447`) — `const rewardStep = await settleRatingReward({...})` + `recordRewardStep(rewardStep, current.card.StableUid)` + `const outcome = useSessionStore.getState().rewardOutcome` (C01 brief `docs/delivery/r16-issues/C01-learn-to-earn-rewards.md:222-238`; C00 §2.3 calls the same value `step`) — and deletes the stake pill `:624-642` and `doneRewardPulls`/`fullClearReward`/`showFullClearStake` (`:570-574`, `:578-582`, `:588-592`; `doneMinimumGoal` `:568-569` stays), so after C01 the header `<SessionProgressHeader vm={sessionVm} />` (`:643` on base) sits directly under the `headerRow` `View` and directly above the `<ScrollView testID="screen-session-card-primary-surface"`. The only `Alert.alert` literal in the file is the pause prompt (`requestPause`, `:561-566`); the trial upsell goes through the imported `showTrialUpsellDialog` (`:48`, called at `:310` and `:454`). Both are pre-existing; C02 adds no third. The screen already imports `Text`, `StyleSheet`, `colors`, `spacing`, `typography` (`:2-10`, `:57-59`) and its `styles` block starts at `:729`. `ownedSet` state (`Set<string> | null`, `:112`) is the `OwnedGate` you pass through.
- One name collision C00 does not resolve: §2.5 names the screen state `forecastLine: string | null` and in the same component calls the function `forecastLine(...)`. A `useState` binding named `forecastLine` would shadow the import (TS2349 on the call). Decision for this brief: the state is `loadForecast` / `setLoadForecast`; the import keeps its contract name `forecastLine`.
- `mobile/tests/integration/session-card.screen.test.tsx` (499 lines on base) mocks the planner (`:142-159`), `sessionReviewHelpers` (`:117-128`, `buildRatedSessionState` → `nextCurrent: null`) and after C01 also `../../src/features/gacha/rewards/sessionRewards` (a step with `newCardPaid: true, pulls: 1` for hard+; C00 §3.1). `navigation.replace` is a `vi.fn`, so after the single rating the screen stays mounted in its route-complete state and still renders the progress header — the forecast `Text` is findable there. Verified on the scratch copy with a stand-in for C01's step: 19 → no node, 20 → one node.
- Test infra: vitest 4 (`mobile/vitest.config.ts`, `environment: 'node'`, `globals: true`), `fast-check ^4.9.0` (`mobile/package.json:66`; pattern `mobile/tests/unit/skipPolicy.test.ts:1-30`), `react-test-renderer` for screens. Driver gate: `npm run test:typecheck && npx vitest run` (`.github/workflows/ci.yml:35-36`).

What C00 decided and why (binding): the limit formula and `hasElite` line of §2.5 verbatim; `FORECAST_START = 20` / `FORECAST_STEP = 10`; the `TomorrowLoad` type, `computeTomorrowLoad` and `forecastLine` signatures and copy verbatim; testID `session-card-load-forecast`, `numberOfLines={2}`, rendered only when non-null, directly under the header; "one line, no dialog, never blocks the next card (R7 不拦截)"; C02 does not touch `homeSelectors.ts` (§6 #7); property test for the milestone arithmetic (§3.3); the planner case title `gives a single new card a one-node route` (§3.2); the integration case "mocked step reports `newCardsLearnedToday: 20` → present; 19 → absent" (§3.1). Economy rules stay R1–R10 + 4' — this issue adds no rule, threshold or copy beyond R6/R7.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables: OTA-only, frozen files, banned families, no suppression), §1.1 (the C02 column and the C02 → C04 / C02 → C03 orderings), §2.3 (`RatingRewardStep.newCardsLearnedToday` — the value you consume), **§2.5 whole (your contract, verbatim)**, §3.1 "C02" row, §3.2 `loadForecast.test.ts` bullet, §3.3, §5 (verify conventions), §6 #7, #16, #19, #20.
2. `docs/economy-v2-learn-to-earn-2026-09-19.md:24-37` (R6 at `:31`, R7 at `:32`, the unchanged list at `:37`).
3. `mobile/src/features/gacha/planner/sessionBuilder.ts:1-75` (whole) and `mobile/src/features/gacha/planner/sessionRoles.ts:1-15`.
4. `mobile/src/features/gacha/selectors/progressSelectors.ts:16-30` (learned/scheduled/new predicates) and `:47-77` (`buildUpcoming`); `mobile/src/features/gacha/contracts.ts:3-6` (`CalendarDay`), `:65-75` (`ChallengeRoute`), `:94` (`OwnedGate`).
5. `mobile/src/review/model.ts:4-27` (`CardProgress`), `:85-140` (`scheduleNextReview` — where `nextReviewAt` comes from), `:221-226` (`formatDateKey`). Frozen; read only.
6. `mobile/src/screens/SessionCardScreen.tsx` as it is after C01: the imports `:1-59`, state `:92-135`, load reset `:202-213`, `handleRating` `:396-512` (find C01's `settleRatingReward` call), the render top from `<View style={styles.container}>` to the `<ScrollView`, and the `styles` block. All base numbers.
7. `mobile/src/features/gacha/session/sessionReviewHelpers.ts:47-100` (`buildRatedSessionState` — `updatedProgress` is the whole deck's progress after the rating; that is what you forecast from).
8. `mobile/src/screens/ChallengeScreen.tsx:20-35` (the `COPY` table whose `(N cards)` template your test literal follows) — read only.
9. Tests: `mobile/tests/unit/planner.test.ts` (whole, 118 lines); `mobile/tests/unit/ownedGatePredicates.test.ts:94-106`, `:215-224`; `mobile/tests/integration/economy-floor.spec.tsx:458-521` (the "first day" walk); `mobile/tests/integration/owned-gate-entry-points.spec.tsx:361-377`; `mobile/tests/integration/session-card.screen.test.tsx:1-235` (harness) plus C01's `sessionRewards` mock and its retitled Settlement case; `mobile/tests/p2-smoke.ts:37-66`.
10. `mobile/tests/unit/skipPolicy.test.ts:1-30` (fast-check import + arbitrary style used in this repo).
11. C01's brief `docs/delivery/r16-issues/C01-learn-to-earn-rewards.md:220-240` (change 8: the awaited step is named `rewardStep`) and `:274` (its `session-card.screen.test.tsx` mock: `settleRatingReward: vi.fn(async (input: any) => …)` — already a `vi.fn`, so `mockResolvedValueOnce` exists). Confirm both against the merged tree; do not re-do anything of C01's.
12. `docs/home-review-and-launch-copy-2026-09-17.md:57` (F10, the sentence that spawned E2).

## Constraints

- **Scope (the ONLY files that may change):** `mobile/src/features/gacha/planner/sessionBuilder.ts`, `mobile/src/features/gacha/planner/loadForecast.ts` (new), `mobile/src/screens/SessionCardScreen.tsx`, `mobile/tests/unit/loadForecast.test.ts` (new), `mobile/tests/unit/planner.test.ts`, `mobile/tests/unit/ownedGatePredicates.test.ts`, `mobile/tests/p2-smoke.ts`, `mobile/tests/integration/session-card.screen.test.tsx`, `mobile/tests/integration/economy-floor.spec.tsx`, `mobile/tests/integration/owned-gate-entry-points.spec.tsx`. Nothing else. In particular **not**: `homeSelectors.ts` (C03), `constants.ts`, `sessionPlanner.ts`, `sessionRoles.ts`, `sessionReviewHelpers.ts`, `contracts.ts`, `navigation/types.ts`, `ChallengeScreen.tsx`, `SessionSummaryScreen.tsx`, `SessionProgressHeader.tsx`, anything under `rewards/`, `tests/setup/*`, `vitest.config.ts`.
- **Frozen files (gacha-v7 §2.1, `mobile/gacha-v7.md:83-88`, narrowed by the wave) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched by every Wave C issue: `mobile/src/review/storage.ts`.
- **OTA-only (C00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no new dependency, no native module, no `expo prebuild`, no `npm install`. `"expo-updates": "~29.0.15"` and `"version": "1.6.0"` stay as they are. Pure TS under `mobile/src` and `mobile/tests`.
- **Banned literals in any added line:** the six driver-gate terms of B00 §0 / C00 §0 (the driver greps your diff case-insensitively; this brief deliberately does not spell them — say "work around", "sidestep", "sensor", "guard", "probe", "fallback"). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` in any added line (the pre-existing `eslint-disable-next-line` at `SessionCardScreen.tsx:380` is not yours and stays).
- **Purity:** `loadForecast.ts` imports only `buildUpcoming` (`../selectors/progressSelectors`) and types (`CardProgress` from `../../../review/model`, `OwnedGate` from `../contracts`). No React, no AsyncStorage, no `Date.now`, no `Math.random`, no `require(`. It re-declares neither constant from `constants.ts`.
- **No dialog, no interruption (R7 "不拦截"):** no `Alert.alert`, no modal, no navigation, no delay on the rating path. The line is plain state + one conditional `<Text>`.
- **No economy change:** you add no rule, threshold or copy beyond §2.5; `SESSION_MAIN_ROUTE_DEFAULT` stays 5; no new `eventType`, no storage key, no wallet call.
- **Existing tests — exhaustive list of what may change (C00 §3.1 + the two omissions recorded in Context):** `planner.test.ts` (two literals + two new cases), `ownedGatePredicates.test.ts` (`:105` literal; the `:218` comment may say `limit 4`; `:223` stays `toBe(2)`), `p2-smoke.ts` (`:44`, `:65` literals only), `economy-floor.spec.tsx` (`:507-511` comment + literal only), `owned-gate-entry-points.spec.tsx` (`:372-375` comment + literal only), `session-card.screen.test.tsx` (add-only: one case; plus, only if C01's `sessionRewards` factory did not return `vi.fn`s, wrapping `settleRatingReward` in `vi.fn(...)` so `mockResolvedValueOnce` exists — no assertion changes). Every other test file is byte-identical; no `it` title other than the ones named here is added, removed or renamed. The full suite (`npx vitest run`) must stay green — the driver runs it after you.
- **C01 is merged under you.** Do not reintroduce `computeSessionRewardPulls`, the stake pill, or any summary-time reward logic; do not edit C01's files (`rewards/*`, `sessionStore.ts`, `summaryMapper.ts`, `SessionSummaryScreen.tsx`, `drawState*.ts`, `DebugMenuScreen.tsx`, `navigation/types.ts`).

## Changes required

1. **`mobile/src/features/gacha/planner/sessionBuilder.ts`** — the quota and the floor go; nothing else moves.
   a. Delete `:41` (`const effectiveNew = …`).
   b. Replace `:42-44` with exactly this one line (C00 §2.5, byte for byte):
      ```ts
      const limit = hasTodayWork ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)) : 1;
      ```
   c. Replace `:47` with exactly:
      ```ts
      const hasElite = dueCount >= 2 || newCount >= 1;
      ```
   d. `:40` (`hasTodayWork`), `:46` (`hasBoss = dueCount >= 3`), the node builder `:49-58`, the summary `:60-62` (keep `${newCount} fresh`), the return `:64-74`, `describeNode` `:5-31` and the imports `:1-3` are unchanged. The file has one `export function` before and after. Do not add a comment that restates R6 in prose longer than one line; if you add one, keep it to the formula's line.

2. **`mobile/src/features/gacha/planner/loadForecast.ts` (new, pure)** — the contract of C00 §2.5. This is the whole module (it was compiled and tested on the tree; keep the exported names, constants, type and copy byte-identical — the body may be restyled, not re-designed):
   ```ts
   import type { CardProgress } from '../../../review/model';
   import type { OwnedGate } from '../contracts';
   import { buildUpcoming } from '../selectors/progressSelectors';

   /** R7 (economy-v2 §2): the forecast fires on the 20th new card learned today … */
   export const FORECAST_START = 20;
   /** … and on every 10th after it (30, 40, …). */
   export const FORECAST_STEP = 10;

   export type TomorrowLoad = {
     newCardsLearnedToday: number;
     /** buildUpcoming(progress, now, 2, ownedSet)[1].count (progressSelectors.ts:47-77) — cards whose next
      *  review lands on tomorrow's local day under the current ladder. */
     tomorrowDue: number;
     /** newCardsLearnedToday >= FORECAST_START && (newCardsLearnedToday - FORECAST_START) % FORECAST_STEP === 0 */
     milestone: boolean;
   };

   export function computeTomorrowLoad(input: {
     progress: CardProgress[];
     now: Date;
     ownedSet?: OwnedGate;
     newCardsLearnedToday: number;
   }): TomorrowLoad {
     const { progress, now, ownedSet = null, newCardsLearnedToday } = input;
     const tomorrowDue = buildUpcoming(progress, now, 2, ownedSet)[1]?.count ?? 0;
     const milestone =
       newCardsLearnedToday >= FORECAST_START && (newCardsLearnedToday - FORECAST_START) % FORECAST_STEP === 0;
     return { newCardsLearnedToday, tomorrowDue, milestone };
   }

   /** milestone ? one line : null. One line, no dialog, never blocks the next card (R7 "不拦截"). */
   export function forecastLine(load: TomorrowLoad): string | null {
     if (!load.milestone) return null;
     const n = load.tomorrowDue;
     return `At this pace, about ${n} card${n === 1 ? ' comes' : 's come'} due tomorrow.`;
   }
   ```
   The template literal `At this pace, about ${n} card${n === 1 ? ' comes' : 's come'} due tomorrow.` is grepped by verify exactly as written (including the `n` variable name). `FORECAST_START`/`FORECAST_STEP` are the only numeric literals in the file besides the `2` days and the `[1]` index.

3. **`mobile/src/screens/SessionCardScreen.tsx`** — the one-line hint. Six small edits, nothing else (C00 §2.5 "Nothing else in the screen"):
   a. Import, next to the planner import (`:37` on base): `import { computeTomorrowLoad, forecastLine } from '../features/gacha/planner/loadForecast';`
   b. State, after `const [trialInfo, setTrialInfo] = useState<TrialInfo>(EMPTY_TRIAL_INFO);` (`:123` base): `const [loadForecast, setLoadForecast] = useState<string | null>(null);` — verify greps that whole line (`loadError` at `:106` already uses the bare `useState<string | null>(null)` shape, so only the full line proves the state exists). Named `loadForecast`, not `forecastLine` — see Context, the import must not be shadowed.
   c. Cleared on load: inside `load()` right after `setShowAnswer(false);` (`:208` base) add `setLoadForecast(null);` (grepped verbatim).
   d. Computed per rating: in `handleRating`, immediately after C01's pay hook (the three lines `const rewardStep = await settleRatingReward({...});` / `recordRewardStep(rewardStep, …);` / `const outcome = …;` — C00 §2.3 calls the value `step`, C01's brief names it `rewardStep`; use the name the merged tree has) and **before** `recordSessionRating({ stableUid: current.card.StableUid, rating });`, add:
      ```ts
      setLoadForecast(
        forecastLine(
          computeTomorrowLoad({
            progress: nextState.updatedProgress,
            now: nowAtRating,
            ownedSet,
            newCardsLearnedToday: rewardStep.newCardsLearnedToday,
          }),
        ),
      );
      ```
      (`rewardStep` = C01's variable; verify accepts any identifier before `.newCardsLearnedToday`.) It runs on every rating, including the last one of a run (the navigation that follows unmounts the screen; that is fine). It is not gated on `rating` — R7 counts learned cards, and `step.newCardsLearnedToday` already reflects whether this rating paid.
   e. Rendered directly under the progress header — between `<SessionProgressHeader vm={sessionVm} />` and the `<ScrollView testID="screen-session-card-primary-surface"`, only when non-null (the opening `<Text …>` tag is C00 §2.5's, grepped byte for byte on one line — do not let a formatter wrap its three props):
      ```tsx
      {loadForecast ? (
        <Text testID="session-card-load-forecast" numberOfLines={2} style={styles.forecastLine}>
          {loadForecast}
        </Text>
      ) : null}
      ```
   f. Style, added to `styles` (place it before `trialPreview`): `forecastLine: { marginTop: spacing.xs, marginBottom: 4, fontSize: typography.caption, color: colors.inkSecondary, fontWeight: '700', textAlign: 'center' }` — theme tokens the file already imports; no new colour literals, no `shadowRadius`.
   No `Alert.alert`, no `useEffect`, no timer, no navigation param, no change to `sessionVm`, to the pause prompt, to the trial gate or to either `navigation.replace` payload.

4. **`mobile/tests/unit/planner.test.ts`**
   a. `:42` `expect(challenge.limit).toBe(4);` → `toBe(5)` (the case title `creates a boss-ending route for a real due backlog` and its boss assertion stay: 5 nodes, last is boss).
   b. `:65` `expect(planned.limit).toBe(2);` → `toBe(3)` (title `derives counts from deck progress` stays).
   c. Two new cases appended to `describe('buildChallengeRoute / planChallengeRoute')` (after `does not force a boss node when there is no high-pressure backlog`), titles verbatim:
      - `it('gives a single new card a one-node route', …)` — `const single = buildChallengeRoute({ slug: 'csharp', deckTitle: 'C# Interview', dueCount: 0, newCount: 1 });` then `expect(single.limit).toBe(1); expect(single.nodes).toHaveLength(1); expect(single.nodes[0]?.role).toBe('warmup');` (a one-line comment naming R6 / F10 is welcome).
      - `it('grows the route with every new card up to the cap', …)` — a local `limitFor(dueCount, newCount)` helper over `buildChallengeRoute`; assert `limitFor(0, 2) === 2`, `limitFor(0, 3) === 3`, `limitFor(0, 7) === 5`, `limitFor(1, 1) === 2`, `limitFor(2, 2) === 4`, `limitFor(1, 4) === 5`.
   d. The other seven `it` titles and the fixtures are byte-identical — verify greps each with `-F`: `creates a one-node maintenance route when today is clear`, `counts overdue scheduled cards into today`, `prefers due cards in review-due mode`, `prefers new cards in learn-new mode`, `falls back to updated learned cards in mixed mode when no due cards exist`, `reuses the avoided uid only when no better candidate exists` (plus the two retained titles named in a/b). Use `challenge`/`planned` only where they already exist so the verify's absent-literal guards (`toBe(4)` on `challenge.limit`, `toBe(2)` on `planned.limit`) hold.

5. **`mobile/tests/unit/ownedGatePredicates.test.ts`** — `:105` `expect(planned.limit).toBe(3);` → `toBe(4)` (title `plans a route off whole-deck counts`). `:223` `expect(planned.limit).toBe(2);` in `plans a shorter route because the deck is no longer the pool` stays. The comment at `:218` may change `limit 3` → `limit 4` so it stays true. Nothing else; all 19 `it` titles unchanged.

6. **`mobile/tests/p2-smoke.ts`** — `:44` `assert.equal(challenge.limit, 4);` → `5`; `:65` `assert.equal(plannedChallenge.limit, 2);` → `3`. Two lines, nothing else (C01's edits further down are not yours).

7. **`mobile/tests/integration/economy-floor.spec.tsx`** — in `walks from an empty collection to exactly one studiable card` (`:459`): `:511` `expect(blob).toContain('Run 0/2');` → `expect(blob).toContain('Run 0/1');`, and rewrite the comment `:507-510` so it describes the new shape (one owned new card → a one-node route; R6 removed the padded warm-up slot; the assertion still guards a regression that re-opens the route to the whole deck file). Nothing else in the file; all 12 `it` titles unchanged.

8. **`mobile/tests/integration/owned-gate-entry-points.spec.tsx`** — in `sizes today’s run from the collection, not the deck file` (`:362`): `:375` → `expect(textBlob(tree)).toContain('Clear today’s run (1 cards) for +2 free pulls.');` (the `(1 cards)` grammar and `+2 free pulls` are `ChallengeScreen.tsx:31`'s own template, kept verbatim per C00 §6 #20 — do not "fix" the screen), and rewrite the comment `:372-374` accordingly (ungated the route is now two cards longer, not one). Nothing else.

9. **`mobile/tests/integration/session-card.screen.test.tsx`** — add-only, one case at the end of the `describe('SessionCardScreen')`, title verbatim:
   `it('shows the tomorrow-load forecast line on the 20th new card and not on the 19th', …)`.
   Shape: `import { settleRatingReward } from '../../src/features/gacha/rewards/sessionRewards';` (the module C01 mocked; add `import type { RatingRewardStep } from '../../src/features/gacha/rewards/sessionRewards';` if you want the literal typed) and a local `stepWith = (newCardsLearnedToday: number): RatingRewardStep => ({ newCardPaid: false, dueClearPaid: false, pulls: 0, walletBefore: null, walletAfter: null, applied: null, newCardsLearnedToday })`. A local `rateOnce(count)` mounts the screen with `params: { slug: 'csharp', mode: 'mixed', limit: 1 }` (the harness of the first case, `:236-266`), asserts no node with `testID === 'session-card-load-forecast'` before any rating, arms `vi.mocked(settleRatingReward).mockResolvedValueOnce(stepWith(count))`, presses `Reveal answer` then `Good` (the same `act` blocks as `:257-266`), and returns the tree. Then: `rateOnce(19)` → `findAll(node => node.type === 'Text' && node.props?.testID === 'session-card-load-forecast')` has length 0; unmount inside `act`; `rateOnce(20)` → length 1 and `String(node.props.children)` matches `/^At this pace, about \d+ cards? comes? due tomorrow\.$/`. The literals `newCardsLearnedToday: 20` / `19` must appear (via the helper's argument is fine — verify greps `rateOnce(19)`/`rateOnce(20)` or the bare `19`/`20` next to `newCardsLearnedToday`; keep one of those forms). If C01's factory did not build `settleRatingReward` with `vi.fn`, wrap it so `mockResolvedValueOnce` exists — that is the only permitted non-add edit. No existing case, mock or assertion changes; verify greps these six untouched titles with `-F`: `starts a session and routes to SessionSummary after the last rating`, `passes the planner minimum goal to SessionSummary`, `uses Continue in the route-complete state`, `routes to SessionSummary when Continue is pressed in the route-complete state`, `shows passive trial preview progress without adding another action`, `keeps rating dock mounted while content scrolls` (the seventh, C01's retitled Settlement case, is not pinned by C02).

10. **`mobile/tests/unit/loadForecast.test.ts` (new, fast-check)** — `import fc from 'fast-check'`; imports `FORECAST_START, FORECAST_STEP, computeTomorrowLoad, forecastLine` from `../../src/features/gacha/planner/loadForecast` and `buildUpcoming` from `../../src/features/gacha/selectors/progressSelectors`. A fixed local `NOW = new Date(2026, 3, 23, 12, 0, 0)` (local time, so day boundaries are deterministic) and a `progressArb` (`fc.array` of `fc.record({ stableUid, stage 0..6, lastReviewedAt: 0 | 1..NOW, nextReviewAt: NOW±3 days })`, `maxLength: 40`). Six cases, titles verbatim, in one `describe('computeTomorrowLoad / forecastLine')`:
    1. `it('flags a milestone at 20 and at every 10th new card after it', …)` — `fc.assert(fc.property(fc.integer({ min: 0, max: 200 }), k => computeTomorrowLoad({ progress: [], now: NOW, newCardsLearnedToday: FORECAST_START + k * FORECAST_STEP }).milestone === true))`.
    2. `it('never flags a milestone below 20 or between steps', …)` — property over `fc.integer({ min: -5, max: 2000 })`: `milestone === (n >= FORECAST_START && (n - FORECAST_START) % FORECAST_STEP === 0)`; plus the table 0, 1, 19, 21, 29, 31 → false and 20, 30, 40, 100 → true.
    3. `it("reads tomorrow's due count off the two-day calendar", …)` — property over `progressArb`: `tomorrowDue === buildUpcoming(progress, NOW, 2)[1].count`; plus a hand-built five-card fixture (due tomorrow / due today / overdue / new / due in 5 days) → `tomorrowDue === 1`.
    4. `it('counts only owned cards when a gate is passed', …)` — two cards due tomorrow, `ownedSet: null` → 2, `ownedSet: new Set(['owned'])` → 1.
    5. `it('says nothing off a milestone', …)` — property over `progressArb × fc.integer({ min: 0, max: 500 })`: `forecastLine(load)` is a string iff `load.milestone`, else `null`.
    6. `it('pins the forecast copy for zero, one and many cards', …)` — with `milestone: true`: `tomorrowDue 0` → `'At this pace, about 0 cards come due tomorrow.'`, `1` → `'At this pace, about 1 card comes due tomorrow.'`, `12` → `'At this pace, about 12 cards come due tomorrow.'`; and `FORECAST_START === 20`, `FORECAST_STEP === 10`.
    This is the C00 §3.3 property test C02 owes (milestone arithmetic). There is no byte-identical-export or event-bytes contract in C02's scope — the screen adds no event, no storage write and no sync field.

Estimated size: sessionBuilder −5/+2 lines, loadForecast ~40, SessionCardScreen ~25, loadForecast.test ~110, planner.test ~30, the five literal files ~15 in total.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C02.verify.sh` re-runs exactly these.

- Scope files exist: `mobile/src/features/gacha/planner/loadForecast.ts`, `mobile/tests/unit/loadForecast.test.ts`; C01 prerequisite present: `mobile/src/features/gacha/rewards/sessionRewards.ts` exports `settleRatingReward` and its step type carries `newCardsLearnedToday`.
- `sessionBuilder.ts` contains the §2.5 `limit` line and `hasElite` line byte for byte, still contains `const hasBoss = dueCount >= 3;`, `fresh`, and `from '../constants'`; contains neither `effectiveNew` nor `Math.max(dueCount, 1)`; exactly one `export function`.
- `loadForecast.ts` exports `FORECAST_START = 20`, `FORECAST_STEP = 10`, `type TomorrowLoad`, `computeTomorrowLoad`, `forecastLine`; imports `buildUpcoming` from `'../selectors/progressSelectors'`; carries the copy template verbatim; no React / storage / clock / randomness / `require(` imports.
- `SessionCardScreen.tsx` imports `computeTomorrowLoad, forecastLine` from `'../features/gacha/planner/loadForecast'`, contains the opening tag `<Text testID="session-card-load-forecast" numberOfLines={2} style={styles.forecastLine}>` on one line, the state line `const [loadForecast, setLoadForecast] = useState<string | null>(null);`, `setLoadForecast(null);`, calls `computeTomorrowLoad({` with `progress: nextState.updatedProgress,` and `newCardsLearnedToday: <identifier>.newCardsLearnedToday`, defines `forecastLine:` in `styles`, and has no `const [forecastLine,` state; no added line of `sessionBuilder.ts` / `SessionCardScreen.tsx` contains `Alert.alert`, `Modal`, `setTimeout(` or `setInterval(`.
- `homeSelectors.ts` unchanged against the merge base.
- Test literals: `planner.test.ts` has `expect(challenge.limit).toBe(5);`, `expect(planned.limit).toBe(3);`, not `expect(challenge.limit).toBe(4);` / `expect(planned.limit).toBe(2);`, both new titles, ≥ 11 `it(`; `ownedGatePredicates.test.ts` has `expect(planned.limit).toBe(4);` and `expect(planned.limit).toBe(2);`, not `toBe(3)`, 19 `it(`; `p2-smoke.ts` has `assert.equal(challenge.limit, 5);` and `assert.equal(plannedChallenge.limit, 3);`; `economy-floor.spec.tsx` has `'Run 0/1'` and not `'Run 0/2'`, 12 `it(`; `owned-gate-entry-points.spec.tsx` has `'Clear today’s run (1 cards) for +2 free pulls.'` and not `(2 cards)`; `session-card.screen.test.tsx` has the new title, `session-card-load-forecast`, `settleRatingReward`, and both `19` and `20` counts, ≥ 8 `it(`, the six untouched titles still present; `loadForecast.test.ts` uses `fast-check` + `fc.assert(`, imports `buildUpcoming`, has all six titles.
- No `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in the two new files or in any added line of the eight edited files.
- `cd mobile && npm run test:typecheck` exit 0.
- `cd mobile && npx vitest run tests/unit/loadForecast.test.ts tests/unit/planner.test.ts tests/unit/ownedGatePredicates.test.ts tests/integration/session-card.screen.test.tsx tests/integration/economy-floor.spec.tsx tests/integration/owned-gate-entry-points.spec.tsx --reporter=dot` exit 0.
- Scope + frozen + OTA guard against `git merge-base HEAD delivery/r16-c-economy`: only the ten scope files (plus `docs/delivery/r16-issues/*`) differ or are untracked under `mobile/src mobile/tests`; the three frozen files, `storage.ts`, `homeSelectors.ts`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `mobile/vitest.config.ts`, `mobile/tests/setup` have no diff; `p2-smoke.ts` and `ownedGatePredicates.test.ts` changed by ≤ 2 lines each way, `economy-floor.spec.tsx` and `owned-gate-entry-points.spec.tsx` by ≤ 6 each way; `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"`, `"version": "1.6.0"` still present; no `@sentry` under `mobile/src`.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C02.verify.sh
```

Runtime ≈ 20 s (tsc + six targeted suites). The driver then runs the full root gate on its own — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan, so the whole mobile suite (113 files on base, plus C01's three new unit files and your `loadForecast.test.ts`) must be green, not just the six files above.

## Do NOT

- Do NOT touch `homeSelectors.ts` (`buildRoutePreview` is C03's), `constants.ts`, `sessionPlanner.ts`, `sessionRoles.ts`, `contracts.ts`, `sessionReviewHelpers.ts`, `ChallengeScreen.tsx`, `SessionProgressHeader.tsx`, or any file C01/C03/C04 own.
- Do NOT add a dialog, toast, modal, timer, navigation param, event field, storage key or wallet call for the forecast — it is one `Text`.
- Do NOT gate the forecast on `mode` (C04 adds the sweep skip), on `rating`, or on `tomorrowDue > 0` (the copy is defined for 0).
- Do NOT name the state `forecastLine` (it would shadow the import) and do NOT rename the import (its name is the contract).
- Do NOT edit any test not named in Constraints, retitle any existing `it`, or "fix" the `(1 cards)` grammar in `ChallengeScreen.tsx`.
- Do NOT run `npm install`, `npm ci`, `expo prebuild`, `eas …`, anything network-bound, or git/npm inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree. No `git push`, no PR, never touch `main`.
