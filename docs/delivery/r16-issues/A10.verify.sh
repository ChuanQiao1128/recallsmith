#!/usr/bin/env bash
# A10 me-help-profile-copy — brief acceptance, re-run by the driver (Gate 2b).
# cwd = worktree root. Env BASE (integration branch name) is exported by the driver;
# falls back to delivery/r16-a-home when run by hand.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT FAILS at AC1 (mobile/tests/integration/
# more.screen.test.tsx does not exist; a vitest path filter that matches nothing
# is silently ignored, so the existence check is explicit) and, if AC1 were
# skipped, at AC3 (mobile/src/content/faq.ts missing, mobile/src/mock/faq.ts still
# present, HelpFAQScreen still imports '../mock/faq', MoreScreen has no byline /
# MORE_LINKS / testIDs, and the screens still contain "support rail",
# "Developer tools", "Learner #local", "support companion") and at AC4
# (me-final:89 asserts toContain('Developer tools'), support-pool-polish:77 asserts
# toContain('support rail'), support-family-final-polish:70 asserts
# toContain('support companion')). AC2 (typecheck) and AC5 (scope/frozen numstat)
# are purely negative/baseline guards and pass on base by design.
set -euo pipefail

ROOT="$(pwd)"
fail() { echo "A10 VERIFY FAIL: $*" >&2; exit 1; }

MORE=mobile/src/screens/MoreScreen.tsx
HELP=mobile/src/screens/HelpFAQScreen.tsx
PROFILE=mobile/src/screens/ProfileScreen.tsx
FAQ_NEW=mobile/src/content/faq.ts
FAQ_OLD=mobile/src/mock/faq.ts
TEST_NEW=mobile/tests/integration/more.screen.test.tsx
TEST_MEFINAL=mobile/tests/integration/me-final.screen.test.tsx
TEST_POOL=mobile/tests/integration/support-pool-polish.screen.test.tsx
TEST_FAMILY=mobile/tests/integration/support-family-final-polish.screen.test.tsx

for f in "$MORE" "$HELP" "$PROFILE"; do
  [ -f "$f" ] || fail "missing scope file $f"
done

# ---------------------------------------------------------------- AC1: targeted tests
[ -f "$TEST_NEW" ] || fail "AC1: $TEST_NEW does not exist (fails on base by design)"
IT_COUNT=$(grep -cE "^\s*it\(" "$TEST_NEW" || true)
[ "$IT_COUNT" -ge 8 ] || fail "AC1: $TEST_NEW has $IT_COUNT it() blocks, need >= 8"

# Pre-existing suites: a parallel issue (A07) may delete some of them; run the
# ones that still exist. The new suite is mandatory (checked above).
TEST_FILES=("tests/integration/more.screen.test.tsx")
for t in \
  tests/integration/me-real-data.spec.tsx \
  tests/integration/me-final.screen.test.tsx \
  tests/integration/phase-c-complete.screen.test.tsx \
  tests/integration/phase-c-shells.screen.test.tsx \
  tests/integration/support-pool-polish.screen.test.tsx \
  tests/integration/support-family-final-polish.screen.test.tsx; do
  [ -f "mobile/$t" ] && TEST_FILES+=("$t")
done

echo "AC1: targeted vitest (${#TEST_FILES[@]} files)"
( cd "$ROOT/mobile" && npx vitest run "${TEST_FILES[@]}" --reporter=dot ) \
  || fail "AC1: targeted vitest failed"

# ---------------------------------------------------------------- AC2: typecheck
echo "AC2: typecheck"
( cd "$ROOT/mobile" && npm run test:typecheck ) || fail "AC2: typecheck failed"

# ---------------------------------------------------------------- AC3: literal guards
echo "AC3: literal guards"
[ -f "$FAQ_NEW" ] || fail "AC3: $FAQ_NEW missing (fails on base by design)"
[ ! -e "$FAQ_OLD" ] || fail "AC3: $FAQ_OLD still exists (fails on base by design)"
if grep -rn "mock/faq" mobile/src mobile/tests >/dev/null; then
  fail "AC3: something still imports mock/faq"
