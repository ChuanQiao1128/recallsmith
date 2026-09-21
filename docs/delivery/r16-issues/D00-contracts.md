# D00 — Wave D shared contracts (`r16-d-mcq`)

The interface contract every Wave D brief (D01–D06) must follow verbatim so that six independently implemented issues assemble into ONE OTA on runtimeVersion 1.6.0 (published as 1.6.1) plus one console deploy. When a brief and this file disagree, this file wins; when this file and a plan doc (or the driver's task text) disagree, the resolution is recorded in §6 and this file wins. Base: `delivery/r16-d-mcq` (== `main@107e2a2`, which already holds Waves A–C and polish 1/2). Every line number below was read on that tree on 2026-09-22; the plan docs were written 2026-09-18/19 against an older tree and their line numbers are trusted only where this file repeats them.

Sources: `docs/delivery-wave-1.6-plan-2026-09-19.md:123-136` (Wave D: table `:127-132`, owner's post-wave list `:134`, owner-only list `:136`); `docs/mcq-card-type-plan-2026-09-18.md` §3.2 (`:76-92`), §3.8 (`:126-136`), §3.9 (`:138-146`), §4.3 (`:170-256`, fence `:172-254`, card 1 `:177-217`, card 2 `:218-253`), §4.5 warnings (`:266`), §5 (`:276-329`: inputs `:282-289`, table `:291-303` rows `:295-301`, invariants `:303`, redeal `:317-319`, interleave `:321-323`, events `:325-329`), §6 (`:331-369`: 6.1 `:333-337`, 6.2 `:339-341`, 6.3 `:343-345`, 6.4 `:347-349`, 6.5 `:351-353`, 6.6 `:355-357`, 6.7 `:359-361`, 6.8 `:363-369`), §8 kill switch (`:393`), §9 (`:403`, `:405`); `docs/economy-v2-learn-to-earn-2026-09-19.md:66` (the signed frozen-file exception); `docs/delivery/r16-issues/C00-contracts.md` §0 (`:9-22`), §2.9.1 (`:459-464`), §5 (`:727-741`), §6 #9 (`:757`), #23 (`:773`). Format precedent: `C07-topic-mobile.md`, `C07.verify.sh`, `B03.verify.sh`. The two survey files that fed this contract are scratch and not cited by any brief.

---

## 0. Non-negotiables

- **OTA-only on runtimeVersion 1.6.0.** No issue may change `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, or add/remove any native module or dependency. Pure TS + assets under `mobile/src` and `mobile/tests`; D06 additionally touches `frontend/src`, `frontend/tests`, `frontend/scripts`. Every mobile verify greps `"expo-updates": "~29.0.15"` (`mobile/package.json:43`), `"vite": "7.2.4"` (`:69`) and `"version": "1.6.0"` in `mobile/app.json`, and runs `git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json`. The defaults `flags.mcq.enabled=true` already ship in the 1.6.0 binary (`mobile/src/config/featureFlags.ts:23`) with no reader; D05 is what makes them observable, so the OTA moment is the real switch — the owner's post-wave list (`delivery-wave:134`) is where that is scheduled, not any brief.
- **Frozen files** (gacha-v7 §2.1, narrowed by C00 §0 to three): `mobile/src/content/deckRepository.ts` (blob `ab994b5a`, 1705 lines), `mobile/src/sync/progressSync.ts` (blob `495b2c83`, 1872 lines), `mobile/src/review/model.ts` (blob `ed210c33`, 225 lines). Wave D has exactly ONE signed exception (`economy-v2:66`, ticked: "两个 mapper 各加一行（`Topic`，之后 `Mcq`）"):
  **D01 — `deckRepository.ts`: exactly one added line per install mapper, two lines total, zero removed, zero imports.** Mapper 1 `mapRawDeckV1ToDeckExport` (`:1586-1645`, card literal `:1612-1626`), mapper 2 `mapRawDeckFlatToDeckExport` (`:1647-1705`, literal `:1672-1686`). The line is inserted immediately after the C07 Topic line (`:1621` and `:1681` on the base, each itself directly after `OrderInDeck: order,` at `:1620` / `:1680`) and before the blank line that precedes `Revision: revision,`, and reads, byte for byte (6-space indent):
  ```ts
        Mcq: typeof (c as any).mcq === 'object' && (c as any).mcq !== null ? (c as any).mcq : null,
  ```
  The cast is load-bearing (raw card types `:396-408` / `:419-431` have no `mcq` key; `mobile/tsconfig.json` is `strict: true`, so `c.mcq` is TS2339) and the line is deliberately a **pass-through, not a call to `normalizeMcq`**: `deckRepository.ts` imports only `:2-12` and a `normalizeMcq(...)` call would need a third added line (an import), which the signature and the driver's `2	0` numstat gate both forbid (§6 #1). Normalisation happens at the only read boundary (`resolveMcq` / `isMcqCard`, §2.1). After the edit the file is 1707 lines, the resulting card key order is `StableUid, Question, Explanation, CodeSnippet, CodeLanguage, RealWorldUsage, Difficulty, OrderInDeck, Topic, Mcq, Revision, Version, UpdatedAt`, and the C07 Topic line is still exactly twice in the file. Guard: `git diff --numstat "$MB" HEAD -- mobile/src/content/deckRepository.ts` prints `2	0	…`; `git diff -U0 … | grep '^+' | grep -v '^+++'` prints that line twice and nothing else; `grep -n -A1 -F "$TOPIC_LINE" | grep -c -F 'Mcq: typeof (c as any).mcq'` prints 2.
  Every other issue keeps `git diff --quiet "$MB" HEAD -- <the three files>`; `progressSync.ts` and `model.ts` are zero-diff in every issue including D01.
- **No scheduler / progress-model change.** MCQ answers map to the existing four ratings (`ReviewRating`, `model.ts:2`) through the pure `mapMcqVerdictToRating` (§2.2) BEFORE `handleRating`; `scheduleNextReview` (`model.ts:85-140`), `CardProgress` (`:4-27`), the `storage.ts` whitelist, `SCHEDULER_VERSION 'ladder-v1'` (`progressSync.ts:134`), `sessionStore.recordRating`'s streak rule (`sessionStore.ts:60-64`) and `settleRatingReward`'s R1 rule (`sessionRewards.ts:127`, pays on `rating !== 'again'`) are all consumed unchanged. No `attemptIndex`, `verdict`, `confidence`, `picks` or `kind` field on `CardProgress`, `SessionRatingRecord` or the session store; per-card MCQ state is screen state and refs (§2.5).
- **Rating events carry only the mapped rating.** The `recordReviewEvent({...})` call at `SessionCardScreen.tsx:454-467` is byte-identical after D05 (`rating`, `reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review'` `:463`, `dwellTimeMs: Math.max(0, nowMs - cardShownAtRef.current)` `:464`, `statedDifficulty`, `cardRevision`, `progressAfter`, `lastSeenRevision`). `mapRatingToNumber` (`progressSync.ts:224-237`) coerces any unknown string to 3 = good (`:236`), so `handleRating(rating: UiRating)` (`:429`, `UiRating = ReviewRating` `:65`) is the only entry and its parameter type is never widened. No new `eventType`, no `schemaVersion` bump, no `answer` payload (Phase 5, out of Wave D; `answerTelemetry` stays `false` and is never read). MCQ dwell spans three screens and is not comparable to Q/A dwell (plan §5.8) — nobody "fixes" that on the client.
- **Feature flags exist and are not edited.** `mobile/src/config/featureFlags.ts` (127 lines): `FeatureFlags.mcq { enabled; recallFirst; maxPerRun; answerTelemetry }` `:5-11`, defaults `enabled: true, recallFirst: true, maxPerRun: 2, answerTelemetry: false` `:22-27`, `getFeatureFlags()` `:53-55` (sync snapshot), `applyRemoteFeatures` `:63-116` (`maxPerRun` accepted only as an integer ≥ 0, `:84-87`), `useFeatureFlags` `:125-127`. `remoteConfig.ts:27-46` already types `features.mcq`; `forceUpdateGate.ts:45` is the only writer. Rule (`featureFlags.ts:57-62`): read a flag ONCE at the moment of use with `getFeatureFlags()`, never as live policy; `SessionCardScreen` reads it in the same batch that sets a card current (§2.5), so a config arriving mid-session never re-renders an open card. Nobody edits `featureFlags.ts`, `remoteConfig.ts`, `forceUpdateGate.ts` or `tests/unit/featureFlags.test.ts`.
- **Kill switch semantics (plan §8 `:393`).** `enabled === false` → every MCQ card renders and behaves as the Q/A card it already is on 1.5.0 (`ReviewBody` + `RatingBar`, no `Mcq*` component mounted, no kind hint to the planner, no `MC` marks on any face, no `'mcq'` capability token); `recallFirst === false` → the stem screen is skipped and the options screen is the first stage; `maxPerRun` → cap on MCQ cards dealt from the NEW bucket per run (`0` = none; due/updated buckets are never deferred); takes effect on the next cold start only.
- **Do-not-touch list** (beyond the three frozen files): `mobile/src/review/storage.ts`; `mobile/src/content/chunkedInstall.ts` (already pushes whole card objects, `:332`); `mobile/src/features/gacha/planner/sessionBuilder.ts` (route length stays `min(5, due + new)`, `SESSION_MAIN_ROUTE_DEFAULT = 5` at `constants.ts:7`); `mobile/src/features/gacha/session/sessionStore.ts`; `mobile/src/features/gacha/rewards/*`; `mobile/src/features/gacha/components/ReviewBody.tsx` and `RatingBar.tsx` (the MCQ components are siblings, §2.4); `mobile/src/features/gacha/draw/poolSelection.ts` (its PRNG is an inline closure `:63-65`, not reusable by design) and `cardRarity.ts` (rarity = difficulty, MCQ is d1–d3 by the console gate — nothing to do on the phone); `mobile/src/features/gacha/contracts.ts`; `mobile/src/features/gacha/library/LibraryHeader.tsx`, `libraryScreenStyles.ts`, `topics.ts`, `cardRank.ts`; `mobile/tests/setup/*`, `mobile/vitest.config.ts`, `mobile/tsconfig.json`; every existing test file except the four bounded edits listed in §1 and §3; Sentry (no `@sentry/*`, no `src/observability/`); `expo-updates` (never statically imported, C00 §6 #17); `frontend/src/lib/cardRules.ts` and `mcqRules.ts` (a warning code must NOT join `McqIssueCode` — `frontend/tests/deckImport.mcq.test.ts:522-524` pins `Record<McqIssueCode, CodeCase>`); `frontend/src/lib/deckImportRunner.ts`; `frontend/src/pages/` file set; `frontend/src/hooks/` barrel; `src_C/**`, `snowflake/**`; every top-level `docs/*.md` (briefs live under `docs/delivery/r16-issues/`, which `frontend/tests/docsPaths.test.ts:85-90` does not walk — no docsPaths churn in Wave D).
- **`card.Mcq` readers are an allow-list that grows twice.** The canonical three are `mobile/src/types/deckExport.ts`, `mobile/src/content/deckRepository.ts` and `mobile/src/features/gacha/mcq/normalizeMcq.ts` (the field is server-shaped and unvalidated until `normalizeMcq` has seen it). Two more files may spell `.Mcq`, each exactly once and only as the argument of `normalizeMcq(…)`: `mobile/src/features/gacha/planner/sessionPlanner.ts` (D03, the pinned `isMcq` line of §2.3 — the planner has no flags, so `resolveMcq` is not available to it) and `mobile/src/features/gacha/library/libraryMapper.ts` (D06, the pinned `isMcq:` row property of §2.6.1 — the mapper takes `mcqEnabled` as a value). Every other consumer goes through `resolveMcq(card, flags)` / `isMcqCard(card, flags)` and never spells `.Mcq`. Every mobile verify greps `grep -rln '\.Mcq\b' mobile/src` against the list that holds at its place in the queue: D01/D02 the three; D03/D04/D05 the three plus `sessionPlanner.ts`; D06 those four plus `libraryMapper.ts` (§6 #19).
- Banned in any added line under `mobile/src`, `mobile/tests`, `frontend/src`, `frontend/tests`, `frontend/scripts` and in every brief (driver grep, case-insensitive): the six terms of B00 §0, which this file deliberately does not spell out. Use "work around", "sidestep", "guard", "fallback", "probe". None of the five suppression tokens of C00 §0 (`:22`: the two TypeScript directive comments, the lint-directive comment, and the two vitest focus/skip calls) in any diff — and the pre-existing lint-directive comment at `SessionCardScreen.tsx:413` (the `react-hooks/exhaustive-deps` one, the only such comment in any Wave D scope file) must not be moved, re-indented or retyped, because a `+` line carrying it fails the driver's diff-scoped scan. Never copy ExamTopics / SAA-C03 dump content; the only MCQ text any brief, test or fixture may quote is plan §4.3 (`:177-253`, two original cards) or the live decks `content/decks/aws-saa-c03.md` / `claude-ccdv-f.md` (original; e.g. `aws-sqs-visibility-timeout-dlq` at `aws-saa-c03.md:42-63`, 4 options, `QUALIFIER: MOST performant`).
- Any explicit component return type is `React.JSX.Element` (or omitted), never `JSX.Element` (C00 §6 #23). `frontend/src/**` stays ASCII-only for CJK ranges (`frontend/tests/uiLanguage.test.ts:65-75` walks `src/`).

---

## 1. File map

"C" = creates, "E" = edits, "L" = the signed line-budget exception, "E(n	m)" = an edit whose numstat is pinned. A file with two owners is serialised in the order shown; the later issue rebases on the earlier one's merge. Paths are repo-relative.

### 1.1 mobile

| Path | D01 | D02 | D03 | D04 | D05 | D06 | order / note |
|---|---|---|---|---|---|---|---|
| `mobile/src/types/deckExport.ts` | E (`McqOption`, `McqExport`, `Mcq?`) | | | | | | literal guards, not a numstat (§6 #12) |
| `mobile/src/content/deckRepository.ts` | L (2 lines) | | | | | | frozen; §0 |
| `mobile/src/features/gacha/mcq/normalizeMcq.ts` | C | | | | | | pure |
| `mobile/src/features/gacha/mcq/mcqConstants.ts` | | C | | | | | pure |
| `mobile/src/features/gacha/mcq/mcqVerdict.ts` | | C | | | | | pure (imports `scheduleNextReview` from the frozen model, read-only) |
| `mobile/src/features/gacha/mcq/mcqShuffle.ts` | | C | | | | | pure |
| `mobile/src/features/gacha/mcq/mcqRotation.ts` | | | C | | | | pure |
| `mobile/src/features/gacha/planner/sessionPlanner.ts` | | | E (`kindHint` on `pickNextCard`) | | | | only D03 |
| `mobile/src/features/gacha/session/sessionReviewHelpers.ts` | | | E (`kindHint` pass-through) | | | | only D03 |
| `mobile/src/features/gacha/mcq/mcqCoachPrefs.ts` | | | | C | | | AsyncStorage, 250 ms budget |
| `mobile/src/features/gacha/components/McqReviewBody.tsx` | | | | C | | | |
| `mobile/src/features/gacha/components/McqActionDock.tsx` | | | | C | | | |
| `mobile/src/features/gacha/components/McqCoachLine.tsx` | | | | C | | | |
| `mobile/src/screens/SessionCardScreen.tsx` | | | | | E (§2.5) | | only D05 |
| `mobile/src/screens/SessionSummaryScreen.tsx` | | | | | E (`picks` line) | | only D05 |
| `mobile/src/navigation/types.ts` | | | | | E (`SessionSummary.picks?`) | E (`kind?`, `requiredCount?` on both draw card shapes) | D05 → D06 |
| `mobile/src/sync/clientCapabilities.ts` | | | | | E (`'mcq'` token, §2.5.4) | | not frozen |
| `mobile/src/features/gacha/draw/drawCommit.ts` | | | | | | E (`DrawnCardVm.tag/kind/requiredCount`) | |
| `mobile/src/screens/DrawResultScreen.tsx` | | | | | | E (featured kind mark) | |
| `mobile/src/screens/CardDetailScreen.tsx` | | | | | | E (hero chip) | |
| `mobile/src/features/gacha/library/libraryMapper.ts` | | | | | | E (`LibraryCardRow.isMcq`, `mcqEnabled?` param) | |
| `mobile/src/features/gacha/library/LibraryCardTile.tsx` | | | | | | E (`MC` mark) | |
| `mobile/src/screens/LibraryScreen.tsx` | | | | | | E (one param line + import) | |

Tests (mobile) — creates: D01 `tests/unit/normalizeMcq.test.ts`, `tests/unit/deckRepositoryMcq.test.ts`; D02 `tests/unit/mcqVerdict.spec.ts`, `tests/unit/mcqShuffle.test.ts`, `tests/unit/mcqConstants.test.ts`; D03 `tests/unit/mcqRotation.test.ts`, `tests/unit/plannerKindHint.test.ts`; D04 `tests/unit/mcqReviewBody.test.tsx`, `tests/unit/mcqActionDock.test.tsx`, `tests/unit/mcqCoachLine.test.tsx`, `tests/unit/mcqCoachPrefs.test.ts`; D05 `tests/integration/session-card-mcq.screen.test.tsx`, `tests/integration/session-summary-picks.screen.test.tsx`, `tests/unit/clientCapabilitiesMcq.test.ts`; D06 `tests/unit/drawCommitFaces.test.ts`, `tests/integration/draw-result-kind.screen.test.tsx`, `tests/integration/card-detail-kind.screen.test.tsx`, `tests/unit/libraryMcqMark.test.tsx`. Bounded edits to existing test files (the only ones in the wave): D01 `tests/unit/deckRepositoryTopic.test.ts` E(3	0); D05 `tests/unit/clientCapabilities.test.ts` (two `it` blocks retitled plus the kill-switch lines of the §3.5 allow-list); D06 `tests/unit/libraryTopics.test.ts` E(2	2) and `tests/unit/libraryCardTile.test.tsx` E(1	0) (§3.6). Every other existing test file is byte-identical in every issue.

### 1.2 console (`frontend`) — D06 only

| Path | D06 | note |
|---|---|---|
| `frontend/src/lib/mcqWarnings.ts` | C | pure; no import from `cardRules.ts` (`tests/cardRulesWiring.test.ts` pins its consumer set) |
| `frontend/src/lib/deckImport.ts` | E (`ParsedDeck.warnings`, computed after `:625`; `formatIssue` widened) | `planImport` (`:772-859`), `validateCards` (`:652-720`), `COMPARABLE_FIELDS`, `serializeDeckMarkdown` untouched |
| `frontend/src/pages/DeckImportPage.tsx` | E (amber panel below the error panel `:412-424`, outside the badge strip `:395-401`) | `blocked` (`:224-230`) untouched |
| `frontend/scripts/lint-deck.mts` | E (prints warnings; exit code ignores them) | |
| `frontend/tests/mcqWarnings.test.ts`, `frontend/tests/deckImportPageWarnings.test.tsx` | C | |

Existing frontend tests are byte-identical: `tests/deckImport.test.ts`, `deckImport.mcq.test.ts`, `deckImport.topic.test.ts`, `deckImportPageRun.test.tsx`, `deckImportPageSource.test.tsx`, `deckImportRunner.test.ts`, `cardMcqConsole.test.tsx`.

Deviations from the wave table (`delivery-wave:127-132`), all deliberate (reasons in §6): D01 edits `deckRepositoryTopic.test.ts` (#3); D02 adds `mcqConstants.test.ts` and `mcqShuffle.test.ts` beside the named `mcqVerdict.spec.ts`; D03 creates `mcq/mcqRotation.ts` (#4); D04 creates `mcq/mcqCoachPrefs.ts`; D05 edits `clientCapabilities.ts` (#8); D06 widens the console scope to `mcqWarnings.ts`, `DeckImportPage.tsx`, `lint-deck.mts` (#9) and edits `navigation/types.ts` and `LibraryScreen.tsx` (#10, #11). `describeMcqDiff` (plan `:405`) is dropped: not on the tree, no consumer (#13).

---

## 2. Exported APIs (signatures are verbatim contracts)

### 2.1 D01 — types, normaliser, mapper lines

`mobile/src/types/deckExport.ts` (`CardExport` `:15-26`, `Topic?: string | null;` `:25`, `}` `:26`; the file has no trailing newline, so `wc -l` prints 25). One line directly after `:25`, then two interfaces appended after `CardExport`'s closing brace:

```ts
  Mcq?: McqExport | null;       // C08/C09 cards.mcq. Server-shaped, unvalidated on this type: read only through normalizeMcq / resolveMcq / isMcqCard (D00 §0)
}

export interface McqOption { key: string; text: string; why: string | null; correct: boolean }
export interface McqExport { v: 1; qualifier: string | null; shuffle: boolean; options: McqOption[] }
```

The verify greps the exact text `Mcq?: McqExport | null;` as the line directly after `Topic?: string | null;`, and both interface lines with `-F`.

`mobile/src/features/gacha/mcq/normalizeMcq.ts` (pure: no react, no react-native, no storage, no clock, no randomness; the only imports are `type { CardExport, McqExport, McqOption } from '../../../types/deckExport'` and `type { FeatureFlags } from '../../../config/featureFlags'`):

```ts
export const MCQ_MIN_OPTIONS = 3;
export const MCQ_MAX_OPTIONS = 6;
export const MCQ_MAX_OPTION_TEXT = 600;   // chars after trim
export const MCQ_MAX_REQUIRED = 3;
export const MCQ_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export const QUALIFIER_IS_CHOOSE_N = /choose (two|three)/i;

/** Never throws. Any violation → null → the card renders as the Q/A card it already is on 1.5.0.
 *  Rules (C00 §2.9.1, plan §3.2) applied to the raw blob only — the stem is NOT consulted (§6 #2):
 *   - raw is a plain object (not null, not an array); raw.v === 1;
 *   - raw.options is an array of 3..6 plain objects; option i has key === MCQ_KEYS[i] (lowercase,
 *     consecutive from 'a', hence unique); text is a string, non-empty after trim, ≤ 600 chars after trim;
 *     correct is a boolean; why is a string, null or undefined (undefined and '' after trim → null);
 *   - requiredCount = count(correct) ∈ {1,2,3} and < options.length;
 *   - every correct === false option has a non-empty why (after trim);
 *   - qualifier: null/undefined/'' (after trim) → null; a string is trimmed; any other type → null blob;
 *     a non-null qualifier must not match QUALIFIER_IS_CHOOSE_N;
 *   - shuffle: boolean → itself; anything else (absent, null, 1, 'no') → true.
 *  Returns a NEW frozen object { v: 1, qualifier, shuffle, options: [{ key, text, why, correct }] } with
 *  trimmed strings; the input is never mutated. Idempotent: normalizeMcq(normalizeMcq(x)) deep-equals normalizeMcq(x). */
export function normalizeMcq(raw: unknown): McqExport | null;

/** count(correct) of a normalised blob; 1..3. */
export function mcqRequiredCount(mcq: McqExport): number;

/** flags.mcq.enabled === false → null (kill switch, §0); otherwise normalizeMcq(card.Mcq). Never throws. */
export function resolveMcq(card: Pick<CardExport, 'Mcq'>, flags: Pick<FeatureFlags, 'mcq'>): McqExport | null;

/** resolveMcq(card, flags) !== null — the plan's isMcqCard(card, flags). */
export function isMcqCard(card: Pick<CardExport, 'Mcq'>, flags: Pick<FeatureFlags, 'mcq'>): boolean;
```

Install path (unchanged by D01 beyond the two lines): validators check only `stableUid` per card (`deckRepository.ts:886`, `:907`, inside `:877-926`; `unknown_deck_shape` `:925`), `applyDelta` (`:1169-1200`) copies whole card objects (`:1174`, `:1187`, `:1193`), `isDeckDelta` (`:1158`) does not bump `schemaVersion`, and the chunked assembler pushes whole objects (`chunkedInstall.ts:332`). The raw server blob (PG key order `v, options[{key, why, text, correct}], shuffle, qualifier`; `qualifier: null` and `why: null` explicit; `mcq` absent on Q/A cards) therefore reaches disk untouched and `CardExport.Mcq` returns it verbatim — arrays and garbage objects included, which is why every consumer goes through `resolveMcq`.

### 2.2 D02 — `mcqConstants.ts`, `mcqVerdict.ts`, `mcqShuffle.ts` (all pure)

```ts
// mcqConstants.ts
export const MCQ_FAST_MS = Object.freeze({ upToFourOptions: 20_000, fiveOrSix: 30_000 });   // plan §5.2
export const MCQ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;   // by DISPLAYED position, never by key
export function mcqLetter(index: number): string;   // MCQ_LETTERS[index] ?? '?'
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
export function mcqKindChip(requiredCount: number): string;          // 1 → single, 2 → two, 3 → three
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

```ts
// mcqVerdict.ts
import type { ReviewRating, CardProgress } from '../../../review/model';
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

/** Plan §5.3, top-down, first hit (rows :295-301). Total: any finite or non-finite numbers, any combination.
 *  1 wrong                                                    → 'again'
 *  2 partial                                                  → 'hard'
 *  3 correct, unsure                                          → 'hard'
 *  4 correct, sure, first_review                              → 'good'
 *  5 correct, sure, repeat_review, (changedPick || !fast)     → 'good'
 *  6 correct, sure, repeat_review, !changedPick, fast, stage >= 1 && hardStreak === 0 → 'easy'
 *  7 correct, sure, repeat_review, !changedPick, fast, otherwise                     → 'good'
 *  Invariants (fast-check, §3.2): wrong ⇒ again; partial ⇒ hard; unsure ⇒ ∈ {again, hard}; first_review ⇒ ≠ easy;
 *  changedPick ⇒ ≠ easy; !fast ⇒ ≠ easy; output ∈ the four ratings; never throws. */
export function mapMcqVerdictToRating(input: McqVerdictInput): ReviewRating;

export const RATING_LABEL: Readonly<Record<ReviewRating, 'Again' | 'Hard' | 'Good' | 'Easy'>>;

/** Pure preview of the ladder: after = scheduleNextReview(before, rating, now) (model.ts:85, read-only import).
 *  line = `Scheduled as ${RATING_LABEL[rating]} · back in ${gap}` where gap = '10 minutes' when the delta is < 1 hour,
 *  else `${days} day${days === 1 ? '' : 's'}` with days = Math.round(delta / 86_400_000); rating === 'hard' && after.stage === before.stage
 *  inserts ' · the card stays where it is' before ' · back in'. Examples: 'Scheduled as Good · back in 2 days',
 *  'Scheduled as Hard · the card stays where it is · back in 1 day', 'Scheduled as Again · back in 10 minutes'. */
export function describeScheduledRating(before: CardProgress, rating: ReviewRating, now: Date): { after: CardProgress; line: string };
```

```ts
// mcqShuffle.ts
import { fnv1a32Hex } from '../library/topics';   // pure, already on the tree (topics.ts:14); D02 does not re-implement a hash
export function mcqSeed(sessionId: string, stableUid: string, attemptIndex: number): number;   // parseInt(fnv1a32Hex(`${sessionId}|${stableUid}|${attemptIndex}`), 16) >>> 0
/** Deterministic Fisher–Yates over a copy, driven by mulberry32(seed). Same seed → same order; the result is a
 *  permutation of items; items is never mutated. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[];
/** mcq.shuffle === false → [...mcq.options] (stored order); else seededShuffle(mcq.options, seed). */
export function shownOrderFor(mcq: McqExport, seed: number): McqOption[];
```

Letters are assigned by displayed index (`mcqLetter(i)`), never by `key`; `key` is the stable id for testIDs, picks and the verdict. The D04 components read their testIDs from `MCQ_TEST_IDS`; the screen-level entries (`dock`, `summaryPicks`, `drawFeaturedKind`, `cardDetailKind`, `libraryKind`) are catalogued here for the tests, while D05/D06 write the JSX attribute literally (`testID="review-rating-bar"`, `testID="session-summary-picks"`, `testID="draw-result-featured-kind"`, `testID="card-detail-kind-chip"`, `` testID={`library-card-kind-${item.stableUid}`} ``) because their verifies grep the attribute, not the constant.

### 2.3 D03 — planner `kindHint` + `mcqRotation.ts`

```ts
// mcq/mcqRotation.ts (pure; imports isNewProgress from '../selectors/progressSelectors' and type FeatureFlags)
export type McqKindHint = { mcqAllowed: boolean; preferMcq: boolean };
export type McqRunState = { served: number; lastNewKind: 'mcq' | 'qa' | null };   // served = MCQ cards set current this run, any bucket (plan §5.7 "本场已出 MCQ 数")
export const EMPTY_MCQ_RUN_STATE: McqRunState;   // frozen { served: 0, lastNewKind: null }
/** flags.mcq.enabled === false → null (no hint at all: the planner behaves exactly as today).
 *  Else { mcqAllowed: state.served < flags.mcq.maxPerRun, preferMcq: mcqAllowed && state.lastNewKind !== 'mcq' }. */
export function buildKindHint(state: McqRunState, flags: Pick<FeatureFlags, 'mcq'>): McqKindHint | null;
/** Returns a new state: served + (isMcq ? 1 : 0); lastNewKind = isMcq ? 'mcq' : 'qa' when isNewProgress(progress), else unchanged. */
export function noteServedCard(state: McqRunState, progress: CardProgress, isMcq: boolean): McqRunState;
```

`sessionPlanner.ts`: `pickNextCard` params (`:92-100`) gain ONE optional key `kindHint?: McqKindHint | null;` (`import type { McqKindHint } from '../mcq/mcqRotation'`; `import { normalizeMcq } from '../mcq/normalizeMcq'`). Only `pickNew` (`:143`) changes; `pickWith` (`:108-129`), `owns` (`:140`), `pickDue`/`pickUpdated` (`:141-142`), `pickSweep` (`:148-162`) and the dispatch (`:164-167`: sweep → sweep, review-due → due, learn-new → new, mixed → `pickDue() ?? pickUpdated() ?? pickNew()`) are byte-identical, so the bucket order and the `owns` guard hold by construction:

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

`mcqAllowed` is a filter (with `maxPerRun = 0` no MCQ card is ever dealt from the new bucket; if only MCQ new cards remain, `pickNew` returns `null` and the run ends on the route-complete card — accepted, §6 #5); `preferMcq` is an ordering with fallback. The hint is consulted in `mixed` and `learn-new` only; `review-due` and `sweep` never call `pickNew`, so due MCQ cards are dealt when due and a sweep is unaffected. The comment block at `:131-139` gains one sentence naming `kindHint` as the fourth pick that remembered `owns`.

`sessionReviewHelpers.ts`: `buildRatedSessionState` params (`:48-57`) gain `kindHint?: McqKindHint | null;` and forward it in the `pickNextCard` call (`:82-89`). Nothing else in the file changes (`nextDone = sessionDone + 1` `:75` stays verdict-blind — plan §5.5).

### 2.4 D04 — `McqReviewBody`, `McqActionDock`, `McqCoachLine`, `mcqCoachPrefs`

React-native import rule for all three components (and for every file D05 adds to `SessionCardScreen.tsx`'s import graph): `import { … } from 'react-native'` may name only `View`, `Text`, `ScrollView`, `Pressable`, `StyleSheet`, `Animated`, `ActivityIndicator`, `Alert`, `useWindowDimensions` — the exact export set of the factory mock at `mobile/tests/integration/session-card.screen.test.tsx:5-40`, which must keep passing untouched; vitest throws on a missing named export of a factory mock. `AccessibilityInfo` is read through the `import * as RN` + `readRN(key, fallback)` pattern (`HomeScreen.tsx:11`, `:48-57`) and announced as `AI?.announceForAccessibility?.(text)` (`DrawCeremonyScreen.tsx:523`); `Platform` is never imported; haptics go through `loadExpoHaptics()` from `mobile/src/components/ceremonyHaptics.ts:45` (guarded require; `notificationAsync(NotificationFeedbackType.Success | Warning | Error)`, `ExpoHapticsLike` `:27-33`), never a static `expo-haptics` import. `CodeBlock` (`mobile/src/components/CodeBlock.tsx`, mocked at `session-card.screen.test.tsx:63-69`) is reused for the CODING SAMPLE section. Section styles mirror `ReviewBody.tsx:376-394` (`sectionDivider`, `sectionHeader`, `sectionBody`) by copying, not importing (ReviewBody exports none).

```tsx
// McqReviewBody.tsx — sibling of ReviewBody (§6 #6), no faceUp/onFlip, no Hide, no RatingBar
export type McqStage = 'stem' | 'options' | 'verdict';
export type McqOptionRowState = 'idle' | 'selected' | 'correct-picked' | 'correct-missed' | 'wrong-picked' | 'wrong-unpicked';
export function rowStateFor(option: McqOption, picked: boolean, stage: McqStage): McqOptionRowState;   // exported for the tests
export type McqReviewBodyProps = {
  card: CardExport;
  mcq: McqExport;                      // already normalised (resolveMcq)
  rank?: number | null;                // same "#011" badge as ReviewBody (formatRank)
  stage: McqStage;
  shownOrder: readonly McqOption[];    // display order; letter = mcqLetter(index)
  picks: readonly string[];            // option keys in pick order
  verdict: McqVerdict | null;          // non-null only in 'verdict'
  scheduleLine: string | null;         // describeScheduledRating(...).line, non-null only in 'verdict'
  attemptIndex: number;                // ≥ 1 → redeal banner (MCQ_COPY.redeal, testID redealBanner)
  onToggleOption: (key: string) => void;
  onOverLimit?: () => void;            // multi-select tap beyond requiredCount (parent does the haptic)
};
```
Behaviour by stage: **stem** — header badges (rank/order + difficulty as ReviewBody `:138-150`), chip `mcqKindChip(requiredCount)` (testID kindChip), the FULL stem (testID stem, never clamped) with the qualifier in bold (nested `<Text testID="mcq-qualifier">` at the first case-insensitive occurrence; when `mcq.qualifier` is null or not found, bold every all-caps word of ≥ 4 letters instead — fallback, not a demotion), then `MCQ_COPY.stemHint` (testID stemHint). **options** — stem collapsed to `numberOfLines={3}` behind a `Pressable` `mcq-show-full-stem` (`MCQ_COPY.showFullStem`, toggles to full), then one `Pressable` per option in `shownOrder`: `testID=mcq-option-<key>`, `minHeight: 48`, letter disc (testID optionLetter), wrapping text (never clamped), `accessibilityRole={requiredCount === 1 ? 'radio' : 'checkbox'}`, `accessibilityState={{ checked: picked }}`, `accessibilityLabel={mcqOptionA11yLabel(index, shownOrder.length, text)}`; single-select: a tap selects and replaces; multi-select: a tap toggles, a tap beyond the limit is ignored, shows `MCQ_COPY.overLimit` (testID overLimitHint, transient) and calls `onOverLimit`. **verdict** — rows become static (`disabled`, `accessibilityState={{ checked, disabled: true }}`) with icon + text + colour, never colour alone: correct-picked ✓ `rowCorrectPicked`; correct-missed hollow ✓ `rowCorrectMissed`; wrong-picked ✗ `rowWrongPicked` with its WHY auto-expanded (testID why(key)); wrong-unpicked faded with a `Pressable` `mcq-why-toggle-<key>` (`rowWhyNot`) that expands the WHY; a correct option's `why` (null on every live card) renders nothing. Then the banner (testID verdictBanner: `bannerCorrect` / `mcqBannerPartial(k, N)` / `bannerWrong`) and `scheduleLine` (testID scheduleLine), then sections in this order with ReviewBody's section styling: EXPLANATION (`card.Explanation`, testID sectionExplanation), WHY THE QUALIFIER MATTERS (`mcqQualifierBody(qualifier)`, testID sectionQualifier, ONLY when `mcq.qualifier` is non-null — 13 live AWS cards have none), REAL USAGE (`card.RealWorldUsage` via `renderSimpleMarkdown`, testID sectionUsage, when present), CODING SAMPLE (`CodeBlock`, testID sectionCode, when `card.CodeSnippet`). Nothing in this component sets `allowFontScaling={false}` or `maxFontSizeMultiplier`; `numberOfLines` appears only on the collapsed options-stage stem, the letter disc, chips and the banner.

```tsx
// McqActionDock.tsx — rendered INSIDE the existing dock View (testID review-rating-dock) in place of RatingBar
export type McqActionDockProps = {
  testID?: string;                     // default 'review-rating-bar' (the untouched dock test finds a View with this testID)
  stage: McqStage;
  requiredCount: number;
  selectedCount: number;
  disabled?: boolean;                  // reviewing
  isLastNode: boolean;                 // 'Finish run' instead of 'Next'
  onShowOptions: () => void;
  onSubmit: (confidence: McqConfidence) => void;
  onDontKnow: () => void;
  onNext: () => void;
};
```
Root is a `View testID={testID}`. **stem**: one primary button `mcq-show-options` (`MCQ_COPY.showOptions`). **options**: hint Text (testID dockHint) = `MCQ_COPY.confidenceHint`; when `requiredCount > 1` a count Text (testID selectedCount) = `mcqSelectedCount(selectedCount, requiredCount)`; primary `mcq-submit-sure` (`Sure`) + secondary `mcq-submit-unsure` (`Not sure`), both `disabled` until `selectedCount === requiredCount`; text link `mcq-dont-know` (`I don't know`), always enabled. **verdict**: one primary button `mcq-next` (`Next` / `Finish run`). Every Pressable carries `accessibilityRole="button"`, `accessibilityState={{ disabled }}`, `minHeight ≥ 48`; the RatingBar's 4-up subtitle sizing constraint (`RatingBar.tsx:6-11`) does not apply — two buttons and a link have room.

```tsx
// McqCoachLine.tsx
export type McqCoachLineProps = { visible: boolean; onDismiss: () => void; testID?: string /* 'mcq-coach-line' */ };
// One dismissible line (MCQ_COPY.coach) with a `Pressable` testID 'mcq-coach-dismiss' (MCQ_COPY.coachDismiss, accessibilityRole="button"). Renders null when !visible.
```

```ts
// mcq/mcqCoachPrefs.ts — ceremonyPrefs.ts pattern (:1-13, :33): AsyncStorage only, device-global key, no user scoping, no module-level memo
export { MCQ_COACH_SEEN_KEY, MCQ_COACH_READ_TIMEOUT_MS } from './mcqConstants';
/** true when the key holds '1'; any error, garbage or a read slower than MCQ_COACH_READ_TIMEOUT_MS → true ("seen": nobody is ever stuck behind the line). */
export async function readMcqCoachSeen(): Promise<boolean>;
/** Writes '1'. Never throws. */
export async function markMcqCoachSeen(): Promise<void>;
```

### 2.5 D05 — `SessionCardScreen` state machine, `SessionSummary.picks`, capability token

#### 2.5.1 State (beside `showAnswer` `:121`; reset in the SAME batches as `setShowAnswer(false)` at `:222` (load) and `:535` (after a rating))

```ts
type McqCardState = {
  mcq: McqExport | null;               // resolveMcq(card, getFeatureFlags()) — null ⇒ renderAsMcq false
  stage: McqStage;                     // 'stem' when flags.mcq.recallFirst !== false, else 'options'
  shownOrder: McqOption[];             // shownOrderFor(mcq, mcqSeed(sessionId, StableUid, attemptIndex))
  picks: string[];
  firstPicks: string[] | null;         // the first COMPLETE set (length === requiredCount); set once
  changedPick: boolean;                // submitted set ≠ firstPicks (as sets)
  confidence: McqConfidence | null;
  verdict: McqVerdict | null;
  mappedRating: ReviewRating | null;
  scheduleLine: string | null;
  attemptIndex: number;
};
const EMPTY_MCQ_CARD_STATE: McqCardState;   // mcq null, stage 'stem', [], null, false, null, null, null, null, 0
const [mcqState, setMcqState] = useState<McqCardState>(EMPTY_MCQ_CARD_STATE);
const renderAsMcq = mcqState.mcq !== null;
// refs (never state): optionsShownAtRef (ms; set when stage becomes 'options'), submittedAtRef, attemptIndexRef: Map<string, number>
// (StableUid → attempts so far this run), mcqRunRef: McqRunState (EMPTY_MCQ_RUN_STATE), picksRef: { landed: number; answered: number },
// coachSeenRef: boolean | null (null = not read yet)
```

`applyCurrent(next: CurrentCardLike | null, sessionIdForSeed: string)` (the second parameter is D05 gap 2: `load()` passes the id it just handed to `startSession`, `handleRating` passes `useSessionStore.getState().sessionId ?? ''`) is the ONE helper that replaces the bare `setCurrent(...)` at `:382` and `:534`; it runs in the same synchronous batch as `setShowAnswer(false)`: `const flags = getFeatureFlags(); const mcq = next ? resolveMcq(next.card, flags) : null; const attemptIndex = next ? (attemptIndexRef.current.get(uid) ?? 0) : 0; attemptIndexRef.current.set(uid, attemptIndex + 1); mcqRunRef.current = next ? noteServedCard(mcqRunRef.current, next.progress, mcq !== null) : mcqRunRef.current; setCurrent(next); setMcqState(mcq ? { ...EMPTY, mcq, stage: flags.mcq.recallFirst !== false ? 'stem' : 'options', shownOrder: shownOrderFor(mcq, mcqSeed(sessionIdForSeed, uid, attemptIndex)), attemptIndex } : EMPTY_MCQ_CARD_STATE)`, and when the initial stage is `'options'`, `optionsShownAtRef.current = Date.now()`. A card re-dealt after `again` (in-run redeal, plan §5.6: `pickNextCard` honours `avoidUid` first, `sessionPlanner.ts:110`, `:118`) therefore gets `attemptIndex 1`, a fresh order and the redeal banner; an immediate same-uid redeal (only candidate) still bumps the index. `sessionIdForSeed` is the store's `sessionId` at the time `startSession` (`:373-378`) ran — the `load()` path reads it from the object it just built, not from the hook (which lags a render). `load()` (`:216`) resets `attemptIndexRef`, `mcqRunRef`, `picksRef`, `coachSeenRef` next to `:221-223`.

Kind hint: the `pickNextCard` call at `:364-372` and the `buildRatedSessionState` call at `:438-448` each gain `kindHint: buildKindHint(mcqRunRef.current, getFeatureFlags())` — nothing else about those calls changes (the untouched suite mocks both functions and ignores extra keys; D05 imports `buildKindHint` from `mcqRotation.ts`, NEVER a new name from `sessionPlanner.ts` or `sessionReviewHelpers.ts`, both of which are factory-mocked at `session-card.screen.test.tsx:118-131` and `:142-160` — a new named import from either throws in that suite).

#### 2.5.2 Handlers (three, plus the existing `handleRating` unchanged in signature and body except the two `applyCurrent` swaps and the `kindHint` key)

- `handleShowOptions()`: `stage === 'stem'` → `stage = 'options'`, `optionsShownAtRef.current = Date.now()`.
- `handleToggleOption(key)`: `stage === 'options' && !reviewing` only. Single: `picks = [key]`. Multi: toggle; ignore beyond `requiredCount`. When `picks.length === requiredCount` for the first time → `firstPicks = picks`. `changedPick` is recomputed on submit: `firstPicks !== null && !sameSet(picks, firstPicks)`.
- `handleSubmit(confidence)`: guards `stage === 'options'`, `picks.length === requiredCount`, `!reviewing`, `current && mcqState.mcq`. Computes `verdict = resolveMcqVerdict(picks, mcq)`, `responseMs = Date.now() - optionsShownAtRef.current`, `mappedRating = mapMcqVerdictToRating({ verdict, confidence, changedPick, responseMs, optionCount: shownOrder.length, reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review', stage: current.progress.stage, hardStreak: current.progress.hardStreak ?? 0 })` (the same `isLearned` the screen already has at `:73-75`), `scheduleLine = describeScheduledRating(current.progress, mappedRating, new Date()).line`; in ONE batch: `setMcqState({ ..., stage: 'verdict', confidence, verdict, mappedRating, scheduleLine, changedPick })` and `setShowAnswer(true)` (so every guard of `handleRating` `:430-433` keeps its meaning); then `submittedAtRef`, haptic (`Success` / `Warning` for partial / `Error`), `AI?.announceForAccessibility?.(`${banner}. ${scheduleLine}.`)`.
- `handleDontKnow()`: same as `handleSubmit` with `picks = []`, `confidence 'unsure'`, `verdict 'wrong'` → `mappedRating 'again'` (row 1), no `changedPick`.
- `handleMcqNext()`: `stage === 'verdict' && mappedRating` → `picksRef.current = { answered: answered + 1, landed: landed + (verdict !== 'wrong' ? 1 : 0) }`; if the coach line is visible, `void markMcqCoachSeen()`; then `void handleRating(mappedRating)` — which runs `:429-573` exactly as for Q/A: `buildRatedSessionState` (`:438`), `recordReviewEvent` (`:454-467`), `saveDeckProgress` (`:479`), `settleRatingReward` (`:480-489`, the mapped rating, so `again` never pays R1), `recordRewardStep` (`:490`), forecast (`:495-506`), trial (`:507-520`), `recordSessionRating` (`:521`, streak on hard/good/easy), `advanceSession` (`:522`), the `:532-535` batch (with `applyCurrent`), reminders, end-of-run navigation.

`SessionSummary` navigation (`:555-568`) gains, inside the object after the `loadForecast` spread (`:567`): `...(picksRef.current.answered > 0 ? { picks: picksRef.current } : {})`. The Settlement branch (`:541-553`) and the route-complete Continue navigations (`:743-758`) are untouched; `tests/integration/session-card.screen.test.tsx:296-308` pins the exact Q/A param shape (no `picks`), which the conditional spread preserves.

#### 2.5.3 Render

`ratingDockHeight` (`:672`) becomes `(renderAsMcq ? MCQ_DOCK_HEIGHT : 164) + Math.max(insets.bottom, 8)` with `MCQ_DOCK_HEIGHT` a screen-local constant (D05 picks it; ≥ 164 is not required). Inside the ScrollView (`:712-774`) the `ReviewBody` mount (`:767-772`) becomes `renderAsMcq ? <McqReviewBody card={current.card} mcq={mcqState.mcq} rank={…} stage={mcqState.stage} shownOrder={…} picks={…} verdict={…} scheduleLine={…} attemptIndex={…} onToggleOption={handleToggleOption} onOverLimit={…haptic Warning…} /> : <ReviewBody … unchanged … />`. The coach line renders directly above the dock (between `:774` and `:775`) when `renderAsMcq && coachSeen === false`, in all three stages; `coachSeenRef` is the once-per-session latch and last resolved value, mirrored into `const [coachSeen, setCoachSeen] = useState<boolean | null>(null)` because a ref write alone does not re-render (D05 gap 3); it is read once per session on the first MCQ card (`readMcqCoachSeen()`, fire-and-forget into that state). Inside the dock View (`:776-791`, testID `review-rating-dock` `:783` untouched) the `RatingBar` mount (`:785-790`) becomes `renderAsMcq ? <McqActionDock testID="review-rating-bar" stage={…} requiredCount={mcqRequiredCount(mcq)} selectedCount={picks.length} disabled={reviewing} isLastNode={sessionLimit > 0 && sessionDone + 1 >= sessionLimit} onShowOptions={handleShowOptions} onSubmit={handleSubmit} onDontKnow={handleDontKnow} onNext={handleMcqNext} /> : <RatingBar … unchanged … />`. The header (`:688-705`), `SessionProgressHeader` (`:706`), forecast line (`:707-711`), trial preview and route-complete card are untouched; no time estimate is added (plan §6.7).

#### 2.5.4 `SessionSummary.picks` and the capability token

`mobile/src/navigation/types.ts` — `SessionSummary` (`:191-204`) gains ONE optional field appended after `loadForecast?: string;` (`:203`): `picks?: { landed: number; answered: number };`. `SessionSummaryScreen.tsx`: `picks` joins the destructuring at `:46`; rendered as `<Text testID="session-summary-picks" numberOfLines={2} style={styles.forecastLine}>{mcqPicksLine(picks)}</Text>` directly under the `loadForecast` line (`:262-266`), only when `picks` is present. `buildSessionSummaryVM` (`:102-113`) and `summaryMapper.ts` are not edited; `tests/integration/session-summary.screen.test.tsx:112-122` passes no `picks` and stays green.

`mobile/src/sync/clientCapabilities.ts` (not frozen; its own comment `:14` reserves this): `getClientCapabilities()` (`:62-75`) computes `normalizeClientFeatures(getFeatureFlags().mcq.enabled ? [...CLIENT_FEATURES, 'mcq'] : CLIENT_FEATURES)` (`import { getFeatureFlags } from '../config/featureFlags'`; `CLIENT_FEATURES` `:15` stays `[]`, `MAX_CLIENT_FEATURES`, `normalizeClientFeatures` `:25`, the update-id cache and `resetClientCapabilitiesForTests` are unchanged). The push envelope (`progressSync.ts:1487`, `:1500-1501`) then carries `clientFeatures: ['mcq']` exactly when the flag is on, which is what C13's Snowflake `answer_mode` keys on (C00 §6 #9); with the kill switch off nothing is advertised and events read as `'qa'`, the honest label. `tests/unit/clientCapabilities.test.ts:92-105` pins the Wave C "no token" state; D05 retitles those two `it` blocks (§3.5) and adds `tests/unit/clientCapabilitiesMcq.test.ts`.

### 2.6 D06 — card faces (mobile) and the console warnings tier

#### 2.6.1 Faces

`mobile/src/features/gacha/draw/drawCommit.ts` — `DrawnCardVm` (`:13-20`) gains three optional fields appended after `rank`: `tag?: string;` (the deck's topic label, `normalizeTopic(card.Topic)` — the slot `DrawResultScreen.tsx` already reads through `cardTagText` `:87-89` and names "topic label" at `:470`; §6 #10), `kind?: 'mcq';` and `requiredCount?: number;` (both present only when `resolveMcq(card, flags)` is non-null). The literal at `:98-104` sets them through conditional spreads — `...(tag !== null ? { tag } : {})` and `...(mcq !== null ? { kind: 'mcq' as const, requiredCount: mcqRequiredCount(mcq) } : {})` — so an absent value is an absent KEY, never a key holding `undefined` (§3.6 "no `tag` key when `Topic` is null"; D06 gap 1); `getFeatureFlags` is read once inside `commitDraw`, before the map. `mobile/src/navigation/types.ts` — both draw card shapes (`DrawCeremony` `:87-95`, `DrawResult` `:116-124`) gain `kind?: 'mcq'; requiredCount?: number;` after `rank?`. No test pins `DrawnCardVm`'s key set (`draw.screen.test.tsx:269` uses `expect.any(Array)`).

`DrawResultScreen.tsx` — featured card only: a small mark `<View testID="draw-result-featured-kind">` with text `MCQ_COPY.faceMarkPick(n)` (n ≥ 2) or `MCQ_COPY.faceMark`, placed in the art window (`:515-543`) beside the rarity chip (`:531-535`), rendered only when `featured.kind === 'mcq'`; the topic chip (`:536-541`, testID `draw-result-featured-topic`) keeps showing `tag`; the question slab (`:548-555`, `FEATURED_STEM_LINES = 6` `:131`) and serial (`:563`) are untouched; grid rows (`:706-712`) are untouched. Options, keys, answers never appear on any face.

`CardDetailScreen.tsx` — in the hero top bar (`:219-243`, between the rarity chip and the status chip) a chip `testID="card-detail-kind-chip"` with `MCQ_COPY.detailChipPick(n)` / `MCQ_COPY.detailChip`, rendered only when `!isLocked && isMcqCard(card, getFeatureFlags())` (`n = mcqRequiredCount(resolveMcq(card, flags)!)`). The dead `tag` fallback (`:186`) is left alone. No options, WHY or answer text is rendered anywhere on this screen (plan §6.8: reading the answer before the session would turn the item into a review).

`libraryMapper.ts` — `LibraryCardRow` (`:22-57`) gains `isMcq: boolean;` appended after `rank` (`:56`); `buildLibraryCardRows` (`:119-126`) and `buildLibraryVM` (`:189-200`) gain `mcqEnabled?: boolean` (default `true`); the row literal (tail `:178-185`, `topic:` `:183`, `rank:` `:184`) sets `isMcq: mcqEnabled && normalizeMcq(card.Mcq) !== null` after `rank`. `LibraryScreen.tsx` passes `mcqEnabled: getFeatureFlags().mcq.enabled` in the `buildLibraryVM` call (`:167-176`) — one added key plus the import; nothing else in the screen. `LibraryCardTile.tsx` — in the non-missing body (`:103-110`) a `Text testID={`library-card-kind-${item.stableUid}`}` reading `MCQ_COPY.faceMark` next to the icon (`:104-106`), only when `item.isMcq`; the question keeps `numberOfLines={2}` (`:107`); the hidden status probe (`:115-123`) is untouched. Pinned key-order tests: `tests/unit/libraryTopics.test.ts:234-235` (`toBe(14)` → `toBe(15)`; `slice(-3)…['isUpdated', 'topic', 'rank']` → `slice(-4)…['isUpdated', 'topic', 'rank', 'isMcq']`, numstat `2	2`) and `tests/unit/libraryCardTile.test.tsx:40-57` `baseRow` (gains `isMcq: false,` after `topic: null,`, numstat `1	0`).

#### 2.6.2 Console warnings tier (non-blocking, separate array — never inside `errors`)

```ts
// frontend/src/lib/mcqWarnings.ts (pure; imports only type { McqBlob } from '../types/mcq')
export type McqWarningCode =
  | 'MCQ_WARN_CORRECT_LONGEST'     // some correct option's trimmed length ≥ 1.4 × median trimmed length of the WRONG options (one warning per card)
  | 'MCQ_WARN_WHY_SHORT'           // any non-null why < 40 chars after trim (one per option)
  | 'MCQ_WARN_STEM_LONG'           // question > 120 words (split on /\s+/)
  | 'MCQ_WARN_FIRST_SENTENCE_LONG' // first sentence of the question (up to the first [.?!] followed by whitespace or end) > 140 chars
  | 'MCQ_WARN_SHAPE'               // (requiredCount, options.length) not in {(1,4), (2,5), (3,6)}
  | 'MCQ_WARN_NO_USAGE';           // realWorldUsage null / empty
export interface ImportWarning { code: McqWarningCode; severity: 'warning'; line: number; message: string; stableUid: string }
export function warnMcq(card: { question: string; realWorldUsage: string | null; mcq: McqBlob }): Array<{ code: McqWarningCode; message: string }>;
export function formatWarning(w: Pick<ImportWarning, 'line' | 'message'>): string;   // `line ${line}: ${message}` (same shape as formatIssue)
```

`frontend/src/lib/deckImport.ts`: `ParsedDeck` (`:93-98`) gains `warnings: ImportWarning[];` (required — no code constructs a `ParsedDeck` literal: `DeckImportPage.tsx:22`, `:42` and the tests only consume it; `planImport` takes `Pick<ParsedDeck, 'cards'>` `:773`). `parseDeckMarkdown` (`:242-628`) computes them after `errors.push(...validateCards(cards))` (`:625`) for every card with `mcq`, each re-tagged `line: card.sourceLine` like the MCQ issues at `:707-716`, sorted by `line` then code, and returns `{ deckSlug, cards, errors: sortIssues(errors), warnings }` (`:627`). `formatIssue` (`:908-910`) takes `Pick<ImportIssue, 'line' | 'message'>`. The comment at `:704-706` ("There is no warning tier in Wave C") is rewritten to point at `mcqWarnings.ts`. `validateCards`, `planImport`, `COMPARABLE_FIELDS`, `fieldsThatDiffer`, `serializeDeckMarkdown` and `deckImportRunner.ts` are untouched — warnings never reach the plan, the runner or `blocked`.

`frontend/src/pages/DeckImportPage.tsx`: an amber panel `<div data-testid="import-warnings">` rendered directly BELOW the error panel (`:412-424`) and OUTSIDE the badge strip (`:395-401`, exactly five `<Badge>` children — `tests/deckImportPageRun.test.tsx:221-226` reads every child of that div and `:289-295`, `:398-404` assert the 5-element array, `:376` indexes `[4]`), heading `${n} suggestion${n === 1 ? '' : 's'} — not blocking`, then the warnings grouped by code (`<ul>` per code with a count in the group heading, items via `formatWarning`), only when `preview.parsed.warnings.length > 0`. `blocked` (`:224-230`) and the "N problem(s) in the document" heading (`:415-416`, pinned by `deckImportPageRun.test.tsx:374`, `:387`) are untouched; no new table column (`rowSummaries()` `:229-234` reads cells `[0]`, `[1]`, `[4]`).

`frontend/scripts/lint-deck.mts`: after the issue lines (`:121-125`) print each warning as `${line}: WARN ${code} ${message}` and the summary as `${cards} cards, ${mcq} mcq, ${issues} issues, ${warnings} warnings`; the exit code still depends on issues only (`:127`); an optional `--strict` flag makes warnings fail. On the live decks the plan's thresholds fire on ~74 % / ~70 % of MCQ cards for `MCQ_WARN_CORRECT_LONGEST` and ~35 % for `MCQ_WARN_FIRST_SENTENCE_LONG` (0 for the other four) — that is a content finding for the owner, not a threshold bug, so the thresholds stay the plan's numbers and "zero warnings on re-import" is NOT a gate anywhere (§6 #14).

---

## 3. Test contracts

Conventions: vitest discovers `tests/{unit,integration}/**/*.{test,spec}.{ts,tsx}` (`mobile/vitest.config.ts`); `fast-check` is `import fc from 'fast-check'` (`tests/unit/cardRank.test.ts:2`; `mobile/package.json:66`); `tsc --noEmit` typechecks `tests/` (`npm run test:typecheck`). Every `it('…'` title below is grepped `-F` by the issue's verify.

### 3.1 D01

- `tests/unit/normalizeMcq.test.ts` — property: `mcqArb` (3–6 options, keys a–f in order, 1–3 correct and < count, non-empty text ≤ 600, wrong options with why, optional qualifier not matching choose-N, optional shuffle) ⇒ non-null, idempotent, frozen, input untouched, `mcqRequiredCount` equals the correct count; one mutation per rule ⇒ null (v 2; 2 options; 7 options; key 'b' first; duplicate key; empty text; 601-char text; `correct: 'yes'`; 0 correct; all correct; 4 correct of 6; wrong option with `why: ''`; `qualifier: 'Choose two'`; `qualifier: 7`); `shuffle` absent/`null`/`'no'` → `true`, `false` → `false`; junk (`null`, `[]`, `'x'`, `7`, `{ v: 1, options: 'a' }`, a Proxy that throws on access) never throws; `resolveMcq`/`isMcqCard` with `{ mcq: { enabled: false } }` → null/false for a valid blob, with defaults → the blob / true, with `Mcq` absent → null / false. Titles: `'normalises the plan §4.3 cards and is idempotent'`, `'returns null for every single-rule violation'`, `'never throws on junk'`, `'defaults shuffle to true and honours false'`, `'isMcqCard is false under the kill switch and for a card without Mcq'`.
- `tests/unit/deckRepositoryMcq.test.ts` — the C07 harness (`tests/unit/deckRepositoryTopic.test.ts:20-129`: hoisted env, Map-backed AsyncStorage, `expo-file-system/legacy`, `expo-crypto`, `aws-amplify/auth`, `premiumStore` mocks, `loadRepo()` with `vi.resetModules()` `:76-77`, `seed()` `:110`, keys `:81-82`), through `resolveDeckBySlug`: flat and v1 files whose card carries the PG-ordered blob of plan §4.3 card 1 → `Cards[0].Mcq` deep-equals the raw blob with the same key order and `normalizeMcq` of it is non-null; `mcq` absent / `null` / `7` / `'x'` → `Mcq: null`; `mcq: []` and `mcq: { v: 2 }` → passed through as-is and `normalizeMcq` → null; `Object.keys(Cards[0])` is the 13-key order of §0; a chunked install (`installDeckFromChunkedPackage`, harness of `tests/unit/chunkedInstall.test.ts`) writes the blob verbatim into the flat file. Titles: `'passes a server mcq blob through both mappers untouched'`, `'maps absent and non-object mcq to null and keeps the card key order'`, `'lets a garbage blob survive install and normalise to null'`, `'keeps mcq through a chunked install'`.
- `tests/unit/deckRepositoryTopic.test.ts` — E(3	0): `'Mcq',` after each `'Topic',` (`:187`, `:224`) and `Mcq: null,` after `Topic: null,` (`:201`). Nothing else; the four `it` titles at `:132`, `:152`, `:166`, `:231` stay.

### 3.2 D02

- `tests/unit/mcqVerdict.spec.ts` — the seven invariants of §2.2 as `fc.assert` properties over `fc.record` inputs including non-finite `responseMs`, negative `stage`, `NaN` `hardStreak`; a 7-row table test reproducing plan §5.3 rows 1–7 verbatim; `resolveMcqVerdict`: `[]` → wrong; single correct/wrong; choose-2 with k = 2 / 1 / 0; choose-3 with k = 3 / 2 / 1; unknown keys ignored; `isFastResponse` at 20 000 / 20 001 with 4 options and 30 000 / 30 001 with 5; `describeScheduledRating` (`INTERVALS_DAYS = [1, 2, 4, 8, 15, 30, 60]` at `model.ts:38`, `HARD_STREAK_TO_DEMOTE = 3` at `:35`): again → `'Scheduled as Again · back in 10 minutes'`; hard on a stage-2 card with `hardStreak 0` → stage stays 2, `max(1, round(4 × 0.7)) = 3` → `'Scheduled as Hard · the card stays where it is · back in 3 days'`; good on stage 0 → stage 1 → `'Scheduled as Good · back in 2 days'`; easy on stage 1 → stage 3 → `'Scheduled as Easy · back in 8 days'`. Titles: `'wrong always maps to again'`, `'partial always maps to hard'`, `'unsure never reaches good or easy'`, `'first_review never reaches easy'`, `'a changed pick never reaches easy'`, `'a slow answer never reaches easy'`, `'is total and only ever answers one of the four ratings'`, `'reproduces the seven rows of plan §5.3'`, `'previews the ladder without touching the progress'`.
- `tests/unit/mcqShuffle.test.ts` — fast-check: `seededShuffle` is a permutation, deterministic for a seed, leaves the input untouched; `mcqSeed` differs across `attemptIndex` 0/1/2 for a fixed session/uid; `shownOrderFor` with `shuffle: false` returns stored order. Titles: `'returns a permutation and never mutates the input'`, `'is deterministic per seed and changes with attemptIndex'`, `'keeps stored order when shuffle is false'`.
- `tests/unit/mcqConstants.test.ts` — `mcqLetter(0..5)` = A–F, `mcqLetter(6)` = '?'; `mcqKindChip(1|2|3)`; `mcqPicksLine` for 0 and 3 of 5; `mcqOptionA11yLabel(1, 4, 'x')` = `'Option B of 4: x'`. Title: `'formats letters, chips, counts and the picks line'`.

### 3.3 D03

- `tests/unit/plannerKindHint.test.ts` (new; `tests/unit/planner.test.ts:161-206` and `tests/unit/ownedGatePredicates.test.ts:114` are untouched and stay green): a deck of Q/A cards at OrderInDeck 10–50 and MCQ cards at 1540–1560 (blob from plan §4.3 card 1), all new; `hint = null` ⇒ identical result to the no-hint call (fast-check over random decks/progress/modes); bucket order: a due Q/A card beats a preferred MCQ new card in `mixed`; `owns`: an unowned MCQ new card is never returned with `preferMcq`; `mcqAllowed: false` never returns an MCQ card and returns `null` when only MCQ new cards remain; `preferMcq: true` returns the first MCQ new card in deck order although every Q/A new card sorts before it; `preferMcq: false` returns the first Q/A new card, then falls back to MCQ when no Q/A new card is left; `review-due` and `sweep` ignore the hint; `buildRatedSessionState` forwards `kindHint` to `pickNextCard` (spy). Titles: `'is a no-op without a hint'`, `'keeps the due → updated → new bucket order under a hint'`, `'keeps the owns guard under a hint'`, `'never deals an MCQ new card when mcqAllowed is false'`, `'prefers an MCQ new card that sorts after every Q/A card'`, `'alternates back to Q/A and falls back to MCQ'`, `'ignores the hint in review-due and sweep'`, `'buildRatedSessionState forwards the hint'`.
- `tests/unit/mcqRotation.test.ts` — `buildKindHint` with `enabled: false` → null; `maxPerRun 0` → `{ mcqAllowed: false, preferMcq: false }`; served 1 of 2 with lastNewKind 'mcq' → `{ true, false }`; with 'qa' → `{ true, true }`; `noteServedCard` counts only MCQ, updates `lastNewKind` only for new progress. Titles: `'answers null under the kill switch'`, `'caps at maxPerRun and alternates on the last new kind'`, `'counts served MCQ cards from any bucket'`.

### 3.4 D04

`tests/unit/mcqReviewBody.test.tsx`, `mcqActionDock.test.tsx`, `mcqCoachLine.test.tsx` use the `react-native` factory mock of `tests/unit/reviewBody.test.tsx:16-31` (its `Platform` entry is what lets the REAL `CodeBlock` render — that file does not mock `CodeBlock`; only `session-card.screen.test.tsx:63-69` does — so the body suite keeps `Platform` and asserts the CODING SAMPLE section through `code-block-language`) and `react-test-renderer`. Required cases — body: stem stage shows the full stem with no `numberOfLines`, bold qualifier node `mcq-qualifier`, chip text for 1/2/3, hint; fallback bolding of all-caps words when no qualifier; options stage renders `shownOrder` letters A–D by position (fixture order deliberately `c, a, d, b` so key ≠ letter), roles radio/checkbox, `accessibilityState.checked`, a11y labels, over-limit hint + `onOverLimit` on the third tap of a choose-2; verdict stage: the four row states with their copy and icons, wrong-picked WHY expanded, `mcq-why-toggle-<key>` expands a wrong-unpicked WHY, correct option renders no WHY, sections in order, qualifier section absent without a qualifier, `describeScheduledRating` text shown, redeal banner at attemptIndex 1; no `allowFontScaling={false}` / `maxFontSizeMultiplier` anywhere (`tree.root.findAll` over Text props); a 481-char option (from `content/decks/aws-saa-c03.md`) is rendered as full children. Dock: per-stage buttons, `disabled` until `selectedCount === requiredCount`, count line only when `requiredCount > 1`, `Finish run` on the last node, roles and `accessibilityState`. Coach: null when hidden, dismiss calls `onDismiss`. `tests/unit/mcqCoachPrefs.test.ts`: `vi.resetModules()` per test, fake timers for the 250 ms hang (`advanceTimersByTimeAsync`), garbage → seen, storage throw → seen, mark then read → true. Titles (body): `'renders the full stem with the qualifier in bold'`, `'assigns letters by displayed position, never by key'`, `'uses radio for single and checkbox for multi with checked state'`, `'ignores a pick beyond the limit and says so'`, `'shows the four verdict row states with their WHYs'`, `'renders sections in order and the qualifier section only with a qualifier'`, `'never disables font scaling and never clamps option text'`; (dock): `'shows one button per stage and gates submit on a full pick'`, `'says Finish run on the last node'`; (prefs): `'reads seen on garbage, error or a slow read'`, `'marks and re-reads seen'`.

### 3.5 D05

`tests/integration/session-card-mcq.screen.test.tsx` copies the harness of `session-card.screen.test.tsx:1-261` (same `react-native` factory mock `:5-40`, same module mocks `:63-183`, `flush` `:193-198`, `findPressableByLabel` `:200-206`, `buildDeck`/`buildChallengeRoute` `:212-237`, `beforeEach` `:244-256`, `vi.setSystemTime` for `responseMs`) plus `vi.mock('../../src/config/featureFlags', …)` in the style of `tests/integration/paywall.screen.test.tsx:137-140` (a `featureFlagsMock` the cases flip) and `vi.mock('@react-native-async-storage/async-storage', …)` (Map-backed, as `tests/unit/deckRepositoryTopic.test.ts:20-34`). Fixtures: the 4-option card (plan §4.3 card 1, `Mcq` in PG key order) and the 5-option choose-two card (card 2), fed through the `resolveDeckBySlug` and `pickNextCard` mocks; `buildRatedSessionState` mocked to return `nextCurrent: null` (end of run) or the same card (redeal). Cases (each a required `it` title):
1. `'renders the stem stage first with recall-first on'` — chip, `mcq-show-options`, no `mcq-option-*`, exactly one `review-rating-dock` and one `review-rating-bar` View, one `screen-session-card-primary-surface`.
2. `'answers a single-choice card correctly and rates it good on first review'` — show options → tap the correct key → `Sure` → banner `Correct`, `mcq-schedule-line` present, `mcq-next` → `recordReviewEvent` called with `rating: 'good'`, `settleRatingReward` input `rating 'good'`, `navigation.replace('SessionSummary', expect.objectContaining({ picks: { landed: 1, answered: 1 } }))`, store `streakEarned === true`.
3. `'rates a wrong pick again and reports zero landed picks'` — wrong key → `Not sure` → `Not this time`, WHY of the pick expanded, `recordReviewEvent` `rating 'again'`, `picks: { landed: 0, answered: 1 }`, `streakEarned === false`.
4. `"rates I don't know as again without a pick"` — `mcq-dont-know` from the options stage.
5. `'skips the stem stage when recallFirst is off'` — flags `{ recallFirst: false }` → options immediately, no `mcq-show-options`.
6. `'renders the card as Q/A under the kill switch'` — flags `{ enabled: false }` → `Reveal answer` present, zero nodes whose testID starts with `mcq-`, `pickNextCard` called with `kindHint: null`, and the untouched Q/A summary param shape (no `picks`).
7. `'walks a choose-two card: count, over-limit hint, partial verdict, hard'` — checkbox roles, `1 of 2 selected`, third tap ignored with `Deselect one first`, submit disabled until two, one correct + one wrong → `You knew 1 of 2`, `rating 'hard'`, `streakEarned === true`.
8. `'never truncates the stem or an option under Dynamic Type'` — no `numberOfLines` on `mcq-stem` in stem and verdict stages nor on any option text; a 481-char option renders its full text; no `allowFontScaling={false}`.
9. `'gives good, not easy, to a changed pick on repeat review and easy to a fast unchanged one'` — progress `{ stage: 2, lastReviewedAt: >0, nextReviewAt: >0, hardStreak: 0 }`; pick a then b → `Sure` within 5 s → `rating 'good'`; fresh render, pick b once → `'easy'`.
10. `'re-deals an again card with a new order and the redeal banner'` — `buildRatedSessionState` returns the same card; second serve shows `mcq-redeal-banner` and a `shownOrder` different from the first (seed differs by `attemptIndex`; assert via letter→key mapping).
11. `'passes a kind hint to the planner on both call sites'` — `pickNextCard` and `buildRatedSessionState` mock calls carry `kindHint: { mcqAllowed: true, preferMcq: true }` on a fresh run.
12. `'shows the coach line once and marks it seen on Next'` — first MCQ card shows `mcq-coach-line`; after Next the storage key holds `'1'`; a second render does not show it.
`tests/integration/session-summary-picks.screen.test.tsx` — the `session-summary.screen.test.tsx` harness with `picks: { landed: 3, answered: 5 }` → `'3 of 5 picks landed'`; `{ landed: 0, answered: 5 }` → the ten-minutes line; absent → no `session-summary-picks` node. `tests/unit/clientCapabilitiesMcq.test.ts` — `applyRemoteFeatures({ features: { mcq: { enabled: false } } })` → no `clientFeatures` key; defaults → `clientFeatures: ['mcq']`; normalisation still sorts/caps. `tests/unit/clientCapabilities.test.ts` — the `it` at `:92` ("never sends undefined-valued keys") and `:100` ("ships no feature tokens in Wave C") are retitled `'never sends undefined-valued keys under the kill switch'` and `'ships no feature tokens beyond the flag-gated mcq token'` and gain a `applyRemoteFeatures({ features: { mcq: { enabled: false } } });` line each (plus `import { applyRemoteFeatures } from '../../src/config/featureFlags';`). Because four more base cases pin `toEqual({})` / `toEqual({ updateId: 'abc-def' })` under the default `mcq.enabled === true` (`:42-54`, `:56-62`, `:64-67`, `:69-81`), the edit is a bounded allow-list rather than "byte-identical elsewhere" (D05 gap 1): the same kill-switch line once in `beforeEach` after `resetClientCapabilitiesForTests();` (`:39`), and `(await import('../../src/config/featureFlags')).applyRemoteFeatures({ features: { mcq: { enabled: false } } });` once in each of the two `vi.resetModules()` cases (before `:48`'s `const mod = await import(…)`, after `:58`'s `vi.resetModules();`). The `-` lines are exactly the two old `it(` lines; every `+` line (trimmed) is one of the import line, the kill-switch line, the fresh-registry kill-switch line or the two new `it(` lines; no assertion changes; every other base `it('…'` title is still present verbatim. `session-card.screen.test.tsx`, `session-summary.screen.test.tsx`, `ratingBar.test.tsx`, `reviewBody.test.tsx`, `session-store.test.ts`, `sessionRewards.test.ts`, `featureFlags.test.ts`, `progressSyncEnvelopeBytes.test.ts` are untouched and green.

### 3.6 D06

Mobile: `tests/unit/drawCommitFaces.test.ts` (`commitDraw` output carries `tag` = topic, `kind: 'mcq'` + `requiredCount` for an MCQ card under defaults, neither under `enabled: false`, no `tag` key when `Topic` is null); `tests/integration/draw-result-kind.screen.test.tsx` (harness of `draw-result.screen.test.tsx`; featured card with `kind: 'mcq', requiredCount: 2` shows `draw-result-featured-kind` = `MC · pick 2` inside the art window next to `draw-result-featured-topic`; without `kind` the node is absent; `draw-result.screen.test.tsx:85`, `:677` fixtures untouched); `tests/integration/card-detail-kind.screen.test.tsx` (chip text for 1 and 2, absent for Q/A, absent when locked, absent under the kill switch, no option text anywhere in the tree); `tests/unit/libraryMcqMark.test.tsx` (`buildLibraryCardRows` sets `isMcq` from the blob and `mcqEnabled: false` clears it; the tile shows `library-card-kind-<uid>` only when `isMcq`). Bounded edits: `tests/unit/libraryTopics.test.ts` numstat `2	2` (`:234-235` as §2.6.1), `tests/unit/libraryCardTile.test.tsx` numstat `1	0` (`isMcq: false,`). Titles: `'tags drawn cards with topic and kind'`, `'marks the featured MCQ card and leaves Q/A cards alone'`, `'shows the multiple-choice chip and never the options'`, `'marks MCQ tiles and clears the mark under the kill switch'`.

Console: `frontend/tests/mcqWarnings.test.ts` — one positive and one negative case per code (six codes; fast-check over `cardArb`-style blobs that a no-warning card produces `[]`), thresholds at the boundary (1.39× vs 1.40×, 39 vs 40 chars, 120 vs 121 words, 140 vs 141 chars), shape table; `frontend/tests/deckImportPageWarnings.test.tsx` — a document with one warning-only MCQ card: `import-warnings` panel present with `1 suggestion — not blocking`, the five-badge strip unchanged (`badgeStrip('parse errors')` still 5 entries), no "problem" heading, the Run button not blocked; a clean document renders no panel. `parseDeckMarkdown` on plan §4.3 card 1 yields `warnings` whose codes are exactly `['MCQ_WARN_CORRECT_LONGEST']` (measured 2026-09-22 on the fence text with lines joined by `\n` as `sectionText` does: correct option b = 157 chars, wrong options a/c/d = 95 / 104 / 114, median 104 × 1.4 = 145.6 < 157; stem 49 words, first sentence 78 chars, every WHY ≥ 121 chars, shape (1, 4), USAGE present) — the brief pins that literal. Titles: `'fires each warning code once from a minimal positive case'`, `'stays silent on a well-shaped card'`, `'lists suggestions below the errors without blocking the run'`.

### 3.7 Property tests required

D01 (normaliser idempotence, rule mutations), D02 (all seven verdict invariants; shuffle permutation/determinism), D03 (hint-null equivalence), D06 (warnings silent on well-shaped cards). D04/D05 are example-based.

---

## 4. Dependency edges and merge order

| Issue | deps | why |
|---|---|---|
| D01 | – | canary; the only frozen-file touch; every later issue imports `normalizeMcq` / the types |
| D02 | D01 | `McqExport`/`McqOption` types; `mcqRequiredCount` |
| D03 | D02 | `normalizeMcq` in the planner, `McqKindHint` type; `FeatureFlags` |
| D04 | D02 (queue: after D03) | `mcqConstants` copy/testIDs, `McqVerdict`, `describeScheduledRating`, `mcqLetter` |
| D05 | D03, D04 | `buildKindHint` + the two planner call sites; the three components; `mcqCoachPrefs` |
| D06 | D05 | `navigation/types.ts` after D05's `picks?`; `MCQ_COPY` face strings; console part has no mobile dep but merges in queue order |

Merge order: **D01 → D02 → D03 → D04 → D05 → D06**, strictly serial in the driver's `queue.tsv`. D03 and D04 could run in parallel worktrees (both depend on D02 only) but the queue keeps D03 first; D06's console half could start any time but is verified and merged with its mobile half as one issue (§6 #9).

---

## 5. verify.sh conventions (all issues)

Copy `docs/delivery/r16-issues/C07.verify.sh`'s skeleton: `#!/usr/bin/env bash`, `set -euo pipefail`, `ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"`, `BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"` (the driver exports `BASE=delivery/r16-d-mcq`), `MB="$(git merge-base "$BASE_REF" HEAD)"` (resolved as C07 does, `origin/` fallback, `fail` if unresolvable), `fail()`, numbered `echo "[k/5] …"` steps, and a header comment that starts `# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:` naming exactly the missing new files. **Step 1 is always the one that fails on base** (scope files exist + prerequisite greps: D02+ requires `mobile/src/features/gacha/mcq/normalizeMcq.ts`; D03+ `mcqVerdict.ts`; D05 the three `Mcq*.tsx` and `mcqRotation.ts`; D06 `session-summary-picks.screen.test.tsx`); tsc/vitest never run on base. Step 2 = literal guards (`-F` greps of every signature, testID, copy string and `it('…'` title in §2/§3 the issue owns; `≥ N` `it(` blocks; the suppression grep of `C07.verify.sh:151` (its five-token `grep -Eq` alternation, copied verbatim from that line) over the issue's NEW files and over the `+` lines of its edited files — never over whole pre-existing files, `SessionCardScreen.tsx:413` holds one). Step 3 = `( cd mobile && npm run test:typecheck )` (tsc at most once) / `( cd frontend && npm run lint )`. Step 4 = targeted `npx vitest run <the issue's test files + the untouched suites it sits beside> --reporter=dot`; frontend adds `npm run build` when `src/` changed. Step 5 = scope + frozen + OTA guard.

- **Scope guard**: `git diff --name-only "$MB" HEAD` ∪ `git ls-files --others --exclude-standard -- mobile/src mobile/tests` (D06 also `frontend/src frontend/tests frontend/scripts`) filtered by an allow-regex built from the issue's §1 row plus `^docs/delivery/r16-issues/`. Pathspec-scoped, never bare (the driver symlinks `node_modules` into the worktree).
- **Frozen guard**: D01 → `git diff --numstat "$MB" HEAD -- mobile/src/content/deckRepository.ts` equals `2	0`; the two `+` lines equal the pinned Mcq line of §0 byte for byte; `grep -Fxc "$MCQ_LINE"` == 2 and `grep -Fxc "$TOPIC_LINE"` == 2; `grep -n -A1 -F "$TOPIC_LINE" | grep -c -F 'Mcq: typeof (c as any).mcq'` == 2; `wc -l` == 1707; `grep -Eq "^\s+mcq\??:"` fails (raw types gain no key); `grep -c "normalizeMcq" mobile/src/content/deckRepository.ts` == 0; `git diff --quiet "$MB" HEAD -- mobile/src/sync/progressSync.ts mobile/src/review/model.ts`. Every other issue: `git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts`.
- **Reader guard** (every mobile issue): `grep -rln '\.Mcq\b' mobile/src` prints nothing outside the allow-list of §0 for that issue's queue position — D01/D02: `mobile/src/types/deckExport.ts`, `mobile/src/content/deckRepository.ts`, `mobile/src/features/gacha/mcq/normalizeMcq.ts`; D03/D04/D05: those plus `mobile/src/features/gacha/planner/sessionPlanner.ts`; D06: those plus `mobile/src/features/gacha/library/libraryMapper.ts`. D03 and D06 additionally pin the count in the file they add (`grep -c '\.Mcq\b'` == 1) so the token appears only inside `normalizeMcq(card.Mcq)`.
- **Mock-safety guard** (D04, D05, D06 mobile): every `from 'react-native'` import in `mobile/src/features/gacha/components/Mcq*.tsx`, `mobile/src/features/gacha/mcq/*.ts` and the `+` lines of `SessionCardScreen.tsx` names only the nine exports listed in §2.4; `grep -E "import .*(Platform|AccessibilityInfo|Vibration).*from 'react-native'"` fails; no static `from 'expo-haptics'` / `from 'expo-updates'`; D05: `git diff -U0 "$MB" HEAD -- mobile/src/screens/SessionCardScreen.tsx | grep '^-' | grep -v '^---' | grep -E 'recordReviewEvent|reviewStage:|dwellTimeMs:|statedDifficulty:|cardRevision:|progressAfter:'` is empty, the string `reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review',` occurs exactly once, `async function handleRating(rating: UiRating)` still occurs once, and no `+` line imports a new name from `../features/gacha/planner/sessionPlanner` or `../features/gacha/session/sessionReviewHelpers` (compare the two import blocks against base).
- **OTA guard** (every mobile issue): `git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json`; `grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json`; `grep -Fq '"version": "1.6.0"' mobile/app.json`; `grep -Fq '"vite": "7.2.4"' mobile/package.json`; `! grep -rq "@sentry" mobile/src`.
- **Bounded test edits**: D01 `git diff --numstat "$MB" HEAD -- mobile/tests/unit/deckRepositoryTopic.test.ts` == `3	0` and the `+` lines (stripped) are `'Mcq',`, `Mcq: null,`, `'Mcq',`; D06 `libraryTopics.test.ts` == `2	2`, `libraryCardTile.test.tsx` == `1	0` with the single `+` line `isMcq: false,`; D05 `clientCapabilities.test.ts`: the two new titles present, the old two absent, every other `it('` title of the base file still present (extract the base list with `git show "$MB":…`), the `-` lines exactly the two old `it(` lines, every `+` line inside the five-entry allow-list of §3.5.
- **Untouched-suite guard**: every issue lists the existing test files of §1/§3 it must not change and runs `git diff --quiet "$MB" HEAD -- <them>`; D06 additionally the seven frontend test files of §1.2.
- **Gates**: mobile → targeted vitest then `npm run test:typecheck`; frontend (D06) → `( cd frontend && npx vitest run tests/mcqWarnings.test.ts tests/deckImportPageWarnings.test.tsx tests/deckImport.test.ts tests/deckImport.mcq.test.ts tests/deckImportPageRun.test.tsx tests/deckImportPageSource.test.tsx tests/cardRulesWiring.test.ts tests/uiLanguage.test.ts --reporter=dot )`, `npm run lint`, `npm run build`. The driver's per-root gates (`npm run test:typecheck && npx vitest run`; `npm run lint && npx vitest run && npm run build`) run in addition. No top-level `docs/*.md` changes in Wave D, so no docsPaths step.
- **Banned terms**: `grep -Eiq '<the six terms>'` over the issue's added lines only (`git diff -U0 "$MB" HEAD -- <files> | grep '^+' | grep -v '^+++'` plus whole new files).
- Final line `echo "D0N VERIFY OK"`. No `npm install`/`npm ci`/network/`expo`/`prebuild`. Runtime < 5 min.

---

## 6. Contradictions resolved (plan / task text vs. tree) — binding on every brief

1. **The mapper line.** Plan §3.8 (`:134`) and the driver's task text say `Mcq: normalizeMcq(c.mcq)` / `Mcq: normalizeMcq((c as any).mcq),`. Tree: `deckRepository.ts` imports only `:2-12`, nothing from `features/gacha/mcq`, so that line needs a third added line (an import) — numstat `3	0` — while the signed exception (`economy-v2:66`, "各加一行") and the driver gate ("exactly `2	0`") allow two lines total and the task text asserts both at once. Decision: the signed line is the import-free pass-through of §0 (Topic's style), `normalizeMcq` runs at the read boundary (`resolveMcq`/`isMcqCard`), `CardExport.Mcq` is documented as unvalidated and has exactly three readers (§0). The plan's "永不抛，任何违规 → null → 按 Q/A 渲染" holds at that boundary. Nobody asks the owner for a 3-line re-sign.
2. **"qualifier must appear in the stem" is not a phone-side rule.** Plan §3.2 lists it among the four-layer rules; `normalizeMcq(raw)` (plan §3.8 signature, kept) sees only the blob. Decision: the console (`mcqRules.ts` `MCQ_QUALIFIER_NOT_IN_STEM`) and the C09 publish gate enforce it upstream; the phone renders the qualifier bold only where it finds it and otherwise falls back to all-caps words — a mismatch degrades a highlight, never demotes a card to Q/A silently.
3. **`deckRepositoryTopic.test.ts` pins the mapped key set** (`:178-190`, `:192-205`, `:215-227`, twelve keys). Adding `Mcq` after `Topic` turns it red, so D01's scope includes that file with numstat `3	0` (§3.1). `C07.verify.sh` (1705 lines, "+Topic only") stops passing on this branch after D01 — expected, C07 is merged; nobody re-runs it.
4. **Where the rotation logic lives.** Plan §5.7 puts the hint on `pickNextCard`/`buildRatedSessionState` and leaves "调用方按会话状态算 hint" to the screen. The untouched `session-card.screen.test.tsx` factory-mocks `sessionPlanner` (`:142-160`) and `sessionReviewHelpers` (`:118-131`); a new named import from either would throw there. Decision: `McqKindHint`, `buildKindHint`, `noteServedCard` live in the new `mcq/mcqRotation.ts` (D03); the planner `import type`s the hint; D05 imports only from the mcq directory.
5. **`maxPerRun = 0` means "none", so `mcqAllowed` is a hard filter.** Plan §5.7 says `pickNew` "找不到回退到普通扫描" and §8 says `0 = 不出`; a fallback would still deal an MCQ card when it is the only new card. Decision: `mcqAllowed` filters, `preferMcq` orders (§2.3). Consequence accepted: a run whose only remaining new cards are MCQ ends early on the route-complete card. `served` counts MCQ cards from any bucket (plan literal "本场已出 MCQ 数"); due MCQ cards are never deferred and there is no hint in `review-due`/`sweep` (C04's mode exists on the tree, `sessionPlanner.ts:96`, `:164`; plan predates it).
6. **Why `McqReviewBody` is a sibling.** Plan §6.1 (`:337`) gives two reasons; the first ("ReviewBody 把题目截 4/2 行") is stale — `ReviewBody.tsx:59-79`, `:150-169` renders the full stem on both faces (testIDs `review-question`, `review-question-recap`). The second (`faceUp/onFlip` `:89-92`, `Hide` `:187-195` lets the answer be hidden again; MCQ has no re-hide, no re-submit, no RatingBar) still holds. Decision: sibling, `ReviewBody.tsx` untouched.
7. **`SessionSummary.picks` must be conditional.** `session-card.screen.test.tsx:296-308` pins the exact Q/A param object (C00 §2.4's "one optional field" is `reward?` then `loadForecast?`; this is the third, `types.ts:203-204`). Decision: `picks` is spread only when `answered > 0`; `landed` = submits whose verdict ≠ wrong (so the copy "they're all back in 10 minutes" is literally true when it shows).
8. **The `'mcq'` capability token belongs to Wave D, not Phase 5.** `clientCapabilities.ts:14` reserves it ("Wave D appends 'mcq' when flags.mcq.enabled at call time"); C13's Snowflake `answer_mode` keys on `array_contains('mcq', client_features)` (C00 §6 #9, `:757`); without the token every MCQ event of the 1.6.1 period reads as `'qa'` and the Phase 3 partition is wrong for the whole period. The wave table (`:130-131`) does not list the file. Decision: D05 edits `clientCapabilities.ts` (not frozen) and retitles two pins in `clientCapabilities.test.ts` (§3.5). `answerTelemetry` and any `answer` payload stay out (privacy label + `src/sync` signature, plan §7).
9. **D06 is one issue with two roots.** The survey proposed splitting D06a/D06b; the driver's task text already runs the frontend gate "for the D06 console part". Decision: one brief, one `D06.verify.sh` with a mobile half and a frontend half; the wave table's console scope (`:132`, only `deckImport.ts, tests`) is widened to `mcqWarnings.ts`, `DeckImportPage.tsx`, `lint-deck.mts` because a warnings array nobody renders or prints is not a tier. Warnings are a separate `ParsedDeck.warnings` array with their own `McqWarningCode` type, never members of `errors`/`McqIssueCode` (`deckImport.mcq.test.ts:522` pins the code table; `blocked` and the "problem" count must not move). The task text's "severity 'warning'" is honoured as a literal field on `ImportWarning`.
10. **`DrawnCardVm.tag` is the topic, the MCQ mark is its own field.** Plan §6.8 (`:365`) says "对 MCQ 设 "Choice · pick 2"" in `tag` and that `DrawnCardVm` lacks `tag`. Tree: `DrawnCardVm` (`drawCommit.ts:13-20`) still lacks it, but the route params already declare `tag?: string` (`types.ts:92`, `:121`), `DrawResultScreen.tsx` renders it as the featured **topic** chip (`:394`, `:536-541`, comment `:470` "rarity chip + topic label") and the grid tag (`:706-710`), and only test fixtures populate it (`draw-result.screen.test.tsx:85`, `:677`, pinned at `:569-571`). Decision: D06 fills `tag` with the C07 topic label (the slot's documented purpose) and adds `kind?: 'mcq'` + `requiredCount?` rendered as a separate `MC · pick 2` mark (§2.6.1); the ceremony face renders neither. D06's scope therefore includes `navigation/types.ts` after D05.
11. **`LibraryCardRow` gains a required `isMcq`.** `libraryTopics.test.ts:234-235` pins the row key count and the last three keys, `libraryCardTile.test.tsx:40-57` builds a full row. Decision: required field appended after `rank`, both tests edited with pinned numstats (C07's one-line fixture precedent, `C07-topic-mobile.md` Constraints); `LibraryScreen.tsx` passes `mcqEnabled` so the mark obeys the kill switch like every other face.
12. **`deckExport.ts` has no trailing newline** (`:26` is `}` without `\n`, `wc -l` prints 25). Appending the two interfaces turns that line into a modified line in numstat, so D01's verify pins literals on this file, not a numstat.
13. **`describeMcqDiff`** (plan `:405`) is not on the tree (grep 0 in `frontend/src`) and C12 shipped the badge and the read-only panel without it. Dropped from Wave D.
14. **"黄金 5 重导零警告" (plan `:405`) cannot be a gate.** With the plan's thresholds the live decks warn on 122/165 and 99/142 MCQ cards for `MCQ_WARN_CORRECT_LONGEST` and 57/142 and 53/142 for `MCQ_WARN_FIRST_SENTENCE_LONG` (measured 2026-09-22 with the console parser). Decision: thresholds stay the plan's numbers, the page groups by code with counts, no verify asserts zero warnings on any real file; the owner reads the counts as a content-quality signal.
15. **Line drift in the plan** (stale numbers nobody re-derives): `handleRating` is `:429` (plan `:396`); the branch point is `ReviewBody` `:767-772` / dock `:775-792` / `RatingBar` `:785-790` (plan `:699-721`); `:401-512` → `:438-572`; `:479-508` → `:540-568`; `load()` `:216` (plan `:186-382`); `pickWith` `:108-129` (plan `:97-104`); `sessionBuilder.ts:41` "新卡每场只有 1–2 张" was removed by C02/R6 (the ordering problem — MCQ cards at 1540+ sort after every unseen Q/A card — remains and is what §2.3 solves); `remoteConfig.ts:123-129` → `:27-46`; `storage.ts:143-189` whitelist → not cited (frozen by policy, not edited); `SCHEDULER_VERSION` is `progressSync.ts:134` (survey said `:133`); `mapRatingToNumber` `:224-237`; `progressSync.ts` is 1872 lines (C14's four lines landed); `economy-v2` exception is `:66` (survey said `:65`).
16. **The `1 of 2 selected` count is a dock element, not a body element** (plan §6.4 "dock 里"); the over-limit hint is a body element (it answers a row tap). Both carry the testIDs of §2.2.
17. **"Show full question" is the one deliberate clamp.** Plan §6.4 collapses the stem to 3 lines on the options screen; §6.3/§6.5 forbid clamping elsewhere. The D05 Dynamic Type case asserts on the stem and verdict stages and on option text; the options-stage stem is asserted to expand on `mcq-show-full-stem`.
18. **`sessionId` for the seed.** The store hook (`:142`) lags a render behind `startSession` (`:373-378`); `applyCurrent` in `load()` takes the id from the object it just passed to `startSession`, and in `handleRating` from `useSessionStore.getState().sessionId` (the screen already does that at `:556`).
19. **The `.Mcq` reader list is five files by the end of the wave, not three.** The first draft of §0 said "exactly three readers" while §2.3 pins `normalizeMcq(card.Mcq)` inside `sessionPlanner.ts` (the planner takes no flags, so `resolveMcq` cannot be used there) and §2.6.1 pins `isMcq: mcqEnabled && normalizeMcq(card.Mcq) !== null` inside `libraryMapper.ts` (the mapper takes `mcqEnabled` as a value). Both cannot hold. Decision (as D03 and D06 already resolved it): the raw field may be spelled only as the argument of `normalizeMcq(…)`, once per file, in those two files; every screen uses `resolveMcq(card, flags)` / `isMcqCard(card, flags)`. The verify allow-lists follow the queue: D01/D02 three, D03/D04/D05 four, D06 five (§0, §5).
20. **`readMcqCoachSeen` answers "seen" for any stored string, not only `'1'`.** §2.4's doc comment says "true when the key holds '1'; any error, garbage or slow read → true"; D04 gap 8 makes it literal: `null` (nothing stored) → `false`, anything else → `true`. `markMcqCoachSeen` still writes `'1'` and D05's suite asserts that byte.
