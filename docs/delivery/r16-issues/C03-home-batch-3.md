# C03 — H3 Home batch 3: F9 subline by draw.state, F10 locked copy / Caught up, F11 masteredCount (`home-batch-3`)

root: `mobile` · deps: C02 (and C01, both merged into `delivery/r16-c-economy` before your worktree is cut) · timeout: 40 min

Three Home fixes that were carried over from the 2026-09-17 Home review (`docs/home-review-and-launch-copy-2026-09-17.md:56-58`) and re-worded for the learn-to-earn economy (`docs/economy-v2-learn-to-earn-2026-09-19.md` §2 R1/R2, §5): the locked draw label and the hero sublines stop promising "clear today's route" and state the R1/R2 rule (F9, F10); a caught-up deck with an empty wallet says `Caught up` / `No cards due · a free pull returns tomorrow` instead of a dead end (F10); `Deck mastered 🎉` / `Mastered ✓` read a new `DeckSummary.masteredCount` (stage ≥ 4) instead of `masteredApprox` (reviewed once) (F11). C03 also owns the Home route-preview formula so it equals C02's planner (`C00-contracts.md` §6 #7), and moves the two FAQ answers that still describe the old rule. Pure JS/TS, OTA on runtimeVersion 1.6.0, no dependency change. Contract: `docs/delivery/r16-issues/C00-contracts.md` §2.6 (binding; signatures and literals below are repeated from it verbatim).

## Context

