# D02 — MCQ verdict mapping, seeded shuffle, constants (`mcq-verdict-shuffle`)

Three pure modules under `mobile/src/features/gacha/mcq/` and three unit suites, nothing else: `mcqVerdict.ts` (the 7-row verdict → rating mapping of plan §5.3, `resolveMcqVerdict`, `isFastResponse`, the pure ladder preview `describeScheduledRating`), `mcqShuffle.ts` (`mcqSeed` over the existing `fnv1a32Hex`, a deterministic Fisher–Yates driven by mulberry32, `shownOrderFor`) and `mcqConstants.ts` (fast budgets, letters, copy, testIDs, the coach-line storage key). No screen, no component, no planner change, no storage, no clock, no randomness beyond the seeded PRNG. The scheduler is consumed read-only: MCQ answers become one of the four existing ratings BEFORE `handleRating`, and `review/model.ts` stays byte-identical. Pure TS shipped in the 1.6.1 OTA on runtimeVersion 1.6.0.

## Context

What the tree looks like today (`delivery/r16-d-mcq` == `main@107e2a2` plus D01 merged; every line read on 2026-09-22):

- **D01 is the only prerequisite** (D00 §4). After it, `mobile/src/types/deckExport.ts` carries `McqOption { key; text; why; correct }` and `McqExport { v: 1; qualifier; shuffle; options }` (D00 §2.1; on the base the file ends at `Topic?: string | null;` `:25` and `}` `:26`, so both interfaces are D01's), and `mobile/src/features/gacha/mcq/normalizeMcq.ts` exports `mcqRequiredCount(mcq: McqExport): number` (count of `correct`, 1..3 on a normalised blob). `resolveMcqVerdict` takes an already-normalised `McqExport` and gets `N` from `mcqRequiredCount`; it never re-validates the blob and never reads `card.Mcq` (D00 §0: exactly three readers, none of them in this issue).
- **The ladder you preview, never re-implement** — `mobile/src/review/model.ts` (frozen, blob `ed210c33`, 225 lines): `ReviewRating` `:2`, `CardProgress` `:4-27` (`stage` `:6`, `hardStreak?` `:17`), `HARD_STREAK_TO_DEMOTE = 3` `:35` (module-private), `INTERVALS_DAYS = [1, 2, 4, 8, 15, 30, 60]` `:38` (module-private), `clampStage` `:58-61`, `scheduleNextReview(p, rating, now)` `:85-140`: `again` → `stage − 2` floored at 0, `+10 min` `:99-102`; `hard` → streak `+1`, demote one rung at 3 else stage unchanged, `max(1, round(INTERVALS_DAYS[stage] × 0.7))` days `:103-115`; `good` → `+1` rung `:116-118`; `easy` → `+2` `:119-122`; the result is a spread copy `:124-139`, so the input object is never mutated. `describeScheduledRating` calls this function and formats its `nextReviewAt` delta; the constants above are not copied into any Wave D file.
- **Where the mapped rating goes (all untouched, all consumed by D05):** `SessionCardScreen.tsx:429` `handleRating(rating: UiRating)`; the `reviewStage` rule `isLearned(current.progress) ? 'repeat_review' : 'first_review'` `:463` (`isLearned` `:73-75`), which `McqVerdictInput.reviewStage` mirrors; `progressSync.ts:224-237` `mapRatingToNumber` coerces any unknown string to `3` = good (`:236`), which is why `mapMcqVerdictToRating` may only ever return one of the four literals; `sessionStore.ts:60-64` sets `streakEarned` on `hard | good | easy`; `sessionRewards.ts:127` pays R1 on `rating !== 'again'`. Nothing in this issue imports any of those files.
- **The hash you reuse** — `mobile/src/features/gacha/library/topics.ts:14-21` `fnv1a32Hex(input: string): string` (FNV-1a 32-bit over UTF-16 code units, 8 lowercase hex digits; pinned by `tests/unit/libraryTopics.test.ts:97-98`: `fnv1a32Hex('') === '811c9dc5'`, `fnv1a32Hex('a') === 'e40c292c'`). `mcqSeed` is `parseInt(fnv1a32Hex(…), 16) >>> 0` and nothing else; D02 does not write a hash.
- **The PRNG you copy, not import** — `mobile/src/features/gacha/draw/poolSelection.ts:63-71` is a mulberry32 step (`rngState = (rngState + 0x6d2b79f5) >>> 0; … Math.imul(value ^ (value >>> 15), value | 1) … value | 61 … / 4294967296`) written as an inline closure inside `selectDrawCards`, not exported by design (D00 §0 do-not-touch; D00 cites the head of that closure as `:63-65`). `mcqShuffle.ts` carries its own module-private `mulberry32(seed)` with the same arithmetic so the two never drift apart in behaviour and neither file imports the other.
- **Flags exist and are not read here.** `mobile/src/config/featureFlags.ts:5-11` types `mcq { enabled; recallFirst; maxPerRun; answerTelemetry }`, defaults `:21-27`. D02 has no flag input; the kill switch is applied upstream by `resolveMcq` (D01) and the screen (D05).
- **Storage key precedent** — `mobile/src/features/gacha/draw/ceremonyPrefs.ts:12-13` (`CEREMONY_PREFS_KEY = 'recallsmith:ceremony:completed:v1'`, `CEREMONY_PREFS_READ_TIMEOUT_MS = 250`): device-global, no user scoping. `MCQ_COACH_SEEN_KEY` / `MCQ_COACH_READ_TIMEOUT_MS` follow it; D04's `mcqCoachPrefs.ts` re-exports them from `mcqConstants.ts`, so the literals live here.
- **Test infra** — vitest includes `tests/unit/**/*.spec.ts` as well as `*.test.ts` (`mobile/vitest.config.ts:9-18`, `.spec.ts` at `:12`), so the wave table's `mcqVerdict.spec.ts` name is discovered. `fast-check` `^4.9.0` (`mobile/package.json:66`, installed 4.9.0), imported as `import fc from 'fast-check'` (`tests/unit/cardRank.test.ts:2`). Dirty-input generator precedent: `tests/unit/scheduler.properties.test.ts:25-28` (`dirtyStageArb` mixes `fc.integer` with `fc.constantFrom(NaN, Infinity, -Infinity, -5, -1, 99, 6.7, 2.3)`). `tsc --noEmit` (`package.json:11`) typechecks `tests/` (`mobile/tsconfig.json` is `strict: true` with no `include`).

What D00 decided (binding; `docs/delivery/r16-issues/D00-contracts.md`): §0 (`:9-28`) non-negotiables (OTA-only, three frozen files, no scheduler change, the `.Mcq` reader rule, banned literals); §1.1 (`:36-62`) the D02 row — creates `mcqConstants.ts`, `mcqVerdict.ts`, `mcqShuffle.ts`, `tests/unit/mcqVerdict.spec.ts`, `tests/unit/mcqShuffle.test.ts`, `tests/unit/mcqConstants.test.ts` and edits nothing (`:76` records that the two extra test files are a deliberate deviation from the wave table); §2.2 (`:133-254`) every signature below, verbatim; §3.2 (`:440-444`) the required cases and `it` titles; §3.7 (`:478-480`) property tests required; §4 (`:484-495`) deps = **D01 only**, merge order D01 → D02 → D03; §5 (`:499-514`) verify conventions; §6 #15 (`:532`) the plan's stale line numbers.

Doc drift, stated so nobody re-derives it: plan §5.1 (`docs/mcq-card-type-plan-2026-09-18.md:280`) cites `SessionCardScreen.tsx:396` (tree `:429`), `progressSync.ts:133` (tree `:134`), `progressSync.ts:223-236` (tree `:224-237`) and `sessionStore.ts:54-58` (tree `:60-64`); plan §6.4 (`:349`) cites `poolSelection.ts:63` for the inline PRNG (tree `:63-71`); plan §6.5 (`:353`) writes the hard preview as "… the card stays where it is, back in 1 day" with a comma — D00 §2.2 pins the middle-dot form `Scheduled as Hard · the card stays where it is · back in 1 day`, and D00 wins. The wave table (`docs/delivery-wave-1.6-plan-2026-09-19.md:128`) lists only `tests/unit/mcqVerdict.spec.ts`; D00 §1.1 adds the shuffle and constants suites.

Gaps D00 leaves open — resolved here and binding for this issue:

1. **Unrecognised inputs fall to the cautious rating.** `mapMcqVerdictToRating` is typed on the three unions but must be total at runtime (D00 §2.2 "never throws"). A `verdict` that is neither `'correct'` nor `'partial'` → `'again'` (row 1); a `confidence` that is not `'sure'` → row 3 (`'hard'`); a `reviewStage` that is not `'repeat_review'` → row 4 (`'good'`); a `changedPick` that is not literally `false` counts as changed. Nothing that is not clearly earned unlocks `'easy'`.
2. **`resolveMcqVerdict` with a blob that has no correct option** (`mcqRequiredCount` < 1 — impossible after `normalizeMcq`, possible for a hand-built literal) → `'wrong'`. Without this rule `k === N` would hold at `0 === 0`.
3. **`resolveMcqVerdict` for `N === 1` reads `picks[0]` only**, exactly as D00 says; for `N ≥ 2` it counts the distinct picked keys that are correct (`k`). Duplicates and unknown keys are therefore inert: appending an unknown key to any pick list never changes the verdict, and the tests assert exactly that property.
4. **`mcqKindChip` outside 1..3**: `requiredCount >= 3` → `three`, `=== 2` → `two`, anything else (0, 1, NaN) → `single`.
5. **`isFastResponse` with an `optionCount` that is not `<= 4`** (5, 6, 7, `NaN`, `Infinity`) uses the 30 s budget; a non-finite or negative `responseMs` is never fast (D00). The budget is inclusive: 20 000 ms is fast with 4 options, 20 001 is not.
6. **The shuffle is pinned by literal values, not only by properties.** Two seeds that differ can still deal the same 4-option order (1 in 24; e.g. `mcqSeed('session-1', 'aws-sqs-order-buffer-mcq-01', 0)` and `(…, 1)` both deal `b, c, d, a`), so the shuffle suite asserts distinct SEEDS across `attemptIndex` and pins exact orders for the fixture below; it never asserts that adjacent attempts produce different orders. D05's redeal case must pick its fixture with this in mind.
7. **`describeScheduledRating`'s "stays" clause** compares `after.stage === before.stage` literally (D00). For a dirty `before.stage` (`99`, `NaN`) the scheduler clamps and the clause is simply omitted; the line is display-only and nothing downstream parses it.

## Read first

1. `docs/delivery/r16-issues/D00-contracts.md` §0 (`:9-28`), §1.1 (`:36-62`, the D02 column and the tests paragraph), §2.1 (`:82-131` — what D01 gives you), §2.2 (`:133-254` — your contract, verbatim), §3.2 (`:440-444`), §3.7 (`:478-480`), §4 (`:484-495`), §5 (`:499-514`), §6 #15 (`:532`).
2. `docs/mcq-card-type-plan-2026-09-18.md` §5.2 (`:282-289`), §5.3 (`:291-303` — the seven rows `:295-301`, the invariants `:303`), §5.4 (`:305-311`), §5.6 (`:317-319`), §6.4 (`:347-349`), §6.5 (`:351-353`), §6.6 (`:355-357`), §6.2 (`:339-341`); §4.3 (`:170-256`) for the two original cards whose option keys / correct sets are your fixtures.
3. `mobile/src/review/model.ts` (whole file, 225 lines — read-only; you import `scheduleNextReview` and two types).
4. `mobile/src/types/deckExport.ts` (whole file, after D01) and `mobile/src/features/gacha/mcq/normalizeMcq.ts` (after D01; you import `mcqRequiredCount`).
5. `mobile/src/features/gacha/library/topics.ts:12-21` (`fnv1a32Hex`) and `mobile/src/features/gacha/draw/poolSelection.ts:63-71` (the PRNG arithmetic you reproduce; do not edit or import that file).
6. `mobile/src/features/gacha/draw/ceremonyPrefs.ts:1-13` (key precedent) and `mobile/src/screens/SessionCardScreen.tsx:73-75`, `:454-467` (the `reviewStage` rule your input type mirrors; you do not edit the screen).
7. `mobile/tests/unit/scheduler.properties.test.ts:1-60` and `mobile/tests/unit/spillSchedule.test.ts:1-45` (fast-check style in this repo), `mobile/tests/unit/libraryTopics.test.ts:85-99` (`fnv1a32Hex` pins).
8. `docs/delivery/r16-issues/C07-topic-mobile.md` (format precedent) and `docs/delivery/r16-issues/D02.verify.sh` (what will be run against your worktree).

## Constraints

- **Scope (the ONLY files that may change):**
  `mobile/src/features/gacha/mcq/mcqConstants.ts` (new), `mobile/src/features/gacha/mcq/mcqVerdict.ts` (new), `mobile/src/features/gacha/mcq/mcqShuffle.ts` (new), `mobile/tests/unit/mcqVerdict.spec.ts` (new), `mobile/tests/unit/mcqShuffle.test.ts` (new), `mobile/tests/unit/mcqConstants.test.ts` (new). Nothing else — no edit to any existing file, including D01's `normalizeMcq.ts`, `deckExport.ts` and its tests.
- **Frozen files (gacha-v7 §2.1, narrowed by C00 §0; D00 §0):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` are zero-diff against the base (D01's two mapper lines are already on the base you branch from; D02 adds none). Also untouched: `mobile/src/review/storage.ts`, `mobile/src/content/chunkedInstall.ts`, `mobile/src/features/gacha/planner/*`, `mobile/src/features/gacha/session/*`, `mobile/src/features/gacha/rewards/*`, `mobile/src/features/gacha/components/*`, `mobile/src/features/gacha/draw/poolSelection.ts`, `mobile/src/features/gacha/draw/cardRarity.ts`, `mobile/src/features/gacha/contracts.ts`, `mobile/src/features/gacha/library/topics.ts`, `mobile/src/config/featureFlags.ts`, `mobile/src/config/remoteConfig.ts`, `mobile/src/screens/*`, `mobile/src/navigation/types.ts`, `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`.
- **OTA rule (D00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`; no new dependency, no native module, no `npm install`. `"expo-updates": "~29.0.15"`, `"vite": "7.2.4"` and `"version": "1.6.0"` stay as they are.
- **Purity (D00 §1.1 "pure"):** none of the three modules imports `react`, `react-native`, AsyncStorage or anything under `../../../sync`, `../../../content` or `../session`/`../planner`; no `Date.now`, no `Math.random`, no `require(`, no `setTimeout`. `mcqConstants.ts` has no import statement at all. `mcqVerdict.ts` imports exactly: `import type { ReviewRating, CardProgress } from '../../../review/model';`, `import { scheduleNextReview } from '../../../review/model';` (the `sessionPlanner.ts:2` / `:6` pattern), `import type { McqExport } from '../../../types/deckExport';`, `import { mcqRequiredCount } from './normalizeMcq';`, `import { MCQ_FAST_MS } from './mcqConstants';`. `mcqShuffle.ts` imports exactly: `import type { McqExport, McqOption } from '../../../types/deckExport';`, `import { fnv1a32Hex } from '../library/topics';`.
- **No ladder copy.** `mcqVerdict.ts` must not contain `1, 2, 4, 8, 15, 30, 60`, `0.7`, `HARD_STREAK` or a `10 * 60 * 1000` — the preview is `scheduleNextReview`'s output formatted, never a second scheduler. `mcqShuffle.ts` must not contain `0x811c9dc5` / `0x01000193` (that is `fnv1a32Hex`, imported) and must contain `0x6d2b79f5` (mulberry32, local).
- **`.Mcq` reader rule (D00 §0):** no file in this issue references `.Mcq`; `grep -rln '\.Mcq\b' mobile/src` still prints only `types/deckExport.ts`, `content/deckRepository.ts`, `features/gacha/mcq/normalizeMcq.ts`.
- **Copy and testIDs are pinned verbatim** (D00 §2.2): every `MCQ_COPY` value and every `MCQ_TEST_IDS` value below, character for character, including the em dash in `redeal` / `mcqPicksLine`, the middle dots in `faceMarkPick` / `detailChipPick` / `describeScheduledRating`, and the apostrophes in `dontKnow` / `coach`. Letters are assigned by DISPLAYED index (`mcqLetter(i)`), never by option `key`; `key` is the stable id used in testIDs, picks and the verdict.
- **Banned literals in any new line:** the six terms of B00 §0 (driver gate). Use "sidestep", "work around", "guard", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the six files. No `as any` outside the test files.
- **Existing tests:** no existing test file changes. `tests/unit/normalizeMcq.test.ts`, `tests/unit/deckRepositoryMcq.test.ts`, `tests/unit/deckRepositoryTopic.test.ts`, `tests/unit/scheduler.properties.test.ts`, `tests/unit/libraryTopics.test.ts`, `tests/unit/featureFlags.test.ts`, `tests/unit/cardRank.test.ts` must stay green untouched.
- **MCQ fixtures:** option keys and correct sets come from plan §4.3 card 1 (`a b c d`, correct `{b}`, `requiredCount 1`) and card 2 (`a b c d e`, correct `{a, c}`, `requiredCount 2`); the choose-3 fixture (`a b c d e f`, correct `{a, b, c}`) is synthetic because no live card requires three. Option `text` / `why` strings are either the §4.3 text or neutral placeholders such as `option a` / `why not a`; nothing from any other source. Fixtures are typed `McqExport` literals (already "normalised"); `normalizeMcq` is not called in these suites.
- Any explicit component return type is `React.JSX.Element` (or omitted), never `JSX.Element` (C00 §6 #23) — moot here, there are no components.
- Standing rules: no `git push`, no PR, never touch `main`, no EAS / expo / deploy command, no npm/git activity outside your worktree.

## Changes required

1. **`mobile/src/features/gacha/mcq/mcqConstants.ts` (new, pure, no imports)** — exactly these exports, values verbatim (D00 §2.2):
   ```ts
   export const MCQ_FAST_MS = Object.freeze({ upToFourOptions: 20_000, fiveOrSix: 30_000 });   // plan §5.2
   export const MCQ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;   // by DISPLAYED position, never by key
   export function mcqLetter(index: number): string { return MCQ_LETTERS[index] ?? '?'; }
   export const MCQ_COACH_SEEN_KEY = 'recallsmith:mcq:coach-seen:v1';   // device-global (ceremonyPrefs pattern), no user scoping
   export const MCQ_COACH_READ_TIMEOUT_MS = 250;
   export const MCQ_COPY = Object.freeze({
     kindChip: { single: 'Multiple choice', two: 'Choose 2', three: 'Choose 3' },
     stemHint: 'Decide on your answer before you look at the options.',
     showOptions: 'Show options',
     showFullStem: 'Show full question',
     sure: 'Sure',
     unsure: 'Not sure',
     dontKnow: "I don't know",
     confidenceHint: 'How confident are you?',
     overLimit: 'Deselect one first',
     bannerCorrect: 'Correct',
     bannerWrong: 'Not this time',
     rowCorrectPicked: 'Correct',
     rowCorrectMissed: 'You missed this one',
     rowWrongPicked: 'Your pick',
     rowWhyNot: 'Why not?',
     sectionExplanation: 'EXPLANATION',
     sectionQualifier: 'WHY THE QUALIFIER MATTERS',
     sectionUsage: 'REAL USAGE',
     sectionCode: 'CODING SAMPLE',
     next: 'Next',
     finishRun: 'Finish run',
     redeal: "Back again — let's see if it stuck",
     coach: "New card type. Decide first, then reveal the options. Sure / Not sure tells the scheduler how confident you were; I don't know skips the guess and shows the explanations.",
     coachDismiss: 'Got it',
     faceMark: 'MC',                                   // Library tile + DrawResult featured mark
     faceMarkPick: (n: number) => `MC · pick ${n}`,    // requiredCount ≥ 2
     detailChip: 'Multiple choice',
     detailChipPick: (n: number) => `Multiple choice · pick ${n}`,
   });
   export function mcqKindChip(requiredCount: number): string;          // >= 3 → three, === 2 → two, else single (gap #4)
   export function mcqSelectedCount(k: number, n: number): string;      // `${k} of ${n} selected`
   export function mcqBannerPartial(k: number, n: number): string;      // `You knew ${k} of ${n}`
   export function mcqQualifierBody(qualifier: string): string;         // `The stem asked for the ${qualifier} option. Several options would work; the one that best satisfies that phrase wins.`
   export function mcqOptionA11yLabel(index: number, total: number, text: string): string;   // `Option ${mcqLetter(index)} of ${total}: ${text}`
   export function mcqPicksLine(picks: { landed: number; answered: number }): string;
   //   landed === 0 → `0 of ${answered} picks landed — they're all back in 10 minutes`; else `${landed} of ${answered} picks landed`
   export const MCQ_TEST_IDS = Object.freeze({
     body: 'mcq-review-body', kindChip: 'mcq-kind-chip', stem: 'mcq-stem', qualifier: 'mcq-qualifier', stemHint: 'mcq-stem-hint',
     showFullStem: 'mcq-show-full-stem', option: (key: string) => `mcq-option-${key}`, optionLetter: (key: string) => `mcq-option-letter-${key}`,
     overLimitHint: 'mcq-over-limit-hint', verdictBanner: 'mcq-verdict-banner', scheduleLine: 'mcq-schedule-line',
     why: (key: string) => `mcq-why-${key}`, whyToggle: (key: string) => `mcq-why-toggle-${key}`,
     sectionExplanation: 'mcq-section-explanation', sectionQualifier: 'mcq-section-qualifier', sectionUsage: 'mcq-section-usage', sectionCode: 'mcq-section-code',
     redealBanner: 'mcq-redeal-banner',
     dock: 'review-rating-bar', dockHint: 'mcq-dock-hint', selectedCount: 'mcq-selected-count',
     showOptions: 'mcq-show-options', submitSure: 'mcq-submit-sure', submitUnsure: 'mcq-submit-unsure', dontKnow: 'mcq-dont-know', next: 'mcq-next',
     coachLine: 'mcq-coach-line', coachDismiss: 'mcq-coach-dismiss',
     summaryPicks: 'session-summary-picks',
     drawFeaturedKind: 'draw-result-featured-kind', cardDetailKind: 'card-detail-kind-chip', libraryKind: (uid: string) => `library-card-kind-${uid}`,
   });
   ```
   The six `function` lines are written out with bodies that do exactly what the trailing comment says; the verify greps each signature line with `-F`, every `MCQ_COPY` pair and every `MCQ_TEST_IDS` pair. No other export.

2. **`mobile/src/features/gacha/mcq/mcqVerdict.ts` (new, pure)** — the five import lines of Constraints, then exactly (D00 §2.2):
   ```ts
   export type McqVerdict = 'correct' | 'partial' | 'wrong';
   export type McqConfidence = 'sure' | 'unsure';
   export type McqReviewStage = 'first_review' | 'repeat_review';

   /** picks = option KEYS. [] → 'wrong' ("I don't know"). N = requiredCount(mcq), k = |picks ∩ correct keys|.
    *  N === 1: picks[0] correct → 'correct', else 'wrong'. N ≥ 2: k === N → 'correct'; k === N − 1 → 'partial'
    *  (exactly one wrong, plan §5.2/§5.4); else 'wrong'. Extra or unknown keys never make a verdict better. Pure. */
   export function resolveMcqVerdict(picks: readonly string[], mcq: McqExport): McqVerdict;

   /** responseMs ≤ MCQ_FAST_MS.upToFourOptions when optionCount ≤ 4, else ≤ MCQ_FAST_MS.fiveOrSix. A non-finite or
    *  negative responseMs is never fast. */
   export function isFastResponse(responseMs: number, optionCount: number): boolean;

   export type McqVerdictInput = {
     verdict: McqVerdict;
     confidence: McqConfidence;      // which submit button; "I don't know" passes 'unsure' (row 1 ignores it)
     changedPick: boolean;           // the submitted set differs from the FIRST complete set (§2.5)
     responseMs: number;             // options shown → submit (NOT dwellTimeMs)
     optionCount: number;            // shownOrder.length
     reviewStage: McqReviewStage;    // same rule as SessionCardScreen.tsx:463 (isLearned(current.progress))
     stage: number;                  // current.progress.stage BEFORE the rating
     hardStreak: number;             // current.progress.hardStreak ?? 0 BEFORE the rating
   };

   export function mapMcqVerdictToRating(input: McqVerdictInput): ReviewRating;

   export const RATING_LABEL: Readonly<Record<ReviewRating, 'Again' | 'Hard' | 'Good' | 'Easy'>> = Object.freeze({ again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' });

   export function describeScheduledRating(before: CardProgress, rating: ReviewRating, now: Date): { after: CardProgress; line: string };
   ```
   Bodies:
   - `resolveMcqVerdict`: `correct = new Set(keys of options with correct === true)`, `n = mcqRequiredCount(mcq)`; `picks.length === 0 || n < 1` → `'wrong'` (gap #2); `n === 1` → `correct.has(picks[0]) ? 'correct' : 'wrong'`; else `k = new Set(picks.filter((key) => correct.has(key))).size`; `k === n` → `'correct'`, `k === n - 1` → `'partial'`, else `'wrong'` (gap #3).
   - `isFastResponse`: `!Number.isFinite(responseMs) || responseMs < 0` → `false`; budget `optionCount <= 4 ? MCQ_FAST_MS.upToFourOptions : MCQ_FAST_MS.fiveOrSix`; `responseMs <= budget` (gap #5).
   - `mapMcqVerdictToRating`, top-down, first hit (plan §5.3 rows `:295-301`; keep this table in the doc comment):
     ```
     1 wrong                                                    → 'again'
     2 partial                                                  → 'hard'
     3 correct, unsure                                          → 'hard'
     4 correct, sure, first_review                              → 'good'
     5 correct, sure, repeat_review, (changedPick || !fast)     → 'good'
     6 correct, sure, repeat_review, !changedPick, fast, stage >= 1 && hardStreak === 0 → 'easy'
     7 correct, sure, repeat_review, !changedPick, fast, otherwise                     → 'good'
     ```
     with `fast = isFastResponse(input.responseMs, input.optionCount)`; an unrecognised `verdict` → `'again'`, an unrecognised `confidence` → `'hard'`, an unrecognised `reviewStage` → `'good'`, `changedPick !== false` → changed (gap #1). Comparisons on `stage` / `hardStreak` are plain `>=` / `===`, so `NaN` never reaches `'easy'`. Never throws; no `Date`, no clock.
   - `describeScheduledRating`: `after = scheduleNextReview(before, rating, now)`; `delta = after.nextReviewAt - now.getTime()`; `days = Math.round(delta / 86_400_000)`; `gap = delta < 3_600_000 ? '10 minutes' : `${days} day${days === 1 ? '' : 's'}``; `stays = rating === 'hard' && after.stage === before.stage ? ' · the card stays where it is' : ''`; `line = `Scheduled as ${RATING_LABEL[rating]}${stays} · back in ${gap}``. Returns `{ after, line }`; `before` is never mutated (the scheduler spreads). Worked values on the tree's ladder: again → `Scheduled as Again · back in 10 minutes`; hard on stage 2 with `hardStreak 0` → stage stays 2, `max(1, round(4 × 0.7)) = 3` → `Scheduled as Hard · the card stays where it is · back in 3 days`; hard on stage 0 → `Scheduled as Hard · the card stays where it is · back in 1 day`; hard on stage 2 with `hardStreak 2` → demoted to 1, `round(2 × 0.7) = 1` → `Scheduled as Hard · back in 1 day`; good on stage 0 → stage 1 → `Scheduled as Good · back in 2 days`; easy on stage 1 → stage 3 → `Scheduled as Easy · back in 8 days`; easy on stage 6 → stays 6 → `Scheduled as Easy · back in 60 days`.

3. **`mobile/src/features/gacha/mcq/mcqShuffle.ts` (new, pure)** — the two import lines of Constraints, a module-private `mulberry32`, then exactly (D00 §2.2):
   ```ts
   export function mcqSeed(sessionId: string, stableUid: string, attemptIndex: number): number;   // parseInt(fnv1a32Hex(`${sessionId}|${stableUid}|${attemptIndex}`), 16) >>> 0
   /** Deterministic Fisher–Yates over a copy, driven by mulberry32(seed). Same seed → same order; the result is a
    *  permutation of items; items is never mutated. */
   export function seededShuffle<T>(items: readonly T[], seed: number): T[];
   /** mcq.shuffle === false → [...mcq.options] (stored order); else seededShuffle(mcq.options, seed). */
   export function shownOrderFor(mcq: McqExport, seed: number): McqOption[];
   ```
   Bodies (the literal expectations in §5 of the shuffle suite pin this arithmetic, so follow it exactly):
   ```ts
   function mulberry32(seed: number): () => number {
     let state = seed >>> 0;                       // NaN / Infinity / negative / fractional seeds are coerced, never thrown on
     return () => {
       state = (state + 0x6d2b79f5) >>> 0;
       let t = state;
       t = Math.imul(t ^ (t >>> 15), t | 1);
       t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
       return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
     };
   }
   export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
     const out = [...items];
     const next = mulberry32(seed);
     for (let i = out.length - 1; i > 0; i -= 1) {
       const j = Math.floor(next() * (i + 1));
       const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
     }
     return out;
   }
   ```
   `mcqSeed` is the one-liner in its trailing comment (template with `|` separators, `parseInt(…, 16) >>> 0`). `shownOrderFor` returns a NEW array in both branches. Worked values (computed on the tree's `fnv1a32Hex` and the arithmetic above): `fnv1a32Hex('run-1|aws-sqs-order-buffer-mcq-01|0') === 'a8374309'` → `mcqSeed('run-1', 'aws-sqs-order-buffer-mcq-01', 0) === 2822193929`; attempt 1 → `'a7374176'` → `2805416310`; attempt 2 → `'a6373fe3'` → `2788638691`. `seededShuffle(['a', 'b', 'c', 'd'], 2822193929)` → `['c', 'd', 'b', 'a']`; `…, 2805416310)` → `['d', 'a', 'c', 'b']`; `…, 2788638691)` → `['b', 'a', 'd', 'c']`; `seededShuffle(['a', 'b', 'c', 'd', 'e'], 2822193929)` → `['e', 'c', 'd', 'b', 'a']`; `seededShuffle(['a', 'b', 'c', 'd'], 0)` → `['d', 'c', 'a', 'b']`; `seededShuffle(['a', 'b', 'c', 'd'], 1)` → `['d', 'b', 'a', 'c']`; `seededShuffle(['a', 'b', 'c', 'd'], NaN)` equals the seed-0 order; `seededShuffle([], 5)` → `[]`; `seededShuffle(['a'], 5)` → `['a']`.

4. **`mobile/tests/unit/mcqVerdict.spec.ts` (new)** — `import fc from 'fast-check'`; imports `resolveMcqVerdict`, `isFastResponse`, `mapMcqVerdictToRating`, `describeScheduledRating`, `RATING_LABEL` and the three types from `../../src/features/gacha/mcq/mcqVerdict`; `MCQ_FAST_MS` from `../../src/features/gacha/mcq/mcqConstants`; `scheduleNextReview` and `type CardProgress`, `type ReviewRating` from `../../src/review/model`; `type McqExport` from `../../src/types/deckExport`. Fixture helper `mcqOf(correct: readonly string[], keys: readonly string[] = ['a', 'b', 'c', 'd']): McqExport` building `{ v: 1, qualifier: null, shuffle: true, options: keys.map(key → { key, text: `option ${key}`, why: correct.includes(key) ? null : `why not ${key}`, correct: correct.includes(key) }) }`; `card1 = mcqOf(['b'])`, `card2 = mcqOf(['a', 'c'], ['a', 'b', 'c', 'd', 'e'])`, `card3 = mcqOf(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e', 'f'])`. Generators: `verdictArb = fc.constantFrom<McqVerdict>('correct', 'partial', 'wrong')`, `confidenceArb`, `stageNameArb` likewise; `responseArb = fc.oneof(fc.integer({ min: 0, max: 120_000 }), fc.constantFrom(NaN, Infinity, -Infinity, -1, 0, 20_000, 20_001, 30_000, 30_001))`; `optionCountArb = fc.oneof(fc.integer({ min: 3, max: 6 }), fc.constantFrom(NaN, 0, 7))`; `dirtyStageArb = fc.oneof(fc.integer({ min: 0, max: 6 }), fc.constantFrom(NaN, Infinity, -Infinity, -5, -1, 99, 2.3))`; `hardStreakArb = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constantFrom(NaN, -1, 2.5))`; `inputArb = fc.record({ verdict, confidence, changedPick: fc.boolean(), responseMs, optionCount, reviewStage, stage, hardStreak })`. `FOUR = ['again', 'hard', 'good', 'easy']`. Cases, each its own `it`, titles verbatim, every property through `fc.assert(fc.property(…))`:
   1. `it('wrong always maps to again', …)` — `{ ...input, verdict: 'wrong' }` → `'again'`.
   2. `it('partial always maps to hard', …)` — `{ ...input, verdict: 'partial' }` → `'hard'`.
   3. `it('unsure never reaches good or easy', …)` — `{ ...input, confidence: 'unsure' }` → `∈ ['again', 'hard']`.
   4. `it('first_review never reaches easy', …)` — `{ ...input, reviewStage: 'first_review' }` → `!== 'easy'`.
   5. `it('a changed pick never reaches easy', …)` — `{ ...input, changedPick: true }` → `!== 'easy'`.
   6. `it('a slow answer never reaches easy', …)` — whenever `!isFastResponse(input.responseMs, input.optionCount)` the output is `!== 'easy'` (use `fc.pre` or an early `return` inside the property).
   7. `it('is total and only ever answers one of the four ratings', …)` — for every `inputArb` value the call does not throw and returns one of `FOUR`; then the same with `verdict`, `confidence` and `reviewStage` replaced by `fc.string()` values (cast `as McqVerdict` etc.) and `changedPick` by `fc.anything()` (cast): still one of `FOUR`, still no throw; and the cautious fallbacks of gap #1: `verdict: 'nope'` → `'again'`, `confidence: 'nope'` with `verdict: 'correct'` → `'hard'`, `reviewStage: 'nope'` with `verdict: 'correct', confidence: 'sure'` → `'good'`.
   8. `it('reproduces the seven rows of plan §5.3', …)` — a literal table, one assertion per row (base input `{ verdict: 'correct', confidence: 'sure', changedPick: false, responseMs: 5_000, optionCount: 4, reviewStage: 'repeat_review', stage: 3, hardStreak: 0 }`): row 1 `verdict: 'wrong'` → `'again'`; row 2 `verdict: 'partial'` → `'hard'`; row 3 `confidence: 'unsure'` → `'hard'`; row 4 `reviewStage: 'first_review', stage: 0` → `'good'`; row 5 `changedPick: true` → `'good'` and separately `responseMs: 25_000` (slow with 4 options) → `'good'`, while `responseMs: 25_000, optionCount: 5` → `'easy'` (30 s budget); row 6 `stage: 1` → `'easy'`; row 7 `stage: 0` → `'good'` (the ten-minute redeal, plan §5.4) and `stage: 2, hardStreak: 1` → `'good'`.
   9. `it('resolves the verdict from the picked keys and ignores unknown keys', …)` — `card1`: `[]` → `'wrong'`, `['b']` → `'correct'`, `['a']` → `'wrong'`, `['b', 'z']` → `'correct'`, `['z']` → `'wrong'`; `card2`: `['a', 'c']` → `'correct'`, `['c', 'a']` → `'correct'`, `['a', 'b']` → `'partial'`, `['b', 'd']` → `'wrong'`, `['a']` → `'partial'`, `['a', 'a']` → `'partial'`; `card3`: `['a', 'b', 'c']` → `'correct'`, `['a', 'b', 'd']` → `'partial'`, `['a', 'd', 'e']` → `'wrong'`, `[]` → `'wrong'`; `mcqOf([])` (no correct option) with `['a']` → `'wrong'` (gap #2); property over `fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'z'), { maxLength: 6 })` × `fc.constantFrom(card1, card2, card3)`: `resolveMcqVerdict([...picks, 'z'], mcq) === resolveMcqVerdict(picks, mcq)`, the result is one of the three verdicts, and `mcq` is deep-equal to a pre-call `structuredClone` (gap #3).
   10. `it('calls an answer fast only inside the option-count budget', …)` — `isFastResponse(20_000, 4) === true`, `(20_001, 4) === false`, `(30_000, 5) === true`, `(30_001, 5) === false`, `(25_000, 6) === true`, `(25_000, 3) === false`, `(0, 4) === true`, `(-1, 4) === false`, `(NaN, 4) === false`, `(Infinity, 6) === false`, `(25_000, NaN) === true` (gap #5); `MCQ_FAST_MS` deep-equals `{ upToFourOptions: 20_000, fiveOrSix: 30_000 }`.
   11. `it('previews the ladder without touching the progress', …)` — `NOW = new Date(1_700_000_000_000)`, `p = (stage, extra?) => ({ stableUid: 'u', stage, nextReviewAt: 0, lastReviewedAt: 1, ...extra })`: `describeScheduledRating(p(3), 'again', NOW).line === 'Scheduled as Again · back in 10 minutes'`; `(p(2, { hardStreak: 0 }), 'hard')` → `'Scheduled as Hard · the card stays where it is · back in 3 days'` and `after.stage === 2`; `(p(0), 'hard')` → `'Scheduled as Hard · the card stays where it is · back in 1 day'`; `(p(2, { hardStreak: 2 }), 'hard')` → `'Scheduled as Hard · back in 1 day'` and `after.stage === 1`; `(p(0), 'good')` → `'Scheduled as Good · back in 2 days'` and `after.stage === 1`; `(p(1), 'easy')` → `'Scheduled as Easy · back in 8 days'` and `after.stage === 3`; `(p(6), 'easy')` → `'Scheduled as Easy · back in 60 days'`; `RATING_LABEL` deep-equals `{ again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }` and `Object.isFrozen(RATING_LABEL)`; property over `fc.constantFrom<ReviewRating>(...FOUR)` × `dirtyStageArb` × `hardStreakArb`: `after` deep-equals `scheduleNextReview(before, rating, NOW)`, `before` deep-equals its pre-call `structuredClone`, `line.startsWith(`Scheduled as ${RATING_LABEL[rating]}`)`, and `line` contains `' · back in '`.

5. **`mobile/tests/unit/mcqShuffle.test.ts` (new)** — `import fc from 'fast-check'`; imports `mcqSeed`, `seededShuffle`, `shownOrderFor` from `../../src/features/gacha/mcq/mcqShuffle`, `fnv1a32Hex` from `../../src/features/gacha/library/topics`, `type McqExport` from `../../src/types/deckExport`; `card1` as in the verdict suite (keys `a b c d`, correct `{b}`, `shuffle: true`). `seedArb = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.constantFrom(NaN, -1, 1.5, Infinity))`, `itemsArb = fc.array(fc.integer(), { maxLength: 12 })`. Titles verbatim:
   1. `it('returns a permutation and never mutates the input', …)` — property: `out = seededShuffle(items, seed)`: `out !== items`, `[...out].sort()` equals `[...items].sort()` (numeric comparator), `out.length === items.length`, `items` deep-equals its pre-call copy; also `seededShuffle(Object.freeze(['a', 'b', 'c']), 7)` does not throw; `seededShuffle([], 5)` → `[]`, `seededShuffle(['a'], 5)` → `['a']`.
   2. `it('is deterministic per seed and changes with attemptIndex', …)` — property: `seededShuffle(items, seed)` deep-equals a second call with the same arguments; `mcqSeed('run-1', 'aws-sqs-order-buffer-mcq-01', 0) === 2822193929`, `(…, 1) === 2805416310`, `(…, 2) === 2788638691` (three distinct values), each equal to `parseInt(fnv1a32Hex(`run-1|aws-sqs-order-buffer-mcq-01|${i}`), 16) >>> 0`; property over `fc.string()` × `fc.string()` × `fc.nat(50)`: `mcqSeed(s, u, i)` is a non-negative integer `<= 0xffffffff` and equals itself on a second call; the literal orders of Changes 3: `seededShuffle(['a', 'b', 'c', 'd'], 2822193929)` → `['c', 'd', 'b', 'a']`, `2805416310` → `['d', 'a', 'c', 'b']`, `2788638691` → `['b', 'a', 'd', 'c']`, `seededShuffle(['a', 'b', 'c', 'd', 'e'], 2822193929)` → `['e', 'c', 'd', 'b', 'a']`, seed `0` → `['d', 'c', 'a', 'b']`, seed `1` → `['d', 'b', 'a', 'c']`, seed `NaN` deep-equals seed `0`.
   3. `it('keeps stored order when shuffle is false', …)` — `shownOrderFor({ ...card1, shuffle: false }, 2822193929)` deep-equals `card1.options`, is `!== card1.options`, and its keys are `['a', 'b', 'c', 'd']`; `shownOrderFor(card1, 2822193929).map(key)` → `['c', 'd', 'b', 'a']` and deep-equals `seededShuffle(card1.options, 2822193929)`; property over `seedArb`: `shownOrderFor(card1, seed)` is a permutation of `card1.options` (same key multiset) and `card1.options` is untouched.

6. **`mobile/tests/unit/mcqConstants.test.ts` (new)** — imports everything it asserts from `../../src/features/gacha/mcq/mcqConstants`. Titles verbatim:
   1. `it('formats letters, chips, counts and the picks line', …)` — `[0, 1, 2, 3, 4, 5].map(mcqLetter)` → `['A', 'B', 'C', 'D', 'E', 'F']`, `mcqLetter(6) === '?'`, `mcqLetter(-1) === '?'`, `mcqLetter(NaN) === '?'`; `mcqKindChip(1) === 'Multiple choice'`, `(2) === 'Choose 2'`, `(3) === 'Choose 3'`, `(0) === 'Multiple choice'`, `(4) === 'Choose 3'` (gap #4); `mcqSelectedCount(1, 2) === '1 of 2 selected'`; `mcqBannerPartial(1, 2) === 'You knew 1 of 2'`; `mcqQualifierBody('MOST performant') === 'The stem asked for the MOST performant option. Several options would work; the one that best satisfies that phrase wins.'`; `mcqOptionA11yLabel(1, 4, 'x') === 'Option B of 4: x'`; `mcqPicksLine({ landed: 3, answered: 5 }) === '3 of 5 picks landed'`; `mcqPicksLine({ landed: 0, answered: 5 }) === "0 of 5 picks landed — they're all back in 10 minutes"`.
   2. `it('pins the storage key, the fast budgets, the copy and the testID shapes', …)` — `MCQ_COACH_SEEN_KEY === 'recallsmith:mcq:coach-seen:v1'`, `MCQ_COACH_READ_TIMEOUT_MS === 250`, `MCQ_FAST_MS` deep-equals `{ upToFourOptions: 20_000, fiveOrSix: 30_000 }`, `MCQ_LETTERS` deep-equals `['A', 'B', 'C', 'D', 'E', 'F']`; `Object.isFrozen(MCQ_COPY)`, `Object.isFrozen(MCQ_TEST_IDS)`, `Object.isFrozen(MCQ_FAST_MS)`; `MCQ_COPY.kindChip` deep-equals `{ single: 'Multiple choice', two: 'Choose 2', three: 'Choose 3' }`, `MCQ_COPY.redeal === "Back again — let's see if it stuck"`, `MCQ_COPY.dontKnow === "I don't know"`, `MCQ_COPY.faceMark === 'MC'`, `MCQ_COPY.faceMarkPick(2) === 'MC · pick 2'`, `MCQ_COPY.detailChipPick(3) === 'Multiple choice · pick 3'`, `MCQ_COPY.coach.startsWith('New card type.')`; `MCQ_TEST_IDS.dock === 'review-rating-bar'`, `MCQ_TEST_IDS.option('c') === 'mcq-option-c'`, `MCQ_TEST_IDS.optionLetter('c') === 'mcq-option-letter-c'`, `MCQ_TEST_IDS.why('b') === 'mcq-why-b'`, `MCQ_TEST_IDS.whyToggle('b') === 'mcq-why-toggle-b'`, `MCQ_TEST_IDS.libraryKind('u1') === 'library-card-kind-u1'`, `MCQ_TEST_IDS.summaryPicks === 'session-summary-picks'`, `MCQ_TEST_IDS.drawFeaturedKind === 'draw-result-featured-kind'`, `MCQ_TEST_IDS.cardDetailKind === 'card-detail-kind-chip'`.

Estimated size: mcqConstants ~75 lines, mcqVerdict ~90 lines, mcqShuffle ~40 lines, tests ~220 + ~80 + ~60 lines.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/D02.verify.sh` re-runs exactly these.

1. Scope files exist: the three modules and the three suites; D01 has landed (`mobile/src/features/gacha/mcq/normalizeMcq.ts` exists with `export function mcqRequiredCount(mcq: McqExport): number`, `mobile/src/types/deckExport.ts` has `export interface McqOption` and `export interface McqExport`, `mobile/tests/unit/normalizeMcq.test.ts` exists).
2. Literal guards (all exit 0): `mcqConstants.ts` has every signature line, every `MCQ_COPY` pair and every `MCQ_TEST_IDS` pair of Changes 1 and no `import`; `mcqVerdict.ts` has the three type lines, the `McqVerdictInput` fields, the four function signatures, the `RATING_LABEL` declaration and exactly the five import lines, and contains none of `1, 2, 4, 8, 15, 30, 60` / `0.7` / `HARD_STREAK` / `10 * 60 * 1000`; `mcqShuffle.ts` has the three signatures, the seed template `${sessionId}|${stableUid}|${attemptIndex}`, `0x6d2b79f5`, `from '../library/topics'`, and neither `0x811c9dc5` nor `poolSelection`; none of the three modules imports react / react-native / storage / clock / randomness; the three suites carry every `it('…'` title above (≥ 11, ≥ 3 and ≥ 2 `it(` blocks), the verdict and shuffle suites import `fast-check` and call `fc.assert(`, the verdict suite imports `scheduleNextReview` and asserts every worked `Scheduled as …` line, the shuffle suite asserts `2822193929` and `['c', 'd', 'b', 'a']`; no `.skip(`/`.only(`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable` in any of the six files; `.Mcq` is still read by exactly the three D00 files; the seven existing suites listed in Constraints are zero-diff against the base.
3. `cd mobile && npm run test:typecheck` — exit 0.
4. `cd mobile && npx vitest run tests/unit/mcqVerdict.spec.ts tests/unit/mcqShuffle.test.ts tests/unit/mcqConstants.test.ts tests/unit/normalizeMcq.test.ts tests/unit/scheduler.properties.test.ts tests/unit/libraryTopics.test.ts --reporter=dot` — exit 0.
5. Scope + frozen + OTA guard: `git diff --quiet <merge-base> -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts` (zero diff on all three); zero numstat on the do-not-touch list of Constraints and on `mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup`; `"expo-updates": "~29.0.15"`, `"version": "1.6.0"` and `"vite": "7.2.4"` unchanged; no `@sentry` under `mobile/src`; every changed or untracked path under `mobile/src` / `mobile/tests` is one of the six scope files (or `docs/delivery/r16-issues/*`).

## Verify

```bash
BASE=delivery/r16-d-mcq bash docs/delivery/r16-issues/D02.verify.sh
```

Runs steps 1–5 above (≈ 1–2 min; `tsc` dominates; no network). The driver then runs the full mobile root gate — `cd mobile && npm run test:typecheck && npx vitest run` — plus the diff-scoped banned-term grep and the suppression scan; all must be green, so do not leave any other suite red.

## Do NOT

- Do NOT touch `review/model.ts`, `progressSync.ts`, `deckRepository.ts`, `storage.ts`, `sessionStore.ts`, `sessionRewards.ts` or any screen — the mapping is a pure display-layer function and the ladder is consumed read-only.
- Do NOT copy `INTERVALS_DAYS`, `HARD_STREAK_TO_DEMOTE`, the `0.7` factor or the ten-minute constant into `mcqVerdict.ts`; `describeScheduledRating` formats `scheduleNextReview`'s result and nothing else.
- Do NOT add a fifth rating, a `verdict`/`confidence`/`picks`/`attemptIndex` field on `CardProgress` or any progress/event type, or return anything but `'again' | 'hard' | 'good' | 'easy'` from `mapMcqVerdictToRating`.
- Do NOT import `poolSelection.ts`, export `mulberry32`, use `Math.random`, or write a hash — `fnv1a32Hex` is imported from `topics.ts`.
- Do NOT read `card.Mcq`, feature flags or remote config; do NOT call `normalizeMcq` — `resolveMcqVerdict` takes an already-normalised blob and only `mcqRequiredCount` is imported from `normalizeMcq.ts`.
- Do NOT assign letters by option `key`; `mcqLetter(index)` is by displayed position only.
- Do NOT reword any `MCQ_COPY` string or `MCQ_TEST_IDS` value, or add / rename an export in any of the three modules (D03–D06 import them by these exact names).
- Do NOT edit any existing test; do NOT loosen `tsconfig.json`; do NOT run `npm install`, `npm ci`, `eas …`, `npx expo …`.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
