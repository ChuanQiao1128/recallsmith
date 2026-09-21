# D03 — planner `kindHint` + `maxPerRun` rotation in the new-card bucket (`planner-kind-hint`)

Give the session planner a way to deal MCQ cards from the NEW bucket at all: on the live decks every MCQ card sits at `OrderInDeck` 1540+ (aws-saa-c03) behind hundreds of unseen Q/A cards, and `pickNew` returns the first new card in deck order, so an MCQ card would not come up for weeks. This issue adds ONE optional key `kindHint?: McqKindHint | null` to `pickNextCard` (and its pass-through `buildRatedSessionState`), a new pure module `mcq/mcqRotation.ts` that turns a per-run counter plus `features.mcq.maxPerRun` into that hint, and two unit suites. The hint touches only `pickNew`: bucket order (due → updated → new), the `owns` guard, `pickWith`'s avoid-then-ignore scan, `pickSweep` and the mode dispatch are byte-identical, so the existing planner pins stay green untouched. Pure TS shipped as an OTA on runtime 1.6.0 — no dependency, manifest, native, scheduler or progress-model change. Nobody wires the hint into a screen here (D05 does); with no hint, or under the kill switch, the planner behaves exactly as it does today.

## Context

What the tree looks like today (`delivery/r16-d-mcq` == `main@107e2a2`; every line read on 2026-09-22):

- **`mobile/src/features/gacha/planner/sessionPlanner.ts` (198 lines).** Imports `:1-7` (types from `deckExport`, `review/model`, `contracts`, `navigation/types`; `sessionBuilder`; `isLearnedProgress, isNewProgress, isScheduledProgress, startOfToday` from `../selectors/progressSelectors` `:5`; `formatDateKey` `:6`). `pickNextCard` params `:92-100` (`ownedSet?: OwnedGate;` is the last key, `:99`), destructuring `:101`, `pickWith` `:108-129` (two scans: honour `avoidUid` `:109-116`, then ignore it `:118-126`), the comment block `:131-139` ("a fourth pick added later must remember `owns` -- if you are adding one, add it." `:138-139`), `owns` `:140`, `pickDue` `:141`, `pickUpdated` `:142`, `pickNew` `:143` (`const pickNew = () => pickWith((card, progressEntry) => owns(card) && isNewProgress(progressEntry));`), `pickSweep` `:148-162`, dispatch `:164-167` (`sweep` → `pickSweep()`, `review-due` → `pickDue()`, `learn-new` → `pickNew()`, else `pickDue() ?? pickUpdated() ?? pickNew()`). The planner reads no feature flag and must not start to.
- **`mobile/src/features/gacha/session/sessionReviewHelpers.ts` (101 lines).** Imports `:1-5` (`pickNextCard`, `countDueToday` from `../planner/sessionPlanner` `:4`). `buildRatedSessionState` params `:48-57` (`ownedSet?: OwnedGate;` last, `:57`), destructuring `:66`, `updatedOne` `:68-71`, `nextDone = sessionDone + 1` `:75` (verdict-blind — plan §5.5), the `pickNextCard({...})` call `:82-89` (`avoidUid: updatedOne.stableUid,` `:86`, `ownedSet,` `:88`), `remainingDueCount` `:91`.
- **`mobile/src/features/gacha/selectors/progressSelectors.ts`**: `isLearnedProgress` `:16-18`, `isNewProgress` `:24-26` (`!isLearnedProgress`). Pure (imports `review/model`, `../constants`, `../contracts` types only).
- **`mobile/src/config/featureFlags.ts` (127 lines, NOT edited):** `FeatureFlags.mcq { enabled; recallFirst; maxPerRun; answerTelemetry }` `:5-11`; `DEFAULT_FEATURE_FLAGS` `:21-32` with `mcq { enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false }` `:22-27`; `getFeatureFlags()` `:53-55`; `maxPerRun` accepted from remote config only as an integer ≥ 0 (`:84-87`). `mcqRotation.ts` takes a `Pick<FeatureFlags, 'mcq'>` VALUE — it never calls `getFeatureFlags()`; the screen reads the snapshot once per card (D05, D00 §2.5.1).
- **`mobile/src/review/model.ts` (frozen):** `ReviewRating` `:2`, `CardProgress` `:4-27` (`lastReviewedAt?` `:7` absent ⇒ never learned). Read-only here (`mcqRotation.ts` imports the type).
- **`mobile/src/types/deckExport.ts`:** `CardExport` `:15-26`, `Topic?: string | null;` `:25`. On the base it has NO `Mcq` key and `mobile/src/features/gacha/mcq/` does not exist — D01 adds `Mcq?: McqExport | null;` and `mcq/normalizeMcq.ts` (`normalizeMcq(raw: unknown): McqExport | null`, D00 §2.1 `:119`), D02 adds `mcqVerdict.ts` / `mcqShuffle.ts` / `mcqConstants.ts`. D03 rebases on D02's merge (D00 §4: deps D02) and the verify's step 1 checks both prerequisites before anything else runs.
- **Existing pins that must stay green untouched:** `mobile/tests/unit/planner.test.ts` `describe('countDueToday / pickNextCard')` `:161-220` (D00 cites `:161-206`: review-due prefers due `:166`, learn-new prefers new `:171`, mixed falls back to updated `:176`, avoided uid reused only when nothing better `:194`, sweep `:206`); `mobile/tests/unit/ownedGatePredicates.test.ts` `:114` ("picks the first card in deck order that matches the mode, owned or not"), `:126` (`buildRatedSessionState` hands the next card back), `:228-279` (the gated twins: unowned due/new/updated skipped, `:254` "carries the gate through both of the rating pass-throughs"); `mobile/tests/unit/sweepPlanner.test.ts` (`pickNextCard` in sweep mode `:111`, `:138`, `:170-171`; `buildRatedSessionState` `:245-246`); `mobile/tests/integration/session-card.screen.test.tsx` (factory-mocks `sessionReviewHelpers` `:118-131` and `sessionPlanner` `:142-160` — the mocks ignore extra keys, and the screen is not edited here); `mobile/tests/integration/challenge.screen.test.tsx:66` (factory-mocks `sessionPlanner`); `mobile/tests/p2-smoke.ts:3`, `:81-118` (calls `pickNextCard` with the existing params; typechecked by `tsc --noEmit`, not run by vitest). All call `pickNextCard` / `buildRatedSessionState` WITHOUT `kindHint`, which is why the key is optional and `null`/absent must be a no-op.
- **Harness precedents:** `mobile/tests/unit/planner.test.ts:5-30` (`NOW`, `TODAY_MS`, `TOMORROW_MS`, `YESTERDAY_MS`, deck/progress fixtures `as any`); `mobile/tests/unit/ownedGatePredicates.test.ts:36-70` (the "unowned twin sorts first" fixture idea); `mobile/tests/unit/spillSchedule.test.ts:4` (`import fc from 'fast-check'`; `fast-check` `^4.9.0` is a devDependency, `mobile/package.json:66`); `mobile/tests/integration/draw-result.screen.test.tsx:69-72` (`vi.mock(path, async (importOriginal) => ({ ...(await importOriginal<typeof import(path)>()), name: vi.fn(...) }))` — the pass-through mock the spy case copies; vitest is `^4.1.5`, `mobile/package.json:70`).
- Typecheck: `mobile/tsconfig.json` is `strict: true` with no `include`, so `tests/` is typechecked by `npm run test:typecheck` (`tsc --noEmit`, `package.json:11`). vitest discovers `tests/unit/**/*.test.ts` (`mobile/vitest.config.ts`).

