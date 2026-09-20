#!/usr/bin/env bash
# B15 — share-review-deeplink verify. cwd = worktree root. Re-runs the brief's six
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/share/shareDraw.ts, mobile/src/features/gacha/
#     milestones/ratingPrompt.ts and mobile/src/navigation/linking.ts do not exist
#     (the `[ -f ]` guards fire before vitest is even invoked), and
#   - mobile/tests/unit/{shareDraw,ratingPrompt,linking}.test.ts do not exist.
# If step 1 were skipped, step 3 (every module literal), step 4 (no
# draw-result-share-button / shareDrawImage / maybeRequestRating in
# DrawResultScreen.tsx) and step 5 (no `linking` import / prop in App.tsx) all
# fail on base as well. Steps 2 and 6 pass on base by design (baseline tsc;
# purely negative scope/frozen guard).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B15 VERIFY FAIL: $*" >&2; exit 1; }

SHARE=mobile/src/features/gacha/share/shareDraw.ts
RATING=mobile/src/features/gacha/milestones/ratingPrompt.ts
LINKING=mobile/src/navigation/linking.ts
SCREEN=mobile/src/screens/DrawResultScreen.tsx
APP=mobile/App.tsx
T_SHARE=mobile/tests/unit/shareDraw.test.ts
T_RATING=mobile/tests/unit/ratingPrompt.test.ts
T_LINK=mobile/tests/unit/linking.test.ts
T_RESULT=mobile/tests/integration/draw-result.screen.test.tsx

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 1. Targeted vitest (FAILS ON BASE: new files missing) ──────────────────
echo "[1/6] vitest shareDraw + ratingPrompt + linking + draw-result"
for f in "$SHARE" "$RATING" "$LINKING"; do
  [ -f "$f" ] || fail "step 1: $f does not exist (base tree fails here)"
done
for f in "$T_SHARE" "$T_RATING" "$T_LINK"; do
  [ -f "$f" ] || fail "step 1: $f does not exist (base tree fails here)"
