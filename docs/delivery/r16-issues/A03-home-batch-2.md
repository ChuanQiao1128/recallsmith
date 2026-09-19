# A03 — Home batch 2: relabel the Today tiles (F2), dedupe the due count (F4), replace planner jargon (F5)

## Context

Home's "Today's pressure" card renders four tiles (Normal / Elite / Boss / Total) whose first three count a synthetic route preview that no reachable screen shows, do not add up to Total, and read "1 Normal" when there is nothing to study (`mobile/src/features/gacha/components/TodayPressureCard.tsx:32-64`, fed by `buildCounts()` at `mobile/src/features/gacha/selectors/homeSelectors.ts:163-185` over `buildRoutePreview()` at `:102-161`). The same due number is then repeated in the card subtitle (`TodayPressureCard.tsx:29`) and the hero subline (`homeSelectors.ts:515`), and every nudge on Home speaks planner jargon (pressure / route / node / reserve / fresh) that the previous screen never defines and the next screen never repeats (`homeSelectors.ts:214, :227, :458, :488, :500, :509, :515-516, :584`; `mobile/src/features/gacha/home/HomeDeckRow.tsx:56`). This issue relabels the tiles to numbers the next screen can verify (Due / New / Learned / Total), drops the redundant subtitle tail and footnote, and copy-swaps the rendered strings to the four-word Home glossary (cards, review, pull, packs) — updating exactly the pinned test literals listed below. Spec: `docs/home-review-and-launch-copy-2026-09-17.md` §1.3 rows F2 (line 49), F4 (line 51), F5 (line 52).

