#!/usr/bin/env bash
# D04 — mcq-components verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/mcq/mcqCoachPrefs.ts,
#     mobile/src/features/gacha/components/McqReviewBody.tsx,
#     mobile/src/features/gacha/components/McqActionDock.tsx,
#     mobile/src/features/gacha/components/McqCoachLine.tsx,
#     mobile/tests/unit/mcqReviewBody.test.tsx,
#     mobile/tests/unit/mcqActionDock.test.tsx,
#     mobile/tests/unit/mcqCoachLine.test.tsx and
#     mobile/tests/unit/mcqCoachPrefs.test.ts do not exist on base
#   (step 1 then also checks the D01/D02 prerequisites: normalizeMcq.ts,
#   mcqConstants.ts, mcqVerdict.ts and the McqExport/McqOption types must be on
#   the integration branch, because D00 §4 orders D01 → D02 before D04 — the
#   components import every copy string, testID and formatter from D02)
# Step 2 (literal guards: the pinned signatures, the react-native import rule,
# the testIDs, the it('…') titles) would also fail on base. Steps 3/4 are the
# tsc / targeted-vitest gates and step 5 is a scope + frozen + OTA guard; both
# pass on base by design.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (C00 §0).
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 1–2 min (tsc).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"   # driver exports BASE
fail() { echo "D04 VERIFY FAIL: $*" >&2; exit 1; }

PREFS=mobile/src/features/gacha/mcq/mcqCoachPrefs.ts
BODY=mobile/src/features/gacha/components/McqReviewBody.tsx
DOCK=mobile/src/features/gacha/components/McqActionDock.tsx
COACH=mobile/src/features/gacha/components/McqCoachLine.tsx
BT=mobile/tests/unit/mcqReviewBody.test.tsx
DT=mobile/tests/unit/mcqActionDock.test.tsx
CT=mobile/tests/unit/mcqCoachLine.test.tsx
PT=mobile/tests/unit/mcqCoachPrefs.test.ts
# D01/D02 prerequisites (read, never edited by D04)
NORM=mobile/src/features/gacha/mcq/normalizeMcq.ts
CONST=mobile/src/features/gacha/mcq/mcqConstants.ts
VERDICT=mobile/src/features/gacha/mcq/mcqVerdict.ts
EXPORT=mobile/src/types/deckExport.ts

# The one react-native import line every component carries (D00 §2.4).
RN_LINE="import { Pressable, StyleSheet, Text, View } from 'react-native';"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ D01/D02 prerequisites)"
for f in "$PREFS" "$BODY" "$DOCK" "$COACH" "$BT" "$DT" "$CT" "$PT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$NORM" "$CONST" "$VERDICT" "$EXPORT"; do
  [ -f "$f" ] || fail "$f is missing — D01/D02 must be merged before D04 (D00 §4)"
done
grep -Fq "export function mcqRequiredCount(" "$NORM" || fail "normalizeMcq.ts lacks mcqRequiredCount (D01 incomplete)"
for sym in "export const MCQ_COPY" "export const MCQ_TEST_IDS" "export function mcqLetter(" "export function mcqKindChip(" \
           "export function mcqSelectedCount(" "export function mcqBannerPartial(" "export function mcqQualifierBody(" \
           "export function mcqOptionA11yLabel(" "export const MCQ_COACH_SEEN_KEY = 'recallsmith:mcq:coach-seen:v1';" \
           "export const MCQ_COACH_READ_TIMEOUT_MS = 250;"; do
  grep -Fq "$sym" "$CONST" || fail "mcqConstants.ts lacks: $sym (D02 incomplete)"
