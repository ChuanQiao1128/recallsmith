#!/usr/bin/env bash
# A08 draw-state-adoption — brief acceptance, re-run by the driver (Gate 2b).
# cwd = worktree root. Env BASE (integration branch name) is exported by the driver;
# falls back to delivery/r16-a-home when run by hand.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT FAILS at AC1 (vitest: "No test files found"
# for tests/unit/drawStateAdoption.test.ts, passWithNoTests=false) and, if AC1 were
# skipped, at every AC3 positive grep (ANON_USER_SCOPE_PREFIX / adoptAnonDrawState /
# adoptAnonRewardWallet / adoptAnonGachaState do not exist on base) and at AC4
# (authStore.ts has no adoptAnonGachaState call). The AC3 negative grep
# ("signing in afterwards starts empty" absent) and AC5 (frozen/scope numstat) are
# purely negative guards and pass on base by design.
set -euo pipefail

ROOT="$(pwd)"
fail() { echo "A08 VERIFY FAIL: $*" >&2; exit 1; }

STORE=mobile/src/features/gacha/draw/drawStateStore.ts
SYNC=mobile/src/sync/drawStateSync.ts
WALLET=mobile/src/features/gacha/rewards/rewardWallet.ts
AUTH=mobile/src/auth/authStore.ts
TEST=mobile/tests/unit/drawStateAdoption.test.ts

for f in "$STORE" "$SYNC" "$WALLET" "$AUTH"; do
  [ -f "$f" ] || fail "missing scope file $f"
done

# ---------------------------------------------------------------- AC1: targeted tests
[ -f "$TEST" ] || fail "AC1: $TEST does not exist (fails on base by design)"
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST" || true)
[ "$IT_COUNT" -ge 9 ] || fail "AC1: $TEST has $IT_COUNT it() blocks, need >= 9"

echo "AC1: targeted vitest"
( cd "$ROOT/mobile" && npx vitest run \
    tests/unit/drawStateAdoption.test.ts \
    tests/unit/drawStateSync.test.ts \
    tests/unit/gachaUserScope.test.ts \
    tests/unit/drawStateStore.test.ts \
    tests/unit/rewardWalletOrdering.test.ts \
    tests/unit/drawStateCacheInvalidation.test.ts \
    --reporter=dot ) || fail "AC1: targeted vitest failed"

# ---------------------------------------------------------------- AC2: typecheck + full unit suite
echo "AC2: typecheck + tests/unit"
( cd "$ROOT/mobile" && npm run test:typecheck ) || fail "AC2: typecheck failed"
( cd "$ROOT/mobile" && npx vitest run tests/unit --reporter=dot ) || fail "AC2: tests/unit failed"

# ---------------------------------------------------------------- AC3: literal guards
echo "AC3: literal guards"
grep -q "export const ANON_USER_SCOPE_PREFIX = 'devcards:u:anon:'" "$STORE" \
  || fail "AC3: ANON_USER_SCOPE_PREFIX literal missing in $STORE"
grep -q "export async function adoptAnonDrawState" "$STORE" \
  || fail "AC3: adoptAnonDrawState missing in $STORE"
grep -q "invalidateDrawStateCache" "$STORE" \
  || fail "AC3: $STORE removes anon draw-state keys but never calls invalidateDrawStateCache"
if grep -q "signing in afterwards starts empty" "$STORE"; then
  fail "AC3: stale 'starts empty' comment still present in $STORE"
fi
grep -q "export async function adoptAnonRewardWallet" "$WALLET" \
  || fail "AC3: adoptAnonRewardWallet missing in $WALLET"
grep -q "applyRewardToWallet(" "$WALLET" \
  || fail "AC3: applyRewardToWallet( no longer referenced in $WALLET"
grep -Eq "export (async )?function adoptAnonGachaState" "$SYNC" \
  || fail "AC3: adoptAnonGachaState missing in $SYNC"

