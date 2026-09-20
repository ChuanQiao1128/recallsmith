#!/usr/bin/env bash
# B02 — reanimated-guard-timings verify. cwd = worktree root. Re-runs the brief's
# five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/components/ceremony/reanimatedGuard.ts, mobile/src/features/gacha/
#     draw/ceremonyTimings.ts, mobile/tests/setup/ceremony.ts, mobile/tests/unit/
#     ceremonyTimings.test.ts and mobile/tests/unit/reanimatedGuard.test.tsx do not
#     exist on base (the ceremony/ directory itself does not exist)
# Step 2 would also fail on base (vitest.config.ts:30 lists only globals.ts;
# featureFlags.ts has no `ceremony` group; the three new it() titles are absent).
# Steps 3/4 are the baseline gates (tsc / vitest) and step 5 is a purely negative
# scope guard; both pass on base by design.
#
# Network: none. No npm install, no expo, no prebuild.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B02 VERIFY FAIL: $*" >&2; exit 1; }

G=mobile/src/components/ceremony/reanimatedGuard.ts
T=mobile/src/features/gacha/draw/ceremonyTimings.ts
S=mobile/tests/setup/ceremony.ts
TT=mobile/tests/unit/ceremonyTimings.test.ts
GT=mobile/tests/unit/reanimatedGuard.test.tsx
VC=mobile/vitest.config.ts
FF=mobile/src/config/featureFlags.ts
FT=mobile/tests/unit/featureFlags.test.ts

# ── 1. New files exist (FAILS ON BASE) ─────────────────────────────────────
echo "[1/5] scope files exist"
for f in "$G" "$T" "$S" "$TT" "$GT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ -f "$VC" ] && [ -f "$FF" ] && [ -f "$FT" ] || fail "existing scope file missing"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. ceremonyTimings.ts — tables verbatim (B00 §2.2), constants, exports, purity
while IFS= read -r line; do
  grep -Fq "$line" "$T" || fail "ceremonyTimings.ts lacks the verbatim row: $line"
