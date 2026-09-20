#!/usr/bin/env bash
# B05 — stage-canvas verify. cwd = worktree root. Re-runs the brief's six
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/src/components/ceremony/StageCanvas.tsx and
#   mobile/tests/unit/stageCanvas.test.tsx do not exist on base (the `[ -f ]`
#   checks fail before vitest runs). If step 1 were skipped, steps 3, 4 and 5
#   fail on base too because the positive greps (STAGE_TESTID, RAY_COUNT,
#   useRSXformBuffer, the four tell hex literals, the guard mock in the test)
#   have no file to hit. Steps 2 and 6 pass on base by design (tsc baseline;
#   purely negative scope/frozen guard).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B05 VERIFY FAIL: $*" >&2; exit 1; }

f=mobile/src/components/ceremony/StageCanvas.tsx
t=mobile/tests/unit/stageCanvas.test.tsx

# ── 1. New files exist + targeted vitest (FAILS ON BASE: files missing) ────
echo "[1/6] new files + targeted vitest"
[ -f "$f" ] || fail "$f does not exist (base tree fails here)"
[ -f "$t" ] || fail "$t does not exist (base tree fails here)"
IT_N=$(grep -cE "^\s*it\(" "$t" || true)
[ "$IT_N" -ge 11 ] || fail "$t has $IT_N it() blocks, need >= 11"
( cd mobile && npx vitest run tests/unit/stageCanvas.test.tsx --reporter=dot ) || fail "targeted vitest failed"

# ── 2. Typecheck ───────────────────────────────────────────────────────────
echo "[2/6] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 3. StageCanvas.tsx positive guards ─────────────────────────────────────
echo "[3/6] StageCanvas.tsx positive guards"
grep -Fq "export const STAGE_TESTID = 'draw-ceremony-stage-canvas'" "$f" || fail "STAGE_TESTID literal missing"
grep -Fq "export const RAY_COUNT = 12" "$f"                               || fail "RAY_COUNT must be 12"
grep -Fq "export const RAY_REVOLUTION_MS = 14000" "$f"                    || fail "RAY_REVOLUTION_MS must be 14000"
grep -Fq "export const MAX_PARTICLES = 120" "$f"                          || fail "MAX_PARTICLES must be 120"
grep -q "export function StageCanvas" "$f"                               || fail "missing StageCanvas"
grep -q "export type StageCanvasProps" "$f"                              || fail "missing StageCanvasProps"
grep -q "export type StageTimeline" "$f"                                 || fail "missing StageTimeline"
grep -q "export function stageHaloColor" "$f"                            || fail "missing stageHaloColor"
grep -q "export function rayStops" "$f"                                  || fail "missing rayStops"
grep -q "export function tableCardSize" "$f"                             || fail "missing tableCardSize"
grep -q "export function particlePose" "$f"                              || fail "missing particlePose"
grep -q "export function poseToRSXform" "$f"                             || fail "missing poseToRSXform"
grep -q "export function packRectInStage" "$f"                           || fail "missing packRectInStage"
grep -q "export function packSlotInStage" "$f"                           || fail "missing packSlotInStage (B09 mounts PackTear at it)"
grep -Fq "export const PACK_BODY_FRACTION = 0.7" "$f"                      || fail "PACK_BODY_FRACTION must be 0.7 (mirrors PackTear)"
grep -Fq "rotate: raysAngle.value }" "$f"                                  || fail "rayTransform must pass raysAngle (radians, B00 §2.10) to Skia rotate unchanged"
grep -Fq "translateX: width / 2 }, { translateY: height / 2 }" "$f"        || fail "rims must sit inside the centre-origin Group (spill x/y are offsets from the stage centre, B00 §2.10)"
for hex in "'#FFF7EC'" "'#FFF3E0'" "'#A78BD8'" "'#F5C95E'"; do
  grep -Fq "$hex" "$f" || fail "tell colour literal $hex missing"
done
grep -Fq 'blendMode="plus"' "$f"                                          || fail "leak/particles must use blendMode plus"
grep -Fq "from './reanimatedGuard'" "$f"                                  || fail "must import the guard"
grep -q "SweepGradient" "$f"                                             || fail "missing SweepGradient rays"
grep -q "RadialGradient" "$f"                                            || fail "missing RadialGradient"
grep -q "RoundedRect" "$f"                                               || fail "rims must use RoundedRect (not RoundRect)"
grep -q "Atlas" "$f"                                                     || fail "missing Atlas particles"
grep -q "useRSXformBuffer" "$f"                                          || fail "missing useRSXformBuffer"
grep -Fq "'worklet'" "$f"                                                 || fail "worklet directives missing"