Line numbers are as of `92cebbd` on `delivery/r16-a-home`. A02 (this issue's dependency) edits the StyleSheet block of `TodayPressureCard.tsx` (font sizes only) and `HomeScreen.tsx`; the JSX anchors above should hold, but grep for each quoted literal before editing rather than trusting a number.

## Constraints

- Scope (only these six files may change; no new files, no new deps, no new packages):
  - `mobile/src/features/gacha/selectors/homeSelectors.ts`
  - `mobile/src/features/gacha/components/TodayPressureCard.tsx`
  - `mobile/src/features/gacha/home/HomeDeckRow.tsx`
  - `mobile/tests/integration/home-primary-cta.test.tsx`
  - `mobile/tests/integration/home-economy-floor.spec.tsx`
  - `mobile/tests/unit/homeSelectors.spec.ts`
- Frozen (gacha-v7.md §2.1; never touch): `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Also do NOT touch `mobile/src/screens/HomeScreen.tsx` (A02/A04 own it), `mobile/src/features/gacha/contracts.ts`, `rewardWallet.ts`, `drawState.ts`, `summaryMapper.ts`.
- testIDs that must keep existing exactly as today, on the same element types: `home-today-count-grid` (the row View), `home-today-count-normal`, `home-today-count-elite`, `home-today-count-boss`, `home-today-count-total` (the four metric Views, in that order), `home-draw-status-badge`, `home-primary-cta`, `screen-home-primary-cta`. Do not add `testID` to any new wrapper except the one new empty-state Text named below.
- Style keys `metric`, `metricWide: { flex: 1, minWidth: 0 }`, `metricCompact: { width: '48%' }` and the `useCompactMetrics = width < 390` rule in `TodayPressureCard.tsx:20-21, :101-102` stay byte-identical — `home-primary-cta.test.tsx:269-274` compares the `home-today-count-total` style array against them. Do not reorder the four tiles.
- The ONLY test literals allowed to change (everything else in the three test files stays as is; do not delete, skip or loosen any assertion):
  - `home-primary-cta.test.tsx:264-266`: `'Normal'` → `'Due'`, `'Elite'` → `'New'`, `'Boss'` → `'Learned'`. Line 267 `'Total'` stays.
  - `home-primary-cta.test.tsx:283`: `'Clear today’s route to unlock pulls'` → `'Review today’s cards to earn a pull'` (line 337 is the `expect` that reads it; it does not change).
  - `home-primary-cta.test.tsx:302`: `'1 ready · 2 in reserve'` → `'1 pull ready · 2 more waiting'`.
  - `home-economy-floor.spec.tsx:221`: `'Clear today’s route to unlock pulls'` → `'Review today’s cards to earn a pull'`.
  - `home-primary-cta.test.tsx:294` `'2 pulls ready'`, `:310` `'Wallet full (30 + 5)'`, `home-economy-floor.spec.tsx:211` `'1 pull ready'`, `homeSelectors.spec.ts:243` `/Wallet full/i` are pinned and must still pass → the wallet-full label at `homeSelectors.ts:207` and the available label at `:221` do NOT change.
- Banned copy (gacha-v7.md:213, :308): never introduce `MVP`, `placeholder`, `coming soon`, `lost`, `missed`, `forfeit`, `wasted`, `gone`, `expired`. Do not hardcode "earn 1 pull" anywhere (spec F16 — reward pulls vary per route).
- No `@ts-ignore` / `@ts-expect-error` / `eslint-disable`; no tsconfig or vitest config changes.

## Changes required

1. `mobile/src/features/gacha/components/TodayPressureCard.tsx` (F2 + F4 + F5):
   1. Title (`:25-27`): `Today’s pressure` → `Today`.
   2. Subtitle (`:28-30`): render only the deck title — `{selectedDeckTitle ?? 'No active deck selected'}` — i.e. drop the ` · N due · N fresh` tail entirely. No number and no word "fresh" may remain on this line.
   3. Tiles (`:33-64`), keeping the four `testID`s, the element order and the style arrays exactly as they are:
      - `home-today-count-normal`: value `{counts.selectedDue}`, label `Due`.
      - `home-today-count-elite`: value `{counts.selectedNew}`, label `New`.
      - `home-today-count-boss`: value `{counts.selectedMastered}`, label `Learned`.
      - `home-today-count-total`: value `{counts.totalDueAllDecks}`, label `Total` (unchanged).
      Style token names (`metricNormal` / `metricElite` / `metricBoss`) may stay as they are; do not rename the testIDs.
   4. Delete the footnote `Mastered in selected deck: …` Text (`:67-69`) and its `footnote` style entry (`:109`).
   5. Empty state: compute `const nothingYet = counts.selectedDue === 0 && counts.selectedNew === 0 && counts.selectedMastered === 0 && counts.totalDueAllDecks === 0;`. When `nothingYet` is true render, in place of the grid View, a single `<Text testID="home-today-empty" style={styles.subtitle} numberOfLines={2}>Nothing to review yet — open a pack to get your first cards.</Text>`; otherwise render the grid exactly as today. (No integration test mounts Home with all-zero counts and asserts the tile labels — `home-primary-cta.test.tsx:193` seeds 1 due / 1 new — so the grid may be unmounted in this state.)
   6. `counts.normalCount / eliteCount / bossCount` are no longer read by this component; leave them in `TodayCounts` and in `buildCounts()` — the legacy Challenge `RoutePreview` still consumes `routePreview`.

2. `mobile/src/features/gacha/selectors/homeSelectors.ts` (F4 + F5) — copy-swap only; no logic, threshold or state-kind change; `buildRoutePreview()` (`:102-161`), `buildCounts()` (`:163-185`), `inferStatusKind`, `mapStatusToCta` and `drawStatusLabel` (`:698-702`) untouched:
   1. `:214` reserve badge → `` `${safeWallet.availablePulls} pull${safeWallet.availablePulls === 1 ? '' : 's'} ready · ${safeWallet.reservePulls} more waiting` ``.
   2. `:227` locked badge → `'Review today’s cards to earn a pull'`.
   3. `:207` wallet-full badge stays `` `Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})` `` (pinned by `home-primary-cta.test.tsx:310`). `:221` stays.
   4. `:458` today_partial subtitle → `'You started today. Finish the remaining cards.'`.
   5. `:488` nothing_to_learn subtitle → `'No due cards and no new cards queued right now.'`.
   6. `:500` wallet_full subtitle → `'Pulls are full. Today’s review still comes first; spend a pull afterwards.'` (must agree with the study-first CTA; do not write "open a pack" here). Keep the comment block at `:497-499`.
   7. `:509` default title branch → `` `A few new cards are ready in ${selectedDeck.title}` ``.
   8. `:514-516` default subtitle → `hasTodayWork ? `` `Review today’s cards to earn pulls · at most ${SESSION_MAIN_ROUTE_DEFAULT} cards.` `` : 'Nothing due today; review later or browse your decks.'`. After this edit no rendered `title`/`subtitle` string in `buildHeroCopy` may contain the words normal / elite / boss / pressure / route / node / reserve / fresh.
   9. `:584` deck-row progressLabel → `` `${deck.dueToday} due · ${deck.newToday} new` ``.
   10. Leave the `helper:` strings (`:459, :467, :475, :482, :501, :517-521`) exactly as they are — `hero.helper` is never rendered (HomeHero.tsx is unimported; A04 deletes it). Leave `:701`.

3. `mobile/src/features/gacha/home/HomeDeckRow.tsx:56` fallback subtitle → `` `${deck.dueToday} due · ${deck.newToday} new` ``. Nothing else in the file changes.

4. `mobile/tests/integration/home-primary-cta.test.tsx`: apply exactly the four literal edits listed under Constraints (`:264`, `:265`, `:266`, `:283`, `:302`). No other line changes.

5. `mobile/tests/integration/home-economy-floor.spec.tsx:221`: `'Clear today’s route to unlock pulls'` → `'Review today’s cards to earn a pull'`. The comment at `:208-209` may be left as is. No other line changes.

6. `mobile/tests/unit/homeSelectors.spec.ts`: append a new `describe('Home copy glossary', …)` block at the end of the file (do not edit existing cases) with these four cases, each built with the existing `makeDeck` helper and `buildHomeVM`:
   1. `'hero subline no longer names route roles'`: `makeDeck({ dueToday: 3, newToday: 1 })`, wallet `{0,0}` → `expect(vm.hero.subline).toBe('Review today’s cards to earn pulls · at most 5 cards.')` and `expect(vm.hero.subline).not.toMatch(/normal|elite|boss|pressure|route|node/i)`.
   2. `'hero subline for a clear day drops the pressure wording'`: `makeDeck({ dueToday: 0, newToday: 0 })`, wallet `{0,0}` → `expect(vm.hero.subline).toBe('Nothing due today; review later or browse your decks.')`.
   3. `'draw badge speaks in pulls, not reserve'`: wallet `{ availablePulls: 1, reservePulls: 2 }` → `expect(vm.draw.label).toBe('1 pull ready · 2 more waiting')`; wallet `{ availablePulls: 2, reservePulls: 3 }` → `'2 pulls ready · 3 more waiting'`; wallet `{0,0}` → `expect(vm.draw.label).toBe('Review today’s cards to earn a pull')`.
   4. `'deck rows say new, not fresh'`: `makeDeck({ dueToday: 3, newToday: 2 })` → `expect(vm.decks.rows[0].progressLabel).toBe('3 due · 2 new')`.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/A03.verify.sh` runs exactly these five, in this order.