done
grep -Fq "export type McqVerdict = 'correct' | 'partial' | 'wrong';" "$VERDICT" || fail "mcqVerdict.ts lacks McqVerdict (D02 incomplete)"
grep -Fq "export type McqConfidence = 'sure' | 'unsure';" "$VERDICT"            || fail "mcqVerdict.ts lacks McqConfidence (D02 incomplete)"
grep -Fq "export interface McqOption {" "$EXPORT" || fail "deckExport.ts lacks McqOption (D01 incomplete)"
grep -Fq "export interface McqExport {" "$EXPORT" || fail "deckExport.ts lacks McqExport (D01 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. The react-native import rule (D00 §2.4) and the closed import set of every source file
for f in "$BODY" "$DOCK" "$COACH"; do
  grep -Fxq "$RN_LINE" "$f" || fail "$f must carry exactly: $RN_LINE"
  [ "$(grep -c "from 'react-native'" "$f" || true)" = "1" ] || fail "$f must import from 'react-native' exactly once"
done
for f in "$BODY" "$DOCK" "$COACH" "$PREFS"; do
  if grep -Eq "Platform|AccessibilityInfo|Vibration|expo-haptics|expo-updates|react-native-safe-area-context|@sentry|allowFontScaling|maxFontSizeMultiplier|faceUp|onFlip|RatingBar|config/featureFlags|remoteConfig|review/model|review/storage|/sync/|sessionStore|/rewards/|Date\.now|Math\.random" "$f"; then
    grep -En "Platform|AccessibilityInfo|Vibration|expo-haptics|expo-updates|react-native-safe-area-context|@sentry|allowFontScaling|maxFontSizeMultiplier|faceUp|onFlip|RatingBar|config/featureFlags|remoteConfig|review/model|review/storage|/sync/|sessionStore|/rewards/|Date\.now|Math\.random" "$f" >&2 || true
    fail "$f names something outside its import/prop contract (D00 §2.4, brief Constraints)"
  fi
  if grep -Eq "[^.]JSX\.Element" "$f"; then
    grep -En "[^.]JSX\.Element" "$f" >&2 || true
    fail "$f: explicit return types must be React.JSX.Element (C00 §6 #23)"
  fi
done
# 2b. McqReviewBody.tsx — pinned exports, props, roles, the one clamp, the imports it must use
for sym in "export type McqStage = 'stem' | 'options' | 'verdict';" \
           "export type McqOptionRowState = 'idle' | 'selected' | 'correct-picked' | 'correct-missed' | 'wrong-picked' | 'wrong-unpicked';" \
           "export function rowStateFor(option: McqOption, picked: boolean, stage: McqStage): McqOptionRowState" \
           "export type McqReviewBodyProps = {" \
           "card: CardExport;" "mcq: McqExport;" "rank?: number | null;" "stage: McqStage;" \
           "shownOrder: readonly McqOption[];" "picks: readonly string[];" "verdict: McqVerdict | null;" \
           "scheduleLine: string | null;" "attemptIndex: number;" "onToggleOption: (key: string) => void;" "onOverLimit?: () => void;" \
           "export function McqReviewBody(props: McqReviewBodyProps)" \
           "export function stemSegments(stem: string, qualifier: string | null): StemSegment[]" \
           "export const MCQ_BODY_TEST_IDS = Object.freeze({" \
           "accessibilityRole={requiredCount === 1 ? 'radio' : 'checkbox'}" \
           "from '../mcq/mcqConstants'" "from '../mcq/normalizeMcq'" "from '../mcq/mcqVerdict'" \
           "from '../library/cardRank'" "from '../../../components/CodeBlock'" "from '../session/reviewContentHelpers'" \
           "mcqRequiredCount(" "mcqLetter(" "mcqKindChip(" "mcqOptionA11yLabel(" "mcqBannerPartial(" "mcqQualifierBody(" \
           "renderSimpleMarkdown(" "MCQ_TEST_IDS.qualifier" "MCQ_TEST_IDS.whyToggle(" "MCQ_TEST_IDS.redealBanner" \
           "MCQ_COPY.overLimit" "MCQ_COPY.showFullStem" "MCQ_COPY.stemHint" "MCQ_COPY.redeal" \
           "mcq-order-badge" "mcq-stem-caps" "mcq-option-text-" "mcq-row-glyph-" "mcq-row-label-" \
           "minHeight: 48"; do
  grep -Fq "$sym" "$BODY" || fail "McqReviewBody.tsx lacks: $sym"