What D00 decided (binding; `docs/delivery/r16-issues/D00-contracts.md`): §0 (`:9-28`) — OTA-only, the three frozen files zero-diff for this issue, no scheduler change, flags read once and never edited, kill switch = no hint at all, the do-not-touch list (`:23`), banned literals (`:25`); §1.1 (`:44-46`, `:62`) — the D03 column: `mcq/mcqRotation.ts` (C), `sessionPlanner.ts` (E, `kindHint` on `pickNextCard`, only D03), `sessionReviewHelpers.ts` (E, pass-through, only D03), tests `mcqRotation.test.ts` and `plannerKindHint.test.ts` (C); §2.3 (`:256-285`) — the signatures and the `pickNew` snippet below, verbatim; §3.3 (`:446-449`) — the eleven `it` titles; §3.7 (`:478-480`) — D03's property test is the hint-null equivalence; §4 (`:484-495`) — deps D02, merge order D01 → D02 → **D03** → D04 → D05 → D06; §5 (`:499-513`) — verify conventions; §6 #4 (`:521`) — the rotation logic lives in `mcq/mcqRotation.ts` because the untouched screen suite factory-mocks both `sessionPlanner` and `sessionReviewHelpers` (a new named import from either would throw there; D05 imports `buildKindHint` only from the mcq directory); §6 #5 (`:522`) — `maxPerRun = 0` means none, so `mcqAllowed` is a hard FILTER while `preferMcq` is an ORDERING with fallback; a run whose only remaining new cards are MCQ ends early on the route-complete card (accepted); `served` counts MCQ cards from ANY bucket; due MCQ cards are never deferred and there is no hint in `review-due` / `sweep`; §6 #15 (`:532`) — plan line drift (`pickWith` is `:108-129`, not the plan's `:97-104`; `sessionBuilder.ts:41` "1–2 new cards per run" is gone since C02/R6, the ordering problem remains).

Doc drift, stated so nobody re-derives it:

- Plan §5.7 (`docs/mcq-card-type-plan-2026-09-18.md:321-323`) says `pickNew` "先扫 … 符合偏好，找不到回退到普通扫描" for BOTH halves of the hint. D00 §6 #5 wins: only `preferMcq` falls back; `mcqAllowed: false` never falls back to an MCQ card (`0 = 不出`, plan §8 `:393`). The wave table row (`docs/delivery-wave-1.6-plan-2026-09-19.md:129`) lists scope `planner/sessionPlanner.ts, session/sessionReviewHelpers.ts, tests` and no new module; D00 §1.1 / §6 #4 add `mcq/mcqRotation.ts` — this brief follows D00.
- Plan §5.7 puts "调用方按会话状态算 hint" on the screen; here the arithmetic is the pure `buildKindHint` / `noteServedCard` so D05 only threads state. The screen call sites (`SessionCardScreen.tsx:364-372`, `:438-448`) are NOT touched by this issue.
- **D00 contradicts itself on `.Mcq` readers and this brief resolves it.** D00 §0 (`:24`) and §5 (`:505`) say exactly three files may reference `.Mcq` (`deckExport.ts`, `deckRepository.ts`, `normalizeMcq.ts`); D00 §2.3 (`:274`) pins, verbatim, `const isMcq = (card: CardExport) => normalizeMcq(card.Mcq) !== null;` INSIDE `sessionPlanner.ts`. Both cannot hold. The pinned snippet is what makes the planner work and it honours the rule's purpose (the raw field goes straight into `normalizeMcq`, nothing else looks at it), so **`sessionPlanner.ts` is the fourth and last reader**; `D03.verify.sh`'s reader guard allows exactly these four files; D04 and D05 carry the same four-file list, and D06 adds `library/libraryMapper.ts` (its own pinned `normalizeMcq(card.Mcq)` row property) as the fifth and last — recorded in D00 §6 #19. `mcqRotation.ts` itself never touches `.Mcq` (it takes an `isMcq: boolean`).

