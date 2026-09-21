#!/usr/bin/env bash
# D02 — mcq-verdict-shuffle verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/mcq/mcqConstants.ts,
#     mobile/src/features/gacha/mcq/mcqVerdict.ts,
#     mobile/src/features/gacha/mcq/mcqShuffle.ts,
#     mobile/tests/unit/mcqVerdict.spec.ts,
#     mobile/tests/unit/mcqShuffle.test.ts and
#     mobile/tests/unit/mcqConstants.test.ts do not exist on base
#   (step 1 then also checks the D01 prerequisite: normalizeMcq.ts with
#   mcqRequiredCount, McqOption / McqExport on deckExport.ts and
#   tests/unit/normalizeMcq.test.ts must be on the integration branch,
#   because D00 §4 orders D01 before D02 — the verdict reads D01's types)
# Step 2 (literal guards: the pinned signatures, copy, testIDs, worked values
# and the it('…') titles) would also fail on base. Steps 3/4 are the tsc /
# targeted-vitest gates and step 5 is a scope + frozen + OTA guard; both pass
# on base by design.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (D00 §0).
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 1–2 min (tsc).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"   # driver exports BASE
fail() { echo "D02 VERIFY FAIL: $*" >&2; exit 1; }

CONST=mobile/src/features/gacha/mcq/mcqConstants.ts
VERDICT=mobile/src/features/gacha/mcq/mcqVerdict.ts
SHUFFLE=mobile/src/features/gacha/mcq/mcqShuffle.ts
VT=mobile/tests/unit/mcqVerdict.spec.ts
ST=mobile/tests/unit/mcqShuffle.test.ts
CT=mobile/tests/unit/mcqConstants.test.ts
NORMALIZE=mobile/src/features/gacha/mcq/normalizeMcq.ts
EXPORT=mobile/src/types/deckExport.ts
NT=mobile/tests/unit/normalizeMcq.test.ts
TOPICS=mobile/src/features/gacha/library/topics.ts

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ D01 prerequisite)"
for f in "$CONST" "$VERDICT" "$SHUFFLE" "$VT" "$ST" "$CT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ -f "$NORMALIZE" ] || fail "$NORMALIZE is missing — D01 must be merged before D02 (D00 §4)"
grep -Fq "export function mcqRequiredCount(mcq: McqExport): number" "$NORMALIZE" || fail "normalizeMcq.ts lacks mcqRequiredCount (D01 incomplete)"
grep -Fq "export interface McqOption" "$EXPORT" || fail "deckExport.ts lacks McqOption (D01 incomplete)"
grep -Fq "export interface McqExport" "$EXPORT" || fail "deckExport.ts lacks McqExport (D01 incomplete)"
[ -f "$NT" ] || fail "$NT is missing — D01's suite must be on the branch (D00 §1.1)"
grep -Fq "export function fnv1a32Hex(input: string): string" "$TOPICS" || fail "topics.ts lacks fnv1a32Hex (C07 polish regressed?)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# 2a. mcqConstants.ts — signatures, no imports
[ "$(grep -c '^import ' "$CONST" || true)" = "0" ] || fail "mcqConstants.ts must not import anything"
for sym in \
  "export const MCQ_FAST_MS = Object.freeze({ upToFourOptions: 20_000, fiveOrSix: 30_000 });" \
  "export const MCQ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;" \
  "export function mcqLetter(index: number): string" \
  "export const MCQ_COACH_SEEN_KEY = 'recallsmith:mcq:coach-seen:v1';" \
  "export const MCQ_COACH_READ_TIMEOUT_MS = 250;" \
  "export const MCQ_COPY = Object.freeze({" \
  "export function mcqKindChip(requiredCount: number): string" \
  "export function mcqSelectedCount(k: number, n: number): string" \
  "export function mcqBannerPartial(k: number, n: number): string" \
  "export function mcqQualifierBody(qualifier: string): string" \
  "export function mcqOptionA11yLabel(index: number, total: number, text: string): string" \
  "export function mcqPicksLine(picks: { landed: number; answered: number }): string" \
  "export const MCQ_TEST_IDS = Object.freeze({"; do
  grep -Fq -- "$sym" "$CONST" || fail "mcqConstants.ts lacks: $sym"