- `cd mobile && npm run test:typecheck`
- `cd mobile && npx vitest run tests/integration/home-primary-cta.test.tsx tests/integration/home-economy-floor.spec.tsx tests/unit/homeSelectors.spec.ts --reporter=dot`
- Source literal guard (all must hold): `f=mobile/src/features/gacha/selectors/homeSelectors.ts; c=mobile/src/features/gacha/components/TodayPressureCard.tsx; r=mobile/src/features/gacha/home/HomeDeckRow.tsx; grep -qF "'Review today’s cards to earn a pull'" $f && grep -qF "more waiting\`" $f && grep -qF 'Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})' $f && grep -qF 'Review today’s cards to earn pulls · at most ${SESSION_MAIN_ROUTE_DEFAULT} cards.' $f && grep -qF "'Nothing due today; review later or browse your decks.'" $f && grep -qF "'You started today. Finish the remaining cards.'" $f && grep -qF "'Pulls are full. Today’s review still comes first; spend a pull afterwards.'" $f && grep -qF "'No due cards and no new cards queued right now.'" $f && grep -qF 'A few new cards are ready in ${selectedDeck.title}' $f && grep -qF 'due · ${deck.newToday} new`' $f && grep -qF 'due · ${deck.newToday} new`' $r && ! grep -qE "Clear today’s route|in reserve|boss max|No pressure day|Finish the remaining route|reserve can flow|A short fresh run|newToday} fresh" $f $r && grep -qF 'testID="home-today-count-grid"' $c && grep -qF 'testID="home-today-count-normal"' $c && grep -qF 'testID="home-today-count-elite"' $c && grep -qF 'testID="home-today-count-boss"' $c && grep -qF 'testID="home-today-count-total"' $c && grep -qF 'testID="home-today-empty"' $c && grep -qF 'Nothing to review yet — open a pack to get your first cards.' $c && grep -qF "metricWide: { flex: 1, minWidth: 0 }" $c && grep -qF "metricCompact: { width: '48%' }" $c && grep -qF 'counts.selectedDue' $c && grep -qF 'counts.selectedNew' $c && grep -qF 'counts.selectedMastered' $c && grep -qF 'counts.totalDueAllDecks' $c && grep -qwE 'Due|Learned' $c && ! grep -qwE 'Normal|Elite|Boss' $c && ! grep -qE "Today’s pressure|Mastered in selected deck| fresh|counts\.(normal|elite|boss)Count" $c`
- Test literal guard: `t=mobile/tests/integration/home-primary-cta.test.tsx; e=mobile/tests/integration/home-economy-floor.spec.tsx; u=mobile/tests/unit/homeSelectors.spec.ts; grep -qF "toContain('Due')" $t && grep -qF "toContain('New')" $t && grep -qF "toContain('Learned')" $t && grep -qF "toContain('Total')" $t && grep -qF "'Review today’s cards to earn a pull'" $t && grep -qF "'1 pull ready · 2 more waiting'" $t && grep -qF "'2 pulls ready'" $t && grep -qF "'Wallet full (30 + 5)'" $t && grep -qF "'Review today’s cards to earn a pull'" $e && grep -qF "'1 pull ready'" $e && grep -qF "/Wallet full/i" $u && grep -qF "Review today’s cards to earn pulls · at most 5 cards." $u && grep -qF "'1 pull ready · 2 more waiting'" $u && grep -qF "'3 due · 2 new'" $u && ! grep -qE "toContain\('(Normal|Elite|Boss)'\)|Clear today’s route|in reserve'" $t $e`
- Scope / frozen-file guard: `base=$(git merge-base HEAD delivery/r16-a-home 2>/dev/null || git merge-base HEAD origin/delivery/r16-a-home); test -z "$(git diff --numstat "$base" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/screens/HomeScreen.tsx mobile/src/features/gacha/contracts.ts)" && test -z "$(git diff --name-only "$base" | grep -vE '^(mobile/src/features/gacha/selectors/homeSelectors\.ts|mobile/src/features/gacha/components/TodayPressureCard\.tsx|mobile/src/features/gacha/home/HomeDeckRow\.tsx|mobile/tests/integration/home-primary-cta\.test\.tsx|mobile/tests/integration/home-economy-floor\.spec\.tsx|mobile/tests/unit/homeSelectors\.spec\.ts)$')"`