done
[ "$(grep -Fc "numberOfLines={collapsed ? 3 : undefined}" "$BODY" || true)" = "1" ] || fail "McqReviewBody.tsx: the stem must carry numberOfLines={collapsed ? 3 : undefined} exactly once (D00 §6 #17)"
if grep -Eq "numberOfLines=\{[0-9]+\}" "$BODY"; then
  bad="$(grep -En "numberOfLines=\{[0-9]+\}" "$BODY" | grep -Ev "numberOfLines=\{1\}" || true)"
  [ -z "$bad" ] || { echo "$bad" >&2; fail "McqReviewBody.tsx clamps something other than single-line chrome (brief gap #7)"; }
fi
if grep -Eq "\.Mcq\b|normalizeMcq\(|resolveMcq\(|shownOrderFor|seededShuffle|mcqShuffle|mcqRotation" "$BODY" "$DOCK" "$COACH" "$PREFS"; then
  grep -En "\.Mcq\b|normalizeMcq\(|resolveMcq\(|shownOrderFor|seededShuffle|mcqShuffle|mcqRotation" "$BODY" "$DOCK" "$COACH" "$PREFS" >&2 || true
  fail "D04 components are controlled: no card.Mcq read, no normalising, no shuffle/rotation import (D00 §0, §2.4)"
fi
# mcqVerdict.ts is a type-only dependency here: the verdict, the rating and the schedule line are computed by D05.
for f in "$BODY" "$DOCK"; do
  grep -Eq "^import type \{[^}]*\} from '\.\./mcq/mcqVerdict';" "$f" || fail "$f must import from '../mcq/mcqVerdict' with 'import type' only"
  if grep -Eq "^import \{[^}]*\} from '\.\./mcq/mcqVerdict';" "$f"; then
    fail "$f imports a value from mcqVerdict.ts — describeScheduledRating / mapMcqVerdictToRating belong to D05"
  fi
done
# 2c. McqActionDock.tsx — pinned props, copy, roles, the dock testID default
for sym in "export type McqActionDockProps = {" \
           "testID?: string;" "stage: McqStage;" "requiredCount: number;" "selectedCount: number;" "disabled?: boolean;" \
           "isLastNode: boolean;" "onShowOptions: () => void;" "onSubmit: (confidence: McqConfidence) => void;" \
           "onDontKnow: () => void;" "onNext: () => void;" \
           "export function McqActionDock(props: McqActionDockProps)" \
           "mcqSelectedCount(" "MCQ_COPY.showOptions" "MCQ_COPY.sure" "MCQ_COPY.unsure" "MCQ_COPY.dontKnow" \
           "MCQ_COPY.confidenceHint" "MCQ_COPY.next" "MCQ_COPY.finishRun" \
           "MCQ_TEST_IDS.showOptions" "MCQ_TEST_IDS.submitSure" "MCQ_TEST_IDS.submitUnsure" "MCQ_TEST_IDS.dontKnow" \
           "MCQ_TEST_IDS.next" "MCQ_TEST_IDS.dockHint" "MCQ_TEST_IDS.selectedCount" \
           'accessibilityRole="button"' "minHeight: 56" "minHeight: 48" \
           "from '../mcq/mcqConstants'" "from '../mcq/mcqVerdict'" "from './McqReviewBody'"; do
  grep -Fq "$sym" "$DOCK" || fail "McqActionDock.tsx lacks: $sym"
