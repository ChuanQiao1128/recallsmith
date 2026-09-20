#!/usr/bin/env bash
# B07 — ceremony-timeline verify. cwd = worktree root. Re-runs the brief's
# Acceptance steps 1-7 verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/src/components/ceremony/useCeremonyTimeline.ts and
#   mobile/tests/unit/useCeremonyTimeline.test.ts do not exist on
#   delivery/r16-b-ceremony (both are created by this issue), so the file
#   existence check fails before any test runs. Were step 1 skipped, step 2
#   would fail too (vitest: "No test files found" with passWithNoTests=false)
#   and every positive grep in step 4 would fail. Steps 3, 5, 6 and 7 are
#   negative/baseline guards and pass on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B07 VERIFY FAIL: $*" >&2; exit 1; }

m=mobile/src/components/ceremony/useCeremonyTimeline.ts
t=mobile/tests/unit/useCeremonyTimeline.test.ts

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/7] scope files exist"
[ -f "$m" ] || fail "$m does not exist (base tree fails here by design)"
[ -f "$t" ] || fail "$t does not exist (base tree fails here by design)"
IT_COUNT=$(grep -cE "^\s*it\(" "$t" || true)
[ "$IT_COUNT" -ge 9 ] || fail "$t has $IT_COUNT it() blocks, need >= 9"

# ── 2. Targeted vitest ─────────────────────────────────────────────────────
echo "[2/7] vitest useCeremonyTimeline + ceremonyTimings + spillSchedule"
( cd mobile && npx vitest run \
    tests/unit/useCeremonyTimeline.test.ts \
    tests/unit/ceremonyTimings.test.ts \
    tests/unit/spillSchedule.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/7] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Positive literal guards on the module (B00 §2.10 verbatim) ─────────
echo "[4/7] positive literal guards"
for s in \
  'export function useCeremonyTimeline(' \
  'export function timelineTargets(' \
  'export function haloColorForTell(' \
  'export type CeremonyTimeline =' \
  'export type TimelineInput =' \
  'export type TimelineTargets =' \
  "EMPHASIZED_OUT: 'bezier(0.05,0.7,0.1,1)'" \
  "STANDARD: 'bezier(0.2,0,0,1)'" \
  "LINEAR: 'linear'" \
  "OUT_CUBIC: 'out(cubic)'" \
  "OUT_QUAD: 'out(quad)'" \
  "NEUTRAL: '#FFF7EC'" \
  "COM: '#FFF3E0'" \
  "RAR: '#A78BD8'" \
  "LEG: '#F5C95E'" \
  'export const LEG_HIT_PAUSE_MS = 32' \
  'export const LEG_DIM = 0.3' \
  'export const MAX_TIMELINE_CARDS = 10' \
  'export const RAYS_ANGLE_PERIOD_MS = 14000' \
  'export const RM_CROSSFADE_MS = 180' \
  'export const SHIVER_HZ = 18' \
  'export const SHIVER_PX = 3' \
  'export const SEAM_PRECUT = 0.15' \
  'export const SEAM_PRECUT_MS = 120' \
  'Math.PI * 2' \
  'Math.PI / 180' \
  'withTiming(SEAM_PRECUT' \
  'withTiming(SHIVER_PX' \
  'export const TEAR_BEATS' \
  'export function spillSlotOffset(' \
  'export function tableSlotLayout(' \
  'export function resolveEasing(' \
  'TELL_FRACTION_OF_HOLD' \
  "from './reanimatedGuard'" \
  "from '../../features/gacha/draw/ceremonyTimings'" \
  "from '../../features/gacha/draw/spillSchedule'" \
  'withRepeat(' \
  'withSequence(' \
  'withDelay(' \
  'cancelAnimation(' \
  'withTiming('; do
  grep -Fq -- "$s" "$m" || fail "missing literal in $m: $s"
done
[ "$(grep -c "'worklet'" "$m")" -ge 2 ] || fail "haloColorForTell and lerpHex must both carry the 'worklet' directive (>= 2 occurrences)"
# the three verify-pinned test titles + the fallback probe case
for s in \
  'timelineTargets encodes the storyboard rest values per phase' \
  'reduce motion keeps packScale and flash at rest in every phase' \
  'haloColorForTell withholds rarity until the tell and goes violet then gold for LEG' \
  'drives every shared value to the phase target under the guard fallback'; do
  grep -Fq -- "$s" "$t" || fail "missing test case title in $t: $s"
done
grep -Fq "resolveCeremonyTimings" "$t" || fail "$t must use the real resolveCeremonyTimings"
grep -Fq "buildSpillSchedule" "$t"     || fail "$t must use the real buildSpillSchedule"
grep -Fq "vi.mock('react-native'" "$t" || fail "$t must declare its own react-native mock (libraryCardTile.test.tsx pattern)"
# units/seam pins of case 6 (B00 §2.10 "Units", §9 #14): radians, px, the pre-cut nick
for s in 'SEAM_PRECUT' 'SHIVER_PX' 'Math.PI'; do
  grep -Fq -- "$s" "$t" || fail "$t must pin $s (case 6: seam at approach, shiver px at hold, radians for raysAngle / spill rot)"
done

# ── 5. Negative guards: the guard is the only door, no timers/clock, units ─
echo "[5/7] negative guards"
if grep -En "from 'react-native'|react-native-reanimated|@shopify/react-native-skia|react-native-worklets|react-native-gesture-handler|setTimeout\(|setInterval\(|Date\.now\(|requestAnimationFrame|useClock|useDerivedValue|\bAnimated\.|motionAvailable|Math\.random|useState\(" "$m"; then
  fail "banned import/identifier present in $m (see lines above)"
fi
# unit drift guards: rays in degrees / a normalised ±1 shiver would be invisible or spin 57× (B00 §9 #16)
if grep -En "withTiming\(360|withTiming\(1, \{ duration: half|withTiming\(-1, \{ duration: half" "$m"; then
  fail "raysAngle must be driven to Math.PI * 2 (radians) and shiver to ±SHIVER_PX px (see lines above)"
fi
# driver gate mirror: the banned substring list is matched case-insensitively over added lines
if grep -Ein "humanizer|bypass|undetect|detector|evade|Gemini said" "$m" "$t"; then
  fail "driver-banned term present in a B07 scope file (see lines above)"
fi

# ── 6. Test-gutting / suppression / deps pin ───────────────────────────────
echo "[6/7] suppression + deps pin"
if grep -En "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$m" "$t"; then
  fail "test gutting / suppression found"
fi
grep -q '"vite": "7.2.4"' mobile/package.json || fail 'mobile/package.json must keep "vite": "7.2.4"'
if grep -q "@sentry" mobile/package.json; then fail "@sentry must not be in mobile/package.json"; fi

# ── 7. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[7/7] scope + frozen guard"
mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "frozen file modified (deckRepository.ts / progressSync.ts / model.ts)"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb" HEAD; \
              git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } \
            | sort -u \
            | grep -Ev '^(mobile/src/components/ceremony/useCeremonyTimeline\.ts|mobile/tests/unit/useCeremonyTimeline\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B07 scope"; }

echo "B07 VERIFY OK"
