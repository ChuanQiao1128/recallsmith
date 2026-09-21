#!/usr/bin/env bash
# D05 — session-card-mcq-branch verify. cwd = worktree root. Re-runs the brief's
# five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/tests/integration/session-card-mcq.screen.test.tsx,
#     mobile/tests/integration/session-summary-picks.screen.test.tsx and
#     mobile/tests/unit/clientCapabilitiesMcq.test.ts do not exist on base
#   (step 1 then also checks the D01–D04 prerequisites: the six pure modules
#   under mobile/src/features/gacha/mcq/, the three Mcq*.tsx components and the
#   planner's kindHint key must be on the integration branch, because D00 §4
#   orders D01 → D02 → D03 → D04 → D05 — the screen imports all of them)
# Step 2 (literal guards: the state/ref/handler lines, both kindHint call
# sites, the picks spread, the token line, the it('…') titles, the bounded
# clientCapabilities.test.ts edit) would also fail on base. Steps 3/4 are the
# tsc / targeted-vitest gates and step 5 is a scope + frozen + OTA guard;
# both pass on base by design.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (C00 §0, D00 §0).
#
# Diffs are merge-base → working tree (C07 skeleton), so committed and
# uncommitted worker changes are both seen; new files come from the untracked scan.
#
# Network: none. No npm install, no expo, no prebuild. Runtime ≈ 2–3 min (tsc).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-d-mcq}}"   # driver exports BASE
fail() { echo "D05 VERIFY FAIL: $*" >&2; exit 1; }

SCREEN=mobile/src/screens/SessionCardScreen.tsx
SUMMARY=mobile/src/screens/SessionSummaryScreen.tsx
TYPES=mobile/src/navigation/types.ts
CAPS=mobile/src/sync/clientCapabilities.ts
MT=mobile/tests/integration/session-card-mcq.screen.test.tsx
PT=mobile/tests/integration/session-summary-picks.screen.test.tsx
CT=mobile/tests/unit/clientCapabilitiesMcq.test.ts
CAPS_T=mobile/tests/unit/clientCapabilities.test.ts
MCQ_DIR=mobile/src/features/gacha/mcq
COMP=mobile/src/features/gacha/components
PLANNER=mobile/src/features/gacha/planner/sessionPlanner.ts

SUPPRESS='\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable'
KILL_LINE="applyRemoteFeatures({ features: { mcq: { enabled: false } } });"
FRESH_KILL_LINE="(await import('../../src/config/featureFlags')).applyRemoteFeatures({ features: { mcq: { enabled: false } } });"
CAPS_IMPORT="import { applyRemoteFeatures } from '../../src/config/featureFlags';"
OLD_T1="it('never sends undefined-valued keys', async () => {"
OLD_T2="it('ships no feature tokens in Wave C', async () => {"
NEW_T1="it('never sends undefined-valued keys under the kill switch', async () => {"
NEW_T2="it('ships no feature tokens beyond the flag-gated mcq token', async () => {"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ D01–D04 prerequisites)"
for f in "$MT" "$PT" "$CT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$SCREEN" "$SUMMARY" "$TYPES" "$CAPS" "$CAPS_T"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
for f in normalizeMcq mcqConstants mcqVerdict mcqShuffle mcqRotation mcqCoachPrefs; do
  [ -f "$MCQ_DIR/$f.ts" ] || fail "$MCQ_DIR/$f.ts is missing — D01–D04 must be merged before D05 (D00 §4)"
done
for f in McqReviewBody McqActionDock McqCoachLine; do
  [ -f "$COMP/$f.tsx" ] || fail "$COMP/$f.tsx is missing — D04 must be merged before D05 (D00 §4)"