done
[ "$(grep -cE "^\s*it\(" "$T_SHARE" || true)" -ge 6 ]  || fail "step 1: $T_SHARE needs >= 6 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_RATING" || true)" -ge 8 ] || fail "step 1: $T_RATING needs >= 8 it() blocks"
[ "$(grep -cE "^\s*it\(" "$T_LINK" || true)" -ge 1 ]   || fail "step 1: $T_LINK needs >= 1 it() block"
for s in \
  'shares a captured PNG through expo-sharing' \
  'returns unavailable when the ref has no node or sharing is unavailable' \
  'returns failed and never throws when capture or share rejects' \
  'reports cancelled for a second call while one share is in flight' \
  'returns unavailable when expo-sharing cannot be loaded' \
  'exposes the DrawResult share testID'; do
  grep -Fq "it('$s'" "$T_SHARE" || fail "step 1: missing shareDraw case: $s"
done
for s in \
  'shouldRequestRating is true only for a null state' \
  'resolveRatingTrigger prefers first-legendary, then a 7-day streak, else null' \
  'parseRatingPromptState rejects malformed values' \
  'requests a review once per install and records it under RATING_PROMPT_KEY' \
  'returns unavailable when store review is unavailable and keeps the one chance' \
  'returns failed when storage cannot be read and never throws' \
  'a review request that throws still counts as consumed' \
  'returns unavailable when expo-store-review cannot be loaded'; do
  grep -Fq "it('$s'" "$T_RATING" || fail "step 1: missing ratingPrompt case: $s"
done
grep -Fq "it('maps recallsmith:// paths onto the five linked routes'" "$T_LINK" || fail "step 1: missing linking case"
grep -Fq "from '@react-navigation/core'" "$T_LINK" || fail "step 1: linking test must import getStateFromPath from @react-navigation/core (native pulls react-native into node)"
# draw-result: three new titles + the eleven base titles (:102-340 on base) untouched; additions only
for s in \
  'shares the pull image from the share button and reports unavailable inline' \
  'requests a store review once for a Legendary pull after the delay' \
  'requests a store review on a seven-day streak when no Legendary was pulled'; do
  grep -Fq "it('$s'" "$T_RESULT" || fail "step 1: missing draw-result case: $s (base tree fails here)"
done
for s in \
  'renders collection bar, featured card, single primary CTA and done link' \
  'renders rarity strip in COM, RAR, LEG order' \
  'routes primary action to Draw when pulls remain' \
  'routes primary action to Library naming the cards just drawn when pulls are empty' \
  'keeps primary CTA non-routable until wallet pulls resolve' \
  'routes done link back to Home' \
  'routes the first Done into PermissionPrompt once when the onboarding flag is pending' \
  'opens and closes detail modal from grid card' \
  'keeps sheet testID with single snap point and handles empty draw state' \
  'opens all-cards sheet from explicit trigger and keeps 92% snap point metadata'; do
  grep -Fq "it('$s'" "$T_RESULT" || fail "step 1: existing draw-result case removed: $s"
done
grep -Fq "'keeps W-BASE, W-CTA, and W-MODAL contracts at %ipt width'" "$T_RESULT" || fail "step 1: existing it.each width case removed"
[ "$(grep -cE "^\s*it(\.each)?\(" "$T_RESULT" || true)" -ge 14 ] || fail "step 1: $T_RESULT has fewer than 14 it()/it.each() blocks (11 base + 3 new)"
removed="$(git diff -U0 "$mb" -- "$T_RESULT" | grep -E '^-' | grep -vE '^---' || true)"
[ -z "$removed" ] || { echo "$removed" >&2; fail "step 1: draw-result.screen.test.tsx has removed/rewritten lines (additions only, B00 §4.4)"; }
grep -Fq "RATING_PROMPT_DELAY_MS" "$T_RESULT" || fail "step 1: draw-result test must advance timers by RATING_PROMPT_DELAY_MS"
grep -Fq "createNodeMock" "$T_RESULT"        || fail "step 1: draw-result share case must render with createNodeMock so the capture ref has a node"
( cd mobile && npx vitest run \
    tests/unit/shareDraw.test.ts \
    tests/unit/ratingPrompt.test.ts \
    tests/unit/linking.test.ts \
    tests/integration/draw-result.screen.test.tsx \
    --reporter=dot ) || fail "step 1: targeted vitest failed"

# ── 2. Typecheck ───────────────────────────────────────────────────────────
echo "[2/6] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "step 2: typecheck failed"

# ── 3. Module literal guards (FAIL ON BASE: files absent) ─────────────────
echo "[3/6] shareDraw.ts / ratingPrompt.ts / linking.ts guards"
grep -Fq "export const SHARE_DRAW_TESTID = 'draw-result-share-button';" "$SHARE" || fail "SHARE_DRAW_TESTID literal missing"
grep -Eq "export type ShareDrawResult = \{ status: 'shared' \| 'unavailable' \| 'cancelled' \| 'failed' \}" "$SHARE" || fail "ShareDrawResult type must match B00 §2.15 verbatim"
grep -q "export async function shareDrawImage" "$SHARE"       || fail "shareDrawImage missing"
grep -Fq "import('react-native-view-shot')" "$SHARE"          || fail "shareDraw.ts must load react-native-view-shot with a dynamic import()"
grep -Fq "import('expo-sharing')" "$SHARE"                    || fail "shareDraw.ts must load expo-sharing with a dynamic import()"
grep -Fq "isAvailableAsync" "$SHARE"                          || fail "shareDraw.ts must check Sharing.isAvailableAsync"
grep -Fq "captureRef(" "$SHARE"                               || fail "shareDraw.ts must call captureRef"
grep -Fq "export const RATING_PROMPT_KEY = 'recallsmith:rating-prompt:v1';" "$RATING" || fail "RATING_PROMPT_KEY literal missing"
grep -Fq "export const RATING_STREAK_DAYS = 7;" "$RATING"     || fail "RATING_STREAK_DAYS must be 7"
grep -q "export const RATING_PROMPT_DELAY_MS" "$RATING"       || fail "RATING_PROMPT_DELAY_MS missing"
grep -Eq "export type RatingTrigger = 'first-legendary' \| 'streak-7';" "$RATING" || fail "RatingTrigger must match B00 §2.15 verbatim"
grep -q "export function shouldRequestRating" "$RATING"       || fail "shouldRequestRating missing"
grep -q "export function resolveRatingTrigger" "$RATING"      || fail "resolveRatingTrigger missing"
grep -q "export function parseRatingPromptState" "$RATING"    || fail "parseRatingPromptState missing"
grep -q "export async function maybeRequestRating" "$RATING"  || fail "maybeRequestRating missing"
grep -Fq "import('expo-store-review')" "$RATING"              || fail "ratingPrompt.ts must load expo-store-review with a dynamic import()"
grep -Fq "from '@react-native-async-storage/async-storage'" "$RATING" || fail "ratingPrompt.ts must use AsyncStorage"
# Comment-only lines (leading //, * or /*) are skipped so a header comment may say
# "CommonJS require"; the brief still tells the worker never to write `require(` at all.
code_lines() { grep -vE '^[[:space:]]*(//|\*|/\*)' "$1" || true; }
for f in "$SHARE" "$RATING"; do
  if code_lines "$f" | grep -Eq "require\(|^import .*from '(expo-sharing|react-native-view-shot|expo-store-review)'|getUserScopedKey"; then
    code_lines "$f" | grep -En "require\(|^import .*from '(expo-sharing|react-native-view-shot|expo-store-review)'|getUserScopedKey" >&2 || true
    fail "$f uses require()/a static native import/getUserScopedKey on a code line"
  fi
done
grep -Fq "prefixes: ['recallsmith://']" "$LINKING"            || fail "linking.ts prefixes must be ['recallsmith://']"
for s in "Home: 'home'" "Draw: 'draw/:slug?'" "Library: 'library'" "CardDetail: 'card/:cardId'" "DrawResult: 'result/:slug'"; do
  grep -Fq "$s" "$LINKING" || fail "linking.ts lacks route line: $s"
done
grep -Fq "export const linking: LinkingOptions<RootStackParamList>" "$LINKING" || fail "linking must be typed LinkingOptions<RootStackParamList>"

# ── 4. DrawResultScreen guards (FAIL ON BASE) ──────────────────────────────
echo "[4/6] DrawResultScreen.tsx guards"
for s in 'testID={SHARE_DRAW_TESTID}' 'CEREMONY_COPY_V10.shareCta' 'draw-result-share-target' 'collapsable={false}' \
         'draw-result-share-status' 'shareDrawImage(shareTargetRef' 'resolveRatingTrigger(' 'maybeRequestRating(' \
         'RATING_PROMPT_DELAY_MS' 'loadStreakSnapshot' 'Sharing is not available on this device' 'Could not prepare the image' \
         'Preparing image'; do
  grep -Fq "$s" "$SCREEN" || fail "DrawResultScreen.tsx lacks literal: $s (base tree fails here)"
done
for s in draw-result-header draw-result-collection-bar screen-draw-result-featured-card draw-result-summary-strip \
         draw-result-open-all-cards draw-result-all-cards-sheet screen-draw-result-primary-cta draw-result-earn-pulls-link \
         draw-result-done-link draw-result-confetti screen-draw-result-detail-close draw-result-guarantee-badge screen-draw-result-root; do
  grep -Fq "$s" "$SCREEN" || fail "DrawResultScreen.tsx lost base testID: $s"
done
# non-comment lines only (same code_lines helper as step 3): a comment may name a package
if code_lines "$SCREEN" | grep -Eq "from 'expo-sharing'|react-native-view-shot|expo-store-review|Alert\.alert\(|Share\.share\(|Linking\.openURL\(|RN\.(Alert|Share|Platform|Linking)\b"; then
  code_lines "$SCREEN" | grep -En "from 'expo-sharing'|react-native-view-shot|expo-store-review|Alert\.alert\(|Share\.share\(|Linking\.openURL\(|RN\.(Alert|Share|Platform|Linking)\b" >&2 || true
  fail "DrawResultScreen.tsx reaches for Alert/Share/Platform/Linking or a native package directly (code line)"
fi
# the named react-native import block (multi-line on base, :2-9) must not gain Alert/Share/Platform/Linking
rn_block="$(awk '
  /^import \{[[:space:]]*$/ { blk=1; buf=""; next }
  blk && /^\} from / { if ($0 ~ /react-native.;/) printf "%s", buf; blk=0; next }
  blk { buf = buf $0 "\n" }
' "$SCREEN")"
if printf '%s\n' "$rn_block" | grep -Eq "^[[:space:]]*(Alert|Share|Platform|Linking),?[[:space:]]*$"; then
  fail "DrawResultScreen.tsx imports Alert/Share/Platform/Linking by name from react-native (the draw-result RN mock does not export them)"
fi
if grep -Eq "^import \{[^}]*\b(Alert|Share|Platform|Linking)\b[^}]*\} from 'react-native'" "$SCREEN"; then
  fail "DrawResultScreen.tsx imports Alert/Share/Platform/Linking by name from react-native (single-line form)"
fi

# ── 5. App.tsx linking (FAILS ON BASE) ─────────────────────────────────────
echo "[5/6] App.tsx linking prop"
grep -Fq "import { linking } from './src/navigation/linking';" "$APP" || fail "App.tsx lacks the linking import (base tree fails here)"
grep -Fq "linking={linking}" "$APP"                                   || fail "App.tsx lacks linking={linking} on NavigationContainer"
read -r app_add app_del _ < <(git diff --numstat "$mb" -- "$APP" | awk '{print $1, $2, $3}'; echo "0 0 -")
[ "${app_add:-0}" -eq 2 ] && [ "${app_del:-0}" -eq 0 ] || fail "App.tsx diff must be exactly 2 added / 0 deleted lines (got +$app_add -$app_del)"

# ── 6. Scope + frozen + gutting guard (purely negative; passes on base) ────
echo "[6/6] scope + frozen guard"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/features/gacha/components/drawResultStyles.ts mobile/src/features/gacha/draw/ceremonyCopy.ts mobile/src/navigation/types.ts \
  mobile/src/features/gacha/streaks/streakTracker.ts mobile/src/features/gacha/milestones/milestoneTracker.ts \
  mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
  | grep -Ev '^(mobile/src/features/gacha/share/shareDraw\.ts|mobile/src/features/gacha/milestones/ratingPrompt\.ts|mobile/src/navigation/linking\.ts|mobile/src/screens/DrawResultScreen\.tsx|mobile/App\.tsx|mobile/tests/unit/shareDraw\.test\.ts|mobile/tests/unit/ratingPrompt\.test\.ts|mobile/tests/unit/linking\.test\.ts|mobile/tests/integration/draw-result\.screen\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B15 scope"; }
if grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$SHARE" "$RATING" "$LINKING" "$SCREEN" "$T_SHARE" "$T_RATING" "$T_LINK" "$T_RESULT"; then
  fail "test gutting / suppression found"
fi
grep -Fq '"vite": "7.2.4"' mobile/package.json || fail "vite pin 7.2.4 lost"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (Sentry is out of 1.6.0)"; fi
if ! grep -Fq '"scheme": "recallsmith"' mobile/app.json; then
  echo "B15 VERIFY WARN: mobile/app.json has no \"scheme\": \"recallsmith\" (B01 owns that line; recallsmith:// links will not open until it lands)" >&2
fi

echo "B15 VERIFY OK"
