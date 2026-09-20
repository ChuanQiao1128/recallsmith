#!/usr/bin/env bash
# B13 — dev-tuning verify. cwd = worktree root. Re-runs the brief's six
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/screens/dev/CeremonyTuning.tsx does not exist (the `[ -f ]`
#     guard fires before vitest is even invoked), and
#   - mobile/tests/unit/ceremonyTuning.test.tsx does not exist.
# If step 1 were skipped, step 3 (every CeremonyTuning literal), step 4
# (debug-seed-wallet / debug-only-legendary / … absent from DebugMenuScreen.tsx)
# and step 5 (no `CeremonyTuning: undefined;` in types.ts, no Stack.Screen in
# App.tsx) all fail on base as well. Steps 2 and 6 pass on base by design
# (baseline tsc; purely negative scope/frozen guard).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B13 VERIFY FAIL: $*" >&2; exit 1; }

SCREEN=mobile/src/screens/dev/CeremonyTuning.tsx
DEBUG=mobile/src/screens/DebugMenuScreen.tsx
TYPES=mobile/src/navigation/types.ts
APP=mobile/App.tsx
TEST=mobile/tests/unit/ceremonyTuning.test.tsx

# ── 1. Targeted vitest (FAILS ON BASE: new files missing) ──────────────────
echo "[1/6] vitest ceremonyTuning + the three DebugMenu-rendering suites"
[ -f "$SCREEN" ] || fail "step 1: $SCREEN does not exist (base tree fails here)"
[ -f "$TEST" ]   || fail "step 1: $TEST does not exist (base tree fails here)"
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST" || true)
[ "$IT_COUNT" -ge 10 ] || fail "step 1: $TEST has $IT_COUNT it() blocks, need >= 10"
for s in \
  'summarizeFrameGaps uses nearest-rank p95 and reports max and count' \
  'readTimingPath and writeTimingPath round-trip every TUNING_KEY without mutating the input' \
  'renders the unavailable text and nothing else when __DEV__ is false' \
  'writes the DEVICE override through setCeremonyTimingOverride from a stepper row' \
  'flags a table that exceeds the device ceiling in the cap readout' \
  'reports frame gaps from requestAnimationFrame deltas while the probe is on' \
  'DebugMenu seeds the wallet at 30/5 and reports it' \
  'DebugMenu owns every non-Legendary card of the active deck and leaves Legendary unowned' \
  'DebugMenu toggles the ceremony dev overrides and opens the tuning screen' \
  'DebugMenu hides the ceremony tools when __DEV__ is false'; do
  grep -Fq "it('$s'" "$TEST" || fail "step 1: missing test case: $s"
done
# the guard module is mocked (B00 §9 #13: its module-scope require()s are not redirected by vi.mock)
grep -Fq "vi.mock('../../src/components/ceremony/reanimatedGuard'" "$TEST" \
  || fail "step 1: $TEST must vi.mock '../../src/components/ceremony/reanimatedGuard' (motionAvailable/skiaAvailable false)"
( cd mobile && npx vitest run \
    tests/unit/ceremonyTuning.test.tsx \
    tests/integration/phase-c-shells.screen.test.tsx \
    tests/integration/phase-c-complete.screen.test.tsx \
    tests/integration/system-support-polish.screen.test.tsx \
    tests/unit/ceremonyTimings.test.ts \
    tests/unit/ceremonyPrefs.test.ts \
    --reporter=dot ) || fail "step 1: targeted vitest failed"

# ── 2. Typecheck ───────────────────────────────────────────────────────────
echo "[2/6] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "step 2: typecheck failed"

# ── 3. CeremonyTuning.tsx literal guards ───────────────────────────────────
echo "[3/6] CeremonyTuning.tsx guards"
grep -q "export const TUNING_KEYS" "$SCREEN"                       || fail "TUNING_KEYS missing"
grep -q "export const TUNING_STEP_MS = 20;" "$SCREEN"               || fail "TUNING_STEP_MS must be 20"
grep -q "export const FRAME_GAP_P95_CAP_MS = 22;" "$SCREEN"         || fail "FRAME_GAP_P95_CAP_MS must be 22"
grep -q "export const FRAME_GAP_MAX_CAP_MS = 50;" "$SCREEN"         || fail "FRAME_GAP_MAX_CAP_MS must be 50"
grep -q "export function summarizeFrameGaps" "$SCREEN"              || fail "summarizeFrameGaps missing"
grep -q "export function useFrameGapProbe" "$SCREEN"                || fail "useFrameGapProbe missing"
grep -q "export function readTimingPath" "$SCREEN"                  || fail "readTimingPath missing"
grep -q "export function writeTimingPath" "$SCREEN"                 || fail "writeTimingPath missing"
grep -q "export function mergeTimingOverride" "$SCREEN"             || fail "mergeTimingOverride missing"
grep -q "export function CeremonyTuningScreen" "$SCREEN"            || fail "CeremonyTuningScreen missing"
grep -q "export default CeremonyTuningScreen" "$SCREEN"             || fail "default export missing"
for s in ceremony-tuning-root ceremony-tuning-unavailable 'Not available in release builds' \
         ceremony-tuning-probe ceremony-tuning-probe-toggle ceremony-tuning-reset ceremony-tuning-cap- \
         'ceremony-tuning-slider-${key}' setCeremonyTimingOverride getCeremonyTimingOverride \
         resolveCeremonyTimings TO_TABLE_CAP_MS; do
  grep -Fq "$s" "$SCREEN" || fail "CeremonyTuning.tsx lacks literal: $s"
done
if grep -Eq "require\(|from 'react-native-reanimated'|@shopify/react-native-skia|Slider|Alert|shadowRadius" "$SCREEN"; then
  grep -En "require\(|from 'react-native-reanimated'|@shopify/react-native-skia|Slider|Alert|shadowRadius" "$SCREEN" >&2 || true
  fail "CeremonyTuning.tsx uses a banned import/identifier"
fi

# ── 4. DebugMenuScreen.tsx literal guards ──────────────────────────────────
echo "[4/6] DebugMenuScreen.tsx guards"
for s in debug-seed-wallet debug-only-legendary debug-force-fallback debug-force-repeat \
         debug-ceremony-tuning debug-ceremony-tools \
         'availablePulls: 30, reservePulls: 5' "navigate('CeremonyTuning')" 'setCeremonyDevOverride(' \
         "await import('../content/deckRepository')" "await import('../content/activeDeck')" \
         debug-reset-progress 'Reset all progress' 'Open error shell' '__DEV__ ?'; do
  grep -Fq "$s" "$DEBUG" || fail "DebugMenuScreen.tsx lacks literal: $s (base tree fails here)"
done
if grep -Eq "^import .*from '\.\./content/(deckRepository|activeDeck)'" "$DEBUG"; then
  fail "DebugMenuScreen.tsx must lazy-import deckRepository/activeDeck (static import found)"
fi
grep -q "from '../features/gacha/draw/ceremonyPrefs'" "$DEBUG"     || fail "DebugMenu must import ceremonyPrefs"
grep -q "saveRewardWalletState" "$DEBUG"                            || fail "DebugMenu must call saveRewardWalletState"
grep -q "saveDrawState(" "$DEBUG"                                   || fail "DebugMenu must write through saveDrawState"
grep -q "rarityOfCard(" "$DEBUG"                                    || fail "DebugMenu must classify cards with rarityOfCard"
if grep -q "AsyncStorage" "$DEBUG"; then fail "DebugMenu must not touch AsyncStorage directly"; fi

# ── 5. Route + Stack.Screen ────────────────────────────────────────────────
echo "[5/6] route + App.tsx registration"
grep -Fq "CeremonyTuning: undefined;" "$TYPES"                                              || fail "types.ts lacks CeremonyTuning route (base tree fails here)"
grep -Fq "import CeremonyTuningScreen from './src/screens/dev/CeremonyTuning';" "$APP"     || fail "App.tsx lacks the CeremonyTuning import"
grep -Fq '{__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null}' "$APP" \
  || fail "App.tsx lacks the __DEV__-gated CeremonyTuning Stack.Screen"
grep -Fq '<Stack.Screen name="DebugMenu" component={DebugMenuScreen} />' "$APP"            || fail "DebugMenu Stack.Screen anchor changed"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
read -r app_add app_del _ < <(git diff --numstat "$mb" -- "$APP" | awk '{print $1, $2, $3}'; echo "0 0 -")
[ "${app_add:-0}" -le 2 ] && [ "${app_del:-0}" -eq 0 ] || fail "App.tsx diff must be <= 2 added / 0 deleted lines (got +$app_add -$app_del)"
read -r ty_add ty_del _ < <(git diff --numstat "$mb" -- "$TYPES" | awk '{print $1, $2, $3}'; echo "0 0 -")
[ "${ty_add:-0}" -eq 1 ] && [ "${ty_del:-0}" -eq 0 ] || fail "types.ts diff must be exactly 1 added / 0 deleted lines (got +$ty_add -$ty_del)"

# ── 6. Scope + frozen + gutting guard (purely negative; passes on base) ────
echo "[6/6] scope + frozen guard"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/features/gacha/draw/ceremonyTimings.ts mobile/src/features/gacha/draw/ceremonyPrefs.ts mobile/src/components/ceremony/reanimatedGuard.ts \
  mobile/src/screens/DrawCeremonyScreen.tsx mobile/src/screens/SettingsScreen.tsx)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
  | grep -Ev '^(mobile/src/screens/dev/CeremonyTuning\.tsx|mobile/src/screens/DebugMenuScreen\.tsx|mobile/src/navigation/types\.ts|mobile/App\.tsx|mobile/tests/unit/ceremonyTuning\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B13 scope"; }
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$SCREEN" "$DEBUG" "$TEST" && fail "test gutting / suppression found"
grep -Fq '"vite": "7.2.4"' mobile/package.json || fail "vite pin 7.2.4 lost"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (Sentry is out of 1.6.0)"; fi

echo "B13 VERIFY OK"