done
grep -Fq "export function buildKindHint" "$MCQ_DIR/mcqRotation.ts"          || fail "mcqRotation.ts lacks buildKindHint (D03 incomplete)"
grep -Fq "export function noteServedCard" "$MCQ_DIR/mcqRotation.ts"         || fail "mcqRotation.ts lacks noteServedCard (D03 incomplete)"
grep -Fq "export function resolveMcq" "$MCQ_DIR/normalizeMcq.ts"            || fail "normalizeMcq.ts lacks resolveMcq (D01 incomplete)"
grep -Fq "export function mapMcqVerdictToRating" "$MCQ_DIR/mcqVerdict.ts"   || fail "mcqVerdict.ts lacks mapMcqVerdictToRating (D02 incomplete)"
grep -Fq "export function describeScheduledRating" "$MCQ_DIR/mcqVerdict.ts" || fail "mcqVerdict.ts lacks describeScheduledRating (D02 incomplete)"
grep -Fq "export function shownOrderFor" "$MCQ_DIR/mcqShuffle.ts"           || fail "mcqShuffle.ts lacks shownOrderFor (D02 incomplete)"
grep -Fq "export function mcqPicksLine" "$MCQ_DIR/mcqConstants.ts"          || fail "mcqConstants.ts lacks mcqPicksLine (D02 incomplete)"
grep -Fq "readMcqCoachSeen" "$MCQ_DIR/mcqCoachPrefs.ts"                    || fail "mcqCoachPrefs.ts lacks readMcqCoachSeen (D04 incomplete)"
grep -Fq "kindHint?: McqKindHint | null;" "$PLANNER"                        || fail "sessionPlanner.ts lacks the kindHint param (D03 incomplete)"

mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
MB="$mb"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. SessionCardScreen.tsx — imports (module specifiers only; the import form is D04's)
for sym in "import * as RN from 'react-native';" \
           "from '../config/featureFlags'" \
           "from '../components/ceremonyHaptics'" \
           "from '../features/gacha/mcq/normalizeMcq'" \
           "from '../features/gacha/mcq/mcqConstants'" \
           "from '../features/gacha/mcq/mcqVerdict'" \
           "from '../features/gacha/mcq/mcqShuffle'" \
           "from '../features/gacha/mcq/mcqRotation'" \
           "from '../features/gacha/mcq/mcqCoachPrefs'" \
           "from '../features/gacha/components/McqReviewBody'" \
           "from '../features/gacha/components/McqActionDock'" \
           "from '../features/gacha/components/McqCoachLine'"; do
  grep -Fq "$sym" "$SCREEN" || fail "SessionCardScreen.tsx lacks import: $sym"
done
# 2b. SessionCardScreen.tsx — module-level, state, refs, helper, handlers, render
for sym in "readRN('AccessibilityInfo', null)" \
           "const MCQ_DOCK_HEIGHT = 216;" \
           "type McqCardState = {" \
           "const EMPTY_MCQ_CARD_STATE: McqCardState" \
           "function sameSet(" \
           "function mcqHaptic(" \
           "const [mcqState, setMcqState] = useState<McqCardState>(EMPTY_MCQ_CARD_STATE);" \
           "const renderAsMcq = mcqState.mcq !== null;" \
           "const [coachSeen, setCoachSeen] = useState<boolean | null>(null);" \
           "const mcqRunRef = useRef<McqRunState>(EMPTY_MCQ_RUN_STATE);" \
           "function applyCurrent(" \
           "applyCurrent(nextCurrent, nextSessionId)" \
           "applyCurrent(nextState.nextCurrent, useSessionStore.getState().sessionId ?? '')" \
           "resolveMcq(next.card, flags)" \
           "noteServedCard(" \
           "shownOrderFor(mcq, mcqSeed(sessionIdForSeed, uid, attemptIndex))" \
           "readMcqCoachSeen()" \
           "markMcqCoachSeen()" \
           "function handleShowOptions(" \
           "function handleToggleOption(" \
           "function settleMcq(" \
           "function handleSubmit(" \
           "function handleDontKnow(" \
           "function handleMcqNext(" \
           "function handleCoachDismiss(" \
           "void handleRating(mappedRating);" \
           "resolveMcqVerdict(" \
           "mapMcqVerdictToRating({" \
           "describeScheduledRating(" \
           "announceForAccessibility?.(" \
           "const ratingDockHeight = (renderAsMcq ? MCQ_DOCK_HEIGHT : 164) + Math.max(insets.bottom, 8);" \
           "<McqReviewBody" \
           "<McqActionDock" \
           "<McqCoachLine" \
           "<ReviewBody" \
           "<RatingBar" \
           "...(picksRef.current.answered > 0 ? { picks: { ...picksRef.current } } : {})," \
           "...(nextLoadForecast ? { loadForecast: nextLoadForecast } : {})," \
           "reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review'," \
           "async function handleRating(rating: UiRating)" \
           'testID="review-rating-dock"'; do
  grep -Fq "$sym" "$SCREEN" || fail "SessionCardScreen.tsx lacks: $sym"
done
[ "$(grep -Fc "kindHint: buildKindHint(mcqRunRef.current, getFeatureFlags())," "$SCREEN" || true)" = "2" ] \
  || fail "SessionCardScreen.tsx: the kindHint line must appear exactly twice (pickNextCard + buildRatedSessionState)"
[ "$(grep -Fc 'testID="review-rating-bar"' "$SCREEN" || true)" = "2" ] \
  || fail "SessionCardScreen.tsx: testID=\"review-rating-bar\" must appear exactly twice (RatingBar + McqActionDock)"
[ "$(grep -Fc 'testID="review-rating-dock"' "$SCREEN" || true)" = "1" ] \
  || fail "SessionCardScreen.tsx: exactly one review-rating-dock View"
[ "$(grep -Fc "reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review'," "$SCREEN" || true)" = "1" ] \
  || fail "SessionCardScreen.tsx: the recordReviewEvent reviewStage line must occur exactly once"
[ "$(grep -Fc "async function handleRating(rating: UiRating)" "$SCREEN" || true)" = "1" ] \
  || fail "SessionCardScreen.tsx: handleRating's signature must occur exactly once and unchanged"
[ "$(grep -Fc "// eslint-disable-next-line react-hooks/exhaustive-deps" "$SCREEN" || true)" = "1" ] \
  || fail "SessionCardScreen.tsx: the pre-existing lint directive must remain exactly once"
if grep -Eq "import \{[^}]*(Platform|AccessibilityInfo|Vibration)[^}]*\} from 'react-native'" "$SCREEN" "$SUMMARY"; then
  fail "a screen names Platform / AccessibilityInfo / Vibration in a react-native named import (factory-mock rule, D00 §2.4)"
fi
if grep -Eq "from 'expo-haptics'|from 'expo-updates'|useFeatureFlags" "$SCREEN" "$SUMMARY" "$CAPS"; then
  grep -En "from 'expo-haptics'|from 'expo-updates'|useFeatureFlags" "$SCREEN" "$SUMMARY" "$CAPS" >&2 || true
  fail "static expo-haptics / expo-updates import or a live flag hook in a D05 source file"
fi
# 2c. SessionCardScreen.tsx — diff-shaped guards against the base
screen_diff="$(git diff -U0 "$MB" -- "$SCREEN")"
screen_minus="$(printf '%s\n' "$screen_diff" | grep '^-' | grep -v '^---' || true)"
screen_plus="$(printf '%s\n' "$screen_diff" | grep '^+' | grep -v '^+++' || true)"
[ -n "$screen_plus" ] || fail "SessionCardScreen.tsx has no added lines against the base"
if printf '%s\n' "$screen_minus" | grep -Eq 'recordReviewEvent|reviewStage:|dwellTimeMs:|statedDifficulty:|cardRevision:|progressAfter:'; then
  printf '%s\n' "$screen_minus" >&2
  fail "SessionCardScreen.tsx: a removed line touches the recordReviewEvent call (D00 §0: byte-identical)"
fi
if printf '%s\n%s\n' "$screen_minus" "$screen_plus" | grep -Fq "eslint-disable"; then
  fail "SessionCardScreen.tsx: the lint directive at base :413 moved or was retyped (fails the driver's suppression scan)"
fi
if printf '%s\n%s\n' "$screen_minus" "$screen_plus" | grep -Eq "features/gacha/(planner/sessionPlanner|session/sessionReviewHelpers)'"; then
  fail "SessionCardScreen.tsx: the sessionPlanner / sessionReviewHelpers import statements must be byte-identical (factory-mocked suites)"
fi
if printf '%s\n%s\n' "$screen_minus" "$screen_plus" | grep -Eq "^[-+]\s*(buildRatedSessionState|buildSessionProgressVM|type CurrentCardLike|ActivityIndicator|Alert|Pressable|ScrollView|StyleSheet|Text|View),\s*$"; then
  fail "SessionCardScreen.tsx: a react-native or planner-helper import member line changed"
fi
if printf '%s\n' "$screen_plus" | grep -Eq "^\+.*from 'react-native'" && [ "$(printf '%s\n' "$screen_plus" | grep -Ec "from 'react-native'" || true)" != "1" ]; then
  fail "SessionCardScreen.tsx: the only added react-native import may be the namespace import"
fi
if printf '%s\n' "$screen_plus" | grep -Eq "from 'react-native'" && ! printf '%s\n' "$screen_plus" | grep -Fq "+import * as RN from 'react-native';"; then
  fail "SessionCardScreen.tsx: the added react-native import must be exactly \`import * as RN from 'react-native';\`"
fi
if printf '%s\n' "$screen_plus" | grep -Eq "numberOfLines|allowFontScaling|maxFontSizeMultiplier"; then
  printf '%s\n' "$screen_plus" | grep -En "numberOfLines|allowFontScaling|maxFontSizeMultiplier" >&2 || true
  fail "SessionCardScreen.tsx: no added line may clamp or freeze text (plan §6.3/§6.5, D00 §6 #17)"
fi
# 2d. The reader rule (D00 §0 / §6 #19): after D03 exactly four files may spell .Mcq — the three
#     canonical ones plus the planner's pinned normalizeMcq(card.Mcq) line; D05 adds none.
mcq_readers="$(grep -rln '\.Mcq\b' mobile/src | grep -Ev '^(mobile/src/types/deckExport\.ts|mobile/src/content/deckRepository\.ts|mobile/src/features/gacha/mcq/normalizeMcq\.ts|mobile/src/features/gacha/planner/sessionPlanner\.ts)$' || true)"
[ -z "$mcq_readers" ] || { echo "$mcq_readers" >&2; fail ".Mcq is read outside the four readers allowed after D03 (deckExport.ts / deckRepository.ts / normalizeMcq.ts / planner/sessionPlanner.ts)"; }
# 2e. navigation/types.ts — the picks field, zero removed lines, only the field (+ comments) added
grep -Fq "picks?: { landed: number; answered: number };" "$TYPES" || fail "types.ts lacks SessionSummary.picks?"
grep -A1 -F "loadForecast?: string;" "$TYPES" | grep -Eq "picks\?: \{ landed: number; answered: number \};|^\s*/\*\*" \
  || fail "types.ts: picks? (or its one-line comment) must directly follow loadForecast?: string;"
types_minus="$(git diff -U0 "$MB" -- "$TYPES" | grep '^-' | grep -v '^---' || true)"
[ -z "$types_minus" ] || { echo "$types_minus" >&2; fail "types.ts: D05 removes no line"; }
types_plus_code="$(git diff -U0 "$MB" -- "$TYPES" | grep '^+' | grep -v '^+++' | sed 's/^+//' | sed 's/^[[:space:]]*//' | grep -vE '^(/\*\*|\*|//)' || true)"
[ "$types_plus_code" = "picks?: { landed: number; answered: number };" ] \
  || { printf '%s\n' "$types_plus_code" >&2; fail "types.ts: the only non-comment added line must be the picks? field"; }
# 2f. SessionSummaryScreen.tsx — import, destructuring, the line
for sym in "from '../features/gacha/mcq/mcqConstants'" \
           'testID="session-summary-picks"' \
           "mcqPicksLine(picks)" \
           'testID="session-summary-load-forecast"'; do
  grep -Fq "$sym" "$SUMMARY" || fail "SessionSummaryScreen.tsx lacks: $sym"
done
grep -Fq "const { sessionId, deckTitle, slug, sessionDone, sessionLimit, minimumGoal, dueCount, streakEarned = false, reward, loadForecast, picks } = route.params;" "$SUMMARY" \
  || fail "SessionSummaryScreen.tsx: picks must join the existing destructuring after loadForecast"
# 2g. clientCapabilities.ts — flag-gated token, everything else intact
for sym in "import { getFeatureFlags } from '../config/featureFlags';" \
           "getFeatureFlags().mcq.enabled ? [...CLIENT_FEATURES, 'mcq'] : CLIENT_FEATURES" \
           "export const CLIENT_FEATURES: readonly string[] = [];" \
           "export const MAX_CLIENT_FEATURES = 16;" \
           "export function normalizeClientFeatures(input: readonly unknown[]): string[] {" \
           "export function resetClientCapabilitiesForTests(): void {" \
           "await import('expo-updates')"; do
  grep -Fq "$sym" "$CAPS" || fail "clientCapabilities.ts lacks: $sym"
done
# 2h. session-card-mcq.screen.test.tsx — harness, fixtures, titles
for sym in "vi.mock('react-native'" \
           "vi.mock('../../src/config/featureFlags'" \
           "vi.mock('@react-native-async-storage/async-storage'" \
           "vi.mock('../../src/features/gacha/planner/sessionPlanner'" \
           "vi.mock('../../src/features/gacha/session/sessionReviewHelpers'" \
           "vi.mock('../../src/sync/progressSync'" \
           "vi.mock('../../src/features/gacha/rewards/sessionRewards'" \
           "vi.useFakeTimers({ toFake: ['Date'] })" \
           "vi.setSystemTime(" \
           "vi.useRealTimers()" \
           "from '../../src/features/gacha/mcq/mcqShuffle'" \
           "from '../../src/features/gacha/mcq/normalizeMcq'" \
           "aws-sqs-order-buffer-mcq-01" \
           "aws-s3-compliance-copy-mcq-02" \
           "recallsmith:mcq:coach-seen:v1" \
           "kindHint: null" \
           "kindHint: { mcqAllowed: true, preferMcq: true }" \
           "kindHint: { mcqAllowed: true, preferMcq: false }" \
           "picks: { landed: 1, answered: 1 }" \
           "picks: { landed: 0, answered: 1 }" \
           "Reveal answer" \
           "toHaveLength(481)" \
           "mcq-redeal-banner" \
           "mcq-coach-dismiss"; do
  grep -Fq "$sym" "$MT" || fail "session-card-mcq.screen.test.tsx lacks: $sym"
done
for s in \
  'renders the stem stage first with recall-first on' \
  'answers a single-choice card correctly and rates it good on first review' \
  'rates a wrong pick again and reports zero landed picks' \
  'skips the stem stage when recallFirst is off' \
  'renders the card as Q/A under the kill switch' \
  'walks a choose-two card: count, over-limit hint, partial verdict, hard' \
  'never truncates the stem or an option under Dynamic Type' \
  'gives good, not easy, to a changed pick on repeat review and easy to a fast unchanged one' \
  're-deals an again card with a new order and the redeal banner' \
  'passes a kind hint to the planner on both call sites' \
  'shows the coach line once and marks it seen on Next'; do
  grep -Fq "it('$s'" "$MT" || fail "missing session-card-mcq test case: $s"
done
grep -Fq "it(\"rates I don't know as again without a pick\"" "$MT" || fail "missing session-card-mcq test case: rates I don't know as again without a pick"
[ "$(grep -cE "^\s*it\(" "$MT" || true)" -ge 12 ] || fail "session-card-mcq.screen.test.tsx needs >= 12 it() blocks"
# 2i. session-summary-picks.screen.test.tsx
for sym in "vi.mock('@react-native-async-storage/async-storage'" \
           "session-summary-picks" \
           "3 of 5 picks landed" \
           "0 of 5 picks landed — they're all back in 10 minutes" \
           "'summary-reward-block', 'session-summary-load-forecast', 'session-summary-picks', 'summary-progress-block'"; do
  grep -Fq "$sym" "$PT" || fail "session-summary-picks.screen.test.tsx lacks: $sym"
done
for s in \
  'renders the picks line under the forecast line' \
  'spells out the ten-minute return when no pick landed' \
  'renders no picks line for a Q/A run'; do
  grep -Fq "it('$s'" "$PT" || fail "missing session-summary-picks test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$PT" || true)" -ge 3 ] || fail "session-summary-picks.screen.test.tsx needs >= 3 it() blocks"
# 2j. clientCapabilitiesMcq.test.ts
for sym in "vi.mock('expo-updates'" \
           "from '../../src/config/featureFlags'" \
           "from '../../src/sync/clientCapabilities'" \
           "clientFeatures: ['mcq']" \
           "$KILL_LINE" \
           "['alpha', 'mcq', 'zeta']"; do
  grep -Fq "$sym" "$CT" || fail "clientCapabilitiesMcq.test.ts lacks: $sym"
done
for s in \
  'advertises mcq under the default flags' \
  'sends no clientFeatures key under the kill switch' \
  'reads the flag at call time and keeps CLIENT_FEATURES empty' \
  'still sorts, dedupes and caps the token list'; do
  grep -Fq "it('$s'" "$CT" || fail "missing clientCapabilitiesMcq test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$CT" || true)" -ge 4 ] || fail "clientCapabilitiesMcq.test.ts needs >= 4 it() blocks"
# 2k. clientCapabilities.test.ts — the bounded edit (brief gap 1, D00 §3.5)
grep -Fq "$NEW_T1" "$CAPS_T" || fail "clientCapabilities.test.ts lacks the retitled case: $NEW_T1"
grep -Fq "$NEW_T2" "$CAPS_T" || fail "clientCapabilities.test.ts lacks the retitled case: $NEW_T2"
grep -Fq "$OLD_T1" "$CAPS_T" && fail "clientCapabilities.test.ts still carries the old title: $OLD_T1"
grep -Fq "$OLD_T2" "$CAPS_T" && fail "clientCapabilities.test.ts still carries the old title: $OLD_T2"
grep -Fq "$CAPS_IMPORT" "$CAPS_T" || fail "clientCapabilities.test.ts lacks: $CAPS_IMPORT"
[ "$(grep -Fc "$FRESH_KILL_LINE" "$CAPS_T" || true)" = "2" ] \
  || fail "clientCapabilities.test.ts: the two vi.resetModules() cases each need the fresh-registry kill-switch line"
[ "$(grep -Fc "$KILL_LINE" "$CAPS_T" || true)" -ge 3 ] \
  || fail "clientCapabilities.test.ts: beforeEach and both retitled cases need the kill-switch line"
git show "$MB:$CAPS_T" | grep -oE "^\s*it\('[^']*'" | sed 's/^[[:space:]]*//' | while IFS= read -r title; do
  case "$title" in
    "it('never sends undefined-valued keys'"|"it('ships no feature tokens in Wave C'") continue ;;
  esac
  grep -Fq "$title" "$CAPS_T" || { echo "D05 VERIFY FAIL: clientCapabilities.test.ts lost a base title: $title" >&2; exit 1; }
done
caps_t_minus="$(git diff -U0 "$MB" -- "$CAPS_T" | grep '^-' | grep -v '^---' | sed 's/^-//' | sed 's/^[[:space:]]*//' || true)"
[ "$caps_t_minus" = "$(printf '%s\n%s' "$OLD_T1" "$OLD_T2")" ] \
  || { printf '%s\n' "$caps_t_minus" >&2; fail "clientCapabilities.test.ts: the only removed lines must be the two old it( titles"; }
caps_t_plus_bad="$(git diff -U0 "$MB" -- "$CAPS_T" | grep '^+' | grep -v '^+++' | sed 's/^+//' | sed 's/^[[:space:]]*//' \
  | grep -Fxv -e "$CAPS_IMPORT" -e "$KILL_LINE" -e "$FRESH_KILL_LINE" -e "$NEW_T1" -e "$NEW_T2" || true)"
[ -z "$caps_t_plus_bad" ] || { printf '%s\n' "$caps_t_plus_bad" >&2; fail "clientCapabilities.test.ts: an added line is outside the allow-list (no assertion may change)"; }
# 2l. Suppression scan: whole new files + the '+' lines of edited files (never a whole pre-existing file: :413 holds one)
grep -Eq "$SUPPRESS" "$MT" "$PT" "$CT" && fail "test gutting / suppression found in a new test file"
for f in "$SCREEN" "$SUMMARY" "$TYPES" "$CAPS" "$CAPS_T"; do
  if git diff -U0 "$MB" -- "$f" | grep '^+' | grep -v '^+++' | grep -Eq "$SUPPRESS"; then
    fail "suppression token in an added line of $f"
  fi
done
# 2m. The untouched suites and the D01–D04 trees are zero-diff
git diff --quiet "$MB" -- \
  mobile/tests/integration/session-card.screen.test.tsx \
  mobile/tests/integration/session-summary.screen.test.tsx \
  mobile/tests/unit/ratingBar.test.tsx \
  mobile/tests/unit/reviewBody.test.tsx \
  mobile/tests/unit/session-store.test.ts \
  mobile/tests/unit/sessionRewards.test.ts \
  mobile/tests/unit/featureFlags.test.ts \
  mobile/tests/unit/progressSyncEnvelopeBytes.test.ts \
  mobile/tests/unit/planner.test.ts \
  || fail "an untouched suite changed — D05 edits exactly one existing test file (clientCapabilities.test.ts)"
git diff --quiet "$MB" -- "$MCQ_DIR" "$COMP" mobile/src/features/gacha/planner mobile/src/features/gacha/session \
  mobile/src/features/gacha/rewards mobile/src/config mobile/src/types \
  || fail "a D01–D04 file or a do-not-touch directory changed"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (new suites + the suites they sit beside + every D01–D04 suite present) ──
echo "[4/5] vitest session-card-mcq / session-summary-picks / clientCapabilities / neighbours"
suites=(
  tests/integration/session-card-mcq.screen.test.tsx
  tests/integration/session-summary-picks.screen.test.tsx
  tests/unit/clientCapabilitiesMcq.test.ts
  tests/unit/clientCapabilities.test.ts
  tests/integration/session-card.screen.test.tsx
  tests/integration/session-summary.screen.test.tsx
  tests/unit/ratingBar.test.tsx
  tests/unit/reviewBody.test.tsx
  tests/unit/session-store.test.ts
  tests/unit/sessionRewards.test.ts
  tests/unit/featureFlags.test.ts
  tests/unit/progressSyncEnvelopeBytes.test.ts
  tests/unit/planner.test.ts
)
for f in tests/unit/normalizeMcq.test.ts tests/unit/deckRepositoryMcq.test.ts tests/unit/mcqVerdict.spec.ts \
         tests/unit/mcqShuffle.test.ts tests/unit/mcqConstants.test.ts tests/unit/mcqRotation.test.ts \
         tests/unit/plannerKindHint.test.ts tests/unit/mcqReviewBody.test.tsx tests/unit/mcqActionDock.test.tsx \
         tests/unit/mcqCoachLine.test.tsx tests/unit/mcqCoachPrefs.test.ts; do
  if [ -f "mobile/$f" ]; then suites+=("$f"); fi
done
( cd mobile && npx vitest run "${suites[@]}" --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file + OTA guard ─────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. The three frozen files: zero diff (D01 holds Wave D's only exception; D05 has none)
git diff --quiet "$MB" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen file changed (deckRepository.ts / progressSync.ts / model.ts must be zero-diff in D05)"
# 5b. The do-not-touch set and the OTA manifest set
frozen="$(git diff --numstat "$MB" -- \
  mobile/src/review/storage.ts mobile/src/content/chunkedInstall.ts mobile/src/features/gacha/contracts.ts \
  mobile/src/features/gacha/components/ReviewBody.tsx mobile/src/features/gacha/components/RatingBar.tsx \
  mobile/src/features/gacha/planner mobile/src/features/gacha/session mobile/src/features/gacha/rewards \
  mobile/src/features/gacha/mcq mobile/src/features/gacha/components mobile/src/features/gacha/library \
  mobile/src/config mobile/src/types mobile/src/screens/DrawResultScreen.tsx mobile/src/screens/CardDetailScreen.tsx \
  mobile/src/screens/LibraryScreen.tsx mobile/src/screens/HomeScreen.tsx \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  mobile/vitest.config.ts mobile/tsconfig.json mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"expo-updates": "~29.0.15"' mobile/package.json || fail "expo-updates pin changed"
grep -Fq '"version": "1.6.0"' mobile/app.json             || fail "app.json version changed (OTA runtime 1.6.0)"
grep -Fq '"vite": "7.2.4"' mobile/package.json             || fail "vite pin changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of 1.6.0)"; fi
# 5c. Every changed or untracked path is one of the eight scope files. Untracked scan is
# pathspec-scoped: the driver symlinks mobile/node_modules into the worktree and the
# `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$MB"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/eas.json mobile/vitest.config.ts mobile/tsconfig.json; } | sort -u | grep -Ev '^(mobile/src/screens/SessionCardScreen\.tsx|mobile/src/screens/SessionSummaryScreen\.tsx|mobile/src/navigation/types\.ts|mobile/src/sync/clientCapabilities\.ts|mobile/tests/integration/session-card-mcq\.screen\.test\.tsx|mobile/tests/integration/session-summary-picks\.screen\.test\.tsx|mobile/tests/unit/clientCapabilitiesMcq\.test\.ts|mobile/tests/unit/clientCapabilities\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside D05 scope"; }

echo "D05 VERIFY OK"