fi
grep -q "export const FAQ_LIST" "$FAQ_NEW" || fail "AC3: FAQ_LIST export missing in $FAQ_NEW"
# Entries only: `q: '...'` / `q: "..."` — the `q: string` in the type alias does not match.
Q_COUNT=$(grep -cE "\bq:\s*['\"\`]" "$FAQ_NEW" || true)
[ "$Q_COUNT" -ge 6 ] && [ "$Q_COUNT" -le 8 ] || fail "AC3: $FAQ_NEW has $Q_COUNT FAQ entries, need 6..8"
for lit in "Why is Draw locked?" "AI assistance" "iOS only"; do
  grep -qF "$lit" "$FAQ_NEW" || fail "AC3: '$lit' missing from $FAQ_NEW"
done
for bad in "route pressure" "thousands" "FSRS" "SM-2" "Google Play" "no AI"; do
  if grep -qF "$bad" "$FAQ_NEW"; then fail "AC3: red-line / mock literal '$bad' present in $FAQ_NEW"; fi
done
grep -q "from '../content/faq'" "$HELP" || fail "AC3: $HELP does not import '../content/faq'"

grep -qF "Made by one developer in Auckland" "$MORE" || fail "AC3: byline missing in $MORE (fails on base by design)"
grep -q "export const MORE_LINKS" "$MORE" || fail "AC3: MORE_LINKS export missing in $MORE"
grep -q "app.json" "$MORE" || fail "AC3: $MORE does not read the version from app.json"
for tid in more-row-profile more-row-settings more-row-help more-row-privacy more-row-support more-byline more-version; do
  grep -q "testID=\"$tid\"" "$MORE" || fail "AC3: testID $tid missing in $MORE"
done
for mod in "expo-constants" "expo-application" "config/remoteConfig"; do
  if grep -q "$mod" "$MORE"; then fail "AC3: $MORE imports $mod (breaks the unmocked suites)"; fi
done
if grep -q "Linking" "$PROFILE"; then fail "AC3: $PROFILE references Linking (me-real-data presses every Pressable)"; fi
for bad in "support rail" "Developer tools" "Debug menu" "Dev tools" "Support areas" "Learner #local" "Study identity" "Next best return point" "support companion"; do
  for f in "$MORE" "$PROFILE" "$HELP"; do
    if grep -qF "$bad" "$f"; then fail "AC3: placeholder literal '$bad' still present in $f"; fi
  done
done

# ---------------------------------------------------------------- AC4: no test asserts the old placeholders
echo "AC4: test-literal guard"
POS=$(grep -rEn "\)\.toContain\('(support rail|Developer tools|support companion|Learner #local|Study identity|Next best return point)'\)" mobile/tests || true)
[ -z "$POS" ] || fail "AC4: a test still positively asserts an old placeholder string (fails on base by design):
$POS"

# ---------------------------------------------------------------- AC5: scope + frozen guards
echo "AC5: scope + frozen files"
BASE_BRANCH="${BASE:-delivery/r16-a-home}"
# Prefer the local branch (a hand run with a stale origin would otherwise compute the
# merge-base at the pre-wave commit and list every A01-A09 file as out of scope).
if git rev-parse --verify -q "$BASE_BRANCH" >/dev/null; then BASE_REF="$BASE_BRANCH";
elif git rev-parse --verify -q "origin/$BASE_BRANCH" >/dev/null; then BASE_REF="origin/$BASE_BRANCH";
else fail "AC5: cannot resolve base ref $BASE_BRANCH"; fi
MB=$(git merge-base "$BASE_REF" HEAD)

FROZEN_DIFF=$(git diff --numstat "$MB" -- \
  mobile/src/content/deckRepository.ts \
  mobile/src/sync/progressSync.ts \
  mobile/src/review/model.ts \
  mobile/src/components/AppInfoScreen.tsx \
  mobile/src/screens/SettingsScreen.tsx \
  mobile/src/screens/EditProfileScreen.tsx \
  mobile/App.tsx)
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
    "$MORE"|"$HELP"|"$PROFILE"|"$FAQ_NEW"|"$FAQ_OLD"|"$TEST_NEW"|"$TEST_MEFINAL"|"$TEST_POOL"|"$TEST_FAMILY") : ;;
    *) BAD="$BAD $f" ;;
  esac
done <<< "$CHANGED"
[ -z "$BAD" ] || fail "AC5: files outside the A10 scope changed:$BAD"

echo "A10 VERIFY PASS"