done
# 2b. mcqConstants.ts — every MCQ_COPY pair, verbatim (D00 §2.2)
for sym in \
  "kindChip: { single: 'Multiple choice', two: 'Choose 2', three: 'Choose 3' }," \
  "stemHint: 'Decide on your answer before you look at the options.'," \
  "showOptions: 'Show options'," \
  "showFullStem: 'Show full question'," \
  "sure: 'Sure'," \
  "unsure: 'Not sure'," \
  $'dontKnow: "I don\'t know",' \
  "confidenceHint: 'How confident are you?'," \
  "overLimit: 'Deselect one first'," \
  "bannerCorrect: 'Correct'," \
  "bannerWrong: 'Not this time'," \
  "rowCorrectPicked: 'Correct'," \
  "rowCorrectMissed: 'You missed this one'," \
  "rowWrongPicked: 'Your pick'," \
  "rowWhyNot: 'Why not?'," \
  "sectionExplanation: 'EXPLANATION'," \
  "sectionQualifier: 'WHY THE QUALIFIER MATTERS'," \
  "sectionUsage: 'REAL USAGE'," \
  "sectionCode: 'CODING SAMPLE'," \
  "next: 'Next'," \
  "finishRun: 'Finish run'," \
  $'redeal: "Back again — let\'s see if it stuck",' \
  $'coach: "New card type. Decide first, then reveal the options. Sure / Not sure tells the scheduler how confident you were; I don\'t know skips the guess and shows the explanations.",' \
  "coachDismiss: 'Got it'," \
  "faceMark: 'MC'," \
  'faceMarkPick: (n: number) => `MC · pick ${n}`,' \
  "detailChip: 'Multiple choice'," \
  'detailChipPick: (n: number) => `Multiple choice · pick ${n}`,'; do
  grep -Fq -- "$sym" "$CONST" || fail "mcqConstants.ts MCQ_COPY lacks: $sym"
done
# 2c. mcqConstants.ts — every MCQ_TEST_IDS pair, verbatim (D00 §2.2)
for sym in \
  "body: 'mcq-review-body'" "kindChip: 'mcq-kind-chip'" "stem: 'mcq-stem'" "qualifier: 'mcq-qualifier'" "stemHint: 'mcq-stem-hint'" \
  "showFullStem: 'mcq-show-full-stem'" 'option: (key: string) => `mcq-option-${key}`' 'optionLetter: (key: string) => `mcq-option-letter-${key}`' \
  "overLimitHint: 'mcq-over-limit-hint'" "verdictBanner: 'mcq-verdict-banner'" "scheduleLine: 'mcq-schedule-line'" \
  'why: (key: string) => `mcq-why-${key}`' 'whyToggle: (key: string) => `mcq-why-toggle-${key}`' \
  "sectionExplanation: 'mcq-section-explanation'" "sectionQualifier: 'mcq-section-qualifier'" "sectionUsage: 'mcq-section-usage'" "sectionCode: 'mcq-section-code'" \
  "redealBanner: 'mcq-redeal-banner'" \
  "dock: 'review-rating-bar'" "dockHint: 'mcq-dock-hint'" "selectedCount: 'mcq-selected-count'" \
  "showOptions: 'mcq-show-options'" "submitSure: 'mcq-submit-sure'" "submitUnsure: 'mcq-submit-unsure'" "dontKnow: 'mcq-dont-know'" "next: 'mcq-next'" \
  "coachLine: 'mcq-coach-line'" "coachDismiss: 'mcq-coach-dismiss'" \
  "summaryPicks: 'session-summary-picks'" \
  "drawFeaturedKind: 'draw-result-featured-kind'" "cardDetailKind: 'card-detail-kind-chip'" 'libraryKind: (uid: string) => `library-card-kind-${uid}`'; do
  grep -Fq -- "$sym" "$CONST" || fail "mcqConstants.ts MCQ_TEST_IDS lacks: $sym"
