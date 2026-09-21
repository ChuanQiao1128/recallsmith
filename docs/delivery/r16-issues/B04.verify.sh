#!/usr/bin/env bash
# B04 — audio-haptics verify. cwd = worktree root. Re-runs the brief's six
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   mobile/tests/unit/ceremonyAudio.test.ts and ceremonyHaptics.test.ts do not
#   exist on base (the `[ -f ]` check fails before vitest runs). If step 1 were
#   skipped, step 3 fails on base too: ceremonyAudio.ts still contains `expo-av`
#   / `createAsync` / `playsInSilentModeIOS` / `eslint-disable` and none of the
#   positive literals (SFX_ALIASES, CEREMONY_GAIN, createCeremonyAudioController,
#   require('expo-audio')); step 4 fails on base (no HAPTIC_RATE_LIMIT /
#   createHapticLimiter, `eslint-disable` present); step 5 fails on base
#   (ceremonyAudio.ts:41 still says expo-av). Steps 2 and 6 pass on base by
#   design (tsc baseline; purely negative scope/frozen guard).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B04 VERIFY FAIL: $*" >&2; exit 1; }

a=mobile/src/components/ceremonyAudio.ts
h=mobile/src/components/ceremonyHaptics.ts
ta=mobile/tests/unit/ceremonyAudio.test.ts
th=mobile/tests/unit/ceremonyHaptics.test.ts