Gaps D00 leaves open — resolved here and binding for this issue:

1. **Absent vs `null` hint.** Both `pickNextCard` and `buildRatedSessionState` destructure `kindHint = null`, so an absent key and an explicit `null` take the same `if (!kindHint)` path and the helper forwards `null` (never `undefined`) to the planner. The spy case asserts `kindHint: null` on the forwarded call when the caller passed nothing.
2. **A malformed hint** (`{ mcqAllowed: false, preferMcq: true }` — `buildKindHint` never produces it) still never deals an MCQ card from the new bucket: `mcqAllowed` is checked first and `preferMcq` is ignored under it. Tested.
3. **`preferMcq` + `avoidUid` on the preferred card.** `preferred` is a `pickWith` call, so its second scan ignores `avoidUid` before the plain fallback runs (an avoided MCQ card can be re-dealt ahead of an unseen Q/A card). `buildKindHint` cannot produce that situation (after an MCQ card `lastNewKind === 'mcq'` ⇒ `preferMcq === false`), so it is documented, not designed around, and not tested.
4. **`maxPerRun` arithmetic is defensive by construction:** `state.served < flags.mcq.maxPerRun` with a non-finite `maxPerRun` is `false` ⇒ `mcqAllowed: false`. No clamping code in this module (`applyRemoteFeatures` already guarantees an integer ≥ 0).
5. **`noteServedCard` counts on `isMcq` only** (plan literal "本场已出 MCQ 数": any bucket); `lastNewKind` moves only when `isNewProgress(progress)` (the progress BEFORE the rating — what the screen holds as `current.progress`). A due MCQ card therefore raises `served` but leaves the rotation parity alone.

## Read first

1. `docs/delivery/r16-issues/D00-contracts.md` §0 (`:9-28`), §1.1 (`:34-62`, the D03 column `:44-46` and the tests line `:62`), §2.1 (`:82-131`, only the `normalizeMcq` signature `:119` matters here), §2.3 (`:256-285`, whole), §3.3 (`:446-449`), §3.7 (`:478-480`), §4 (`:484-495`), §5 (`:499-513`), §6 #4, #5, #15 (`:521-522`, `:532`).
2. `mobile/src/features/gacha/planner/sessionPlanner.ts` (whole file, 198 lines; you edit the import block, the params type, the destructuring, the comment block and `pickNew` — nothing else).
3. `mobile/src/features/gacha/session/sessionReviewHelpers.ts` (whole file, 101 lines; you add one import line, one params key, one destructured default and one forwarded key).
4. `mobile/src/features/gacha/selectors/progressSelectors.ts:16-26`; `mobile/src/config/featureFlags.ts:1-32`, `:53-62`, `:84-87` (read only); `mobile/src/review/model.ts:1-27` (read only, frozen).
5. `mobile/src/features/gacha/mcq/normalizeMcq.ts` as merged by D01 (its `normalizeMcq` export is the only thing you call) and `mobile/src/types/deckExport.ts` as merged by D01 (`Mcq?: McqExport | null;`, `McqExport`, `McqOption`).
6. `mobile/tests/unit/planner.test.ts:1-30`, `:161-220` and `mobile/tests/unit/ownedGatePredicates.test.ts:1-92`, `:114-140`, `:228-279` (the fixtures and pins you must keep green; you do not edit them).
7. `mobile/tests/unit/spillSchedule.test.ts:1-45` (fast-check style) and `mobile/tests/integration/draw-result.screen.test.tsx:66-72` (the `importOriginal` pass-through mock).
8. `docs/mcq-card-type-plan-2026-09-18.md:177-217` (§4.3 card 1 — the ONLY MCQ text your fixtures may carry, transcribed below) and `:321-323` (§5.7).

## Constraints

- **Scope (the ONLY files that may change):**
  `mobile/src/features/gacha/mcq/mcqRotation.ts` (new), `mobile/src/features/gacha/planner/sessionPlanner.ts`, `mobile/src/features/gacha/session/sessionReviewHelpers.ts`, `mobile/tests/unit/mcqRotation.test.ts` (new), `mobile/tests/unit/plannerKindHint.test.ts` (new). Nothing else — not `SessionCardScreen.tsx`, not any other file under `mcq/`, not `deckExport.ts`.