done
# 2d. mcqVerdict.ts — types, signatures, exactly the five imports, no ladder copy
for sym in \
  "export type McqVerdict = 'correct' | 'partial' | 'wrong';" \
  "export type McqConfidence = 'sure' | 'unsure';" \
  "export type McqReviewStage = 'first_review' | 'repeat_review';" \
  "export function resolveMcqVerdict(picks: readonly string[], mcq: McqExport): McqVerdict" \
  "export function isFastResponse(responseMs: number, optionCount: number): boolean" \
  "export type McqVerdictInput = {" \
  "verdict: McqVerdict;" "confidence: McqConfidence;" "changedPick: boolean;" "responseMs: number;" \
  "optionCount: number;" "reviewStage: McqReviewStage;" "stage: number;" "hardStreak: number;" \
  "export function mapMcqVerdictToRating(input: McqVerdictInput): ReviewRating" \
  "export const RATING_LABEL: Readonly<Record<ReviewRating, 'Again' | 'Hard' | 'Good' | 'Easy'>>" \
  "export function describeScheduledRating(before: CardProgress, rating: ReviewRating, now: Date): { after: CardProgress; line: string }" \
  "import type { ReviewRating, CardProgress } from '../../../review/model';" \
  "import { scheduleNextReview } from '../../../review/model';" \
  "import type { McqExport } from '../../../types/deckExport';" \
  "import { mcqRequiredCount } from './normalizeMcq';" \
  "import { MCQ_FAST_MS } from './mcqConstants';" \
  "' · the card stays where it is'" \
  "'10 minutes'"; do
  grep -Fq -- "$sym" "$VERDICT" || fail "mcqVerdict.ts lacks: $sym"
done
[ "$(grep -c '^import ' "$VERDICT" || true)" = "5" ] || fail "mcqVerdict.ts must have exactly the five pinned import lines"
if grep -Eq "1, 2, 4, 8, 15, 30, 60|0\.7|HARD_STREAK|10 \* 60 \* 1000" "$VERDICT"; then
  grep -En "1, 2, 4, 8, 15, 30, 60|0\.7|HARD_STREAK|10 \* 60 \* 1000" "$VERDICT" >&2 || true
  fail "mcqVerdict.ts re-implements the ladder; describeScheduledRating must format scheduleNextReview's result"
fi
# 2e. mcqShuffle.ts — signatures, the seed template, mulberry32 local, fnv1a32Hex imported
for sym in \
  "export function mcqSeed(sessionId: string, stableUid: string, attemptIndex: number): number" \
  "export function seededShuffle<T>(items: readonly T[], seed: number): T[]" \
  "export function shownOrderFor(mcq: McqExport, seed: number): McqOption[]" \
  "import type { McqExport, McqOption } from '../../../types/deckExport';" \
  "import { fnv1a32Hex } from '../library/topics';" \
  '${sessionId}|${stableUid}|${attemptIndex}' \
  "0x6d2b79f5" \
  "mcq.shuffle === false"; do
  grep -Fq -- "$sym" "$SHUFFLE" || fail "mcqShuffle.ts lacks: $sym"
done
[ "$(grep -c '^import ' "$SHUFFLE" || true)" = "2" ] || fail "mcqShuffle.ts must have exactly the two pinned import lines"
if grep -Eq "0x811c9dc5|0x01000193|poolSelection|export (function|const) mulberry32" "$SHUFFLE"; then
  grep -En "0x811c9dc5|0x01000193|poolSelection|export (function|const) mulberry32" "$SHUFFLE" >&2 || true
  fail "mcqShuffle.ts must import fnv1a32Hex (no local hash), keep mulberry32 private and never touch poolSelection"
fi
# 2f. Purity of all three modules
if grep -Eq "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|setTimeout|from '\.\./\.\./\.\./sync|from '\.\./\.\./\.\./content|from '\.\./session|from '\.\./planner" "$CONST" "$VERDICT" "$SHUFFLE"; then
  grep -En "from 'react|require\(|AsyncStorage|Date\.now|Math\.random|setTimeout|from '\.\./\.\./\.\./sync|from '\.\./\.\./\.\./content|from '\.\./session|from '\.\./planner" "$CONST" "$VERDICT" "$SHUFFLE" >&2 || true
  fail "the three mcq modules must stay pure (no react / require / storage / clock / randomness / sync / content / session / planner)"