Line numbers are as of `delivery/r16-c-economy` (== `main@52594fe`) and were re-read on 2026-09-21. C01 and C02 do not edit any of the five source files in your scope (C00 §1.1; §6 #7 keeps C02 out of `homeSelectors.ts`), so they still hold on your worktree; of the three test files you move literals in, C01 edits `homeSelectors.spec.ts` (`:51`, `:135`, `:239`) and `home-primary-cta.test.tsx` (`:308-310`) with literal-only moves (same line count) and leaves `home-economy-floor.spec.tsx` byte-identical (C00 §3.1), so `:293`, `:332`, `:221`, `:283` hold on your tree too. Always `grep -n` the quoted identifier before editing.

- **Locked draw label** — `mobile/src/features/gacha/selectors/homeSelectors.ts:198-229` `buildDrawVM(wallet)`: wallet-full `:201-209` (label follows `FREE_PULL_CAP`/`FREE_PULL_OVERFLOW_CAP`, so after C01 it renders `Wallet full (60 + 5)`), reserve `:211-216`, available `:218-223`, locked `:225-228` with label `'Review today’s cards to earn a pull'`. The economy doc §5 cites the pre-A03 string "Clear today's route to unlock pulls" — **doc says that, tree has `'Review today’s cards to earn a pull'`** (A03 renamed it; C00 §6 #6). It is pinned by `mobile/tests/unit/homeSelectors.spec.ts:332`, `mobile/tests/integration/home-economy-floor.spec.tsx:221` and `mobile/tests/integration/home-primary-cta.test.tsx:283`. `buildDrawVM` has no deck in hand, so it cannot tell "nothing to study" from "work waiting" — the F10 dead end: a user with no cards left and 0 pulls is told to review cards that do not exist. `buildHomeVM` calls it at `:639` (`const draw = buildDrawVM(wallet);`), right after `selectedDeck` is resolved at `:635-636` (`counts` `:637`, `routePreview` `:638`).
- **Hero subline** — `buildHeroCopy` `:419-526` (`@deprecated` note at `:418` is about `helper` only): `today_done` `:462-470` subtitle `:467` `'You can stop here or spend pulls and keep momentum.'`; `today_full_clear` `:471-477` subtitle `:475` `'Great close. Pulls are ready when you want them.'`; `wallet_full` `:494-503`; default `:504-525` with the working-day subtitle `:516` `` `Review today’s cards to earn pulls · at most ${SESSION_MAIN_ROUTE_DEFAULT} cards.` `` (pinned by `homeSelectors.spec.ts:293`). The two "done" sublines promise pulls while the badge under the CTA says locked (F9). F9's original strings ("Minimum goal done — the rest of the route earns your next pull." / "Full clear done. Earn tomorrow's pull with tomorrow's route.") are full-clear-era copy that contradicts R1; C00 §2.6 replaces them. `buildHomeVM` calls `buildHeroCopy` at `:682-687` without `draw`; `hero.subline = heroCopy.subtitle` at `:701`. **`HomeScreen.tsx` renders no subline** (grep `subline` in `mobile/src/screens/HomeScreen.tsx` → 0 hits; A02 removed it), so F9 is VM-only (C00 §6 #6). `drawStatusLabel` `:714-718` (`'New pulls unlock after you clear today’s work.'`) is a legacy field rendered nowhere and is **unchanged** — `tests/unit/summary-home.test.ts:121` and `tests/p2-smoke.ts:253` pin it by regex (`/unlock after you clear today’s work/i`; both numbers are as of base — C01 rewrites `summary-home.test.ts:6-52` and `p2-smoke.ts:115-147`, so on your tree grep the regex rather than trusting the line).
- **Route preview** — `buildRoutePreview` `:102-161`; the formula `:114-124` (`fresh = Math.min(newToday, 2)`, `total = max(1, min(5, max(due,1) + (due === 0 ? fresh : min(fresh,1))))`, `hasBoss = due >= 3`, `hasElite = due >= 2 || fresh >= 1`) duplicates the planner's old formula. C02 rewrote the planner (`mobile/src/features/gacha/planner/sessionBuilder.ts:33-75`, C00 §2.5): `limit = hasTodayWork ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)) : 1`, `hasElite = dueCount >= 2 || newCount >= 1`, `effectiveNew` deleted. Until C03 lands, Home previews a different length than the session (due 0/new 1: preview 2, planner 1). `routePreview` and `counts.normalCount/eliteCount/bossCount` are consumed by no screen or test today (`TodayPressureCard.tsx` reads Due/New/Learned/Total only), so this is a VM-only correction. The elite *position* differs between the two builders for a 2-node route (preview: no elite; planner: index 1) — pre-existing, out of scope, the property test compares counts only.
- **Kicker** — `mobile/src/screens/HomeScreen.tsx:516-524`: `totalDueAcrossDecks > 0 ? '${n} cards waiting today' : draw available/reserve ? 'A reward draw is ready' : firstDrawCoach ? 'Tap your pack to begin' : 'All caught up for now'`. `totalDueAcrossDecks` is `homeState.vm.counts.totalDueAllDecks` (`:457`); `selectedDeckRow` (`HomeDeckVM | null`, `:338-344`) is in scope. **Doc (home-review F10) says `HomeScreen.tsx:557`, tree has `:516-524`.** C00 §2.6 writes the condition as `selectedRow.canStudy && due === 0 && new === 0 && draw.state === 'locked'` — the tree's variable is `selectedDeckRow`.
- **Mastered** — `HomeScreen.tsx:552` `const masteredApprox = (realRow.deck as any)?.masteredApprox ?? 0;`, `:557-558` `isFullyMastered = totalCards > 0 && masteredApprox >= totalCards && dueCount === 0`, `:564` `'Mastered ✓'`, `:603` `'Deck mastered 🎉'`. `masteredApprox` is `learned` (`mobile/src/features/gacha/home/deckActionResolver.ts:246`, `countLearned` at `:205` = `isLearnedProgress`, reviewed at least once), so a deck reads "mastered" once every card has been seen once. **Doc says `deckActionResolver.ts:206, 241`, tree has `:205-206` / `:246`.** `isMasteredProgress` (`mobile/src/features/gacha/selectors/progressSelectors.ts:28-30`, `stage >= MASTERY_STAGE_THRESHOLD`, `constants.ts:11` = 4) exists and has no Home caller. `masteredApprox` must keep its learned-count meaning: `tests/unit/homeOwnedGate.spec.ts:143` pins `masteredApprox === 1` and it feeds `percent` (`:247`); `TodayCounts.selectedMastered` (`homeSelectors.ts:180`) renders under the label **Learned** (`mobile/src/features/gacha/components/TodayPressureCard.tsx:61-64`) and is unchanged (C00 §6 #6 — the doc's "selectedMastered 改读它" is superseded). `DeckSummary` is `contracts.ts:8-28` (`masteredApprox` `:26`, `percent` `:27`); the file already has an unrelated `masteredCount: number;` on `LibraryStatusCounts` (`:96-99`) and a comment mention (`:114`) — both stay, and the new field is the only *optional* `masteredCount?:` in the file; the two non-studiable branches of `loadHomeDeckSummaries` write `masteredApprox: 0` at `:154` and `:187`. `sessionPlanner.ts:33-35` `isOwned` is private and `sessionPlanner.ts` is C04's file, so the owned check is inlined (`ownedSet === null || ownedSet.has(uid)`).
- **FAQ** — `mobile/src/content/faq.ts:1-7` header, `:14` "Fully clear today's review and you earn 1 pull…", `:18` "…Clear today's review to earn one…". `tests/integration/more.screen.test.tsx:278-292` pins only the question strings and a few unrelated substrings.
- **Economy floor** — `mobile/src/features/gacha/rewards/economyFloor.ts:19` `ECONOMY_FLOOR_GRANT = 1`, granted once per local day when owned-new 0 + due 0 + wallet 0 (`:70-81`), which is what makes `a free pull returns tomorrow` an honest sentence.
- **Constants** after C01: `mobile/src/features/gacha/constants.ts:7` `SESSION_MAIN_ROUTE_DEFAULT = 5`, `:9` `FREE_PULL_CAP = 60`, `:10` `FREE_PULL_OVERFLOW_CAP = 5`, `:11` `MASTERY_STAGE_THRESHOLD = 4`.

What C00 decided (§2.6, §3.1, §3.2, §6 #6, #7): three locked labels keyed on the selected deck, `state` stays `'locked'`; two F9 sublines keyed on `draw.state`; the default working-day subline states R1; `masteredCount?` appended to `DeckSummary` after `percent`; only `isFullyMastered` reads it; `selectedMastered` and `drawStatusLabel` untouched; preview formula == C02 planner; FAQ `:14`/`:18` rewritten; the hero subline is not re-rendered; no economy rule beyond R1–R10 is stated anywhere.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables), §1.1 (your row: `contracts.ts`, `homeSelectors.ts`, `deckActionResolver.ts`, `HomeScreen.tsx`, `faq.ts`), §2.5 (C02's formula you mirror), §2.6 (your contract, verbatim), §3.1 "C03" and §3.2 `homeBatch3.spec.ts`, §5 (verify conventions), §6 #6 and #7.
2. `mobile/src/features/gacha/selectors/homeSelectors.ts:1-16` (imports), `:73-100` (`HomeDrawVM`, `HomeViewModel`), `:102-161` (`buildRoutePreview`), `:163-185` (`buildCounts`), `:198-229` (`buildDrawVM`), `:419-526` (`buildHeroCopy`), `:608-747` (`buildHomeVM`).
3. `mobile/src/screens/HomeScreen.tsx:338-344` (`selectedDeckRow`), `:450-457`, `:507-525` (header + kicker), `:540-575` (the visual-deck mapper with `isFullyMastered`), `:597-608` (`heroTitle`), `:745-753` (draw badge).
4. `mobile/src/features/gacha/home/deckActionResolver.ts:1-16` (imports), `:101-260` (`loadHomeDeckSummaries`, the two `masteredApprox: 0` literals at `:154`/`:187`, the studiable branch `:196-248`).
5. `mobile/src/features/gacha/contracts.ts:8-28` (`DeckSummary`), `:30-38` (`TodayCounts`), `:65-75` (`ChallengeRoute` — do not touch, C04 adds `'sweep'` there).
6. `mobile/src/features/gacha/selectors/progressSelectors.ts:16-30`; `mobile/src/features/gacha/planner/sessionBuilder.ts:33-75` as it is on your tree (C02's version); `mobile/src/features/gacha/planner/sessionPlanner.ts:33-35`, `:59-61`.
7. `mobile/src/content/faq.ts:1-19`.
8. Tests: `mobile/tests/unit/homeSelectors.spec.ts:1-26` (`makeDeck`), `:283-334`; `mobile/tests/integration/home.screen.test.tsx:1-175` (harness: `walletFixture`, `deckSummariesFixture`, `textBlob`), `:223-240` (a fixture-mutating case to copy); `mobile/tests/unit/homeOwnedGate.spec.ts:1-108` (the storage-backed harness for `loadHomeDeckSummaries` you copy into the new spec); `mobile/tests/integration/home-economy-floor.spec.tsx:162-168`, `:215-222`; `mobile/tests/integration/home-primary-cta.test.tsx:93-120`, `:190-195`, `:278-285`; `mobile/tests/unit/skipPolicy.test.ts:1-10` (fast-check import style).
9. `docs/home-review-and-launch-copy-2026-09-17.md:56-58` (F9/F10/F11 rows — history; where they disagree with C00 §2.6, C00 wins) and `docs/economy-v2-learn-to-earn-2026-09-19.md:24-35` (R1–R10), `:54-60` (§5).

## Constraints

- **Scope (the ONLY files that may change):**
  `mobile/src/features/gacha/contracts.ts`, `mobile/src/features/gacha/selectors/homeSelectors.ts`, `mobile/src/features/gacha/home/deckActionResolver.ts`, `mobile/src/screens/HomeScreen.tsx`, `mobile/src/content/faq.ts`, `mobile/tests/unit/homeBatch3.spec.ts` (new), `mobile/tests/integration/home.screen.test.tsx` (add-only: two new `it` blocks, zero deleted lines), `mobile/tests/unit/homeSelectors.spec.ts` (exactly two literals, `:293` and `:332`), `mobile/tests/integration/home-economy-floor.spec.tsx` (exactly one literal, `:221`), `mobile/tests/integration/home-primary-cta.test.tsx` (exactly one literal, `:283`). Nothing else — no `sessionBuilder.ts`/`sessionPlanner.ts` (C02/C04), no `TodayPressureCard.tsx`, no `navigation/types.ts`, no `drawState.ts`, no `libraryMapper.ts`, no `ChallengeScreen.tsx` (its `+2 free pulls` line is C00 §6 #20, left alone), no `mobile/src/config/*`.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also untouched: `mobile/src/review/storage.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`.
- **OTA / no-dependency rule (C00 §0):** this ships as an `eas update` on runtimeVersion 1.6.0. `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` are byte-identical; no `npm install`, no new import of any package that is not already imported somewhere under `mobile/src`; no `@sentry/*`.
- **Economy copy:** every string you add states only R1 ("each new card you learn earns a pull"), R2 ("clear today's due cards … a pull, once a day") or R3 (the daily floor). Never "full clear", never "+1 per cleared review", never a number of pulls per run. `Mastered` means stage ≥ 4 and nothing else.
- **Literals are pinned verbatim** (C00 §2.6): the three locked labels, the two F9 sublines, the default subline template, `'Caught up'`, the `:552` line, the FAQ answers. Use the curly apostrophe `’` (U+2019) and the middle dot `·` (U+00B7) exactly as written here — the existing strings in `homeSelectors.ts` use the same characters. Unchanged literals stay byte-identical: `'Mastered ✓'`, `'Deck mastered 🎉'`, `'All caught up for now'`, `'A reward draw is ready'`, `'Tap your pack to begin'`, `'No active deck yet'`, `'New pulls unlock after you clear today’s work.'`, `'You can stop here or spend pulls and keep momentum.'`, `'Great close. Pulls are ready when you want them.'`, `'Pulls are full. Today’s review still comes first; spend a pull afterwards.'`, every `testID`.
- **Banned in any new/changed line:** the six terms of B00 §0 (driver grep, case-insensitive) — write "work around", "sidestep", "guard", "probe" instead. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`. Do not copy the comment at `home.screen.test.tsx:200-202` into a new case (its second word is one of the six).
- **Existing tests:** the three literal moves above and the two add-only cases in `home.screen.test.tsx` are the only edits to existing tests. `tests/unit/homeOwnedGate.spec.ts` (`:143` `masteredApprox === 1`), `tests/unit/summary-home.test.ts`, `tests/unit/deckActionResolver.spec.ts`, `tests/unit/planner.test.ts`, `tests/integration/home-cta-target.test.tsx`, `tests/integration/more.screen.test.tsx`, `tests/p2-smoke.ts` are byte-identical and must stay green (the whole suite must: the driver runs `npm run test:typecheck && npx vitest run` after your verify).
- `mobile/tsconfig.json` has no `include`, so `tests/` is typechecked under `strict: true` — no implicit `any` in the new spec; type fixtures as `DeckSummary`/`CardProgress`. Any `JSX.Element` annotation is `React.JSX.Element` (C00 §6 #23) — you should need none.
- No `git push`, no PR, never touch `main`, no EAS/expo command, no network.

## Changes required

1. **`mobile/src/features/gacha/contracts.ts`** — `DeckSummary` (`:8-28`) gains one optional field, appended directly after `percent: number;` (`:27`), verbatim:
   ```ts
     /** Owned cards at stage >= MASTERY_STAGE_THRESHOLD (isMasteredProgress). masteredApprox keeps
      *  meaning "learned" and still feeds percent; only Home's Mastered ✓ / Deck mastered read this. */
     masteredCount?: number;
   ```
   Nothing else in the file changes (`TodayCounts.selectedMastered` `:34` and `ChallengeRoute` `:65-75` stay).

2. **`mobile/src/features/gacha/home/deckActionResolver.ts`**
   a. `:17` (`import { buildUpcoming, clamp01 } from '../selectors/progressSelectors';` — `:16` is the `HomeDeckActionHint` type import, leave it) becomes `import { buildUpcoming, clamp01, isMasteredProgress } from '../selectors/progressSelectors';`.
   b. Next to `const learned = countLearned(progress, ownedSet);` (`:205`) add
      ```ts
      // F11: "mastered" is stage >= 4, not "reviewed once". `isOwned` in sessionPlanner is
      // private, so the gate is inlined; a studied card is always owned (grandfathered), so
      // this can only ever be <= learned.
      const mastered = progress.filter(
        (item) => (ownedSet === null || ownedSet.has(item.stableUid)) && isMasteredProgress(item),
      ).length;
      ```
   c. In the studiable summary literal (`:228-248`) add `masteredCount: mastered,` on the line directly after `masteredApprox: learned,` (`:246`). `masteredApprox: learned,` and `percent: clamp01(learned / denom),` are unchanged.
   d. The two non-studiable literals (`:154`, `:187`) each gain `masteredCount: 0,` directly after their `masteredApprox: 0,` line.

3. **`mobile/src/features/gacha/selectors/homeSelectors.ts`**
   a. `buildDrawVM` (`:198-229`) — signature, verbatim: `function buildDrawVM(wallet?: RewardWalletState | null, selectedDeck?: DeckSummary | null): HomeDrawVM {`. The wallet-full / reserve / available branches (`:201-223`) are unchanged. The locked return (`:225-228`) becomes:
      ```ts
        // F10 / R1 / R2. `state` stays 'locked' in all three: the label is the only thing the day
        // changes. The first line is honest because the economy floor (economyFloor.ts, ECONOMY_FLOOR_GRANT)
        // pays exactly one pull on the next day a caught-up account with an empty wallet loads Home.
        const deck = selectedDeck?.canStudy ? selectedDeck : null;
        const caughtUp = !!deck && deck.dueToday + deck.newToday === 0;
        const dueOnly = !!deck && deck.newToday === 0 && deck.dueToday > 0;
        return {
          state: 'locked',
          label: caughtUp
            ? 'No cards due · a free pull returns tomorrow'
            : dueOnly
              ? 'Clear today’s due cards to earn a pull'
              : 'Learn a new card to earn a pull',
        };
      ```
      Truth table (C00 §2.6): `canStudy && due + new === 0` → `'No cards due · a free pull returns tomorrow'`; `canStudy && new === 0 && due > 0` → `'Clear today’s due cards to earn a pull'`; everything else (new > 0, no deck, deck not studiable) → `'Learn a new card to earn a pull'`. The string `'Review today’s cards to earn a pull'` no longer appears in the file.
   b. `buildHomeVM` `:639` becomes `const draw = buildDrawVM(wallet, selectedDeck);`.
   c. `buildHeroCopy` (`:419`) — params gain `draw: HomeDrawVM` (last), destructured with the others; signature, verbatim:
      ```ts
      function buildHeroCopy(params: {
        statusKind: HomeCtaKind;
        selectedDeck: DeckSummary | null;
        counts: TodayCounts;
        hasSignedInUser: boolean;
        draw: HomeDrawVM;
      }): { eyebrow: string; title: string; subtitle: string; helper: string } {
      ```
      - `today_done` (`:462-470`): `subtitle` becomes `draw.state === 'locked' ? 'Minimum goal done. Each new card you learn earns a pull.' : 'You can stop here or spend pulls and keep momentum.'`; `eyebrow`, `title`, `helper` unchanged.
      - `today_full_clear` (`:471-477`): `subtitle` becomes `draw.state === 'locked' ? 'Route done. Learn a new card to earn your next pull.' : 'Great close. Pulls are ready when you want them.'`; rest unchanged.
      - default branch `:516`: `` `Review today’s cards to earn pulls · at most ${SESSION_MAIN_ROUTE_DEFAULT} cards.` `` becomes `` `Each new card you learn earns a pull · up to ${SESSION_MAIN_ROUTE_DEFAULT} cards a run.` `` (the `hasTodayWork` ternary and the `'Nothing due today; review later or browse your decks.'` arm stay).
      - `wallet_full` (`:494-503`), `error`, `!selectedDeck`, `!canStudy`, `today_partial`, `due_only`, `nothing_to_learn` and every `helper` string: unchanged.
      - The call at `:682-687` passes `draw` (it is built at `:639`, before this call).
   d. `buildRoutePreview` (`:114-124`) — replace the five lines from `const fresh = …` through `const hasElite = …` with C02's formula (C00 §2.5 / §6 #7):
      ```ts
        const due = selectedDeck.dueToday;
        // Same formula as buildChallengeRoute (planner/sessionBuilder.ts): R6 removed the 1–2 new-card
        // quota, so Home must preview the length the session will actually have.
        const total = Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, due + selectedDeck.newToday));
        const hasBoss = due >= 3;
        const hasElite = due >= 2 || selectedDeck.newToday >= 1;
      ```
      `fresh`, `Math.min(selectedDeck.newToday, 2)` and `Math.max(due, 1)` disappear from the file; the node loop `:126-161` is unchanged.
   e. `drawStatusLabel` (`:714-718`), `inferStatusKind`, `mapStatusToCta`, `buildGoalVM`, `buildDeckRows`, `buildCalendarCompact`, every exported type: unchanged. Do not export `buildDrawVM`/`buildHeroCopy`.

4. **`mobile/src/screens/HomeScreen.tsx`**
   a. Kicker (`:516-524`): insert the F10 branch before the final fallback, so the ternary chain reads
      ```tsx
      {totalDueAcrossDecks > 0
        ? `${totalDueAcrossDecks} cards waiting today`
        : homeState.vm.draw.state === 'available' || homeState.vm.draw.state === 'reserve'
          ? 'A reward draw is ready'
          : firstDrawCoach
            ? 'Tap your pack to begin'
            : selectedDeckRow?.deck.canStudy &&
                selectedDeckRow.deck.dueToday === 0 &&
                selectedDeckRow.deck.newToday === 0 &&
                homeState.vm.draw.state === 'locked'
              ? 'Caught up'
              : 'All caught up for now'}
      ```
      (`selectedDeckRow` is the `useMemo` at `:338-344`.) The `Text` element, its style and `numberOfLines={1}` are unchanged; add no testID.
   b. `:552` becomes, verbatim, `const masteredCount = (realRow.deck as any)?.masteredCount ?? 0;` (the `masteredApprox` local is gone). Update the comment `:553-556` to say mastered = stage ≥ 4 via `masteredCount` (F11) and that `masteredApprox` counts "reviewed once" and must not decide this; `:557-558` becomes
      ```tsx
      const isFullyMastered =
        totalCards > 0 && masteredCount >= totalCards && dueCount === 0;
      ```
      `'Mastered ✓'` (`:564`), `'Deck mastered 🎉'` (`:603`), `heroTitle` priority (`:600-608`), `statusDotColor`, every testID and every other line: unchanged. `masteredApprox` is no longer read anywhere in `HomeScreen.tsx`.

5. **`mobile/src/content/faq.ts`**
   a. `:14` becomes, verbatim: `a: "Every new card you learn earns 1 pull the first time you rate it Hard or better, and clearing all of today's due cards earns 1 more, once a day. New accounts start with 3 starter pulls, and if you have no cards left to study and no pulls, a 1-pull daily floor keeps you going. Pulls are never sold.",`
   b. `:18` becomes, verbatim: `a: "Draw locks when you have no pulls to spend. Learn a new card to earn one, or wait for the daily floor pull if you have nothing left to study.",`
   c. Header comment `:1-7`: replace `+1 pull per fully cleared review (rewardResolver.ts)` with `1 pull per new card learned (first Hard+ rating, R1) and 1 pull a day for clearing today's due cards (R2), both settled in sessionRewards.ts` — the tokens `R1` and `R2` must appear in the header, and the substring `per fully` must not. The `q` strings, the other six entries and `FaqEntry` are unchanged (`more.screen.test.tsx:278-292` pins the questions).

6. **`mobile/tests/unit/homeBatch3.spec.ts` (new)** — vitest + `fast-check` (`import fc from 'fast-check';`). Two harness pieces: (i) a local `makeDeck(overrides: Partial<DeckSummary> = {}): DeckSummary` copied from `homeSelectors.spec.ts:9-26`; (ii) the storage-backed harness of `homeOwnedGate.spec.ts:1-72` (Map-backed `@react-native-async-storage/async-storage`, `DECK` with three cards, `vi.mock` of `../../src/content/activeDeck`, `../../src/content/deckRepository` (with `resolveDeckBySlug: vi.fn(async () => DECK)` you can override per case), `../../src/sync/progressSync`, `../../src/notifications/reminders`), plus `saveDeckProgress`/`setActiveUserSubForStorage` from `../../src/review/storage`, `saveDrawState` from `../../src/features/gacha/draw/drawStateStore`, `invalidateDrawStateCache` from `../../src/features/gacha/draw/drawStateCache`, and a `beforeEach` that clears the store, invalidates the cache and sets the user sub to `null`. Imports under test: `buildHomeVM` from `../../src/features/gacha/selectors/homeSelectors`, `loadHomeDeckSummaries` from `../../src/features/gacha/home/deckActionResolver`, `buildChallengeRoute` from `../../src/features/gacha/planner/sessionBuilder`, `FREE_PULL_CAP`/`FREE_PULL_OVERFLOW_CAP` from `../../src/features/gacha/constants`. Every `buildHomeVM` call passes `selectedSlug: 'csharp'`, `hasSignedInUser: true`, one `makeDeck(...)` and an explicit `wallet`. Cases, each its own `it`, titles verbatim:
   1. `it('says a free pull returns tomorrow when the selected deck is caught up', …)` — `makeDeck({ dueToday: 0, newToday: 0 })`, wallet `{ availablePulls: 0, reservePulls: 0 }` → `vm.draw.state === 'locked'` and `vm.draw.label === 'No cards due · a free pull returns tomorrow'`; the same deck with `statusHint: 'today_full_clear'` gives the same label (the hint does not change the badge).
   2. `it('asks for the due cards when only due work remains', …)` — `makeDeck({ dueToday: 2, newToday: 0 })`, empty wallet → `'Clear today’s due cards to earn a pull'`, state `'locked'`.
   3. `it('asks for a new card in every other locked case', …)` — empty wallet with each of: `makeDeck({ dueToday: 0, newToday: 1 })`, `makeDeck({ dueToday: 3, newToday: 2 })`, `makeDeck({ canStudy: false, dueToday: 0, newToday: 0 })`, and `deckSummaries: []` → all four `'Learn a new card to earn a pull'`, state `'locked'`; and `'Review today’s cards to earn a pull'` is nowhere in any of the four VMs' `draw.label`.
   4. `it('keeps the three unlocked draw states untouched', …)` — `makeDeck({ dueToday: 0, newToday: 0 })` (the caught-up deck, to prove the deck never overrides a wallet with pulls) with `{ availablePulls: 1, reservePulls: 0 }` → `'1 pull ready'` / `'available'`; `{ availablePulls: 1, reservePulls: 2 }` → `'1 pull ready · 2 more waiting'` / `'reserve'`; `{ availablePulls: FREE_PULL_CAP, reservePulls: FREE_PULL_OVERFLOW_CAP }` → `` `Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})` `` / `'wallet-full'`.
   5. `it('tells a done-for-today user that each new card earns a pull while locked', …)` — `makeDeck({ dueToday: 1, newToday: 1 })`, `statusHint: 'today_done'`: empty wallet → `vm.hero.subline === 'Minimum goal done. Each new card you learn earns a pull.'`; `{ availablePulls: 2, reservePulls: 0 }` → `'You can stop here or spend pulls and keep momentum.'`; `vm.hero.headline === 'Minimum goal already done'` in both.
   6. `it('tells a full-clear user to learn a new card while locked', …)` — `makeDeck({ dueToday: 0, newToday: 0 })`, `statusHint: 'today_full_clear'`: empty wallet → `'Route done. Learn a new card to earn your next pull.'`; `{ availablePulls: 2, reservePulls: 0 }` → `'Great close. Pulls are ready when you want them.'`.
   7. `it('leaves the wallet-full subline alone', …)` — `makeDeck({ dueToday: 3, newToday: 1 })`, wallet `{ availablePulls: FREE_PULL_CAP, reservePulls: FREE_PULL_OVERFLOW_CAP }`, no hint → `vm.cta.kind === 'wallet_full'` and `vm.hero.subline === 'Pulls are full. Today’s review still comes first; spend a pull afterwards.'`; and `vm.drawStatusLabel` matches `/unlock after you clear today’s work/i` (the legacy field is untouched).
   8. `it('counts mastered cards by stage, not by having been reviewed', …)` — seed `saveDeckProgress(DECK, [{ stableUid: 'stranger', stage: 4, lastReviewedAt: now - DAY, nextReviewAt: now + 30 * DAY, lastSeenRevision: 1 }, { stableUid: 'drawn', stage: 2, lastReviewedAt: now - DAY, nextReviewAt: now + 3 * DAY, lastSeenRevision: 1 }, { stableUid: 'grand', stage: 0, nextReviewAt: 0, lastSeenRevision: 0 }])` and `saveDrawState('csharp', { owned: ['grand'], pity: null })`; `const { deckSummaries } = await loadHomeDeckSummaries({ premium: false })` → `deckSummaries[0].masteredCount === 1`, `deckSummaries[0].masteredApprox === 2`, `deckSummaries[0].newToday === 1`, `deckSummaries[0].dueToday === 0`.
   9. `it('reports masteredCount 0 for a deck that is not studiable', …)` — `vi.mocked(resolveDeckBySlug).mockResolvedValueOnce(null as any)` (import `resolveDeckBySlug` from the mocked `../../src/content/deckRepository`) → `deckSummaries[0].canStudy === false`, `masteredCount === 0`, `masteredApprox === 0`.
   10. `it('previews exactly as many nodes as the planner would schedule', …)` — for `[due, fresh, expected]` in `[[0, 1, 1], [3, 2, 5], [1, 2, 3]]`: `buildHomeVM({ …, deckSummaries: [makeDeck({ dueToday: due, newToday: fresh })], wallet: empty }).routePreview` has length `expected` **and** length `buildChallengeRoute({ slug: 'csharp', deckTitle: 'C# Interview', dueCount: due, newCount: fresh }).limit`.
   11. `it('previews as many nodes as the planner limit for any due/new pair', …)` — `fc.assert(fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (due, fresh) => { … }))`: `vm.routePreview.length === route.limit`, `vm.counts.normalCount + vm.counts.eliteCount + vm.counts.bossCount === route.limit`, and `vm.counts.bossCount === route.nodes.filter((n) => n.role === 'boss').length` (elite placement is deliberately not compared — see Context).

7. **`mobile/tests/integration/home.screen.test.tsx`** — add-only, two cases appended inside `describe('HomeScreen v9', …)` after the last existing `it` (`:478-`), using the file's own `walletFixture` / `deckSummariesFixture` / `flush` / `textBlob`. Titles verbatim:
   1. `it('says Caught up in the header when the selected deck is clear and pulls are locked', …)` — set every fixture deck to `dueToday: 0, plannedToday: 0, newToday: 0` and `walletFixture = { availablePulls: 0, reservePulls: 0 }`; render; the tree has a `Text` node whose `children` is exactly `'Caught up'` (find it with `tree.root.findAll((node) => (node.type as any) === 'Text' && node.props.children === 'Caught up')` → length 1), `textBlob(tree)` does not contain `'All caught up for now'`, and the `home-draw-status-badge` text is `'No cards due · a free pull returns tomorrow'`. Then a second render with `walletFixture = { availablePulls: 1, reservePulls: 0 }` shows `'A reward draw is ready'` and no `'Caught up'` node. (The economy floor does not fire here: the resolver mock returns no `totalNewAllDecks`/`totalDueAllDecks`, and `isEconomyStarved` treats a missing count as not starved.)
   2. `it('celebrates a mastered deck only when every card reached the mastery stage', …)` — both fixture decks `dueToday: 0, plannedToday: 0, newToday: 0`; the `csharp` row (`totalCards: 10`) with `masteredApprox: 10` and **no** `masteredCount` → `textBlob(tree)` contains neither `'Deck mastered 🎉'` nor `'Mastered ✓'`; a second render with `masteredCount: 10` → contains `'Deck mastered 🎉'` and `'Mastered ✓'`; a third with `masteredCount: 10, dueToday: 1, plannedToday: 1` → neither (the due guard).

8. **Existing literals (exactly these, nothing else in those files):**
   - `mobile/tests/unit/homeSelectors.spec.ts:293` `'Review today’s cards to earn pulls · at most 5 cards.'` → `'Each new card you learn earns a pull · up to 5 cards a run.'`; `:332` `'Review today’s cards to earn a pull'` → `'Learn a new card to earn a pull'`.
   - `mobile/tests/integration/home-economy-floor.spec.tsx:221` → `expect(badgeText(tree)).toBe('Learn a new card to earn a pull');` (the seeded owned card `c1` is unstudied, so the deck has 1 new card).
   - `mobile/tests/integration/home-primary-cta.test.tsx:283` → `expectedDrawBadge: 'Learn a new card to earn a pull',` (the default progress fixture is due 1 / new 1).
   - The neighbouring cases stay titled exactly as they are, and the verify script checks for them: `it('hero subline no longer names route roles'` (`homeSelectors.spec.ts:284`), `it('draw badge speaks in pulls, not reserve'` (`:310`), `it('leaves a user with cards to study exactly as poor as they were'` (`home-economy-floor.spec.tsx:216`), and the `it.each` table titled `'keeps v9 reward gateway contract for %s wallet state'` (`home-primary-cta.test.tsx:315`).

Estimated size: contracts.ts +3, deckActionResolver.ts +9, homeSelectors.ts ~±25, HomeScreen.tsx ~±12, faq.ts ~±5, homeBatch3.spec.ts ~230, home.screen.test.tsx +~70, three one-line test moves.

## Acceptance

Run from the worktree root; `docs/delivery/r16-issues/C03.verify.sh` re-runs exactly these.

- Scope files exist: `mobile/tests/unit/homeBatch3.spec.ts` (new); the eight edited files are present. Prerequisites from C01/C02 are on the tree: `mobile/src/features/gacha/constants.ts` has `export const FREE_PULL_CAP = 60;`, `mobile/src/features/gacha/planner/sessionBuilder.ts` contains `Math.min(SESSION_MAIN_ROUTE_DEFAULT, dueCount + newCount)` and no `effectiveNew`, `mobile/src/features/gacha/planner/loadForecast.ts` exists.
- Literal guards (`grep -F`, exit 0): `contracts.ts` has `masteredCount?: number;` within three lines after `  percent: number;`, exactly one `masteredCount?:` in the file, none inside the `TodayCounts` block, and `LibraryStatusCounts`' `  masteredCount: number;` untouched; `deckActionResolver.ts` imports `isMasteredProgress`, has `isMasteredProgress(`, exactly two `masteredCount: 0,` and one `masteredCount: mastered,` directly after `masteredApprox: learned,`; `homeSelectors.ts` has the `buildDrawVM(wallet?: RewardWalletState | null, selectedDeck?: DeckSummary | null): HomeDrawVM` signature, `buildDrawVM(wallet, selectedDeck)`, `draw: HomeDrawVM;`, the three locked labels, the two F9 sublines, the default template `Each new card you learn earns a pull · up to ${SESSION_MAIN_ROUTE_DEFAULT} cards a run.`, `Math.min(SESSION_MAIN_ROUTE_DEFAULT, due + selectedDeck.newToday)`, `selectedDeck.newToday >= 1`, and still `'New pulls unlock after you clear today’s work.'`, `'You can stop here or spend pulls and keep momentum.'`, `'Great close. Pulls are ready when you want them.'`; and does NOT contain `Review today’s cards`, `Math.min(selectedDeck.newToday, 2)`, `Math.max(due, 1)`, `export function buildDrawVM`, `export function buildHeroCopy`; `HomeScreen.tsx` has `'Caught up'`, `const masteredCount = (realRow.deck as any)?.masteredCount ?? 0;`, `masteredCount >= totalCards && dueCount === 0`, `'All caught up for now'`, `'Mastered ✓'`, `'Deck mastered 🎉'`, and no `masteredApprox`; `faq.ts` has the two new answers, `R1` and `R2`, and neither `per fully` nor `Fully clear today` nor `Clear today's review`.
- Test guards: the 11 `it('…'` titles of change 6 are in `homeBatch3.spec.ts` (with `from 'fast-check'` and `fc.assert(`); the 2 titles of change 7 are in `home.screen.test.tsx` (≥ 14 `it(` blocks); `homeSelectors.spec.ts` contains both moved literals and not `Review today’s cards`; `home-economy-floor.spec.tsx` contains `toBe('Learn a new card to earn a pull')`; `home-primary-cta.test.tsx` contains `expectedDrawBadge: 'Learn a new card to earn a pull',`; the four neighbouring titles listed under change 8 are still present verbatim; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any scope file.
- `cd mobile && npm run test:typecheck` — exit 0.
- `cd mobile && npx vitest run tests/unit/homeBatch3.spec.ts tests/unit/homeSelectors.spec.ts tests/unit/homeOwnedGate.spec.ts tests/unit/summary-home.test.ts tests/unit/deckActionResolver.spec.ts tests/unit/planner.test.ts tests/integration/home.screen.test.tsx tests/integration/home-economy-floor.spec.tsx tests/integration/home-primary-cta.test.tsx tests/integration/home-cta-target.test.tsx tests/integration/more.screen.test.tsx --reporter=dot` — exit 0.
- Scope + frozen + OTA guard against `git merge-base HEAD delivery/r16-c-economy`: zero diff on the three frozen files, on `mobile/src/review/storage.ts`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`, `mobile/tests/setup`, on `mobile/package.json` / `package-lock.json` / `app.json` / `eas.json`, and on `tests/unit/homeOwnedGate.spec.ts`, `tests/unit/summary-home.test.ts`, `tests/unit/deckActionResolver.spec.ts`, `tests/unit/planner.test.ts`; `git diff --numstat` is `2	2` for `homeSelectors.spec.ts`, `1	1` for `home-economy-floor.spec.tsx` and `home-primary-cta.test.tsx`, and `N	0` for `home.screen.test.tsx`; `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"` and `"version": "1.6.0"` unchanged; no `@sentry` under `mobile/src`; no changed or untracked file outside the scope list (untracked scan over `mobile/src mobile/tests docs` and the manifest files).

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C03.verify.sh
```
(cwd = worktree root; runs the five steps above and ends with `C03 VERIFY OK`). The driver then runs the full mobile root gate — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan, so the whole suite must be green, not just the targeted files.

## Do NOT

- Do NOT add a fourth locked label, a threshold, or any copy that states a rule outside economy-v2 §2 (no "full clear", no pulls-per-run, no "30"/"60" literals in copy other than the existing `Wallet full` template).
- Do NOT re-render `hero.subline` in `HomeScreen.tsx`, add a testID, or touch the `home-draw-status-badge` / `home-goal-line` / `home-primary-cta` surfaces.
- Do NOT change `masteredApprox`'s meaning or `TodayCounts.selectedMastered`, and do NOT add `masteredCount` to `TodayCounts`, `LibraryStatusCounts` (`contracts.ts:99` already has a non-optional one) or the settlement types (they have their own `masteredCount`).
- Do NOT edit `sessionBuilder.ts`, `sessionPlanner.ts`, `sessionRoles.ts`, `TodayPressureCard.tsx`, `drawState.ts`, `libraryMapper.ts`, `ChallengeScreen.tsx`, `DrawScreen.tsx`, `DrawResultScreen.tsx` (C00 §6 #20 leaves their old-rule copy in place) or any `docs/*.md` (C15 owns the launch copy).
- Do NOT touch `home-cta-target.test.tsx`, `homeOwnedGate.spec.ts`, `summary-home.test.ts`, `deckActionResolver.spec.ts`, `planner.test.ts`, `p2-smoke.ts`; do NOT delete or retitle any existing `it`.
- Standing rules: no `git push`, no PR, never touch `main`, no EAS/expo command, no `npm install`, no test gutting.