done <<'ROWS'
export const TEST_BASE: CeremonyTimingTable = Object.freeze({
  single: { approach: 300, hold: { COM: 140, RAR: 180, LEG: 220 }, tearFlip: 360, flashReveal: 220, settleMs: 200 },
  multi:  { approach: 620, hold: { COM: 220, RAR: 260, LEG: 300 }, tearFlip: 940, flashReveal: 280, settleMs: 300 },
  tableTailMs: 500,
  beatMs: { COM: 0, RAR: 0, LEG: 0 },
  flipMs: { COM: 0, RAR: 0, LEG: 0 },
  rimSettleMs: { COM: 0, RAR: 0, LEG: 0 },
  liftMs: 0, landMs: 0, tapQueueMs: 90,
export const DEVICE: CeremonyTimingTable = Object.freeze({
  single: { approach: 600, hold: { COM: 360, RAR: 620, LEG: 880 }, tearFlip: 600, flashReveal: 320, settleMs: 520 },
  multi:  { approach: 900, hold: { COM: 600, RAR: 860, LEG: 1100 }, tearFlip: 1800, flashReveal: 400, settleMs: 600 },
  tableTailMs: 200,
  beatMs: { COM: 120, RAR: 180, LEG: 300 },
  flipMs: { COM: 380, RAR: 480, LEG: 640 },
  rimSettleMs: { COM: 800, RAR: 1000, LEG: 1200 },
  liftMs: 80, landMs: 200, tapQueueMs: 90,
export const TO_TABLE_CAP_MS = Object.freeze({ single: 3300, multi: 5500 });
export const REDUCED_MOTION_FLASH_MS = 180;
export const REDUCED_MOTION_SETTLE_MS = 240;
export const SWIPE_TRIGGER_DISTANCE = 72;
export const TELL_FRACTION_OF_HOLD = 0.6;
export const FAST_FORWARD_FROM_HOLD_FRACTION = 0.6;
export const FAST_FORWARD_TEAR_FACTOR = 1.6;
export const SPILL_STAGGER_MS = 60;
export const SPILL_START_FRACTION = 0.5;
export const SPILL_TRAVEL_FRACTION = 1 / 6;
ROWS
for sym in "export function resolveCeremonyTimings" "export function phaseDurations" "export function compressTimings" \
           "export function setCeremonyTimingOverride" "export function getCeremonyTimingOverride" \
           "export type CeremonyPhase" "export type PeakRarity" "export type CeremonyTimingTable" "export type ResolvedCeremonyTimings"; do
  grep -q "$sym" "$T" || fail "ceremonyTimings.ts lacks: $sym"
done
grep -q "from './cardRarity'" "$T" || fail "ceremonyTimings.ts must take Rarity from ./cardRarity"
if grep -Eq "from 'react|require\(|reanimatedGuard|approach: 920" "$T"; then
  grep -En "from 'react|require\(|reanimatedGuard|approach: 920" "$T" >&2 || true
  fail "ceremonyTimings.ts must stay pure (no react / require / guard import) and multi approach is 900"
fi

# 2b. reanimatedGuard.ts — exports, guarded requires, no static native imports, no clock hook
for sym in "export const motionAvailable" "export const skiaAvailable" "export const SkiaModule" "export const Reanimated" \
           "export const GestureHandler" "export type SharedValue<T> = { value: T };" "__CEREMONY_MOTION_AVAILABLE__" \
           "require('react-native-reanimated')" "require('react-native-worklets')" "require('@shopify/react-native-skia')" \
           "require('react-native-gesture-handler')" "createAnimatedComponent" "interpolateColor" \
           "PanHost: loaded.gestureHandler.GestureDetector"; do
  grep -Fq "$sym" "$G" || fail "reanimatedGuard.ts lacks: $sym"
done
# (The driver's banned-term gate is anchored `\bdetector` in wave.conf, so GestureDetector is allowed — B00 §9 #15.)
if grep -Eq "useClock|eslint-disable|from '(react-native-reanimated|react-native-worklets|@shopify/react-native-skia|react-native-gesture-handler)'" "$G"; then
  grep -En "useClock|eslint-disable|from '(react-native-reanimated|react-native-worklets|@shopify/react-native-skia|react-native-gesture-handler)'" "$G" >&2 || true
  fail "reanimatedGuard.ts: static native import, suppression comment, or the Skia clock hook token present"
fi
grep -q "from 'react-native'" "$G" || fail "reanimatedGuard.ts must import View from react-native for the fallback"
# Metro rejects require(<non-literal>) in app source (metro-transform-worker/src/index.js:60-66):
# every require( in the guard must take a string literal, so no tryRequire(name) helper.
if grep -Eq "require\([^'\"]" "$G"; then
  grep -En "require\([^'\"]" "$G" >&2 || true
  fail "reanimatedGuard.ts has a require() whose argument is not a string literal (Metro rejects it at bundle time)"
fi

# 2c. tests/setup/ceremony.ts — override + the nine package mocks, none of the forbidden ones
grep -q "__CEREMONY_MOTION_AVAILABLE__ = false" "$S" || fail "setup must pin __CEREMONY_MOTION_AVAILABLE__ = false"
for pkg in react-native-reanimated react-native-worklets @shopify/react-native-skia expo-audio expo-haptics \
           react-native-gesture-handler expo-sharing expo-store-review react-native-view-shot; do
  grep -Fq "vi.mock('$pkg'" "$S" || fail "setup lacks vi.mock('$pkg'"
done
grep -q "__ceremonyMocks" "$S" || fail "setup lacks globalThis.__ceremonyMocks"
grep -q "beforeEach" "$S"      || fail "setup lacks the global beforeEach reset"
if grep -Eq "vi\.mock\('(react-native|react|@react-native-async-storage/async-storage|expo-linear-gradient|react-native-safe-area-context)'|useClock|__DEV__ =" "$S"; then
  grep -En "vi\.mock\('(react-native|react|@react-native-async-storage/async-storage|expo-linear-gradient|react-native-safe-area-context)'|useClock|__DEV__ =" "$S" >&2 || true
  fail "setup mocks a module it must not, sets __DEV__, or spells the Skia clock hook"
fi
# 2d. vitest.config.ts — exact setupFiles line, nothing else changed
grep -Fq "setupFiles: ['./tests/setup/globals.ts', './tests/setup/ceremony.ts']," "$VC" || fail "vitest.config.ts setupFiles line is not exactly the contract (base tree fails here)"
# 2e. featureFlags.ts — the ceremony group
for sym in "seamOfLight: boolean; forceFallback: boolean" "seamOfLight: true" "forceFallback: false" \
           "left.ceremony.seamOfLight === right.ceremony.seamOfLight" "left.ceremony.forceFallback === right.ceremony.forceFallback" \
           "typeof ceremony?.seamOfLight === 'boolean'" "typeof ceremony?.forceFallback === 'boolean'"; do
  grep -Fq "$sym" "$FF" || fail "featureFlags.ts lacks: $sym"
done
# 2f. featureFlags.test.ts — existing cases intact, new cases present
for s in \
  'starts with the frozen default snapshot' \
  'applies and returns a full override' \
  'fills omitted fields from defaults and accepts zero for maxPerRun' \
  'rejects malformed containers and invalid fields independently' \
  'resets overrides for null, undefined, and an empty config' \
  'notifies once per change, preserves identity for no-ops, and unsubscribes' \
  'useFeatureFlags reads defaults and re-renders for a new snapshot' \
  'applies a feature-only config before the non-gating return' \
  'resets to defaults when the gate loader returns null'; do
  grep -Fq "it('$s'" "$FT" || fail "existing featureFlags test case removed/renamed: $s"
done
for s in \
  'ships the ceremony defaults frozen: seamOfLight on, forceFallback off' \
  'applies boolean ceremony overrides and falls back per field on anything else' \
  'notifies subscribers when only a ceremony flag changes'; do
  grep -Fq "it('$s'" "$FT" || fail "missing featureFlags test case: $s"
done
[ "$(grep -c 'ceremony:' "$FT")" -ge 9 ] || fail "featureFlags.test.ts: full-object toEqual literals must carry the ceremony key (found $(grep -c 'ceremony:' "$FT"))"
# 2g. new test files carry the contract cases
for s in \
  'TEST_BASE is byte-for-byte the pre-1.6 table' \
  'DEVICE hold tiers rise COM < RAR < LEG with gaps of at least 240 ms' \
  'DEVICE anticipation sits inside the grammar band' \
  'DEVICE reaches the table under the ceilings' \
  'the silence beat fits after the colour tell' \
  'compress keeps only the beat of hold and speeds the tear by 1.6x' \
  'the __DEV__ override reaches DEVICE only and clears with null' \
  'exports the shared constants'; do
  grep -Fq "it('$s'" "$TT" || fail "missing ceremonyTimings test case: $s"
done
for s in \
  'reports no motion under vitest' \
  'animation helpers return their targets immediately' \
  'interpolates numbers and colours in plain JS' \
  'easings are identity curves with the same shape' \
  'hooks behave as plain refs inside a component' \
  'falls back to RN View and inert gestures'; do
  grep -Fq "it('$s'" "$GT" || fail "missing reanimatedGuard test case: $s"
done
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$G" "$T" "$S" "$TT" "$GT" "$VC" "$FF" "$FT" && fail "test gutting / suppression found"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Unit tree + the draw-ceremony integration test under the new setup ──
echo "[4/5] vitest tests/unit + draw-ceremony integration"
( cd mobile && npx vitest run tests/unit tests/integration/draw-ceremony.screen.test.tsx --reporter=dot ) \
  || fail "vitest failed (unit tree or draw-ceremony under the ceremony setup file)"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/config/remoteConfig.ts mobile/src/screens/DrawCeremonyScreen.tsx mobile/src/components/HolographicLayer.tsx \
  mobile/tests/setup/globals.ts mobile/tests/integration/draw-ceremony.screen.test.tsx mobile/package.json mobile/package-lock.json)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } | sort -u | grep -Ev '^(mobile/src/components/ceremony/reanimatedGuard\.ts|mobile/src/features/gacha/draw/ceremonyTimings\.ts|mobile/tests/setup/ceremony\.ts|mobile/tests/unit/ceremonyTimings\.test\.ts|mobile/tests/unit/reanimatedGuard\.test\.tsx|mobile/vitest\.config\.ts|mobile/src/config/featureFlags\.ts|mobile/tests/unit/featureFlags\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B02 scope"; }

echo "B02 VERIFY OK"