## DO NOT

- Do not push, do not open a PR, never check out or commit to `main`, do not run any deploy / EAS / OTA command.
- Do not disable, skip, delete or loosen any test or assertion; the only permitted test edits are the literal swaps in Constraints and the appended unit cases in Changes required §6.
- Do not touch `HomeScreen.tsx` (header subtitle dedupe, kicker, status-dot colour and hero title are A02/A04 work), `HomeHero.tsx`, `contracts.ts`, `rewardWallet.ts`, `drawState.ts`, `summaryMapper.ts`, `sessionBuilder.ts`, `ChallengeScreen.tsx` or the frozen files — 'reserve' / 'route' wording outside Home is deliberately left alone in this issue.
- Do not change `buildRoutePreview`, `buildCounts`, `TodayCounts`, `inferStatusKind`, CTA labels (`DRAW_CTA_LABEL`, `'Start today’s challenge'`, `'Open library'`, …), draw state kinds, wallet caps, or the `hero.helper` strings.
- Do not rename or reorder the `home-today-count-*` testIDs, do not add `testID` to new wrappers, do not change `metric` / `metricWide` / `metricCompact` or the `< 390` compact rule, do not resize fonts (A02 F8 owns that).
- Do not add a true "mastered" computation (F11 is a separate issue) — the third tile shows the existing `counts.selectedMastered` labelled `Learned`.
- Do not run `npm ci` / `npm install`; do not add dependencies.