done
grep -Eq "testID = (MCQ_TEST_IDS\.dock|'review-rating-bar')" "$DOCK" || fail "McqActionDock.tsx: testID must default to 'review-rating-bar' (MCQ_TEST_IDS.dock)"
if grep -q "revealed" "$DOCK"; then fail "McqActionDock.tsx must not carry RatingBar's revealed prop"; fi
# 2d. McqCoachLine.tsx — pinned props, copy, null when hidden
grep -Fq "export type McqCoachLineProps = { visible: boolean; onDismiss: () => void; testID?: string" "$COACH" || fail "McqCoachLine.tsx lacks the pinned McqCoachLineProps line"
for sym in "export function McqCoachLine(props: McqCoachLineProps)" "MCQ_COPY.coach" "MCQ_COPY.coachDismiss" \
           "MCQ_TEST_IDS.coachLine" "MCQ_TEST_IDS.coachDismiss" 'accessibilityRole="button"' "return null" "minHeight: 44" \
           "from '../mcq/mcqConstants'"; do
  grep -Fq "$sym" "$COACH" || fail "McqCoachLine.tsx lacks: $sym"
done
# 2e. mcqCoachPrefs.ts — ceremonyPrefs pattern: re-export, both signatures, storage import, timer race, no memo, no user scoping
grep -Fq "export { MCQ_COACH_SEEN_KEY, MCQ_COACH_READ_TIMEOUT_MS } from './mcqConstants';" "$PREFS" || fail "mcqCoachPrefs.ts lacks the pinned re-export line"
grep -Eq "export (async )?function readMcqCoachSeen\(\): Promise<boolean>" "$PREFS" || fail "mcqCoachPrefs.ts lacks readMcqCoachSeen(): Promise<boolean>"
grep -Eq "export (async )?function markMcqCoachSeen\(\): Promise<void>" "$PREFS"    || fail "mcqCoachPrefs.ts lacks markMcqCoachSeen(): Promise<void>"
for sym in "import AsyncStorage from '@react-native-async-storage/async-storage';" "MCQ_COACH_SEEN_KEY" "MCQ_COACH_READ_TIMEOUT_MS" \
           "setTimeout(" "clearTimeout(" "getItem(" "setItem(" "'1'"; do
  grep -Fq "$sym" "$PREFS" || fail "mcqCoachPrefs.ts lacks: $sym"
done
if grep -Eq "^let |getUserScopedKey|__DEV__|from 'react|require\(" "$PREFS"; then
  grep -En "^let |getUserScopedKey|__DEV__|from 'react|require\(" "$PREFS" >&2 || true
  fail "mcqCoachPrefs.ts must be device-global, memo-free and import only AsyncStorage + mcqConstants (ceremonyPrefs pattern)"
fi
# 2f. tests — harnesses, sentinels, titles, counts
grep -Fq "from 'react-test-renderer'" "$BT" || fail "mcqReviewBody.test.tsx must use react-test-renderer"
grep -Fq "vi.mock('react-native'" "$BT"     || fail "mcqReviewBody.test.tsx must factory-mock react-native (reviewBody.test.tsx:16-31)"
grep -Fq "from '../../src/features/gacha/components/McqReviewBody'" "$BT" || fail "mcqReviewBody.test.tsx must import McqReviewBody"
grep -Fq "from '../../src/features/gacha/mcq/mcqConstants'" "$BT" || fail "mcqReviewBody.test.tsx must import the copy from mcqConstants"
for sym in "rowStateFor" "stemSegments" "MCQ_BODY_TEST_IDS" "'Option B of 4: '" "'radio'" "'checkbox'" "allowFontScaling" "maxFontSizeMultiplier" \
           "mcq-why-toggle-" "Deselect one first" "numberOfLines" "code-block-language" "mcq-redeal-banner" \
           "Write a key policy with one statement that grants"; do
  grep -Fq "$sym" "$BT" || fail "mcqReviewBody.test.tsx lacks: $sym"
