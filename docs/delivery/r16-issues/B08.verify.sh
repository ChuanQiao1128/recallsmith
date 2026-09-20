#!/usr/bin/env bash
# B08 — tap-card-foil verify. cwd = worktree root. Re-runs the brief's
# Acceptance steps 1-9 verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/src/components/ceremony/TapCard.tsx, FoilLayer.tsx, ceremonyStyles.ts,
#   tests/unit/tapCard.test.tsx and tests/unit/foilLayer.test.tsx do not exist on
#   delivery/r16-b-ceremony, and mobile/src/components/HolographicLayer.tsx is 181
#   lines (the shim must be <= 25). Were step 1 skipped, step 2 would fail (vitest:
#   "No test files found", passWithNoTests=false), every positive grep in steps 4-7
#   would fail, and step 6 would fail on the base HolographicLayer.tsx (it contains
#   useClock / useDerivedValue / require( / SkiaBurst / eslint-disable). Steps 3, 8's
#   suppression part and 9 are baseline/negative guards and pass on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B08 VERIFY FAIL: $*" >&2; exit 1; }

tc=mobile/src/components/ceremony/TapCard.tsx
fl=mobile/src/components/ceremony/FoilLayer.tsx
cs=mobile/src/components/ceremony/ceremonyStyles.ts
hl=mobile/src/components/HolographicLayer.tsx
tt=mobile/tests/unit/tapCard.test.tsx
tf=mobile/tests/unit/foilLayer.test.tsx

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/9] scope files exist"
for f in "$tc" "$fl" "$cs" "$tt" "$tf"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here by design)"
done
[ -f "$hl" ] || fail "$hl must exist as the shim until B11 deletes it"
HL_LINES=$(wc -l < "$hl" | tr -d ' ')
[ "$HL_LINES" -le 25 ] || fail "$hl has $HL_LINES lines; the shim must be <= 25 (base is 181 — fails on base by design)"
[ "$(grep -cE '^\s*it\(' "$tt" || true)" -ge 8 ] || fail "$tt needs >= 8 it() blocks"
[ "$(grep -cE '^\s*it\(' "$tf" || true)" -ge 3 ] || fail "$tf needs >= 3 it() blocks"

# ── 2. Targeted vitest (unit + the untouched ceremony integration file) ────
echo "[2/9] vitest tapCard + foilLayer + draw-ceremony integration"
( cd mobile && npx vitest run \
    tests/unit/tapCard.test.tsx \
    tests/unit/foilLayer.test.tsx \
    tests/integration/draw-ceremony.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/9] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. TapCard literal guards ──────────────────────────────────────────────
echo "[4/9] TapCard.tsx guards"
for s in \
  'export type TapCardData =' \
  'export const TAP_QUEUE_GAP_MS = 90' \
  'export function createTapQueue(' \
  'export type TapCardProps =' \
  'export function TapCard(' \
  'export function arcTransform(' \
  'export function rarityLabel(' \
  'testID={`tap-card-${index}`}' \
  'accessibilityRole="button"' \
  'accessibilityState={{ disabled }}' \
  'disabled={disabled}' \
  'face down' \
  'revealed' \
  "from './reanimatedGuard'" \
  "from './FoilLayer'" \
  "from './ceremonyStyles'" \
  "from '../ceremonyHaptics'" \
  '[0, 0.49, 0.5, 1]' \
  'readRN(' \
  'PanHost' \
  '<PanHost gesture=' \
  '} = GestureHandler' \
  'createAnimatedComponent(Pressable)' \
  '<AnimatedPressable' \
  'Gesture.Pan()' \
  'withDelay(' \
  'withSequence(' \
  'runOnJS('; do
  grep -Fq -- "$s" "$tc" || fail "missing literal in $tc: $s"
done
if grep -En "react-native-reanimated|@shopify/react-native-skia|react-native-gesture-handler|react-native-worklets|useClock|withSpring\(|setTimeout\(|setInterval\(|\bAnimated\.|A\.Value|HolographicLayer|tapCardHoloOverlay|require\(|<Pressable" "$tc"; then
  fail "banned import/identifier present in $tc (see lines above; the root must be <AnimatedPressable, not a plain <Pressable)"
fi
# Driver Gate 1 mirror (case-insensitive over the whole file, not just added lines): the
# gesture-handler library's host-component name contains one of these substrings, which is
# why the guard exposes it as GestureHandler.PanHost (B00 §2.1, §9 #15).
if grep -Ein "humanizer|bypass|undetect|\bdetector|evade|Gemini said" "$tc" "$fl" "$cs" "$hl" "$tt" "$tf"; then
  fail "driver-banned term present in a B08 scope file (see lines above)"
fi

# ── 5. FoilLayer literal guards ────────────────────────────────────────────
echo "[5/9] FoilLayer.tsx guards"
for s in \
  'export type FoilLayerProps =' \
  'export function FoilLayer(' \
  'export function prewarmFoilShader(' \
  'export const foilAvailable' \
  'export const FOIL_SKSL' \
  'export const FOIL_SWEEP_MS = 1600' \
  'RuntimeEffect.Make(' \
  'u_tilt' \
  'u_time' \
  'u_res' \
  'withRepeat(' \
  "from './reanimatedGuard'"; do
  grep -Fq -- "$s" "$fl" || fail "missing literal in $fl: $s"