# ── 4. StageCanvas.tsx negative guards + canvas count + JSX namespace ──────
echo "[4/6] StageCanvas.tsx negative guards"
BANNED="BackdropBlur|BackdropFilter|<Blur|DisplacementMap|maskFilter|useClock|SkiaModule\.useDerivedValue|setInterval\(|shadowRadius|Math\.random|require\(|from '@shopify/react-native-skia'|from 'react-native-reanimated'|from 'react-native-worklets'|eslint-disable|@ts-ignore|@ts-expect-error|raysAngle\.value \* Math\.PI|raysAngle\.value \* \(Math\.PI|/ 180"
if grep -Eq "$BANNED" "$f"; then
  grep -En "$BANNED" "$f" >&2 || true
  fail "banned identifier/import present in StageCanvas.tsx (incl. a degree→radian conversion of the already-radian raysAngle)"
fi
# the driver gate is case-insensitive: the gesture-handler host's export name must never appear (B00 §9 #15)
if grep -Eiq "humanizer|bypass|undetect|detector|evade|Gemini said" "$f" "$t"; then
  grep -Ein "humanizer|bypass|undetect|detector|evade|Gemini said" "$f" "$t" >&2 || true
  fail "driver-banned term in StageCanvas.tsx / its test (use GestureHandler.PanHost)"
fi
CANVAS_N=$(grep -c "<Canvas" "$f" || true)
[ "$CANVAS_N" = 1 ] || fail "expected exactly 1 <Canvas in StageCanvas.tsx, found $CANVAS_N (B00 §7.3: stage + pack + foil = 3 total)"
# @types/react 19 has no global JSX namespace: a bare `JSX.Element` is TS2503.
if grep -Eq "(^|[^.A-Za-z_])JSX\.Element" "$f"; then
  grep -En "(^|[^.A-Za-z_])JSX\.Element" "$f" >&2 || true
  fail "bare JSX.Element in StageCanvas.tsx — write React.JSX.Element"
fi

# ── 5. Test mocks the guard, not the packages; no gutting ──────────────────
echo "[5/6] test shape guards"
grep -Fq "vi.mock('../../src/components/ceremony/reanimatedGuard'" "$t" || fail "$t must mock the guard module"
grep -q "STAGE_TESTID" "$t"                                            || fail "$t must assert STAGE_TESTID"
grep -q "stageHaloColor" "$t"                                          || fail "$t must exercise stageHaloColor"
grep -q "particlePose" "$t"                                            || fail "$t must exercise particlePose"
grep -q "reduceMotion: true" "$t"                                      || fail "$t must cover reduceMotion: true"
grep -q "packSlotInStage" "$t"                                         || fail "$t must exercise packSlotInStage (case 12)"
grep -q "Math.PI" "$t"                                                 || fail "$t must assert the raysAngle radians pass-through (case 11)"
grep -q "translateX: 140" "$t"                                         || fail "$t must assert the centre-origin rim group for a 280x360 stage (case 4)"
if grep -Eq "vi\.mock\('(@shopify/react-native-skia|react-native-reanimated|react-native-worklets)'" "$t"; then
  fail "$t must not vi.mock the native packages (unreachable through require); mock the guard"
fi
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$t" "$f" && fail "test gutting / suppression found"

# ── 6. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[6/6] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/components/ceremony/reanimatedGuard.ts mobile/src/features/gacha/draw/ceremonyTimings.ts mobile/src/theme/packArt.ts mobile/src/screens/DrawCeremonyScreen.tsx mobile/package.json mobile/package-lock.json mobile/app.json mobile/vitest.config.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -q '"vite": "7.2.4"' mobile/package.json || fail "vite must stay pinned 7.2.4"
grep -q "@sentry" mobile/package.json && fail "no @sentry package allowed"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } | grep -Ev '^(mobile/src/components/ceremony/StageCanvas\.tsx|mobile/tests/unit/stageCanvas\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B05 scope"; }

echo "B05 VERIFY OK"