done
for s in \
  'renders the full stem with the qualifier in bold' \
  'bolds all-caps words when the qualifier is absent or not found' \
  'collapses the stem to three lines on the options stage until Show full question' \
  'assigns letters by displayed position, never by key' \
  'uses radio for single and checkbox for multi with checked state' \
  'ignores a pick beyond the limit and says so' \
  'shows the four verdict row states with their WHYs' \
  'renders sections in order and the qualifier section only with a qualifier' \
  'shows the redeal banner from the second attempt' \
  'never disables font scaling and never clamps option text'; do
  grep -Fq "it('$s'" "$BT" || fail "missing mcqReviewBody test case: $s"
done
grep -Fq "from '../../src/features/gacha/components/McqActionDock'" "$DT" || fail "mcqActionDock.test.tsx must import McqActionDock"
for sym in "vi.mock('react-native'" "mcq-submit-sure" "mcq-submit-unsure" "mcq-dont-know" "mcq-show-options" "mcq-next" \
           "mcq-selected-count" "'1 of 2 selected'" "'Finish run'" "accessibilityRole" "accessibilityState" "'review-rating-bar'"; do
  grep -Fq "$sym" "$DT" || fail "mcqActionDock.test.tsx lacks: $sym"
done
for s in \
  'shows one button per stage and gates submit on a full pick' \
  'says Finish run on the last node' \
  'carries a button role and disabled state on every pressable'; do
  grep -Fq "it('$s'" "$DT" || fail "missing mcqActionDock test case: $s"
done
grep -Fq "from '../../src/features/gacha/components/McqCoachLine'" "$CT" || fail "mcqCoachLine.test.tsx must import McqCoachLine"
for sym in "vi.mock('react-native'" "mcq-coach-line" "mcq-coach-dismiss" "toJSON()" "'Got it'"; do
  grep -Fq "$sym" "$CT" || fail "mcqCoachLine.test.tsx lacks: $sym"
done
for s in \
  'renders nothing when hidden' \
  'shows the coach copy and dismisses through the button'; do
  grep -Fq "it('$s'" "$CT" || fail "missing mcqCoachLine test case: $s"
done
for sym in "vi.mock('@react-native-async-storage/async-storage'" "vi.resetModules()" "useFakeTimers" "advanceTimersByTimeAsync" \
           "'recallsmith:mcq:coach-seen:v1'" "../../src/features/gacha/mcq/mcqCoachPrefs" "'write-throw'" "'hang'"; do
  grep -Fq "$sym" "$PT" || fail "mcqCoachPrefs.test.ts lacks: $sym"
done
for s in \
  'reads not seen when nothing is stored' \
  'reads seen on garbage, error or a slow read' \
  'marks and re-reads seen' \
  'exports the device-global key and the read budget'; do
  grep -Fq "it('$s'" "$PT" || fail "missing mcqCoachPrefs test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$BT" || true)" -ge 10 ] || fail "mcqReviewBody.test.tsx needs >= 10 it() blocks"