# ── 1. New tests exist + targeted vitest (FAILS ON BASE: files missing) ────
echo "[1/6] new test files + targeted vitest"
[ -f "$a" ] && [ -f "$h" ] || fail "scope source file missing"
[ -f "$ta" ] || fail "$ta does not exist (base tree fails here)"
[ -f "$th" ] || fail "$th does not exist (base tree fails here)"
IT_A=$(grep -cE "^\s*it\(" "$ta" || true)
IT_H=$(grep -cE "^\s*it\(" "$th" || true)
[ "$IT_A" -ge 12 ] || fail "$ta has $IT_A it() blocks, need >= 12"
[ "$IT_H" -ge 9 ]  || fail "$th has $IT_H it() blocks, need >= 9"
( cd mobile && npx vitest run \
    tests/unit/ceremonyAudio.test.ts \
    tests/unit/ceremonyHaptics.test.ts \
    tests/integration/draw-ceremony.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 2. Typecheck ───────────────────────────────────────────────────────────
echo "[2/6] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 3. ceremonyAudio.ts guards (FAILS ON BASE) ─────────────────────────────
echo "[3/6] ceremonyAudio.ts guards"
if grep -Eq "expo-av|createAsync|playsInSilentModeIOS|setInterval\(|eslint-disable|@ts-ignore|@ts-expect-error" "$a"; then
  grep -En "expo-av|createAsync|playsInSilentModeIOS|setInterval\(|eslint-disable|@ts-ignore|@ts-expect-error" "$a" >&2 || true
  fail "banned literal still present in ceremonyAudio.ts (base tree fails here)"
fi
if grep -Eq "^import [^t].* from 'react-native'|^import \{[^}]*\} from 'react-native'" "$a"; then
  fail "ceremonyAudio.ts must not import react-native at runtime"
fi
grep -Fq "require('expo-audio')" "$a"                              || fail "missing guarded require('expo-audio')"
grep -q "export const SFX_ALIASES" "$a"                            || fail "missing SFX_ALIASES"
grep -q "export const CEREMONY_GAIN" "$a"                          || fail "missing CEREMONY_GAIN"
grep -q "export function createCeremonyAudioController" "$a"       || fail "missing createCeremonyAudioController"
grep -q "export function prewarmCeremonyAudio" "$a"                || fail "missing prewarmCeremonyAudio"
grep -q "export function getCeremonyAudio" "$a"                    || fail "missing getCeremonyAudio"
grep -q "export function useCeremonyAudio" "$a"                    || fail "missing useCeremonyAudio"
grep -q "export const ceremonyAudioAvailable" "$a"                 || fail "missing ceremonyAudioAvailable"
grep -q "export function loadExpoAudio" "$a"                       || fail "missing loadExpoAudio"
grep -q "export function loadSfxSources" "$a"                      || fail "missing loadSfxSources"
grep -q "playsInSilentMode: true" "$a"                             || fail "audio mode must set playsInSilentMode: true"
grep -q "interruptionMode: 'mixWithOthers'" "$a"                   || fail "audio mode must set interruptionMode: 'mixWithOthers'"
grep -q "'choir-swell': 'ambience'" "$a"                           || fail "alias choir-swell→ambience missing (2026-09-21: every bed name loops the 8 s ambience)"
grep -q "'seam-burst': 'rip'" "$a"                                 || fail "alias seam-burst→rip missing"
grep -q "'sparkle-tail': 'shimmer'" "$a"                           || fail "alias sparkle-tail→shimmer missing"
grep -q "bedTable: 0.25" "$a"                                      || fail "CEREMONY_GAIN.bedTable must be 0.25"
grep -q "duck: 0.15" "$a"                                          || fail "CEREMONY_GAIN.duck must be 0.15"
grep -q "stinger: 1.0" "$a"                                        || fail "CEREMONY_GAIN.hit.stinger must be 1.0"
# the seven committed WAVs are the only static asset requires (ambience.wav added 2026-09-21: the 8 s bed loop)
for s in ambience whoosh rip card-drop card-flip shimmer legendary; do
  grep -Fq "require('../../assets/sfx/$s.wav')" "$a" || fail "missing require('../../assets/sfx/$s.wav')"
done
REQ_N=$(grep -cF "require('../../assets/sfx/" "$a" || true)
[ "$REQ_N" = 7 ] || fail "expected exactly 7 require('../../assets/sfx/…') sites, found $REQ_N (no new sample files may be required)"

# ── 4. ceremonyHaptics.ts guards (FAILS ON BASE) ───────────────────────────
echo "[4/6] ceremonyHaptics.ts guards"
if grep -Eq "setInterval\(|eslint-disable|@ts-ignore|@ts-expect-error" "$h"; then
  grep -En "setInterval\(|eslint-disable|@ts-ignore|@ts-expect-error" "$h" >&2 || true
  fail "banned literal still present in ceremonyHaptics.ts (base tree fails here)"
fi
grep -Fq "require('expo-haptics')" "$h"                                                    || fail "missing guarded require('expo-haptics')"
grep -Fq "export const HAPTIC_RATE_LIMIT = Object.freeze({ maxEvents: 3, windowMs: 1000 })" "$h" || fail "HAPTIC_RATE_LIMIT literal missing (base tree fails here)"
grep -q "export function createHapticLimiter" "$h"                                         || fail "missing createHapticLimiter"
grep -q "export function createCeremonyHapticsController" "$h"                             || fail "missing createCeremonyHapticsController"
grep -q "export function loadExpoHaptics" "$h"                                             || fail "missing loadExpoHaptics"
grep -q "export function getCeremonyHaptics" "$h"                                          || fail "missing getCeremonyHaptics"
grep -q "export function useCeremonyHaptics" "$h"                                          || fail "missing useCeremonyHaptics"
grep -q "export const ceremonyHapticsAvailable" "$h"                                       || fail "missing ceremonyHapticsAvailable"
grep -q "export type HapticImpact = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid'" "$h" || fail "HapticImpact union must be the 5-member literal"
grep -q "reduceMotion" "$h"                                                                || fail "missing reduceMotion mode"
grep -q "notificationAsync" "$h"                                                           || fail "missing notificationAsync"
grep -q "selectionAsync" "$h"                                                              || fail "missing selectionAsync"
grep -q "impactAsync" "$h"                                                                 || fail "missing impactAsync"
# tests must inject fakes, never package-mock (the guarded require cannot see vi.mock)
grep -Eq "vi\.mock\('expo-(audio|haptics)'" "$ta" "$th" && fail "new tests must not vi.mock expo-audio/expo-haptics (unreachable through require); inject fakes via the factories"
grep -q "createCeremonyAudioController" "$ta"   || fail "$ta must exercise createCeremonyAudioController"
grep -q "createCeremonyHapticsController" "$th" || fail "$th must exercise createCeremonyHapticsController"
grep -q "createHapticLimiter" "$th"             || fail "$th must exercise createHapticLimiter"
# the hook probes (audio case 14, haptics case 9) live in .test.ts files: React.createElement, never JSX
grep -Fq "React.createElement(" "$ta"           || fail "$ta must render the useCeremonyAudio probe with React.createElement (no JSX in a .test.ts file)"
grep -Fq "React.createElement(" "$th"           || fail "$th must render the useCeremonyHaptics probe with React.createElement (no JSX in a .test.ts file)"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$ta" "$th" "$a" "$h" && fail "test gutting / suppression found"

# ── 5. No expo-av anywhere under mobile/src (FAILS ON BASE) ────────────────
echo "[5/6] expo-av gone from mobile/src"
if grep -rn "expo-av" mobile/src >/dev/null 2>&1; then
  grep -rn "expo-av" mobile/src >&2 || true
  fail "expo-av still referenced under mobile/src (base tree fails here)"
fi

# ── 6. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[6/6] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/package.json mobile/package-lock.json mobile/app.json mobile/vitest.config.ts mobile/src/screens/DrawCeremonyScreen.tsx)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -q '"vite": "7.2.4"' mobile/package.json || fail "vite must stay pinned 7.2.4"
grep -q "@sentry" mobile/package.json && fail "no @sentry package allowed"
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } | grep -Ev '^(mobile/src/components/ceremonyAudio\.ts|mobile/src/components/ceremonyHaptics\.ts|mobile/tests/unit/ceremonyAudio\.test\.ts|mobile/tests/unit/ceremonyHaptics\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B04 scope"; }

echo "B04 VERIFY OK"