- **Frozen files (gacha-v7 §2.1, narrowed by C00 §0; D00 §0):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` are zero-diff in this issue (D01's two-line exception is already merged; the verify requires `git diff --quiet` on all three). Also untouched (D00 §0 do-not-touch list, plus this issue's neighbours): `mobile/src/review/storage.ts`, `mobile/src/content/chunkedInstall.ts`, `mobile/src/features/gacha/planner/sessionBuilder.ts` (route length stays `min(5, due + new)`), `mobile/src/features/gacha/planner/sessionRoles.ts`, `mobile/src/features/gacha/session/sessionStore.ts`, `mobile/src/features/gacha/session/reviewContentHelpers.ts`, `mobile/src/features/gacha/rewards/*`, `mobile/src/features/gacha/selectors/progressSelectors.ts`, `mobile/src/features/gacha/contracts.ts`, `mobile/src/features/gacha/constants.ts`, `mobile/src/features/gacha/mcq/normalizeMcq.ts`, `mcqVerdict.ts`, `mcqShuffle.ts`, `mcqConstants.ts`, `mobile/src/types/deckExport.ts`, `mobile/src/config/featureFlags.ts`, `mobile/src/config/remoteConfig.ts`, `mobile/src/config/forceUpdateGate.ts`, `mobile/src/screens/*`, `mobile/src/navigation/types.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`.
- **OTA rule (D00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no new dependency, no native module, no `npm install`. `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"` and `"version": "1.6.0"` stay as they are. No `@sentry`, no static `expo-updates` import.
- **No scheduler / flag plumbing in the planner.** `sessionPlanner.ts` and `sessionReviewHelpers.ts` never import `featureFlags`, `remoteConfig`, `react`, `AsyncStorage`, `Date.now` or `Math.random`; the hint arrives as a value. `mcqRotation.ts` is pure: its only imports are `type { CardProgress } from '../../../review/model'`, `type { FeatureFlags } from '../../../config/featureFlags'` and `{ isNewProgress } from '../selectors/progressSelectors'`.
- **Only `pickNew` changes.** `pickWith` (`:108-129`), `owns` (`:140`), `pickDue` / `pickUpdated` (`:141-142`), `pickSweep` (`:148-162`) and the four dispatch lines (`:164-167`) are byte-identical; the verify greps each of them and requires that no removed line of the diff mentions them. `sessionReviewHelpers.ts` keeps `const nextDone = sessionDone + 1;` (`:75`), `avoidUid: updatedOne.stableUid,` (`:86`) and everything else byte-identical.
- **`.Mcq` readers:** after this issue exactly four files under `mobile/src` reference `.Mcq`: `types/deckExport.ts`, `content/deckRepository.ts`, `features/gacha/mcq/normalizeMcq.ts`, `features/gacha/planner/sessionPlanner.ts` (the pinned `isMcq` line, once). `mcqRotation.ts`, `sessionReviewHelpers.ts` and the tests' source imports add no reader (test files may build `Mcq` fixtures freely).
- **Banned literals in any new/changed line and in this brief:** the six terms of B00 §0 (driver gate). Use "sidestep", "work around", "guard", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Existing tests:** NO existing test file changes (D00 §1.1: the wave's only bounded test edits belong to D01, D05, D06). `tests/unit/planner.test.ts`, `tests/unit/ownedGatePredicates.test.ts`, `tests/unit/sweepPlanner.test.ts`, `tests/unit/featureFlags.test.ts`, `tests/integration/session-card.screen.test.tsx`, `tests/integration/challenge.screen.test.tsx`, `tests/p2-smoke.ts` must stay green untouched.
- **MCQ text:** the only MCQ content any fixture may carry is plan §4.3 card 1 (`:177-217`), transcribed in change 5 below. Never paste anything from an exam dump; never invent option text that reads like one — Q/A fixture cards use `Question: 'Q10'`-style placeholders.
- **testIDs / copy:** none — this issue has no UI and no user-facing string. No `console.*` in any scope file.
- Any explicit component return type is `React.JSX.Element` (or omitted), never `JSX.Element` (C00 §6 #23) — moot here, no component.
- Standing rules: no `git push`, no PR, never touch `main`, no EAS / expo / deploy command, no npm/git activity outside your worktree.

## Changes required

1. **`mobile/src/features/gacha/mcq/mcqRotation.ts` (new, pure).** Exactly these exports with these signatures (the verify greps the signature lines byte for byte):
   ```ts
   import type { CardProgress } from '../../../review/model';
   import type { FeatureFlags } from '../../../config/featureFlags';
   import { isNewProgress } from '../selectors/progressSelectors';

   /** What the planner may do with the NEW bucket this pick (D00 §2.3). Absent/null hint = the planner as it is today. */
   export type McqKindHint = { mcqAllowed: boolean; preferMcq: boolean };

   /** Per-run counter the screen keeps in a ref (D05). `served` = MCQ cards set current this run, from ANY bucket
    *  (plan §5.7 "本场已出 MCQ 数"); `lastNewKind` = the kind of the last card dealt from the NEW bucket. */
   export type McqRunState = { served: number; lastNewKind: 'mcq' | 'qa' | null };

   export const EMPTY_MCQ_RUN_STATE: McqRunState = Object.freeze({ served: 0, lastNewKind: null });

   /** flags.mcq.enabled === false → null (kill switch, D00 §0: no hint at all).
    *  Else { mcqAllowed: served < maxPerRun, preferMcq: mcqAllowed && lastNewKind !== 'mcq' }.
    *  maxPerRun 0 ⇒ mcqAllowed false ⇒ preferMcq false. Pure; never throws. */
   export function buildKindHint(state: McqRunState, flags: Pick<FeatureFlags, 'mcq'>): McqKindHint | null {
     if (flags.mcq.enabled === false) return null;
     const mcqAllowed = state.served < flags.mcq.maxPerRun;
     return { mcqAllowed, preferMcq: mcqAllowed && state.lastNewKind !== 'mcq' };
   }

   /** New state after a card was set current: served + (isMcq ? 1 : 0); lastNewKind becomes 'mcq' / 'qa' only when
    *  the card came from the new bucket (isNewProgress(progress), progress = the row BEFORE the rating), else unchanged.
    *  Returns a new object; never mutates `state`. */
   export function noteServedCard(state: McqRunState, progress: CardProgress, isMcq: boolean): McqRunState {
     return {
       served: state.served + (isMcq ? 1 : 0),
       lastNewKind: isNewProgress(progress) ? (isMcq ? 'mcq' : 'qa') : state.lastNewKind,
     };
   }
   ```
   No other export, no default export, no `.Mcq` access, no react / storage / clock / randomness.

2. **`mobile/src/features/gacha/planner/sessionPlanner.ts`**
   a. Imports — add after `:7` (the `StudyMode` type import), exactly:
      ```ts
      import type { McqKindHint } from '../mcq/mcqRotation';
      import { normalizeMcq } from '../mcq/normalizeMcq';
      ```
      Nothing else in `:1-7` changes.
   b. `pickNextCard` params (`:92-100`): ONE added key, directly after `ownedSet?: OwnedGate;` (`:99`), before `}): CurrentCardLike | null {`:
      ```ts
        kindHint?: McqKindHint | null;
      ```
   c. Destructuring (`:101`) becomes exactly:
      ```ts
        const { deck, progress, now, mode, avoidUid, index, ownedSet = null, kindHint = null } = params;
      ```
   d. Comment block (`:131-139`): append ONE sentence to the block (a new `//` line after `:139`, inside the same comment run), e.g. `// kindHint (D03) is that fourth pick: it narrows or reorders pickNew and nothing else, and its predicates keep owns.` Do not rewrite the existing nine lines.
   e. `pickNew` (`:143`) is replaced by the D00 §2.3 snippet, verbatim (the verify greps the four load-bearing lines byte for byte):
      ```ts
        const isMcq = (card: CardExport) => normalizeMcq(card.Mcq) !== null;
        const pickNew = () => {
          const isNew = (card: CardExport, p: CardProgress) => owns(card) && isNewProgress(p);
          if (!kindHint) return pickWith(isNew);
          if (!kindHint.mcqAllowed) return pickWith((card, p) => isNew(card, p) && !isMcq(card));        // hard filter: the cap
          const preferred = pickWith((card, p) => isNew(card, p) && (kindHint.preferMcq ? isMcq(card) : !isMcq(card)));
          return preferred ?? pickWith(isNew);                                                              // soft ordering: the rotation
        };
      ```
      Place `isMcq` directly before `pickNew` (after `pickUpdated`, `:142`). `owns` (`:140`), `pickDue` (`:141`), `pickUpdated` (`:142`), `pickWith` (`:108-129`), `pickSweep` (`:148-162`) and the dispatch (`:164-167`) are not edited, not moved, not re-indented. The hint is therefore consulted in `mixed` and `learn-new` only, by construction.
   f. No `getFeatureFlags`, no flag import, no `console.*`, no other change.

3. **`mobile/src/features/gacha/session/sessionReviewHelpers.ts`**
   a. Import — add after `:5` (`import type { OwnedGate } from '../contracts';`), exactly: `import type { McqKindHint } from '../mcq/mcqRotation';`
   b. `buildRatedSessionState` params (`:48-57`): ONE added key after `ownedSet?: OwnedGate;` (`:57`): `kindHint?: McqKindHint | null;`
   c. Destructuring (`:66`): append `kindHint = null` after `ownedSet = null` (same line, same order as the params).
   d. The `pickNextCard({...})` call (`:82-89`): add `kindHint,` as the LAST key, directly after `ownedSet,` (`:88`). Everything else in the file — `updatedOne` `:68-71`, `prevLearnedCount` `:73`, `nextDone` `:75`, `remaining` `:76`, the comment `:77-79`, `remainingDueCount` `:91`, the return literal `:93-100` — is byte-identical.

4. **`mobile/tests/unit/mcqRotation.test.ts` (new)** — imports `buildKindHint`, `noteServedCard`, `EMPTY_MCQ_RUN_STATE` and the types from `../../src/features/gacha/mcq/mcqRotation`, `DEFAULT_FEATURE_FLAGS` and `type { FeatureFlags }` from `../../src/config/featureFlags` (a value import of the module is fine in vitest — `tests/unit/featureFlags.test.ts:32` already does it; the module's only runtime import is `react`'s `useSyncExternalStore`, and its `remoteConfig` import is type-only). Fixtures: `flagsWith = (mcq: Partial<FeatureFlags['mcq']>) => ({ mcq: { ...DEFAULT_FEATURE_FLAGS.mcq, ...mcq } })`; `newRow = { stableUid: 'n', stage: 0, nextReviewAt: 0 }`; `learnedRow = { stableUid: 'l', stage: 2, lastReviewedAt: 1, nextReviewAt: 2 }` (both `as CardProgress`). Cases, each its own `it`, titles verbatim:
   1. `it('answers null under the kill switch', …)` — `buildKindHint(EMPTY_MCQ_RUN_STATE, flagsWith({ enabled: false }))` is `null`; so is `buildKindHint({ served: 0, lastNewKind: 'qa' }, flagsWith({ enabled: false, maxPerRun: 9 }))`; `EMPTY_MCQ_RUN_STATE` `toEqual({ served: 0, lastNewKind: null })` and `Object.isFrozen(EMPTY_MCQ_RUN_STATE)` is `true`.
   2. `it('caps at maxPerRun and alternates on the last new kind', …)` — `flagsWith({ maxPerRun: 0 })` with the empty state → `{ mcqAllowed: false, preferMcq: false }`; `{ served: 2, lastNewKind: 'qa' }` with the default `maxPerRun` 2 → `{ mcqAllowed: false, preferMcq: false }`; `{ served: 1, lastNewKind: 'mcq' }` → `{ mcqAllowed: true, preferMcq: false }`; `{ served: 1, lastNewKind: 'qa' }` → `{ mcqAllowed: true, preferMcq: true }`; `{ served: 0, lastNewKind: null }` → `{ mcqAllowed: true, preferMcq: true }`; `flagsWith({ maxPerRun: Number.NaN })` → `{ mcqAllowed: false, preferMcq: false }` (defensive by construction, resolution 4).
   3. `it('counts served MCQ cards from any bucket', …)` — `noteServedCard(EMPTY_MCQ_RUN_STATE, newRow, true)` `toEqual({ served: 1, lastNewKind: 'mcq' })`; `noteServedCard(EMPTY_MCQ_RUN_STATE, learnedRow, true)` `toEqual({ served: 1, lastNewKind: null })` (a due MCQ card counts but does not move the parity); `noteServedCard({ served: 1, lastNewKind: 'mcq' }, newRow, false)` `toEqual({ served: 1, lastNewKind: 'qa' })`; `noteServedCard({ served: 1, lastNewKind: 'qa' }, learnedRow, false)` `toEqual({ served: 1, lastNewKind: 'qa' })`; the input object is never mutated (`const before = { served: 0, lastNewKind: null }; noteServedCard(before, newRow, true); expect(before).toEqual({ served: 0, lastNewKind: null })`) and the result is not the same reference (`not.toBe`).

5. **`mobile/tests/unit/plannerKindHint.test.ts` (new)** — imports `describe, it, expect, vi, beforeEach` from `vitest`, `fc from 'fast-check'`, `pickNextCard` from `../../src/features/gacha/planner/sessionPlanner`, `buildRatedSessionState` from `../../src/features/gacha/session/sessionReviewHelpers`, and `type { McqKindHint } from '../../src/features/gacha/mcq/mcqRotation'`. The spy (D00 §3.3 "spy") is the pass-through mock of `draw-result.screen.test.tsx:69-72`, hoisted at the top of the file:
   ```ts
   vi.mock('../../src/features/gacha/planner/sessionPlanner', async (importOriginal) => {
     const actual = await importOriginal<typeof import('../../src/features/gacha/planner/sessionPlanner')>();
     return { ...actual, pickNextCard: vi.fn(actual.pickNextCard) };
   });
   ```
   so the imported `pickNextCard` runs the real implementation while recording calls (`vi.mocked(pickNextCard).mock.calls`); `beforeEach(() => vi.mocked(pickNextCard).mockClear())`.
   Time constants as `planner.test.ts:5-8` (`NOW`, `TODAY_MS`, `TOMORROW_MS`, `YESTERDAY_MS`). The MCQ blob is plan §4.3 card 1 in the server's PG key order (`v, options[{key, why, text, correct}], shuffle, qualifier`; lines of the plan joined with single spaces), exactly:
   ```ts
   const MCQ_BLOB = {
     v: 1,
     options: [
       { key: 'a', why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.', text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.', correct: false },
       { key: 'b', why: null, text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.', correct: true },
       { key: 'c', why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.', text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.', correct: false },
       { key: 'd', why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.', text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.', correct: false },
     ],
     shuffle: true,
     qualifier: 'LEAST operational overhead',
   };
   ```
   (`normalizeMcq` accepts it: keys a–d consecutive, one correct, every wrong option has a WHY, qualifier is not choose-N.) Fixture helpers: `qa(order)` → `{ StableUid: `q${order}`, OrderInDeck: order, Difficulty: 1, Question: `Q${order}`, Revision: 1 }`; `mcq(order)` → `{ StableUid: `m${order}`, OrderInDeck: order, Difficulty: 2, Question: `MCQ ${order}`, Revision: 1, Mcq: MCQ_BLOB }`; `deckOf(cards)` → `{ Slug: 'aws', Title: 'AWS', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: cards.length, Cards: cards } as any`; progress rows `fresh(uid)` → `{ stableUid: uid, stage: 0, nextReviewAt: 0 }`, `due(uid)` → `{ stableUid: uid, stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: YESTERDAY_MS, lastSeenRevision: 1 }`, `later(uid)` → same with `nextReviewAt: TOMORROW_MS`, `updated(uid)` → `later` but the card carries `Revision: 2` (`lastSeenRevision: 1` stays). The base deck: Q/A cards at `OrderInDeck` 10, 20, 30, 40, 50 and MCQ cards at 1540, 1550, 1560, every row `fresh` — so every Q/A new card sorts before every MCQ new card, which is the ordering problem this issue exists for. Hints: `ALLOW_PREFER: McqKindHint = { mcqAllowed: true, preferMcq: true }`, `ALLOW_QA = { mcqAllowed: true, preferMcq: false }`, `BLOCK = { mcqAllowed: false, preferMcq: false }`, `MALFORMED = { mcqAllowed: false, preferMcq: true }`. Cases, each its own `it`, titles verbatim:
   1. `it('is a no-op without a hint', …)` — fast-check (`fc.assert(fc.property(...))`, ≥ 200 runs): an arbitrary deck of 0–12 cards with unique `OrderInDeck` in 1..2000, each card's `Mcq` one of absent / `MCQ_BLOB` / `{ v: 2 }` (garbage → `normalizeMcq` null) and `Revision` 1 or 2; per card a progress row from `{ fresh, due, later, updated }`; `mode` from the four; `avoidUid` = `null` or one of the deck's uids; `ownedSet` = `null` or a `Set` of a sub-array of the uids. For every sample, `pickNextCard(base)`, `pickNextCard({ ...base, kindHint: null })` and `pickNextCard({ ...base, kindHint: undefined })` are `toEqual` each other (three-way). This is D00 §3.7's required property.
   2. `it('keeps the due → updated → new bucket order under a hint', …)` — `mode: 'mixed'`, hint `ALLOW_PREFER`; deck = base + `qa(5)` with `due('q5')` + `qa(6)` with `Revision: 2` and `updated('q6')`: result is `q5`; with `q5`'s row changed to `later`: result is `q6`; with both `q5` and `q6` `later`: result is `m1540` (the preferred new card only once the due and updated buckets are empty). The same three calls with `BLOCK` return `q5`, `q6`, `q10` (due/updated never filtered).
   3. `it('keeps the owns guard under a hint', …)` — `mode: 'learn-new'`, hint `ALLOW_PREFER`, `ownedSet = new Set(['q10', 'm1550'])` → `m1550` (never the unowned `m1540` that sorts first); `ownedSet = new Set(['q20'])` → `q20` (fallback stays gated); `ownedSet = new Set()` → `null`. Plus a small property: for arbitrary `ownedSet` (sub-array of the base uids, or `null`), arbitrary hint (`fc.record({ mcqAllowed: fc.boolean(), preferMcq: fc.boolean() })`) and mode `learn-new` / `mixed`, the result is `null` or a card whose uid is in `ownedSet` (or any card when `ownedSet === null`).
   4. `it('never deals an MCQ new card when mcqAllowed is false', …)` — base deck, `BLOCK`: `learn-new` → `q10`, `mixed` → `q10`; with every Q/A row `later` (only MCQ new cards remain): `learn-new` → `null`, `mixed` → `null` (D00 §6 #5 — the run ends early, no fallback); `MALFORMED` gives the same four answers (resolution 2). Without a hint the second pair returns `m1540` (the pre-existing behaviour, asserted so the filter is visibly the hint's doing).
   5. `it('prefers an MCQ new card that sorts after every Q/A card', …)` — base deck, `ALLOW_PREFER`: `learn-new` → `m1540`, `mixed` → `m1540`; `avoidUid: 'm1540'` → `m1550`; with every MCQ row `later` → `q10` (fallback to the plain scan).
   6. `it('alternates back to Q/A and falls back to MCQ', …)` — base deck, `ALLOW_QA`: `learn-new` → `q10`, `mixed` → `q10`; with every Q/A row `later`: `learn-new` → `m1540`, `mixed` → `m1540` (allowed, merely not preferred).
   7. `it('ignores the hint in review-due and sweep', …)` — deck = base + `mcq(1)` with `due('m1')`: `review-due` with `BLOCK` → `m1` (a due MCQ card is dealt when due, never deferred); `review-due` with `ALLOW_PREFER` and `qa(2)` `due('q2')` added → `q2` (deck order, no preference in the due bucket); `sweep` with `BLOCK` and rows `m1` learned at `lastReviewedAt: TODAY_MS - 5000`, `q2` learned at `TODAY_MS - 1000` → `m1` (longest-unseen wins, kind ignored).
   8. `it('buildRatedSessionState forwards the hint', …)` — `current = { card: qa(10), progress: fresh('q10') }`, `progress` = the base rows, `rating: 'good'`, `mode: 'mixed'`, `sessionDone: 0`, `sessionLimit: 5`, `now: NOW`, `cardIndex: { cards: sortedCards, cardMap }`, `ownedSet: null`. With `kindHint: ALLOW_PREFER`: `vi.mocked(pickNextCard).mock.calls.at(-1)?.[0]` `toMatchObject({ kindHint: ALLOW_PREFER, avoidUid: 'q10', mode: 'mixed' })` and `state.nextCurrent?.card.StableUid` is `m1540`; `state.nextDone` is `1`. With no `kindHint` key: the forwarded arg has `kindHint: null` (resolution 1) and `nextCurrent` is `q20`. With `BLOCK` and every other Q/A row `later`: `nextCurrent` is `null` while the untouched fields (`updatedOne.stableUid === 'q10'`, `nextDone === 1`, `remainingDueCount === 0`) are unchanged.

Estimated size: mcqRotation.ts ~35 lines, sessionPlanner.ts +11 / −2 lines, sessionReviewHelpers.ts +4 / −1 lines, tests ~70 + ~230 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/D03.verify.sh` re-runs exactly these.

1. Scope files exist: `mobile/src/features/gacha/mcq/mcqRotation.ts`, `mobile/tests/unit/mcqRotation.test.ts`, `mobile/tests/unit/plannerKindHint.test.ts` (base fails here); the edited files exist; D01 and D02 have landed (`mobile/src/features/gacha/mcq/normalizeMcq.ts` exports `normalizeMcq(raw: unknown): McqExport | null`, `mobile/src/types/deckExport.ts` has `Mcq?: McqExport | null;`, `mobile/src/features/gacha/mcq/mcqVerdict.ts` exists).
2. Literal guards (all exit 0): `mcqRotation.ts` has the five signature lines of change 1 byte for byte, imports `isNewProgress` from `'../selectors/progressSelectors'`, and is pure (no react / require / storage / clock / randomness / `.Mcq`); `sessionPlanner.ts` has the two import lines, `kindHint?: McqKindHint | null;`, the exact destructuring line, the four load-bearing `pickNew` lines (`isMcq`, `if (!kindHint) return pickWith(isNew);`, the `mcqAllowed` filter line, `return preferred ?? pickWith(isNew);`), a `//` comment line naming `kindHint`, still the exact `owns` / `pickDue` / `pickUpdated` / `pickSweep` / four dispatch lines, no `featureFlags` / `getFeatureFlags` / `console.`, and no removed diff line mentions `pickWith = `, `const owns`, `pickDue`, `pickUpdated`, `pickSweep`, `if (avoidUid`, `mode === `; `sessionReviewHelpers.ts` has the import line, `kindHint?: McqKindHint | null;`, `kindHint = null` on the destructuring line, `kindHint,` inside the call, still `const nextDone = sessionDone + 1;` and `avoidUid: updatedOne.stableUid,`, and no removed diff line mentions `nextDone`, `scheduleNextReview`, `avoidUid`, `remaining`; both test files carry every `it('…'` title above (≥ 3 and ≥ 8 `it(` blocks), `plannerKindHint.test.ts` imports `fast-check`, calls `fc.assert(`, mocks the planner with `importOriginal` and reads `mock.calls`, and carries the plan §4.3 fixture (`'LEAST operational overhead'`, `OrderInDeck: 1540`); no `.skip(` / `.only(` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` in the new files or in any `+` line of the edited files; the seven existing planner / helper suites listed in Constraints are zero-diff against the base; `.Mcq` is referenced by exactly the four reader files.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit/mcqRotation.test.ts tests/unit/plannerKindHint.test.ts tests/unit/planner.test.ts tests/unit/ownedGatePredicates.test.ts tests/unit/sweepPlanner.test.ts tests/integration/session-card.screen.test.tsx tests/integration/challenge.screen.test.tsx --reporter=dot` — exit 0.
5. Scope + frozen + OTA guard: `git diff --quiet <merge-base> -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts` (all three zero-diff); zero diff on the do-not-touch neighbours (`storage.ts`, `chunkedInstall.ts`, `sessionBuilder.ts`, `sessionRoles.ts`, `sessionStore.ts`, `reviewContentHelpers.ts`, `progressSelectors.ts`, `contracts.ts`, `constants.ts`, `normalizeMcq.ts`, `mcqVerdict.ts`, `mcqShuffle.ts`, `mcqConstants.ts`, `deckExport.ts`, `featureFlags.ts`, `remoteConfig.ts`, `mobile/src/screens`, `navigation/types.ts`, `package.json`, `package-lock.json`, `app.json`, `eas.json`, `vitest.config.ts`, `tsconfig.json`, `tests/setup`); `"expo-updates": "~29.0.15"`, `"version": "1.6.0"` and `"vite": "7.2.4"` unchanged; no `@sentry` under `mobile/src`; every changed or untracked path under `mobile/src` / `mobile/tests` is one of the five scope files (or `docs/delivery/r16-issues/*`).

## Verify

```bash
BASE=delivery/r16-d-mcq bash docs/delivery/r16-issues/D03.verify.sh
```

Runs steps 1–5 above (≈ 1–2 min; `tsc` dominates; no network). The driver then runs the full mobile root gate — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan; all must be green, so do not leave any other suite red.

## Do NOT

- Do NOT touch `pickWith`, `owns`, `pickDue`, `pickUpdated`, `pickSweep` or the dispatch — the hint lives inside `pickNew` and nowhere else. Do NOT make `mcqAllowed: false` fall back to an MCQ card (D00 §6 #5). Do NOT let `preferMcq` filter.
- Do NOT read `getFeatureFlags()` / remote config anywhere in scope; do NOT put `served`, `lastNewKind`, `attemptIndex`, `kind` or any MCQ field on `CardProgress`, the session store or `buildRatedSessionState`'s return; do NOT change `nextDone`.
- Do NOT edit `SessionCardScreen.tsx` or wire the hint into any screen (D05); do NOT export `buildKindHint` / `noteServedCard` / `McqKindHint` from `sessionPlanner.ts` or `sessionReviewHelpers.ts` (D00 §6 #4 — the untouched screen suite factory-mocks both).
- Do NOT add a fourth source-file reader of `.Mcq` beyond the pinned `isMcq` line; do NOT call `resolveMcq` / `isMcqCard` from the planner (they need flags the planner must not have).
- Do NOT touch the frozen three (`deckRepository.ts`, `progressSync.ts`, `model.ts`), any file under `mcq/` other than the new `mcqRotation.ts`, `deckExport.ts`, `featureFlags.ts`, or any existing test file; do NOT loosen `tsconfig.json`; do NOT run `npm install`, `npm ci`, `eas …`, `npx expo …`.
- Do NOT paste MCQ text from anywhere except plan §4.3 card 1 as transcribed above.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
