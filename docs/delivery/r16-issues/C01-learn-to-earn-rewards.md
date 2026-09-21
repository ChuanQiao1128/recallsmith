# C01 — E1 learn-to-earn rewards (`learn-to-earn-rewards`)

Replace the "full clear = +1 pull" economy with economy-v2 R1/R2/R4/R5/R9: every card pays **one** pull at its **first** `hard`/`good`/`easy` rating (a per-deck, per-user ledger `newCardPullPaidUids:<slug>` makes it exactly-once), clearing today's due cards pays **one** pull per local day, the wallet cap moves 30 → 60 (`FREE_PULL_CAP`), and the pay-point moves from `SessionSummaryScreen` to `SessionCardScreen.handleRating` so a paused run keeps its pulls. `computeSessionRewardPulls` is deleted; the reward travels to the summary as a `SessionSummary.reward` navigation param; `rewards.test.ts` and its five sibling suites are rewritten to the outcome API. Mobile only, pure TS, OTA on runtimeVersion 1.6.0. Signatures in this brief are copied from `docs/delivery/r16-issues/C00-contracts.md` §2.1–§2.4 and are binding.

## Context

What the tree looks like today (`delivery/r16-c-economy` == `main@52594fe`; every line number below was read on that tree):

- `mobile/src/features/gacha/constants.ts:9` `export const FREE_PULL_CAP = 30;`, `:10` `FREE_PULL_OVERFLOW_CAP = 5`. `rewardWallet.ts:51-67` `applyRewardToWallet` (fills available to the cap, then reserve, then `dropped`), `:81-83` `canAcceptMorePulls`, `:262-280` `consumePullsFromWallet` (`:270` reads the cap) and `:208-260` `adoptAnonRewardWallet` all read the constant; `homeSelectors.ts:202-207` builds `Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})` from it. Two places sidestep the constant with a literal: `mobile/src/features/gacha/draw/drawState.ts:60` `if (wallet.availablePulls >= 30 && wallet.reservePulls > 0)` and `mobile/src/screens/DebugMenuScreen.tsx:32-33`, `:149`, `:154` (seed 30/5). R4 is the constant change plus those two literal sites.
- `mobile/src/features/gacha/rewards/rewardResolver.ts:19-29` `computeSessionRewardPulls` is the old rule (`:27` `sessionLimit > 0 && sessionDone >= sessionLimit → 1`). `:31-58` `resolveSessionReward` calls it (`:43`) and builds `rewardMessage` at `:46-49` (`+N free pull(s) · …` / `Progress saved · …`). Callers: `SessionSummaryScreen.tsx:12`, `:65` (pays once via `applySessionRewardToWallet(sessionId, rewardPulls)` at `:66-69`), `SessionCardScreen.tsx:39`, `:485-489`, `:570-574`, `:578-582`, and `summaryMapper.ts:3`, `:179-184` (derives the reward a second time for display). `tests/p2-smoke.ts:5`, `:127`, `:138` call `resolveSessionReward` and are typechecked by `tsc --noEmit` (not run in CI).
- `rewardWallet.ts:322-405` `applySessionRewardToWallet` is the per-session receipt + wallet write with the ordering rationale at `:375-394` (receipt first, wallet second → under-grant on a crash). It stays exported and byte-identical (three suites pin it: `tests/unit/rewards.test.ts:130`, `tests/unit/rewardWalletOrdering.test.ts`, `tests/unit/gachaUserScope.test.ts:230-256`) and simply has no app caller after this issue.
- `mobile/src/features/gacha/rewards/economyFloor.ts` (R3, untouched) is the pattern for the R2 day marker: `:25` scoped base key, `:114-121` `formatDateKey(now)` equality test, `:140-141` marker written before the wallet, rationale `:83-104`.
- Partition rule: `mobile/src/review/storage.ts:79-81` `getUserScopedKey(baseKey)` → `devcards:u:{sub}:…` / `devcards:u:anon:…`; `mobile/src/features/gacha/draw/drawStateStore.ts:29` `export const ANON_USER_SCOPE_PREFIX = 'devcards:u:anon:'`; `:332-` `adoptAnonDrawState` is the copy-then-clear scan (`getAllKeys` at `:341`, prefix filter `:342-345`). `mobile/src/sync/drawStateSync.ts:233` `export type AnonGachaAdoption = AnonDrawStateAdoption & AnonWalletAdoption;`, `:239` `_adopting` coalescer, `:247-257` `adoptAnonGachaState` (`:250` draw, `:251` wallet, `:252` spread); callers `:276` and `mobile/src/auth/authStore.ts:124` ignore the result. `drawStateSync.ts` is not frozen (A08 precedent).
- Why a ledger and not `CardProgress`: after a first `again` a card is `stage 0, lapses ≥ 1, hardStreak 0, lastReviewedAt > 0` (`model.ts:99-102`, `:127`) — indistinguishable from "hard then again"; and `mobile/src/review/storage.ts:151-189` drops any new progress field on reload and is frozen. So "has this card ever been rated hard+" is not derivable; the ledger is the only source of truth (C00 §6 #3). On a partition's first use the ledger is **seeded** with every already-learned card (`isLearnedProgress`, `mobile/src/features/gacha/selectors/progressSelectors.ts:16-18`) as paid with value `0`, so pre-OTA learned cards never pay.
- Session flow: `mobile/src/screens/SessionCardScreen.tsx:383-384` `const now = new Date(); const dueTodayCount = countDueToday(progress, now, ownedSet);` (pre-rating due count); `:396-512` `handleRating`: `buildRatedSessionState` `:405-415` (returns `remainingDueCount`, `sessionReviewHelpers.ts:90`), event `:421-434`, `await saveDeckProgress(deck, nextState.updatedProgress)` `:446`, trial upsell `:447-460`, `recordSessionRating` `:461`, `advanceSession` `:462`, Settlement navigation `:481-495` (`rewardPulls: computeSessionRewardPulls(…)` `:485-489`), SessionSummary navigation `:498-507`. Pause = `navigation.goBack()` `:561-566` (no summary). Route-complete Continue `:671-691`: Settlement `:675-681` (`rewardPulls: doneRewardPulls` `:679`), SessionSummary `:682-690` (no `sessionId`). Stake pill: `doneMinimumGoal` `:568-569` (stays), `doneRewardPulls` `:570-574`, `fullClearReward` `:578-582`, `showFullClearStake` `:588-592`, comment `:624-628` + JSX `:629-642` (testID `session-card-fullclear-stake`, pinned by no test), styles `fullClearStakePill` `:846-856` + `fullClearStakeText` `:857-862`. The session store is reset on unmount (`:136-140`), so the summary can never read it — the outcome goes through the navigation param.
- `mobile/src/features/gacha/session/sessionStore.ts:10-28` state type, `:30-39` `emptyState`, `:43-53` `startSession` (resets counters), `:64` `resetSession`.
- `mobile/src/navigation/types.ts:137-143` `Settlement` (`rewardPulls?: number` `:141`, unchanged), `:186-195` `SessionSummary` params.
- `mobile/src/screens/SessionSummaryScreen.tsx:12-13` imports, `:47` params, `:49` `walletBeforeReward` state, `:57-99` settlement effect (`:64-79` with `sessionId`, `:81-87` without), `:101-123` `buildSessionSummaryVM` memo, `:125-133` `drawVm`, `:163` `earnedPulls`, `:218-240` gold CTA (testID `summary-reward-use-pulls-cta`, label `Use ${n} new pull${…} now`).
- `mobile/src/features/gacha/session/summaryMapper.ts:6-51` `COPY` (`:8` `title.fullClear`, `:12` `completion.fullClear`, `:17` `sectionFullClear: 'Full clear reward'`, `:20` `badge`, `:21` `gained`, `:22` `noPull: 'No free pulls this run'`, `:28` `progress.fullClearLabel`), `:96-108` `resolveWalletLine`, `:153-166` `buildSessionSummaryVM` signature, `:179-184` the `resolveSessionReward` call, `:204` `rewardLine`, `:206-211` `legacyRewardBody`, `:251-258` wallet before/after. `RewardSummaryCard.tsx:8-23` props are not edited.
- Tests that pin the old rule or the 30 cap are enumerated in C00 §3.1 and in Constraints below; the mock harnesses to copy are `tests/unit/drawStateAdoption.test.ts:1-16` (Map-backed AsyncStorage with `getAllKeys`/`removeItem`), `:23-27` (real `review/storage`, `setActiveUserSubForStorage` to switch partitions) and `tests/unit/rewardWalletOrdering.test.ts:3-27` (`setItemCalls` write-order log).

What C00 decided (binding): pay per rating inside `handleRating` (§2.3, §6 #2); ledger `Record<uid, paidAtMs>` with `0` = seeded/pre-OTA (§2.2, §6 #3); no cross-device dedupe in Wave C, each device seeds from synced progress (§6 #4); R2 triggers on the session deck's `dueBefore > 0 → remainingDueCount === 0` transition with one global per-user day marker (§6 #5); `applySessionRewardToWallet` untouched (§2.1); the route-complete Continue path and `p2-smoke.ts` keep compiling with `reward` absent (§2.3, §6 #19); full-run titles and `'No free pulls this run'` survive (§6 #20); `ChallengeScreen.tsx:31`, `libraryMapper.ts:216`, `DrawScreen.tsx:843`, `DrawResultScreen.tsx:222` are left alone (§6 #20).

Three C00 gaps this brief resolves (the driver knows; do not re-ask):

1. **`AnonLedgerAdoption` field name.** C00 §2.2 writes `{ decks: number; uidsAdded: number }`, but `AnonDrawStateAdoption` (`drawStateStore.ts:316`) already has `decks` and the spread at `drawStateSync.ts:252` would clobber it (`tests/unit/drawStateAdoption.test.ts:76` asserts `result.decks === 1`). The field is **`ledgerDecks`** (signature below). Consequence: `drawStateAdoption.test.ts:54` `ZERO` gains `ledgerDecks: 0, uidsAdded: 0` (the `toEqual(ZERO)` at `:125` and `:149` would otherwise fail) — one extra line beyond C00 §3.1's "literal moves only" for that file.
2. **`drawState.ts:84-85` copy.** C00 §1.1 lists it as edited but pins no string. The locked helper is VM-only (nothing renders `helper`; `tests/unit/draw.test.ts:30` pins `/clear today/i` for the has-work case). The two strings are pinned in change 9.
3. **Route-complete Continue → SessionSummary and `reward`.** C00 §2.3 says "Both SessionSummary navigations (`:498-507`, `:682-690`) pass `reward: outcome`", but the same section's `resolveSessionReward` comment names `:682-690` as the "`reward` absent" path, §3.1 says `session-card.screen.test.tsx` changes "Nothing else" beyond the `:270-279` literal and the `:317` retitle, and `tests/integration/session-card.screen.test.tsx:410-423` pins the Continue-path object exactly ("a run that ended with nothing to review never started a rating"). Resolution: the Continue-path SessionSummary navigation (`:682-690`) passes **no** `reward` key (change 8e); only the post-rating navigation (`:498-507`) passes `reward: outcome`. Semantically identical (`reward` absent → `EMPTY_REWARD_OUTCOME`), and the pinned literal stays byte-identical.

## Read first

1. `docs/delivery/r16-issues/C00-contracts.md` §0 (non-negotiables), §1.1 (the C01 column), §2.1–§2.4 (signatures — verbatim), §3.1 "C01" and §3.2 (the three new test files), §3.3, §5 (verify conventions), §6 #2, #3, #4, #5, #19, #20, #21.
2. `docs/economy-v2-learn-to-earn-2026-09-19.md:24-35` (R1–R10), `:39-45` (invariant 4'), `:54-60` (copy checklist).
3. `mobile/src/features/gacha/rewards/rewardWallet.ts:1-83`, `:199-260`, `:322-405` (read all three — you append one function and change nothing else).
4. `mobile/src/features/gacha/rewards/economyFloor.ts:83-149` (the marker pattern you copy).
5. `mobile/src/features/gacha/rewards/rewardResolver.ts:1-58` (whole file — you rewrite it).
6. `mobile/src/screens/SessionCardScreen.tsx:1-60` (imports), `:100-140` (state + store hooks), `:383-395`, `:396-512` (`handleRating`), `:561-596`, `:624-642`, `:671-691`, `:844-862`.
7. `mobile/src/screens/SessionSummaryScreen.tsx:1-135`, `:156-176`, `:209-252`.
8. `mobile/src/features/gacha/session/summaryMapper.ts` (whole, 294 lines) and `sessionStore.ts` (whole, 69 lines).
9. `mobile/src/navigation/types.ts:1-6`, `:137-143`, `:186-195`; `mobile/src/features/gacha/draw/drawState.ts:1-13`, `:40-89`; `mobile/src/sync/drawStateSync.ts:1-20`, `:225-257`; `mobile/src/screens/DebugMenuScreen.tsx:28-39`, `:146-155`; `mobile/src/features/gacha/draw/drawStateStore.ts:27-29`, `:316-345`.
10. `mobile/src/review/storage.ts:60-81`, `mobile/src/review/model.ts:221-226`, `mobile/src/features/gacha/selectors/progressSelectors.ts:16-18`, `mobile/src/features/gacha/planner/sessionPlanner.ts:50-53`, `mobile/src/features/gacha/session/sessionReviewHelpers.ts:47-100`.
11. Every test file in the Constraints "may change" list, whole; `tests/unit/drawStateAdoption.test.ts:1-60` and `tests/unit/rewardWalletOrdering.test.ts:1-60` as harness models; one fast-check suite for style (`tests/unit/skipPolicy.test.ts`).
12. `docs/delivery/r16-issues/C01.verify.sh` (the driver runs it; every grep in it is a literal you must produce).

## Constraints

- **Scope (the ONLY files that may change):**
  Source — `mobile/src/features/gacha/constants.ts`, `mobile/src/features/gacha/rewards/rewardResolver.ts`, `mobile/src/features/gacha/rewards/rewardWallet.ts`, `mobile/src/features/gacha/rewards/newCardLedger.ts` (new), `mobile/src/features/gacha/rewards/sessionRewards.ts` (new), `mobile/src/features/gacha/session/sessionStore.ts`, `mobile/src/features/gacha/session/summaryMapper.ts`, `mobile/src/features/gacha/draw/drawState.ts`, `mobile/src/sync/drawStateSync.ts`, `mobile/src/screens/DebugMenuScreen.tsx`, `mobile/src/navigation/types.ts`, `mobile/src/screens/SessionSummaryScreen.tsx`, `mobile/src/screens/SessionCardScreen.tsx`.
  Tests (new) — `mobile/tests/unit/newCardLedger.test.ts`, `mobile/tests/unit/sessionRewards.test.ts`, `mobile/tests/unit/rewardOutcome.test.ts`.
  Tests (edit) — `mobile/tests/unit/rewards.test.ts`, `mobile/tests/unit/summaryMapper.spec.ts`, `mobile/tests/unit/summary-home.test.ts`, `mobile/tests/integration/session-summary.screen.test.tsx`, `mobile/tests/integration/session-card.screen.test.tsx`, `mobile/tests/unit/session-store.test.ts` (add-only), `mobile/tests/unit/draw.test.ts`, `mobile/tests/unit/drawStateAdoption.test.ts`, `mobile/tests/unit/homeSelectors.spec.ts`, `mobile/tests/integration/home-primary-cta.test.tsx`, `mobile/tests/unit/ceremonyTuning.test.tsx`, `mobile/tests/p2-smoke.ts`.
  Nothing else. In particular NOT `economyFloor.ts` (R3 unchanged), NOT `homeSelectors.ts` / `HomeScreen.tsx` / `faq.ts` (C03), NOT `sessionBuilder.ts` / `sessionPlanner.ts` (C02/C04), NOT `RewardSummaryCard.tsx`, NOT `mobile/src/review/storage.ts`, NOT `drawStateStore.ts`, NOT `featureFlags.ts` / `remoteConfig.ts`, NOT `mobile/tests/setup/*`, NOT `mobile/vitest.config.ts`.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. This issue claims no exception.
- **OTA-only — no dependency or manifest change:** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` are byte-identical (`"expo-updates": "~29.0.15"`, `"version": "1.6.0"`, `"vite": "7.2.4"` stay). No `npm install`, no new native module, no `@sentry/*`, no `src/observability/`. `fast-check` (`mobile/package.json:66`) is already a devDependency — use it.
- **Economy rules are R1–R10 of economy-v2 §2 and invariant 4' only.** Do not add a threshold, a rule or a copy line that states a rule not in that table. Pulls are never sold; `SESSION_MAIN_ROUTE_DEFAULT = 5` (`constants.ts:7`) and `MASTERY_STAGE_THRESHOLD = 4` (`:11`) are untouched. `FREE_PULL_OVERFLOW_CAP = 5` (`:10`) is untouched.
- **Byte-identical existing tests:** `tests/unit/rewardWalletOrdering.test.ts`, `tests/unit/gachaUserScope.test.ts`, `tests/unit/economyFloor.test.ts`, `tests/integration/economy-floor.spec.tsx`, `tests/integration/home-economy-floor.spec.tsx`, `tests/unit/planner.test.ts`, `tests/unit/ownedGatePredicates.test.ts`, `tests/integration/home.screen.test.tsx`, and every file not in the scope list. Inside the "may change" files the byte-identical hunks are named per file in change 13.
- **Existing identifiers that stay exported and unchanged:** `applySessionRewardToWallet`, `applyRewardToWallet`, `getRewardWalletMessage`, `canAcceptMorePulls`, `loadRewardWalletState`, `saveRewardWalletState`, `seedStarterPullsIfNeeded`, `adoptAnonRewardWallet`, `consumePullsFromWallet`, `consumePullsFromStoredWallet`, `refundPullsToStoredWallet`, `STARTER_PULL_GRANT`, `RewardWalletState`, `AppliedRewardWalletState`, `AnonWalletAdoption` (`rewardWallet.ts` is append-only: `git diff --numstat` shows 0 deletions); `ResolvedSessionReward` (shape extended per §2.3); `COPY.reward.badge`, `COPY.reward.noPull`, `COPY.progress.fullClearLabel`, `COPY.title.*`, `COPY.completion.*` in `summaryMapper.ts`; every testID in both screens.
- **Banned in any added line** (driver gate, case-insensitive): the six terms of B00 §0 / C00 §0 — this brief does not spell them; say "work around", "sidestep", "sensor", "guard", "fallback", "probe". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` in any **added** line (the pre-existing `// eslint-disable-next-line react-hooks/exhaustive-deps` at `SessionCardScreen.tsx:380` is not yours; do not touch that hunk).
- **No circular import:** `rewardResolver.ts` must not import `summaryMapper.ts` (the mapper imports the resolver). The `'No free pulls this run'` literal is duplicated as a module constant in `rewardResolver.ts`; `COPY.reward.noPull` (`summaryMapper.ts:22`) stays as it is.
- **`JSX.Element`** is never written in a signature (B00 §9 #19); use `React.JSX.Element` or omit.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS / `expo prebuild`, no test gutting.

## Changes required

1. **`mobile/src/features/gacha/constants.ts`** — `:9` becomes exactly `export const FREE_PULL_CAP = 60;`. Nothing else in the file changes.

2. **`mobile/src/features/gacha/rewards/rewardWallet.ts`** — append (after `applySessionRewardToWallet`, `:405`; nothing existing moves):
   ```ts
   /** Read → applyRewardToWallet → save. The single wallet write R1/R2 make; the ledger/marker
    *  write always precedes it (under-grant on a crash, same rationale as :375-394). */
   export async function grantPullsToStoredWallet(count: number): Promise<{
     walletBefore: RewardWalletState;
     walletAfter: RewardWalletState;
     applied: AppliedRewardWalletState;
   }>;
   ```
   Body: `const walletBefore = await loadRewardWalletState(); const applied = applyRewardToWallet(walletBefore, count); const walletAfter = { availablePulls: applied.availablePulls, reservePulls: applied.reservePulls }; await saveRewardWalletState(walletAfter); return { walletBefore, walletAfter, applied };`. It **throws** on a storage failure (the caller decides; see change 4). No dedupe key — the ledger/marker is the dedupe.

3. **`mobile/src/features/gacha/rewards/newCardLedger.ts` (new, R5)** — exports, verbatim from C00 §2.2 except `AnonLedgerAdoption` (gap 1):
   ```ts
   import type { CardProgress } from '../../../review/model';

   /** Base key; resolved key is getUserScopedKey(`${NEW_CARD_LEDGER_PREFIX}${slug}`) →
    *  `devcards:u:{sub}:recallsmith:newCardPullPaidUids:<slug>`. The doc's literal
    *  `newCardPullPaidUids:<slug>` appears verbatim; the `recallsmith:` family prefix is the one every
    *  economy key carries (rewardWallet.ts:19-24, economyFloor.ts:25). */
   export const NEW_CARD_LEDGER_PREFIX = 'recallsmith:newCardPullPaidUids:';

   /** stableUid → paidAtMs. 0 = backfilled: the card was already learned when the ledger was first
    *  created on this partition, so it never pays (pre-OTA policy, C00 §6 #3). */
   export type NewCardLedger = Record<string, number>;

   /** { ledger, present }. present=false when the key is absent. Throws on a storage error (callers
    *  fail closed). A corrupt value reads as { ledger: {}, present: true } (never re-seeded). */
   export async function readNewCardLedger(slug: string): Promise<{ ledger: NewCardLedger; present: boolean }>;

   /** present → returned unchanged. absent → written as { [uid]: 0 } for every entry of `progress`
    *  where isLearnedProgress (progressSelectors.ts:16-18), then returned. Throws on storage error. */
   export async function seedNewCardLedgerIfAbsent(slug: string, progress: CardProgress[]): Promise<NewCardLedger>;

   /** paid=false when the uid is already present (any value, including 0) or storage fails; otherwise
    *  writes ledger[uid] = nowMs FIRST and returns paid=true. Never throws. Does not seed. */
   export async function payNewCardIfUnpaid(slug: string, stableUid: string, nowMs: number): Promise<{ paid: boolean; ledger: NewCardLedger }>;

   /** Entries with paidAtMs > 0 whose local day (formatDateKey, model.ts:221-226) equals that of `now`. */
   export function countPaidOnDay(ledger: NewCardLedger, now: Date): number;

   /** R2 day marker (economyFloor pattern, :114-121): getUserScopedKey(DUE_CLEAR_MARKER_KEY) holds
    *  formatDateKey(now). Returns true and writes the marker only when it differs from today. Never throws
    *  (storage error → false). */
   export const DUE_CLEAR_MARKER_KEY = 'recallsmith:due-clear:v1';
   export async function markDueClearedIfFirstToday(now: Date): Promise<boolean>;

   /** A08 mechanism (drawStateStore.ts:332, rewardWallet.ts:208): scans getAllKeys for
    *  `${ANON_USER_SCOPE_PREFIX}${NEW_CARD_LEDGER_PREFIX}`, unions each slug's anon ledger into the user
    *  ledger (user value wins on a uid present in both), writes the user ledger, then removes the anon key
    *  (copy-then-clear). No-op while signed out. Never throws. The R2 marker is NOT adopted (C00 §6 #4). */
   export type AnonLedgerAdoption = { ledgerDecks: number; uidsAdded: number };
   export async function adoptAnonNewCardLedger(): Promise<AnonLedgerAdoption>;
   ```
   Details: imports are `AsyncStorage`, `getUserScopedKey` from `'../../../review/storage'`, `ANON_USER_SCOPE_PREFIX` from `'../draw/drawStateStore'`, `formatDateKey` from `'../../../review/model'`, `isLearnedProgress` from `'../selectors/progressSelectors'`. Parsing: a stored value that is not a JSON object of finite non-negative numbers reads as `{}` with `present: true` (drop non-numeric entries; never throw on garbage). `seedNewCardLedgerIfAbsent` writes even when the seed is `{}` (an empty deck of learned cards still marks the partition seeded). `payNewCardIfUnpaid` reads, returns `paid: false` if `stableUid in ledger`, else writes `{ ...ledger, [stableUid]: nowMs }` and returns `paid: true` with the written ledger; any thrown storage error → `{ paid: false, ledger }` (with whatever was read, or `{}`). "Signed out" = `(await getUserScopedKey('')).startsWith(ANON_USER_SCOPE_PREFIX)` (same test as `rewardWallet.ts:213`). `ledgerDecks` counts anon slugs processed; `uidsAdded` counts uids that were absent from the user ledger.

4. **`mobile/src/features/gacha/rewards/sessionRewards.ts` (new, R1/R2/R8/R9)** — verbatim from C00 §2.3:
   ```ts
   import type { ReviewRating, CardProgress } from '../../../review/model';
   import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';

   export type RatingRewardInput = {
     slug: string;
     stableUid: string;
     rating: ReviewRating;
     /** The deck progress BEFORE this rating (seeds the ledger on first use, C00 §2.2). */
     progressBefore: CardProgress[];
     /** false in sweep mode (R8): R1 is skipped, R2 is still evaluated. C01's caller passes true; C04 passes mode !== 'sweep'. */
     newCardEligible: boolean;
     /** countDueToday over progressBefore. */
     dueBefore: number;
     /** remainingDueCount after the rating. */
     remainingDueCount: number;
     now: Date;
   };

   export type RatingRewardStep = {
     newCardPaid: boolean;        // R1 fired for this uid
     dueClearPaid: boolean;       // R2 fired (dueBefore > 0 && remainingDueCount === 0 && first time today)
     pulls: number;               // Number(newCardPaid) + Number(dueClearPaid), 0..2
     walletBefore: RewardWalletState | null;   // null when pulls === 0
     walletAfter: RewardWalletState | null;
     applied: AppliedRewardWalletState | null;
     /** countPaidOnDay(ledger, now) for this slug AFTER the step (feeds R7 / C02). */
     newCardsLearnedToday: number;
   };

   /** Order: (1) seedNewCardLedgerIfAbsent(slug, progressBefore); (2) R1: newCardEligible && rating !== 'again'
    *  → payNewCardIfUnpaid; (3) R2: dueBefore > 0 && remainingDueCount === 0 → markDueClearedIfFirstToday;
    *  (4) pulls > 0 → grantPullsToStoredWallet(pulls). Ledger and marker land before the wallet. Never throws:
    *  a storage failure at (1) returns the zero step (no pay); at (4) the ledger/marker are already written and
    *  the step reports pulls with walletAfter === null (under-grant, never double-grant). */
   export async function settleRatingReward(input: RatingRewardInput): Promise<RatingRewardStep>;
   export const ZERO_REWARD_STEP: RatingRewardStep;
   ```
   `ZERO_REWARD_STEP = { newCardPaid: false, dueClearPaid: false, pulls: 0, walletBefore: null, walletAfter: null, applied: null, newCardsLearnedToday: 0 }` (frozen object is fine). Step (2) uses `payNewCardIfUnpaid(slug, stableUid, now.getTime())` and the ledger it returns for `newCardsLearnedToday = countPaidOnDay(ledger, now)` (when R1 is skipped, count the ledger from step 1). Step (4): on a thrown `grantPullsToStoredWallet`, return `{ newCardPaid, dueClearPaid, pulls, walletBefore: null, walletAfter: null, applied: null, newCardsLearnedToday }`. R9 falls out: `rating` decides only *when* (`again` defers), never *whether*.

5. **`mobile/src/features/gacha/rewards/rewardResolver.ts` (rewrite)** — `computeSessionRewardPulls` is **deleted** (the identifier must not appear anywhere under `mobile/src` or `mobile/tests` afterwards). Exports, verbatim from C00 §2.3:
   ```ts
   import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
   import type { RatingRewardStep } from './sessionRewards';

   export type RewardOutcome = {
     newCardPulls: number;          // count of steps with newCardPaid
     newCardUids: string[];         // in pay order; length === newCardPulls
     dueClearPulls: 0 | 1;
     rewardPulls: number;           // newCardPulls + dueClearPulls
     applied: number;               // Σ appliedToAvailable + appliedToReserve
     dropped: number;               // Σ dropped (cap 60+5)
     walletBefore: RewardWalletState | null;   // first paying step's walletBefore
     walletAfter: RewardWalletState | null;    // last paying step's walletAfter
   };
   export const EMPTY_REWARD_OUTCOME: RewardOutcome;
   export function accumulateRewardOutcome(prev: RewardOutcome, step: RatingRewardStep, stableUid: string): RewardOutcome;

   /** Copy (economy-v2 §5):
    *  newCardPulls>0, dueClearPulls=0 → `+${n} pull${n===1?'':'s'} · ${n} new card${n===1?'':'s'} learned`
    *  newCardPulls=0, dueClearPulls=1 → `+1 · cleared today's due`
    *  both                            → `+${n+1} pulls · ${n} new card${n===1?'':'s'} learned · cleared today's due`
    *  none                            → 'No free pulls this run' (same literal as COPY.reward.noPull, summaryMapper.ts:22, unchanged) */
   export function rewardLine(outcome: RewardOutcome): string;
   /** `+${rewardPulls} pull${…}` or 'Progress saved' — same shape as COPY.reward.badge (summaryMapper.ts:20). */
   export function rewardBadge(outcome: RewardOutcome): string;

   export type ResolvedSessionReward = {
     rewardPulls: number;
     completedMinimumGoal: boolean;   // sessionDone >= max(1, minimumGoal)  (unchanged, :41)
     completedFullRun: boolean;       // sessionLimit > 0 && sessionDone >= sessionLimit (unchanged, :42) — titles only, never pulls
     walletAfter: AppliedRewardWalletState;
     rewardMessage: string;           // `${rewardLine(outcome)} · ${getRewardWalletMessage(walletAfter)}`
     outcome: RewardOutcome;
   };
   /** `reward` absent/null → EMPTY_REWARD_OUTCOME (the route-complete Continue path, SessionCardScreen.tsx:682-690,
    *  and tests/p2-smoke.ts:127-147, which must keep compiling). walletAfter = applyRewardToWallet(wallet, 0) merged with
    *  outcome.walletAfter when present. */
   export function resolveSessionReward(params: {
     sessionDone: number; sessionLimit: number; minimumGoal: number;
     wallet: RewardWalletState;
     reward?: RewardOutcome | null;
   }): ResolvedSessionReward;
   ```
   Pinned semantics:
   - `EMPTY_REWARD_OUTCOME = { newCardPulls: 0, newCardUids: [], dueClearPulls: 0, rewardPulls: 0, applied: 0, dropped: 0, walletBefore: null, walletAfter: null }`.
   - `accumulateRewardOutcome`: `newCardPulls += step.newCardPaid ? 1 : 0`; `newCardUids = step.newCardPaid ? [...prev.newCardUids, stableUid] : prev.newCardUids`; `dueClearPulls = prev.dueClearPulls === 1 || step.dueClearPaid ? 1 : 0`; `rewardPulls = newCardPulls + dueClearPulls`; `applied += step.applied ? step.applied.appliedToAvailable + step.applied.appliedToReserve : 0`; `dropped += step.applied?.dropped ?? 0`; `walletBefore = prev.walletBefore ?? step.walletBefore`; `walletAfter = step.walletAfter ?? prev.walletAfter`. Pure; returns a new object.
   - `rewardBadge`: `rewardPulls > 0 ? `+${n} pull${n === 1 ? '' : 's'}` : 'Progress saved'`. The apostrophe in `today's` is the ASCII one (`'`), exactly as written above.
   - `resolveSessionReward`: `const outcome = params.reward ?? EMPTY_REWARD_OUTCOME;` `completedMinimumGoal`/`completedFullRun` computed exactly as today (`:38-42`); `rewardPulls = outcome.rewardPulls`; `const base = applyRewardToWallet(wallet, 0);` and, when `outcome.walletAfter` is non-null, `walletAfter = { availablePulls: outcome.walletAfter.availablePulls, reservePulls: outcome.walletAfter.reservePulls, appliedToReserve, appliedToAvailable, dropped: outcome.dropped }` with `appliedToReserve = Math.max(0, outcome.walletAfter.reservePulls - (outcome.walletBefore ?? wallet).reservePulls)` and `appliedToAvailable = Math.max(0, outcome.applied - appliedToReserve)`; otherwise `walletAfter = base`. `rewardMessage` per the type comment. Return `{ rewardPulls, completedMinimumGoal, completedFullRun, walletAfter, rewardMessage, outcome }`.

6. **`mobile/src/features/gacha/session/sessionStore.ts`** — per C00 §2.4: add to the state type
   ```ts
   rewardOutcome: RewardOutcome;                                   // EMPTY_REWARD_OUTCOME in emptyState; reset by startSession and resetSession
   recordRewardStep: (step: RatingRewardStep, stableUid: string) => void;   // rewardOutcome = accumulateRewardOutcome(prev, step, stableUid)
   ```
   `emptyState` (`:30-39`) gains `rewardOutcome: EMPTY_REWARD_OUTCOME`; `startSession` (`:43-53`) also sets `rewardOutcome: EMPTY_REWARD_OUTCOME`; `resetSession` already spreads `emptyState`. Imports: `accumulateRewardOutcome, EMPTY_REWARD_OUTCOME, type RewardOutcome` from `'../rewards/rewardResolver'`, `type RatingRewardStep` from `'../rewards/sessionRewards'`. Nothing else changes (`SessionRatingRecord`, `recordRating`, `advanceSession`, `resetSessionStore` byte-identical).

7. **`mobile/src/navigation/types.ts`** — `SessionSummary` (`:186-195`) gains ONE optional field, appended last: `reward?: RewardOutcome;`. Add `import type { RewardOutcome } from '../features/gacha/rewards/rewardResolver';` next to the existing type import (`:4`). `Settlement` (`:137-143`), `StudyMode` (`:2`) and everything else unchanged.

8. **`mobile/src/screens/SessionCardScreen.tsx`**
   a. Imports: delete `:39` (`computeSessionRewardPulls`). Add `import { settleRatingReward } from '../features/gacha/rewards/sessionRewards';`. Add `const recordRewardStep = useSessionStore((state) => state.recordRewardStep);` next to the other store hooks (`:130-135`).
   b. Pay hook in `handleRating`, inserted immediately after `await saveDeckProgress(deck, nextState.updatedProgress);` (`:446`) and before the trial block (`:447`):
      ```ts
      const rewardStep = await settleRatingReward({
        slug: deck.Slug,
        stableUid: current.card.StableUid,
        rating,
        progressBefore: progress,
        newCardEligible: true,
        dueBefore: dueTodayCount,
        remainingDueCount: nextState.remainingDueCount,
        now: nowAtRating,
      });
      recordRewardStep(rewardStep, current.card.StableUid);
      const outcome = useSessionStore.getState().rewardOutcome;
      ```
      `progress` is the pre-rating state array and `dueTodayCount` (`:384`) is `countDueToday(progress, now, ownedSet)` over it — both are what C00 §2.3 names. `settleRatingReward` never throws, so no try/catch.
   c. Settlement navigation `:481-495`: `rewardPulls: outcome.rewardPulls` replaces the `computeSessionRewardPulls({...})` call (`:485-489`). SessionSummary navigation `:498-507`: add `reward: outcome,` as the last property.
   d. Delete `doneRewardPulls` (`:570-574`), `fullClearReward` (`:578-582`), `showFullClearStake` (`:588-592`) and the stake pill comment + JSX (`:624-642`, testID `session-card-fullclear-stake`); delete the two now-unused style entries `fullClearStakePill` / `fullClearStakeText` (`:844-862`, including their comment). `doneMinimumGoal` (`:568-569`) stays (still used at `:687`).
   e. Route-complete Continue (`:671-691`): the Settlement branch passes `rewardPulls: useSessionStore.getState().rewardOutcome.rewardPulls` (was `doneRewardPulls`); the SessionSummary branch (`:682-690`) is **unchanged** — no `reward` key (this is the "reward absent" path of `resolveSessionReward`; `tests/integration/session-card.screen.test.tsx:415-423` pins the exact object without it).
   f. Nothing else: `isLearned`, the trial logic, `requestPause`, `recordSessionRating`/`advanceSession` order, `syncDailyReminders`, every testID and the `:380` hunk are untouched.

9. **`mobile/src/features/gacha/draw/drawState.ts`** — add `import { FREE_PULL_CAP } from '../constants';`; `:60` becomes `if (wallet.availablePulls >= FREE_PULL_CAP && wallet.reservePulls > 0) {`. Locked helper copy (`:84-85`, VM-only; `tests/unit/draw.test.ts:30` pins `/clear today/i` on the has-work string):
   ```ts
   ? 'Learn a new card or clear today’s due cards, then come back for new pulls.'
   : 'No reward pulls are waiting yet. Learn a new card to earn one.'
   ```
   (curly apostrophe `’` as in the current line). Nothing else in the file changes.

10. **`mobile/src/sync/drawStateSync.ts`** — import `adoptAnonNewCardLedger, type AnonLedgerAdoption` from `'../features/gacha/rewards/newCardLedger'`; `:233` becomes `export type AnonGachaAdoption = AnonDrawStateAdoption & AnonWalletAdoption & AnonLedgerAdoption;`; in `adoptAnonGachaState` (`:249-253`) add a third awaited step after `adoptAnonRewardWallet()` (`:251`): `const ledger = await adoptAnonNewCardLedger();` and return `{ ...draw, ...wallet, ...ledger }`. `_adopting` (`:239`), both callers (`:276`, `authStore.ts:124`) and everything else unchanged.

11. **`mobile/src/screens/DebugMenuScreen.tsx`** — `:32` `saveRewardWalletState({ availablePulls: 60, reservePulls: 5 })`; `:33` `'Wallet seeded 60/5.'`; `:149` `accessibilityLabel="Seed wallet 60/5"`; `:154` `Seed wallet 60/5`. No `30/5` remains in the file. Nothing else.

12. **`mobile/src/screens/SessionSummaryScreen.tsx`** — per C00 §2.4:
    a. Imports: delete `:12` (`computeSessionRewardPulls`); `:13` becomes `import { loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';` (no `applySessionRewardToWallet`).
    b. `:47` destructure gains `reward`.
    c. Effect (`:57-99`): with `sessionId`, `const [loadedWallet, streakResult] = await Promise.all([loadRewardWalletState(), applySessionStreak({ sessionId, earned: streakEarned })]);` then `setWalletBeforeReward(loadedWallet)` and the streak/milestone sets as today. Without `sessionId`: unchanged (`:81-87`). The summary never writes the wallet.
    d. `const walletForSummary = reward?.walletBefore ?? walletBeforeReward;` (render scope). `buildSessionSummaryVM` (`:103-112`) receives `wallet: walletForSummary` and `reward: reward ?? null`; the memo deps gain `reward`.
    e. `earnedPulls` (`:163`) stays `summary.resolvedReward.rewardPulls`; the gold CTA (`:218-240`), `drawVm` (`:125-133`), `RewardSummaryCard` usage, every testID and every string are unchanged.

13. **`mobile/src/features/gacha/session/summaryMapper.ts`** — per C00 §2.4:
    a. Imports: `import { rewardLine as buildRewardLine, resolveSessionReward } from '../rewards/rewardResolver';` and `import type { ResolvedSessionReward, RewardOutcome } from '../rewards/rewardResolver';` (the local `const rewardLine` at `:204` would shadow the function — alias the import).
    b. `COPY.reward.sectionFullClear` (`:17`) becomes `'Run reward'`. `COPY.reward.gained` (`:21`) is deleted. `badge` (`:20`), `noPull` (`:22`), `sectionProgress`, `sectionNoReward`, the wallet lines, `progress.*`, `nextAction.*`, `title.*`, `completion.*` unchanged.
    c. `buildSessionSummaryVM(params)` gains `reward?: RewardOutcome | null;` (after `transitions`) and forwards `reward: reward ?? null` to `resolveSessionReward` (`:179-184`). `const outcome = resolvedReward.outcome;`.
    d. `:204` becomes `const rewardLine = buildRewardLine(outcome);` (it already yields `COPY.reward.noPull`'s literal for the empty outcome). `legacyRewardBody` (`:206-211`): `wallet == null ? (resolvedReward.rewardPulls > 0 ? rewardLine : 'Progress saved for this run.') : resolvedReward.rewardMessage`. `vm.reward.badge` / `rewardBadge` keep `COPY.reward.badge(resolvedReward.rewardPulls)`. `vm.reward.walletBefore` (`:251-254`) reads `outcome.walletBefore ?? wallet` (fall back to `{0,0}` when both are null); `vm.reward.walletAfter` (`:255-258`) reads `resolvedReward.walletAfter` (as today).
    e. Everything else byte-identical: `resolveWalletLine`, `resolvePrimaryAction`, `resolveNextActionCopy`, `SessionSummaryVM`, titles, completion labels, `usePullsLabel`, `nextActionLabel`.

14. **Existing tests** (C00 §3.1; each file changes only as listed):
    - `tests/unit/rewards.test.ts`: delete cases 4–6 (`:66-80`, the `computeSessionRewardPulls` trio `it('computes no pulls when the session is empty'`, `it('computes no pulls for a partial run (below full clear)'`, `it('computes one pull for a full clear'` and their comment — none of the three titles may survive) and drop `computeSessionRewardPulls` from the import at `:27`; cap literals 30 → 60 in case 1 (`it('fills available pulls first, then reserve, then drops overflow'`, `:35-43`: `{59,4}+3 → {60,5}, appliedToAvailable 1, appliedToReserve 1, dropped 1`), case 2 (`it('drops rewards when both available and reserve are already full'`, `:46-52`: `{60,5}+2 → dropped 2`) and case 7 (`it('reports whether the wallet can still accept more pulls'`, `:82-86`: `{60,4}` true / `{60,5}` false); case 3 (`it('builds a neutral progress summary when no pull reward is earned'`, `:54-64`, title kept) becomes `resolveSessionReward({ sessionDone: 0, sessionLimit: 4, minimumGoal: 1, wallet: { availablePulls: 3, reservePulls: 0 }, reward: null })` asserting `rewardPulls === 0` and `rewardMessage` matches `/no free pulls this run/i`. The `starter pull seeding` describe (`:92-128`, first case `it('grants 3 starter pulls to a brand-new (empty) wallet on first boot'`) and `it('persists and deduplicates a session reward application'` (`:130-143`) are byte-identical.
    - `tests/unit/summaryMapper.spec.ts`: the four wallet scenarios (`:11-72`) pass `reward` outcomes — (1) `reward: null`, wallet `{0,0}` → body contains `No free pulls this run` and `0 ready to use` (title kept); (2) `reward: null`, wallet `{12,0}` → `12`, `No free pulls this run`, `Use 12 pulls` (title kept); (3) retitled **`maps 59 → 60 with one new card learned`**, wallet `{59,0}`, `reward: { newCardPulls: 1, newCardUids: ['u1'], dueClearPulls: 0, rewardPulls: 1, applied: 1, dropped: 0, walletBefore: { availablePulls: 59, reservePulls: 0 }, walletAfter: { availablePulls: 60, reservePulls: 0 } }` → `walletAfter {60,0}`, body contains `+1 pull · 1 new card learned` and `60 ready to use`, `completionLabel` still `"Cleared today's run."`; (4) wallet `{60,5}`, same outcome shape with `applied: 0, dropped: 1, walletBefore/After {60,5}` → body contains `Free pulls full · 5 pending in reserve`. `maps next-action titles across ready states` (`:74-112`), `keeps all primary action labels…` (`:114-130`; the wallet-full input at `:125` moves to `{60,5}` — literal move, intent unchanged) and `COPY contains no loss-aversion terms` (`:133-141`) unchanged in intent.
    - `tests/unit/summary-home.test.ts`: the three `buildSessionSummaryVM` cases (`:6-52`) move to the outcome API (case 1 passes a one-new-card outcome and keeps `rewardBadge` `/\+1 pull/i` + `rewardBody` `/ready to use/i`; case 2 unchanged except comment; case 3 keeps `rewardBadge === 'Progress saved'` and asserts `rewardBody` `/no free pulls this run/i`); the `:7-8` comment naming the deleted function is removed. The `buildHomeVM` describe (`:54-`, first case `it('keeps an enabled library CTA when no deck is available'`) including `:121` (`unlock after you clear today’s work`) is byte-identical.
    - `tests/integration/session-summary.screen.test.tsx`: case 1 (`:88-192`) is retitled **`shows the outcome reward copy and never writes the wallet`** (the old title claims the summary applies the reward, which is no longer true), passes the same `reward` outcome (`{0,0} → {1,0}`, one new card) in **both** the create and the `tree.update` params and expects `+1 pull · 1 new card learned` and `1 ready to use` in place of `:151-153`; `:181-186` becomes `expect(store.has('devcards:u:anon:recallsmith:reward-wallet:v1')).toBe(false)` (the summary does not write the wallet); the CTA press → `navigate('Draw', { slug: 'csharp', rewardPending: true })` stays. Case 2 (`it('shows an error branch and retries reward resolution without navigating away'`, `:194-246`, title kept) spies `loadRewardWalletState` (`mockRejectedValueOnce`) instead of `applySessionRewardToWallet`; case 3 (`it('keeps the primary CTA disabled while reward resolution is loading'`, `:248-319`, title kept) spies `loadRewardWalletState` with the pending promise and resolves it with `{ availablePulls: 1, reservePulls: 0 }`. Cases 4 (`it('uses neutral empty-state library copy without session setup language'`, `:321`) and 5 (`it('shows an extra milestone count when multiple milestones unlock'`, `:363`) byte-identical. Every testID unchanged.
    - `tests/integration/session-card.screen.test.tsx`: add `vi.mock('../../src/features/gacha/rewards/sessionRewards', () => ({ settleRatingReward: vi.fn(async (input: any) => input.rating === 'again' ? ZERO_STEP : PAID_STEP) }))` where `PAID_STEP = { newCardPaid: true, dueClearPaid: false, pulls: 1, walletBefore: { availablePulls: 0, reservePulls: 0 }, walletAfter: { availablePulls: 1, reservePulls: 0 }, applied: { availablePulls: 1, reservePulls: 0, appliedToAvailable: 1, appliedToReserve: 0, dropped: 0 }, newCardsLearnedToday: 1 }` and `ZERO_STEP` is the all-zero/null step; the `toHaveBeenCalledWith('SessionSummary', {…})` literal at `:270-279` gains `reward: expect.any(Object)`; case `:317` (`computes settlement reward pulls through the reward resolver`) is retitled **`settles the rating reward and hands the outcome to Settlement`** and expects `rewardPulls: 1`. Nothing else: `it('routes to SessionSummary when Continue is pressed in the route-complete state'` (`:380`) keeps its title and its `:415-423` exact literal.
    - `tests/unit/session-store.test.ts`: add-only — the three existing cases `it('starts a session with route metadata and counters reset'`, `it('records ratings, advances session progress, and earns streak on first non-again rating'`, `it('resets back to the empty session state'` are byte-identical; append `it('accumulates reward steps into the session outcome', …)`: `startSession`, `recordRewardStep(PAID_STEP, 'card-1')`, `recordRewardStep(ZERO_STEP, 'card-2')` → `rewardOutcome.rewardPulls === 1`, `newCardUids` `['card-1']`; then `startSession` again → `rewardOutcome` equals `EMPTY_REWARD_OUTCOME`.
    - Literal moves only: `tests/unit/draw.test.ts` `:69`, `:93`, `:95` (30 → 60); `tests/unit/drawStateAdoption.test.ts` `:98` (28 → 58; C00 says `:97`, tree has `:98`), `:102` (`{60,5}`; `addedPulls 7`, `dropped 3` unchanged) **and** `:54` `ZERO` gains `ledgerDecks: 0, uidsAdded: 0` (gap 1); `tests/unit/homeSelectors.spec.ts` `:51`, `:135`, `:239` (`{60,5}`); `tests/integration/home-primary-cta.test.tsx` `:308` (`{60,5}`), `:310` (`'Wallet full (60 + 5)'`); `tests/unit/ceremonyTuning.test.tsx` `:228` (title `…at 60/5…`), `:238` (`{60,5}`), `:239` (`'Wallet seeded 60/5'`).
    - `tests/p2-smoke.ts` `:115-147`: `applyRewardToWallet({ availablePulls: 59, reservePulls: 4 }, 3)` → 60/5/1/1/1; `fullWallet` from `{60,5}`; the two `resolveSessionReward` calls pass `reward` outcomes (a one-new-card outcome `{0,0} → {1,0}` asserting `rewardPulls === 1` and `/\+1 pull/`; a one-new-card outcome on `{60,4}` with `walletAfter {60,5}`, `applied 1` asserting `/pending in reserve/i`) and keep the `completedFullRun` / `completedMinimumGoal` asserts. Must compile under `tsc --noEmit`; it is not run in CI (C00 §6 #19).

15. **New tests** (C00 §3.2; `it` titles verbatim — the verify script greps them):
    - `mobile/tests/unit/newCardLedger.test.ts` (fast-check; harness = `drawStateAdoption.test.ts:1-16` Map-backed AsyncStorage with `getAllKeys`/`removeItem` + real `review/storage` + `setActiveUserSubForStorage`; pin the literal key `devcards:u:anon:recallsmith:newCardPullPaidUids:csharp`):
      1. `it('pins the ledger key to the anon partition', …)` — after `payNewCardIfUnpaid('csharp', 'c1', 1000)` the store has exactly that key.
      2. `it('pays each uid at most once across any call sequence', …)` — `fc.assert(fc.asyncProperty(fc.array(fc.constantFrom('a','b','c','d')), …))`: for any sequence, the number of `paid: true` results equals the number of distinct uids, and a second pass pays nothing.
      3. `it('seeds exactly the learned uids with 0 and never overwrites a present ledger', …)` — fast-check over progress arrays with mixed `lastReviewedAt`; seeded keys == learned uids, all `0`; a present ledger (including `{}`) is returned unchanged.
      4. `it('reads a corrupt ledger as present and empty', …)` — garbage value → `{ ledger: {}, present: true }`, and `seedNewCardLedgerIfAbsent` does not re-seed it.
      5. `it("counts only today's positive stamps", …)` — `countPaidOnDay` ignores `0`, yesterday, tomorrow.
      6. `it('marks the due-clear day once per local day', …)` — first call true, second false, next day true; `getItem` throwing → false.
      7. `it('adopts the anon ledger into the user partition, unions and clears the anon key', …)` — anon `{a:1,b:2}` + user `{b:0,c:3}` → user `{b:0,c:3,a:1}`, `uidsAdded 1`, `ledgerDecks 1`, anon key removed.
      8. `it('is a no-op while signed out and on a second run', …)`.
    - `mobile/tests/unit/sessionRewards.test.ts` (fast-check over rating sequences; same harness plus a `setItemCalls` log as in `rewardWalletOrdering.test.ts:3-27`):
      1. `it('never pays on again and pays exactly once on the first hard, good or easy', …)` — for any `fc.array(fc.constantFrom('again','hard','good','easy'))` on one card, `Σ newCardPaid === (sequence has a non-again ? 1 : 0)` and it fires at the first non-again index; wallet gains exactly that many pulls.
      2. `it('never pays for a card that was already learned when the ledger was first seeded', …)` — `progressBefore` has the card with `lastReviewedAt > 0` → `hard` pays 0.
      3. `it('fires the due-clear pull once per local day and only on a due-to-zero transition', …)` — `(dueBefore 2, remaining 1)` → 0; `(2, 0)` → 1; again `(2, 0)` same day → 0; next day → 1; `(0, 0)` → 0.
      4. `it('skips the new-card pull in sweep mode but still evaluates the due clear', …)` — `newCardEligible: false`, `hard`, `(1, 0)` → `newCardPaid false`, `dueClearPaid true`, `pulls 1`.
      5. `it('writes the ledger before it touches the wallet', …)` — the wallet key's index in `setItemCalls` is greater than the last ledger-key index.
      6. `it('returns the zero step and leaves the wallet alone when storage fails', …)` — `getItem` throws → `ZERO_REWARD_STEP` shape, no `setItem` on the wallet key.
      7. `it('reports pulls with a null wallet when the wallet write fails after the ledger', …)` — `failSetItemFor = wallet key` → `pulls 1`, `newCardPaid true`, `walletAfter null`, ledger contains the uid.
    - `mobile/tests/unit/rewardOutcome.test.ts` (pure):
      1. `it('accumulates steps into an outcome', …)` — three steps (paid, zero, due-clear) → counts, uids order, `walletBefore` from the first paying step, `walletAfter` from the last, `applied`/`dropped` sums.
      2. `it('renders the four reward lines verbatim', …)` — `+1 pull · 1 new card learned`, `+3 pulls · 3 new cards learned`, `+1 · cleared today's due`, `+4 pulls · 3 new cards learned · cleared today's due`, and `No free pulls this run` for the empty outcome; `rewardBadge` → `+2 pulls` / `Progress saved`.
      3. `it('resolves a session reward from an outcome and from no outcome', …)` — `reward: null` → `rewardPulls 0`, `walletAfter === applyRewardToWallet(wallet, 0)` shape; a `{59,0} → {60,0}` outcome → `walletAfter.availablePulls 60`, `rewardMessage === '+1 pull · 1 new card learned · 60 ready to use'`; `completedFullRun` still follows `sessionDone >= sessionLimit`.

Estimated size: ~120 lines `newCardLedger.ts`, ~70 `sessionRewards.ts`, ~110 `rewardResolver.ts`, ~40 net in `SessionCardScreen.tsx` (mostly deletions), ~20 each in the other source files, ~450 lines of tests.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/C01.verify.sh` re-runs exactly these (steps 1–5); the driver then runs the full mobile gate (`npm run test:typecheck && npx vitest run`), the diff-scoped banned-term grep and the suppression scan.

1. Scope files exist: `mobile/src/features/gacha/rewards/newCardLedger.ts`, `mobile/src/features/gacha/rewards/sessionRewards.ts`, `mobile/tests/unit/newCardLedger.test.ts`, `mobile/tests/unit/sessionRewards.test.ts`, `mobile/tests/unit/rewardOutcome.test.ts`.
2. Literal guards (all exit 0): `grep -Fq 'export const FREE_PULL_CAP = 60;' mobile/src/features/gacha/constants.ts`; every exported signature of changes 2–5 is present as a fixed string (`grep -F`); `computeSessionRewardPulls` has zero hits under `mobile/src` and `mobile/tests`; `applySessionRewardToWallet` has zero hits in `SessionSummaryScreen.tsx` and its definition is still in `rewardWallet.ts` with `git diff --numstat` deletions `0`; `session-card-fullclear-stake`, `fullClearReward`, `showFullClearStake`, `doneRewardPulls` have zero hits in `SessionCardScreen.tsx`; `settleRatingReward(`, `recordRewardStep`, `newCardEligible: true`, `rewardPulls: outcome.rewardPulls`, `reward: outcome` present in it; `>= FREE_PULL_CAP` present and `>= 30` absent in `drawState.ts`; `AnonDrawStateAdoption & AnonWalletAdoption & AnonLedgerAdoption` and `adoptAnonNewCardLedger` in `drawStateSync.ts`; `60/5` ×3 and no `30/5` in `DebugMenuScreen.tsx`; `reward?: RewardOutcome;` in `navigation/types.ts`; `sectionFullClear: 'Run reward'`, `noPull: 'No free pulls this run'`, `reward?: RewardOutcome | null` and no `gained:` in `summaryMapper.ts`; the `it('…'` titles of changes 14–15; `from 'fast-check'` + `fc.assert(` in the two property suites; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any added line.
3. `cd mobile && npm run test:typecheck` — exit 0 (this also compiles `tests/p2-smoke.ts`).
4. `cd mobile && npx vitest run tests/unit/newCardLedger.test.ts tests/unit/sessionRewards.test.ts tests/unit/rewardOutcome.test.ts tests/unit/rewards.test.ts tests/unit/summaryMapper.spec.ts tests/unit/summary-home.test.ts tests/unit/session-store.test.ts tests/unit/draw.test.ts tests/unit/drawStateAdoption.test.ts tests/unit/homeSelectors.spec.ts tests/unit/ceremonyTuning.test.tsx tests/unit/rewardWalletOrdering.test.ts tests/unit/gachaUserScope.test.ts tests/unit/economyFloor.test.ts tests/integration/session-summary.screen.test.tsx tests/integration/session-card.screen.test.tsx tests/integration/home-primary-cta.test.tsx tests/integration/economy-floor.spec.tsx tests/integration/home-economy-floor.spec.tsx --reporter=dot` — exit 0.
5. Scope + frozen + OTA guard: `git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/features/gacha/rewards/economyFloor.ts mobile/src/review/storage.ts mobile/src/features/gacha/draw/drawStateStore.ts mobile/src/features/gacha/components/RewardSummaryCard.tsx mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/vitest.config.ts mobile/tests/setup` and the five byte-identical suites; `grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json`, `grep -Fq '"version": "1.6.0"' mobile/app.json`, `grep -Fq '"vite": "7.2.4"' mobile/package.json`, no `@sentry` under `mobile/src`; `git diff --name-only "$MB" HEAD` ∪ the pathspec-scoped untracked scan of `mobile/src mobile/tests` is a subset of the Scope list plus `docs/delivery/r16-issues/`.

## Verify

```bash
BASE=delivery/r16-c-economy bash docs/delivery/r16-issues/C01.verify.sh
```

Runtime ~2–3 min (one `tsc`, ~19 vitest files). No network, no `npm install`. The driver afterwards runs the full root gate `( cd mobile && npm run test:typecheck && npx vitest run )` plus its own diff-scoped banned-term and suppression scans, so the verify does not repeat the whole suite — but every suite in the repo must be green: a literal you missed in a file outside the "may change" list is a failed gate, not a follow-up.

## Do NOT

- Do NOT pay at the summary, in `SessionSummaryScreen`, or from `sessionRatings`; do NOT keep or re-create `computeSessionRewardPulls` under another name; do NOT call `applySessionRewardToWallet` from app code.
- Do NOT put the ledger on `CardProgress` or in `mobile/src/review/storage.ts`; do NOT sync it (no `drawStateSync` payload change, no server field); do NOT adopt the R2 marker at sign-in.
- Do NOT add a `sweep` mode, a forecast line, `newCardsLearnedToday` UI, `SWEEP_SPREAD_DAYS`, or touch `sessionBuilder.ts` / `homeSelectors.ts` (C02/C03/C04).
- Do NOT change `FREE_PULL_OVERFLOW_CAP`, `SESSION_MAIN_ROUTE_DEFAULT`, `MASTERY_STAGE_THRESHOLD`, pity, rarity or the economy floor.
- Do NOT edit `ChallengeScreen.tsx:31`, `libraryMapper.ts:216`, `DrawScreen.tsx:843`, `DrawResultScreen.tsx:222`, `HomeScreen.tsx`, `faq.ts` (C00 §6 #20; C03/C15 own the rest).
- Do NOT touch the `SessionSummary` route-complete Continue literal (`SessionCardScreen.tsx:682-690`) or the test that pins it; do NOT add `reward` to `Settlement` params.
- Do NOT import `summaryMapper.ts` from `rewardResolver.ts`; do NOT write `JSX.Element`.
- Do NOT run `npm install`/`npm ci`, `expo prebuild`, `eas …`, or git in `/Users/qc/src/recallsmith`; work only in your worktree.