done
[ "$(grep -c '<Canvas' "$fl")" = 1 ] || fail "$fl must contain exactly one <Canvas"
if grep -En "useClock|SkiaModule\.useDerivedValue|Skia!|Circle|Date\.now\(|setInterval\(|setTimeout\(|react-native-reanimated|@shopify/react-native-skia|require\(" "$fl"; then
  fail "banned identifier present in $fl (see lines above)"
fi

# ── 6. Shim + component-tree crash guard (FAILS ON BASE) ───────────────────
echo "[6/9] HolographicLayer.tsx shim + no Skia clock/derived-value hook under mobile/src/components"
grep -Fq "from './ceremony/FoilLayer'" "$hl"           || fail "$hl must source FoilLayer from ./ceremony/FoilLayer"
grep -Fq "export const skiaAvailable = foilAvailable" "$hl" || fail "$hl must export skiaAvailable = foilAvailable"
grep -Fq "export function HolographicLayer(" "$hl"      || fail "$hl must export the HolographicLayer adapter"
if grep -En "useClock|useDerivedValue|require\(|SkiaBurst|SkiaShimmer|eslint-disable" "$hl"; then
  fail "old HolographicLayer body still present in $hl (base tree fails here by design)"
fi
if grep -rn "useClock" mobile/src/components; then
  fail "useClock must not appear anywhere under mobile/src/components"
fi
if grep -rnE "SkiaModule\.useDerivedValue|Skia!?\.useDerivedValue|useDerivedValue[^;]*\} = Skia" mobile/src/components; then
  fail "a derived-value hook is read from the Skia namespace under mobile/src/components"
fi

# ── 7. ceremonyStyles guards ───────────────────────────────────────────────
echo "[7/9] ceremonyStyles.ts guards"
grep -Fq "export const ceremonyStyles = StyleSheet.create(" "$cs" || fail "$cs must export ceremonyStyles via StyleSheet.create"
for k in tapTable tapRow tapTwoRows tapCardSlot tapCardSide tapCardBack tapCardBackInnerRing tapCardBackImage tapCardBackMonogram tapCardFace tapCardChip tapCardChipText tapCardQuestion tapCardHoloOverlay tapCardBurst tapCardPersistentHalo pressed tapCardFrame tapCardFocusLayer tapCardStreak tapCardShadow; do
  grep -Eq "^\s*${k}: " "$cs" || fail "style key missing in $cs: $k"
done
if grep -En "shadowRadius: *(1[6-9]|[2-9][0-9])" "$tc" "$fl" "$cs" "$hl"; then
  fail "shadowRadius >= 16 in a B08 file (B00 §7.4)"
fi

# ── 8. Test titles, suppression, deps pin ──────────────────────────────────
echo "[8/9] test titles + suppression + deps pin"
for s in \
  'createTapQueue spaces flips by the gap and never returns a negative delay' \
  'is disabled outside the table phase and never flips or reports a tap' \
  'flips exactly once on the table and labels the revealed rarity'; do
  grep -Fq -- "$s" "$tt" || fail "missing test case title in $tt: $s"
done
for s in \
  'renders null under vitest and never touches the Skia clock' \
  'prewarmFoilShader is a no-op without Skia and never throws'; do
  grep -Fq -- "$s" "$tf" || fail "missing test case title in $tf: $s"
done
grep -Fq "vi.mock('react-native'" "$tt" || fail "$tt must declare its own react-native mock"
grep -Fq "vi.mock('react-native'" "$tf" || fail "$tf must declare its own react-native mock"
if grep -En "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$tc" "$fl" "$cs" "$hl" "$tt" "$tf"; then
  fail "test gutting / suppression found"
fi
if grep -En "vi\.mock\('(react-native-reanimated|@shopify/react-native-skia|react-native-gesture-handler|expo-haptics|[./]*src/components/ceremony/reanimatedGuard)'" "$tt" "$tf"; then
  fail "unit tests must not mock native packages or the guard (tests/setup/ceremony.ts owns those)"
fi
grep -q '"vite": "7.2.4"' mobile/package.json || fail 'mobile/package.json must keep "vite": "7.2.4"'
if grep -q "@sentry" mobile/package.json; then fail "@sentry must not be in mobile/package.json"; fi

# ── 9. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[9/9] scope + frozen guard"
mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
git diff --quiet "$mb" HEAD -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/screens/DrawCeremonyScreen.tsx mobile/src/components/CeremonyLottie.tsx \
  || fail "frozen/out-of-scope file modified (frozen trio, DrawCeremonyScreen.tsx or CeremonyLottie.tsx)"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb" HEAD; \
              git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
            | sort -u \
            | grep -Ev '^(mobile/src/components/ceremony/TapCard\.tsx|mobile/src/components/ceremony/FoilLayer\.tsx|mobile/src/components/ceremony/ceremonyStyles\.ts|mobile/src/components/HolographicLayer\.tsx|mobile/tests/unit/tapCard\.test\.tsx|mobile/tests/unit/foilLayer\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B08 scope"; }

echo "B08 VERIFY OK"