fi
if grep -q "as any" "$CONST" "$VERDICT" "$SHUFFLE"; then
  grep -n "as any" "$CONST" "$VERDICT" "$SHUFFLE" >&2 || true
  fail "no 'as any' in the three mcq modules"
fi
# 2g. The .Mcq reader rule (D00 §0): exactly three readers under mobile/src
readers="$(grep -rln '\.Mcq\b' mobile/src | grep -Ev '^mobile/src/(types/deckExport\.ts|content/deckRepository\.ts|features/gacha/mcq/normalizeMcq\.ts)$' || true)"
[ -z "$readers" ] || { echo "$readers" >&2; fail "card.Mcq is read outside its three D00 readers"; }
# 2h. tests — harnesses, worked values, titles, counts, no suppression
for t in "$VT" "$ST"; do
  grep -Fq "from 'fast-check'" "$t" || fail "$t must use fast-check"
  grep -Fq "fc.assert(" "$t"        || fail "$t has no fc.assert property"
done
grep -Fq "from '../../src/features/gacha/mcq/mcqVerdict'" "$VT" || fail "mcqVerdict.spec.ts must import mcqVerdict.ts"
grep -Fq "from '../../src/review/model'" "$VT"                   || fail "mcqVerdict.spec.ts must import scheduleNextReview from the frozen model for the preview check"
grep -Fq "scheduleNextReview" "$VT"                               || fail "mcqVerdict.spec.ts must compare the preview against scheduleNextReview"
grep -Fq "structuredClone(" "$VT"                                 || fail "mcqVerdict.spec.ts must snapshot inputs to prove purity"
for s in \
  'Scheduled as Again · back in 10 minutes' \
  'Scheduled as Hard · the card stays where it is · back in 3 days' \
  'Scheduled as Hard · the card stays where it is · back in 1 day' \
  'Scheduled as Hard · back in 1 day' \
  'Scheduled as Good · back in 2 days' \
  'Scheduled as Easy · back in 8 days' \
  'Scheduled as Easy · back in 60 days'; do
  grep -Fq -- "$s" "$VT" || fail "mcqVerdict.spec.ts must pin the worked line: $s"
done
for s in \
  'wrong always maps to again' \
  'partial always maps to hard' \
  'unsure never reaches good or easy' \
  'first_review never reaches easy' \
  'a changed pick never reaches easy' \
  'a slow answer never reaches easy' \
  'is total and only ever answers one of the four ratings' \
  'reproduces the seven rows of plan §5.3' \
  'resolves the verdict from the picked keys and ignores unknown keys' \
  'calls an answer fast only inside the option-count budget' \
  'previews the ladder without touching the progress'; do
  grep -Fq "it('$s'" "$VT" || fail "missing mcqVerdict test case: $s"
done
grep -Fq "from '../../src/features/gacha/mcq/mcqShuffle'" "$ST"     || fail "mcqShuffle.test.ts must import mcqShuffle.ts"
grep -Fq "from '../../src/features/gacha/library/topics'" "$ST"     || fail "mcqShuffle.test.ts must import fnv1a32Hex to pin mcqSeed"
for s in \
  "2822193929" "2805416310" "2788638691" \
  "['c', 'd', 'b', 'a']" "['d', 'a', 'c', 'b']" "['b', 'a', 'd', 'c']" \
  "['e', 'c', 'd', 'b', 'a']" "['d', 'c', 'a', 'b']" "['d', 'b', 'a', 'c']" \
  "'run-1', 'aws-sqs-order-buffer-mcq-01'"; do
  grep -Fq -- "$s" "$ST" || fail "mcqShuffle.test.ts must pin the worked value: $s"
done
for s in \
  'returns a permutation and never mutates the input' \
  'is deterministic per seed and changes with attemptIndex' \
  'keeps stored order when shuffle is false'; do
  grep -Fq "it('$s'" "$ST" || fail "missing mcqShuffle test case: $s"
