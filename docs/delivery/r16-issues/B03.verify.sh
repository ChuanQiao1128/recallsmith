#!/usr/bin/env bash
# B03 — spill-skip-prefs verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - mobile/src/features/gacha/draw/{spillSchedule,skipPolicy,ceremonyPrefs}.ts
#     and mobile/tests/unit/{spillSchedule,skipPolicy,ceremonyPrefs}.test.ts do
#     not exist on base
#   (step 1 then also checks the B02 prerequisite: ceremonyTimings.ts must
#   exist with SPILL_STAGGER_MS / FAST_FORWARD_FROM_HOLD_FRACTION, because both
#   pure modules import their constants and types from it)
# Step 2 (literal guards) would also fail on base. Steps 3/4 are the tsc /
# targeted-vitest gates and step 5 is a purely negative scope guard; both
# pass on base by design.
#
# Network: none. No npm install, no expo, no prebuild. Runtime ~10 s.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B03 VERIFY FAIL: $*" >&2; exit 1; }

S=mobile/src/features/gacha/draw/spillSchedule.ts
K=mobile/src/features/gacha/draw/skipPolicy.ts
P=mobile/src/features/gacha/draw/ceremonyPrefs.ts
ST=mobile/tests/unit/spillSchedule.test.ts
KT=mobile/tests/unit/skipPolicy.test.ts
PT=mobile/tests/unit/ceremonyPrefs.test.ts
TIMINGS=mobile/src/features/gacha/draw/ceremonyTimings.ts

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ B02 prerequisite)"
for f in "$S" "$K" "$P" "$ST" "$KT" "$PT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ -f "$TIMINGS" ] || fail "$TIMINGS is missing — B02 must be merged before B03 (its constants/types are imported)"
grep -q "export const SPILL_STAGGER_MS" "$TIMINGS"               || fail "ceremonyTimings.ts lacks SPILL_STAGGER_MS (B02 incomplete)"
grep -q "export const FAST_FORWARD_FROM_HOLD_FRACTION" "$TIMINGS" || fail "ceremonyTimings.ts lacks FAST_FORWARD_FROM_HOLD_FRACTION (B02 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. spillSchedule.ts — exports, imports from ceremonyTimings, purity
for sym in "export type SpillEntry" "export type SpillSchedule" "export function featuredCardIndex" \
           "export function centreSlot" "export function buildSpillSchedule" "from './ceremonyTimings'" \
           "SPILL_STAGGER_MS" "SPILL_START_FRACTION" "SPILL_TRAVEL_FRACTION"; do
  grep -Fq "$sym" "$S" || fail "spillSchedule.ts lacks: $sym"
done
if grep -Eq "from 'react|require\(|Date\.now|Math\.random|AsyncStorage" "$S"; then
  grep -En "from 'react|require\(|Date\.now|Math\.random|AsyncStorage" "$S" >&2 || true
  fail "spillSchedule.ts must stay pure (no react / require / clock / randomness / storage)"
fi
if grep -Eq "^(export )?const [A-Za-z_]+ = (60|0\.5|1 */ *6);" "$S"; then
  grep -En "^(export )?const [A-Za-z_]+ = (60|0\.5|1 */ *6);" "$S" >&2 || true
  fail "spillSchedule.ts re-declares a timing constant instead of importing it from ceremonyTimings.ts"
fi
# 2b. skipPolicy.ts — the two-member union, no third way out
grep -Fq "export type SkipDecision = 'none' | 'compress';" "$K" || fail "skipPolicy.ts: SkipDecision must be exactly 'none' | 'compress'"
for sym in "export type SkipPolicyInput" "export function skipPolicy" "FAST_FORWARD_FROM_HOLD_FRACTION" "from './ceremonyTimings'"; do
  grep -Fq "$sym" "$K" || fail "skipPolicy.ts lacks: $sym"
done
if grep -q "goResult" "$K"; then
  grep -n "goResult" "$K" >&2 || true
  fail "skipPolicy.ts must not mention goResult — the policy can never leave the ceremony"
fi
if grep -Eq "from 'react|require\(|AsyncStorage|^(export )?const [A-Za-z_]+ = 0\.6;" "$K"; then
  grep -En "from 'react|require\(|AsyncStorage|^(export )?const [A-Za-z_]+ = 0\.6;" "$K" >&2 || true
  fail "skipPolicy.ts must stay pure and must import the 0.6 fraction, not redeclare it"
fi
# 2c. ceremonyPrefs.ts — key/timeout literals, exports, storage import, call-time __DEV__, a real timer
grep -Fq "export const CEREMONY_PREFS_KEY = 'recallsmith:ceremony:completed:v1';" "$P" || fail "ceremonyPrefs.ts: CEREMONY_PREFS_KEY literal missing/changed"
grep -Fq "export const CEREMONY_PREFS_READ_TIMEOUT_MS = 250;" "$P"                    || fail "ceremonyPrefs.ts: CEREMONY_PREFS_READ_TIMEOUT_MS literal missing/changed"
grep -Eq "export (async )?function readCeremoniesCompleted" "$P"   || fail "ceremonyPrefs.ts lacks readCeremoniesCompleted"
grep -Eq "export (async )?function markCeremonyCompleted" "$P"     || fail "ceremonyPrefs.ts lacks markCeremonyCompleted"
for sym in "export type CeremonyDevOverrides" "export function getCeremonyDevOverrides" "export function setCeremonyDevOverride" \
           "export function effectiveCeremoniesCompleted" "import AsyncStorage from '@react-native-async-storage/async-storage';" \
           ".__DEV__ === true" "setTimeout(" "clearTimeout("; do
  grep -Fq "$sym" "$P" || fail "ceremonyPrefs.ts lacks: $sym"