# Ordering inside syncDrawStateNow: _inFlight = true  <  await adoptAnonGachaState()  <  await readStamps()
L_INFLIGHT=$(grep -n "_inFlight = true;" "$SYNC" | head -1 | cut -d: -f1)
L_ADOPT=$(grep -n "await adoptAnonGachaState()" "$SYNC" | head -1 | cut -d: -f1)
L_STAMPS=$(grep -n "await readStamps()" "$SYNC" | head -1 | cut -d: -f1)
[ -n "$L_INFLIGHT" ] && [ -n "$L_ADOPT" ] && [ -n "$L_STAMPS" ] \
  || fail "AC3: could not locate _inFlight/adoptAnonGachaState/readStamps lines in $SYNC"
[ "$L_INFLIGHT" -lt "$L_ADOPT" ] && [ "$L_ADOPT" -lt "$L_STAMPS" ] \
  || fail "AC3: adoption is not between _inFlight=true ($L_INFLIGHT) and readStamps ($L_STAMPS) in $SYNC (found at $L_ADOPT)"

# ---------------------------------------------------------------- AC4: sign-in ordering in authStore
echo "AC4: authStore ordering"
L_SUB=$(grep -n "await setActiveUserSub(userSub)" "$AUTH" | head -1 | cut -d: -f1)
L_CALL=$(grep -n "adoptAnonGachaState()" "$AUTH" | head -1 | cut -d: -f1)
L_TOKEN=$(grep -n "await setSyncAccessToken(at)" "$AUTH" | head -1 | cut -d: -f1)
[ -n "$L_CALL" ] || fail "AC4: authStore.ts never calls adoptAnonGachaState() (fails on base by design)"
[ -n "$L_SUB" ] && [ -n "$L_TOKEN" ] || fail "AC4: setActiveUserSub/setSyncAccessToken anchors moved in $AUTH"
[ "$L_SUB" -lt "$L_CALL" ] && [ "$L_CALL" -lt "$L_TOKEN" ] \
  || fail "AC4: adoptAnonGachaState() at $L_CALL is not between setActiveUserSub ($L_SUB) and setSyncAccessToken ($L_TOKEN)"
grep -q "from '../sync/drawStateSync'" "$AUTH" || fail "AC4: authStore.ts does not import from ../sync/drawStateSync"

# ---------------------------------------------------------------- AC5: scope + frozen guards
echo "AC5: scope + frozen files"
BASE_BRANCH="${BASE:-delivery/r16-a-home}"
# Prefer the local branch (a hand run with a stale origin would otherwise compute the
# merge-base at the pre-wave commit and list every A01-A07 file as out of scope).
if git rev-parse --verify -q "$BASE_BRANCH" >/dev/null; then BASE_REF="$BASE_BRANCH";
elif git rev-parse --verify -q "origin/$BASE_BRANCH" >/dev/null; then BASE_REF="origin/$BASE_BRANCH";
else fail "AC5: cannot resolve base ref $BASE_BRANCH"; fi
MB=$(git merge-base "$BASE_REF" HEAD)

FROZEN_DIFF=$(git diff --numstat "$MB" -- \
  mobile/src/content/deckRepository.ts \
  mobile/src/sync/progressSync.ts \
  mobile/src/review/model.ts \
  mobile/src/review/storage.ts)
[ -z "$FROZEN_DIFF" ] || fail "AC5: frozen/out-of-scope file changed:
$FROZEN_DIFF"

# Committed + working-tree changes vs merge-base, excluding the brief dir itself.
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
CHANGED=$( { git diff --name-only "$MB"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx; } | sort -u | grep -v '^docs/delivery/r16-issues/' || true)
BAD=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    "$STORE"|"$SYNC"|"$WALLET"|"$AUTH"|"$TEST") : ;;
    *) BAD="$BAD $f" ;;
  esac
done <<< "$CHANGED"
[ -z "$BAD" ] || fail "AC5: files outside the A08 scope changed:$BAD"

echo "A08 VERIFY PASS"
