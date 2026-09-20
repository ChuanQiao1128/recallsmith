#!/usr/bin/env bash
# B06 — pack-tear verify. cwd = worktree root. Re-runs the brief's seven
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/src/components/ceremony/PackTear.tsx and
#   mobile/tests/unit/packTear.test.tsx do not exist on base (the `[ -f ]`
#   checks fail before vitest runs). If step 1 were skipped, step 5 fails on
#   base too: mobile/src/theme/packArt.ts ends at line 250 with no
#   `export const SEAM_BAND_RATIO = 0.18;` line, and steps 3/6 fail because
#   the positive greps have no file to hit. Steps 2 and 7 pass on base by
#   design (tsc baseline; purely negative scope/frozen guard).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B06 VERIFY FAIL: $*" >&2; exit 1; }

f=mobile/src/components/ceremony/PackTear.tsx
a=mobile/src/theme/packArt.ts
t=mobile/tests/unit/packTear.test.tsx

# ── 1. New files exist + targeted vitest (FAILS ON BASE: files missing) ────
echo "[1/7] new files + targeted vitest"
[ -f "$a" ] || fail "$a missing"
[ -f "$f" ] || fail "$f does not exist (base tree fails here)"
[ -f "$t" ] || fail "$t does not exist (base tree fails here)"
IT_N=$(grep -cE "^\s*it\(" "$t" || true)
[ "$IT_N" -ge 11 ] || fail "$t has $IT_N it() blocks, need >= 11"
( cd mobile && npx vitest run \
    tests/unit/packTear.test.tsx \
    tests/unit/packArt.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 2. Typecheck ───────────────────────────────────────────────────────────
echo "[2/7] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 3. PackTear.tsx positive guards ────────────────────────────────────────
echo "[3/7] PackTear.tsx positive guards"
grep -Fq "export const PACK_A11Y_LABEL = 'Reward pack'" "$f"                       || fail "PACK_A11Y_LABEL literal missing"
grep -Fq "export const PACK_A11Y_HINT = 'Swipe right or double-tap to open'" "$f"  || fail "PACK_A11Y_HINT literal missing"
grep -Fq "export const PACK_ACTIVATE_ACTION = 'activate'" "$f"                     || fail "PACK_ACTIVATE_ACTION literal missing"
grep -Fq "export const PACK_ACTIVATE_LABEL = 'Open pack'" "$f"                     || fail "PACK_ACTIVATE_LABEL literal missing"
grep -q "export const SEAM_PATH_NORMALISED" "$f"                                   || fail "missing SEAM_PATH_NORMALISED"
grep -q "export function seamProgressFromDelta" "$f"                               || fail "missing seamProgressFromDelta"
grep -q "export function packTestID" "$f"                                          || fail "missing packTestID"
grep -q "export function packBodyRect" "$f"                                        || fail "missing packBodyRect"
grep -q "export function seamPointsPx" "$f"                                        || fail "missing seamPointsPx"
grep -q "export function seamYAt" "$f"                                             || fail "missing seamYAt"
grep -q "export function PackTear" "$f"                                            || fail "missing PackTear"
grep -q "export type PackTearProps" "$f"                                           || fail "missing PackTearProps"
grep -q "export type PackTimeline" "$f"                                            || fail "missing PackTimeline"
grep -Fq "'draw-ceremony-swipe-pack'" "$f"                                          || fail "swipe-pack testID missing"
grep -Fq "'draw-ceremony-multi-flyin'" "$f"                                         || fail "multi-flyin testID missing"
grep -Fq "'draw-ceremony-single-pack-flyin'" "$f"                                   || fail "single-pack-flyin testID missing"
grep -Fq 'accessibilityRole="button"' "$f"                                          || fail "root must be accessibilityRole button"
grep -Fq "accessibilityActions=" "$f"                                               || fail "root must declare accessibilityActions"
grep -Fq "onAccessibilityAction=" "$f"                                              || fail "root must handle onAccessibilityAction"
grep -Fq "accessibilityState={{ disabled }}" "$f"                                   || fail "root must expose accessibilityState disabled"
grep -Fq "from './reanimatedGuard'" "$f"                                            || fail "must import the guard"
grep -q "SWIPE_TRIGGER_DISTANCE" "$f"                                              || fail "must use SWIPE_TRIGGER_DISTANCE from ceremonyTimings"
grep -q "SEAM_BAND_RATIO" "$f"                                                     || fail "must use SEAM_BAND_RATIO from packArt"
grep -q "PanHost" "$f"                                                            || fail "missing GestureHandler.PanHost (the guard name of the gesture host, B00 §2.1)"
grep -Fq "<PanHost gesture=" "$f"                                                   || fail "root must be wrapped in <PanHost gesture={pan}>"
grep -Fq "Gesture.Pan()" "$f"                                                       || fail "missing Gesture.Pan()"
grep -q "rotateX" "$f"                                                             || fail "peel must use rotateX"
grep -q "perspective" "$f"                                                         || fail "peel must use perspective"
grep -Fq 'fit="cover"' "$f"                                                         || fail "pack image must be drawn with fit=cover"
grep -Fq "'worklet'" "$f"                                                           || fail "worklet directives missing"

# ── 4. PackTear.tsx negative guards + canvas count + JSX namespace ─────────
echo "[4/7] PackTear.tsx negative guards"
BANNED="useClock|SkiaModule\.useDerivedValue|BackdropBlur|<Blur|maskFilter|setInterval\(|shadowRadius|Math\.random|require\(|onResponderGrant|onResponderMove|onResponderRelease|onStartShouldSetResponder|accessibilityElementsHidden|from '@shopify/react-native-skia'|from 'react-native-reanimated'|from 'react-native-worklets'|from 'react-native-gesture-handler'|from 'expo-linear-gradient'|eslint-disable|@ts-ignore|@ts-expect-error"
if grep -Eq "$BANNED" "$f"; then
  grep -En "$BANNED" "$f" >&2 || true
  fail "banned identifier/import present in PackTear.tsx"
fi
CANVAS_N=$(grep -c "<Canvas" "$f" || true)
[ "$CANVAS_N" = 1 ] || fail "expected exactly 1 <Canvas in PackTear.tsx, found $CANVAS_N (B00 §7.3: stage + pack + foil = 3 total)"
# @types/react 19 has no global JSX namespace: a bare `JSX.Element` is TS2503.
if grep -Eq "(^|[^.A-Za-z_])JSX\.Element" "$f"; then
  grep -En "(^|[^.A-Za-z_])JSX\.Element" "$f" >&2 || true
  fail "bare JSX.Element in PackTear.tsx — write React.JSX.Element"
fi
# the driver gate is case-insensitive: the gesture-handler host's export name must never appear (B00 §9 #15)
if grep -Eiq "humanizer|bypass|undetect|\bdetector|evade|Gemini said" "$f" "$t"; then
  grep -Ein "humanizer|bypass|undetect|\bdetector|evade|Gemini said" "$f" "$t" >&2 || true
  fail "driver-banned term in PackTear.tsx / its test (use GestureHandler.PanHost)"
fi

# ── 5. packArt.ts: exactly one appended line (FAILS ON BASE) ───────────────
echo "[5/7] packArt.ts SEAM_BAND_RATIO"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
SEAM_LINE='export const SEAM_BAND_RATIO = 0.18;'
SEAM_N=$(grep -cx "$SEAM_LINE" "$a" || true)
[ "$SEAM_N" = 1 ] || fail "packArt.ts must contain the byte-exact line '$SEAM_LINE' exactly once, no trailing comment (base tree fails here)"
numstat="$(git diff --numstat "$mb" -- "$a" | awk '{print $1" "$2}')"
[ "$numstat" = "1 0" ] || fail "packArt.ts diff must be exactly one added line and none removed (got '${numstat:-none}')"
added="$(git diff -U0 "$mb" -- "$a" | grep -E '^\+[^+]' | sed 's/^+//' || true)"
[ "$added" = "$SEAM_LINE" ] || fail "the one added packArt.ts line must be byte-equal to '$SEAM_LINE' (got '$added')"
# B12.verify.sh:163-164 later asserts this is the last non-empty line of the file.
[ "$(grep -v '^[[:space:]]*$' "$a" | tail -n 1)" = "$SEAM_LINE" ] || fail "'$SEAM_LINE' must be the last non-empty line of packArt.ts"

# ── 6. Test mocks the guard, not the packages; no gutting ──────────────────
echo "[6/7] test shape guards"
grep -Fq "vi.mock('../../src/components/ceremony/reanimatedGuard'" "$t" || fail "$t must mock the guard module"
grep -Fq "actionName: 'activate'" "$t"                                 || fail "$t must drive the activate accessibility action"
grep -q "seamProgressFromDelta" "$t"                                   || fail "$t must exercise seamProgressFromDelta"
grep -q "packBodyRect" "$t"                                            || fail "$t must exercise packBodyRect"
if grep -Eq "vi\.mock\('(@shopify/react-native-skia|react-native-reanimated|react-native-gesture-handler)'" "$t"; then
  fail "$t must not vi.mock the native packages (unreachable through require); mock the guard"
fi
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$t" "$f" && fail "test gutting / suppression found"

# ── 7. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[7/7] scope + frozen guard"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/components/ceremony/reanimatedGuard.ts mobile/src/features/gacha/draw/ceremonyTimings.ts mobile/src/screens/DrawCeremonyScreen.tsx mobile/tests/unit/packArt.test.ts mobile/package.json mobile/package-lock.json mobile/app.json mobile/vitest.config.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -q '"vite": "7.2.4"' mobile/package.json || fail "vite must stay pinned 7.2.4"
grep -q "@sentry" mobile/package.json && fail "no @sentry package allowed"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } | grep -Ev '^(mobile/src/components/ceremony/PackTear\.tsx|mobile/src/theme/packArt\.ts|mobile/tests/unit/packTear\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B06 scope"; }

echo "B06 VERIFY OK"
