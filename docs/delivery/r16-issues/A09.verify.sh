#!/usr/bin/env bash
# A09 — library-install-path — independent verification.
# cwd = worktree root. Re-runs the brief's Acceptance section; never trusts the worker's report.
#
# On the UNTOUCHED base tree (delivery/r16-a-home @ 92cebbd) this script exits non-zero at:
#   - step 1: tests/integration/library.screen.test.tsx does not exist -> the explicit existence check
#             fails (vitest alone would NOT fail: a missing filter just matches nothing while the two
#             existing suites still run and pass, so the check is spelled out).
#   - step 3: LibraryScreen.tsx still contains 'Deck is not installed yet' and lacks installDeckFromUrl( /
#             the new literals and testIDs -> the guard fails.
#   - step 4: the new test file is absent -> grep fails.
# Steps 2 (typecheck) and 5 (frozen-file / scope numstat guard) are green on base by design: they are
# purely negative guards that only detect regressions introduced by the change.
set -euo pipefail

ROOT="$(pwd)"
LIB="mobile/src/screens/LibraryScreen.tsx"
TEST="mobile/tests/integration/library.screen.test.tsx"

fail() { echo "A09 VERIFY FAIL: $*" >&2; exit 1; }
step() { echo; echo "== A09 step $*"; }

[ -f "$LIB" ] || fail "missing $LIB (cwd must be the worktree root)"

# ---------------------------------------------------------------------------
step 1 "targeted vitest (new file + the two existing Library suites that must stay green)"
[ -f "$TEST" ] || fail "missing $TEST -- the new integration test was not created"
( cd "$ROOT/mobile" && npx vitest run \
    tests/integration/library.screen.test.tsx \
    tests/integration/library-final.screen.test.tsx \
    tests/integration/library-360-columns.spec.tsx \
    --reporter=dot ) || fail "targeted vitest failed"

# ---------------------------------------------------------------------------
step 2 "mobile typecheck"
( cd "$ROOT/mobile" && npm run test:typecheck ) || fail "typecheck failed"

# ---------------------------------------------------------------------------
step 3 "LibraryScreen.tsx literal / testID guards"
! grep -q 'Deck is not installed yet' "$LIB"                                   || fail "old throw literal still present in $LIB"
grep -q 'installDeckFromUrl('                    "$LIB"                          || fail "installDeckFromUrl( not called in $LIB"
grep -q 'checkManifestForUpdates(false)'         "$LIB"                          || fail "checkManifestForUpdates(false) missing in $LIB"
grep -q 'This deck is not available on this device yet.' "$LIB"                  || fail "not-installable literal missing"
grep -q 'Install failed. Check your connection and retry.' "$LIB"                || fail "install-failed literal missing"
grep -q 'testID="library-unavailable-home-cta"'  "$LIB"                          || fail "testID library-unavailable-home-cta missing"
grep -q 'testID="library-unavailable-state"'     "$LIB"                          || fail "testID library-unavailable-state missing"
grep -q 'testID="library-unavailable-retry"'     "$LIB"                          || fail "testID library-unavailable-retry missing"
grep -q "navigate('Home')"                       "$LIB"                          || fail "navigate('Home') missing"
grep -q 'Go to Home'                             "$LIB"                          || fail "Go to Home label missing"
! grep -q 'deckActionResolver'                   "$LIB"                          || fail "$LIB must not import deckActionResolver (import-graph rule)"
# testIDs that must survive untouched
for id in screen-library-root screen-library-primary-surface library-card-grid library-empty-state library-empty-cta; do
  grep -q "testID=\"$id\"" "$LIB" || fail "kept testID $id disappeared from $LIB"
done
grep -q "'No deck available yet. Install one first.'" "$LIB"                     || fail "no-slug literal changed"
grep -q 'Library unavailable' "$LIB"                                             || fail "'Library unavailable' title changed"

# ---------------------------------------------------------------------------
step 4 "new integration test asserts the install path"
[ -f "$TEST" ]                                                                   || fail "missing $TEST"
grep -q "toHaveBeenCalledWith('Home')"                    "$TEST"                || fail "test does not assert navigate('Home')"
grep -q 'library-unavailable-home-cta'                    "$TEST"                || fail "test does not press the Go to Home CTA"
grep -q "'https://cdn.example.com/content/csharp.json'"   "$TEST"                || fail "test does not assert the install URL"
grep -q 'checkManifestForUpdates'                         "$TEST"                || fail "test does not mock checkManifestForUpdates"
grep -q 'installDeckFromUrl'                              "$TEST"                || fail "test does not mock/assert installDeckFromUrl"
grep -q 'This deck is not available on this device yet.'  "$TEST"                || fail "test does not assert the not-installable copy"
grep -q 'Install failed. Check your connection and retry.' "$TEST"               || fail "test does not assert the install-failed copy"
IT_COUNT="$(grep -c '^\s*it(' "$TEST" || true)"
[ "${IT_COUNT:-0}" -ge 3 ]                                                       || fail "expected >= 3 it() cases in $TEST, found ${IT_COUNT:-0}"
# no test gutting
! grep -q -E '\b(it|describe|test)\.(skip|only)\(' "$TEST"                       || fail "skip/only found in $TEST"

# ---------------------------------------------------------------------------
step 5 "frozen files + scope numstat guard (green on base by design)"
BASE=""
for ref in "${A09_BASE_REF:-${BASE:-}}" delivery/r16-a-home origin/delivery/r16-a-home; do   # driver exports BASE
  [ -n "$ref" ] || continue
  if git rev-parse --verify -q "$ref" >/dev/null 2>&1; then
    BASE="$(git merge-base HEAD "$ref")"; break
  fi
done
[ -n "$BASE" ] || fail "cannot resolve base ref (set A09_BASE_REF)"
echo "base = $BASE"

FROZEN_DIFF="$(git diff --numstat "$BASE" -- \
  mobile/src/content/deckRepository.ts \
  mobile/src/sync/progressSync.ts \
  mobile/src/review/model.ts \
  mobile/src/features/gacha/home/deckActionResolver.ts \
  mobile/package.json mobile/package-lock.json)"
[ -z "$FROZEN_DIFF" ] || { echo "$FROZEN_DIFF" >&2; fail "frozen / off-limits file changed"; }

# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
OUT_OF_SCOPE="$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx; } \
  | grep -v -E '^(mobile/src/screens/LibraryScreen\.tsx|mobile/tests/integration/library\.screen\.test\.tsx|docs/delivery/r16-issues/)' || true)"
[ -z "$OUT_OF_SCOPE" ] || { echo "$OUT_OF_SCOPE" >&2; fail "files changed outside A09 scope"; }

# size guard: <= 400 LOC changed excluding tests
CHANGED_LOC="$(git diff --numstat "$BASE" -- mobile/src/screens/LibraryScreen.tsx | awk '{s+=$1+$2} END {print s+0}')"
[ "$CHANGED_LOC" -le 400 ] || fail "LibraryScreen.tsx diff is $CHANGED_LOC LOC (> 400)"

# the existing Library suites must be untouched (their mocks lack the new exports on purpose)
for f in mobile/tests/integration/library-final.screen.test.tsx mobile/tests/integration/library-360-columns.spec.tsx; do
  [ -z "$(git diff --numstat "$BASE" -- "$f")" ] || fail "$f was modified"
done

echo
echo "A09 VERIFY OK"