done
# Comments count: the brief tells the worker not to name the per-user helper even in prose.
if grep -Eq "getUserScopedKey|review/storage|ceremonyTimings|from 'react" "$P"; then
  grep -En "getUserScopedKey|review/storage|ceremonyTimings|from 'react" "$P" >&2 || true
  fail "ceremonyPrefs.ts must be device-global (no user scoping, not even as a token in a comment) and import only AsyncStorage"
fi
# B00 §2.5: no module-level memo of the count — storage is the only source of truth, so a
# 'Continue' press in one integration case cannot leak a repeat user into a later case.
if grep -Eq "^let " "$P"; then
  grep -En "^let " "$P" >&2 || true
  fail "ceremonyPrefs.ts has module-level let state — the count must never be memoised (B00 §2.5)"
fi
# 2d. tests — property harness present, contract cases present
for t in "$ST" "$KT"; do
  grep -q "from 'fast-check'" "$t" || fail "$t must use fast-check"
  grep -q "fc.assert(" "$t"        || fail "$t has no fc.assert property"
done
grep -q "vi.resetModules()" "$PT"        || fail "ceremonyPrefs.test.ts must reload the module per test (vi.resetModules)"
grep -q "useFakeTimers" "$PT"            || fail "ceremonyPrefs.test.ts must use fake timers for the hang case"
grep -q "advanceTimersByTimeAsync" "$PT" || fail "ceremonyPrefs.test.ts must advance fake timers asynchronously"
for s in \
  'deals exactly one entry per card, in card-index order' \
  'lands every card inside the tear phase' \
  'assigns slots as a permutation with the featured card in the centre' \
  'deals the featured card last and the rest in index order' \
  'picks the first LEG, else the first RAR, else index 0' \
  'reproduces the DEVICE and TEST_BASE multi numbers' \
  'is deterministic and tolerates a degenerate tear'; do
  grep -Fq "it('$s'" "$ST" || fail "missing spillSchedule test case: $s"
done
for s in \
  'only ever answers none or compress' \
  'never shows a skip under reduce motion, on a first ceremony, or twice' \
  'keeps swipe, approach, settle and the table under the CTA' \
  'opens the fast-forward at sixty percent of hold' \
  'compresses tear and flash on a repeat ceremony' \
  'is monotone in elapsed time during hold'; do
  grep -Fq "it('$s'" "$KT" || fail "missing skipPolicy test case: $s"
done
for s in \
  'reads 0 when nothing is stored and re-reads storage on every call' \
  'parses a stored integer and fails closed on garbage' \
  'resolves 0 when the read throws and retries on the next call' \
  'resolves 0 within the timeout when the read hangs' \
  'markCeremonyCompleted increments, persists and returns the new count' \
  'resolves the incremented count when the write fails and never pins it' \
  'dev overrides are inert outside __DEV__' \
  'forceRepeat lifts a first ceremony to a repeat in __DEV__' \
  'exports the device-global key and the read budget'; do
  grep -Fq "it('$s'" "$PT" || fail "missing ceremonyPrefs test case: $s"
done
[ "$(grep -cE "^\s*it\(" "$ST" || true)" -ge 7 ] || fail "spillSchedule.test.ts needs >= 7 it() blocks"
[ "$(grep -cE "^\s*it\(" "$KT" || true)" -ge 6 ] || fail "skipPolicy.test.ts needs >= 6 it() blocks"
[ "$(grep -cE "^\s*it\(" "$PT" || true)" -ge 9 ] || fail "ceremonyPrefs.test.ts needs >= 9 it() blocks"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$S" "$K" "$P" "$ST" "$KT" "$PT" && fail "test gutting / suppression found"

# ── 3. Typecheck ───────────────────────────────────────────────────────────
echo "[3/5] tsc --noEmit"
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"

# ── 4. Targeted vitest (the three new files) ───────────────────────────────
echo "[4/5] vitest spillSchedule / skipPolicy / ceremonyPrefs"
( cd mobile && npx vitest run \
    tests/unit/spillSchedule.test.ts \
    tests/unit/skipPolicy.test.ts \
    tests/unit/ceremonyPrefs.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/src/features/gacha/draw/ceremonyTimings.ts mobile/src/screens/DrawCeremonyScreen.tsx \
  mobile/src/features/gacha/draw/drawStateStore.ts mobile/src/review/storage.ts \
  mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/tests/setup)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } | sort -u | grep -Ev '^(mobile/src/features/gacha/draw/spillSchedule\.ts|mobile/src/features/gacha/draw/skipPolicy\.ts|mobile/src/features/gacha/draw/ceremonyPrefs\.ts|mobile/tests/unit/spillSchedule\.test\.ts|mobile/tests/unit/skipPolicy\.test\.ts|mobile/tests/unit/ceremonyPrefs\.test\.ts|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B03 scope"; }

echo "B03 VERIFY OK"