done
grep -Fq "from '../../src/features/gacha/mcq/mcqConstants'" "$CT" || fail "mcqConstants.test.ts must import mcqConstants.ts"
for s in \
  "'Option B of 4: x'" \
  "'recallsmith:mcq:coach-seen:v1'" \
  "'3 of 5 picks landed'" \
  "'MC · pick 2'" \
  "'Multiple choice · pick 3'" \
  "Object.isFrozen("; do
  grep -Fq -- "$s" "$CT" || fail "mcqConstants.test.ts must pin: $s"
done
for s in \
  'formats letters, chips, counts and the picks line' \
  'pins the storage key, the fast budgets, the copy and the testID shapes'; do
  grep -Fq "it('$s'" "$CT" || fail "missing mcqConstants test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$VT" || true)" -ge 11 ] || fail "mcqVerdict.spec.ts needs >= 11 it() blocks"
[ "$(grep -cE "^\s*it\(" "$ST" || true)" -ge 3 ]  || fail "mcqShuffle.test.ts needs >= 3 it() blocks"
[ "$(grep -cE "^\s*it\(" "$CT" || true)" -ge 2 ]  || fail "mcqConstants.test.ts needs >= 2 it() blocks"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$CONST" "$VERDICT" "$SHUFFLE" "$VT" "$ST" "$CT" \
  && fail "test gutting / suppression found"
# 2i. Existing suites this issue sits beside are zero-diff against the base
git diff --quiet "$mb" -- \
  mobile/tests/unit/normalizeMcq.test.ts \
  mobile/tests/unit/deckRepositoryMcq.test.ts \
  mobile/tests/unit/deckRepositoryTopic.test.ts \
  mobile/tests/unit/scheduler.properties.test.ts \
  mobile/tests/unit/libraryTopics.test.ts \
  mobile/tests/unit/featureFlags.test.ts \
  mobile/tests/unit/cardRank.test.ts \
  || fail "an existing test file changed — D02 is add-only on tests (D00 §1.1)"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new suites + the suites they sit beside) ──────────
echo "[4/5] vitest mcqVerdict / mcqShuffle / mcqConstants / normalizeMcq / scheduler / libraryTopics"
( cd mobile && npx vitest run \
    tests/unit/mcqVerdict.spec.ts \
    tests/unit/mcqShuffle.test.ts \
    tests/unit/mcqConstants.test.ts \
    tests/unit/normalizeMcq.test.ts \
    tests/unit/scheduler.properties.test.ts \
    tests/unit/libraryTopics.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The three frozen files are zero-diff (D01's signed lines are already on the base; D02 adds none)
git diff --quiet "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || { git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts >&2; fail "a frozen file changed (D00 §0: D02 has no frozen-file exception)"; }
# 5b. The do-not-touch list and the OTA manifest set
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/review/storage.ts mobile/src/content/chunkedInstall.ts \
  mobile/src/features/gacha/planner mobile/src/features/gacha/session mobile/src/features/gacha/rewards \
  mobile/src/features/gacha/components mobile/src/features/gacha/draw/poolSelection.ts mobile/src/features/gacha/draw/cardRarity.ts \
  mobile/src/features/gacha/contracts.ts mobile/src/features/gacha/library/topics.ts mobile/src/features/gacha/mcq/normalizeMcq.ts \
  mobile/src/types/deckExport.ts mobile/src/config/featureFlags.ts mobile/src/config/remoteConfig.ts \
  mobile/src/screens mobile/src/navigation/types.ts mobile/src/sync \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.x)"; fi
# 5c. Every changed or untracked path is one of the six scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json; } | sort -u | grep -Ev '^(mobile/src/features/gacha/mcq/mcqConstants\.ts|mobile/src/features/gacha/mcq/mcqVerdict\.ts|mobile/src/features/gacha/mcq/mcqShuffle\.ts|mobile/tests/unit/mcqVerdict\.spec\.ts|mobile/tests/unit/mcqShuffle\.test\.ts|mobile/tests/unit/mcqConstants\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside D02 scope"; }

echo "D02 VERIFY OK"