[ "$(grep -cE "^\s*it\(" "$DT" || true)" -ge 3 ]  || fail "mcqActionDock.test.tsx needs >= 3 it() blocks"
[ "$(grep -cE "^\s*it\(" "$CT" || true)" -ge 2 ]  || fail "mcqCoachLine.test.tsx needs >= 2 it() blocks"
[ "$(grep -cE "^\s*it\(" "$PT" || true)" -ge 4 ]  || fail "mcqCoachPrefs.test.ts needs >= 4 it() blocks"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$PREFS" "$BODY" "$DOCK" "$COACH" "$BT" "$DT" "$CT" "$PT" \
  && fail "test gutting / suppression found"
# 2g. Existing suites this issue sits beside are zero-diff against the base
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
git diff --quiet "$mb" -- \
  mobile/tests/unit/reviewBody.test.tsx \
  mobile/tests/unit/ratingBar.test.tsx \
  mobile/tests/unit/ceremonyPrefs.test.ts \
  mobile/tests/integration/session-card.screen.test.tsx \
  mobile/tests/unit/mcqConstants.test.ts \
  mobile/tests/unit/mcqVerdict.spec.ts \
  mobile/tests/unit/mcqShuffle.test.ts \
  mobile/tests/unit/normalizeMcq.test.ts \
  || fail "an existing test file changed — D04 is add-only on tests (D00 §1.1)"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new suites + the component / prefs / screen suites they sit beside) ──
echo "[4/5] vitest mcqReviewBody / mcqActionDock / mcqCoachLine / mcqCoachPrefs + neighbours"
( cd mobile && npx vitest run \
    tests/unit/mcqReviewBody.test.tsx \
    tests/unit/mcqActionDock.test.tsx \
    tests/unit/mcqCoachLine.test.tsx \
    tests/unit/mcqCoachPrefs.test.ts \
    tests/unit/reviewBody.test.tsx \
    tests/unit/ratingBar.test.tsx \
    tests/unit/ceremonyPrefs.test.ts \
    tests/integration/session-card.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The three frozen files: zero diff (D01 holds the wave's only exception; not this issue)
git diff --quiet "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen file changed (deckRepository.ts / progressSync.ts / model.ts must be zero-diff in D04)"
# 5b. The do-not-touch list and the OTA manifest set
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/features/gacha/components/ReviewBody.tsx mobile/src/features/gacha/components/RatingBar.tsx \
  mobile/src/screens/SessionCardScreen.tsx mobile/src/screens/SessionSummaryScreen.tsx mobile/src/navigation/types.ts \
  mobile/src/features/gacha/mcq/normalizeMcq.ts mobile/src/features/gacha/mcq/mcqConstants.ts \
  mobile/src/features/gacha/mcq/mcqVerdict.ts mobile/src/features/gacha/mcq/mcqShuffle.ts mobile/src/features/gacha/mcq/mcqRotation.ts \
  mobile/src/types/deckExport.ts mobile/src/config/featureFlags.ts mobile/src/config/remoteConfig.ts mobile/src/config/forceUpdateGate.ts \
  mobile/src/review/storage.ts mobile/src/content/chunkedInstall.ts mobile/src/features/gacha/contracts.ts \
  mobile/src/features/gacha/session/reviewContentHelpers.tsx mobile/src/components/CodeBlock.tsx mobile/src/components/ceremonyHaptics.ts \
  mobile/src/features/gacha/draw/ceremonyPrefs.ts mobile/src/theme \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
# 5c. Reader guard: card.Mcq is read only by the three canonical files plus the planner's
#     pinned normalizeMcq(card.Mcq) line (D03 is merged before D04; D00 §0 / §6 #19)
readers="$(grep -rln '\.Mcq\b' mobile/src | grep -Ev '^mobile/src/(types/deckExport\.ts|content/deckRepository\.ts|features/gacha/mcq/normalizeMcq\.ts|features/gacha/planner/sessionPlanner\.ts)$' || true)"
[ -z "$readers" ] || { echo "$readers" >&2; fail "card.Mcq read outside deckExport.ts / deckRepository.ts / normalizeMcq.ts / planner/sessionPlanner.ts (D00 §0)"; }
# 5d. Every changed or untracked path is one of the eight scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json; } | sort -u | grep -Ev '^(mobile/src/features/gacha/mcq/mcqCoachPrefs\.ts|mobile/src/features/gacha/components/McqReviewBody\.tsx|mobile/src/features/gacha/components/McqActionDock\.tsx|mobile/src/features/gacha/components/McqCoachLine\.tsx|mobile/tests/unit/mcqReviewBody\.test\.tsx|mobile/tests/unit/mcqActionDock\.test\.tsx|mobile/tests/unit/mcqCoachLine\.test\.tsx|mobile/tests/unit/mcqCoachPrefs\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside D04 scope"; }

echo "D04 VERIFY OK"
