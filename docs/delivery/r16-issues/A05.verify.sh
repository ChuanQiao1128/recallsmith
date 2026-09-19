#!/usr/bin/env bash
# A05 — R2 notifications verify. cwd = worktree root.
# Re-runs the brief's Acceptance mechanically; never trusts the worker's report.
#
# On the UNTOUCHED base tree (delivery/r16-a-home @ 92cebbd) this script exits
# non-zero at step 1: mobile/tests/unit/reminders.test.ts does not exist, so
# vitest reports "No test files found" (passWithNoTests is false) and exits 1.
# Steps 3 and 4 also fail on base: reminders.ts still contains
# requestPermissionsAsync / 'DevCards' / eveningEnabled: true, AudienceSurvey
# still does replace('PermissionPrompt'), DrawResult has no
# navigate('PermissionPrompt'), PermissionPromptScreen still passes
# firstDrawCoach and exports no markPermissionPromptPending.
# Step 5 (frozen files / no-deps / no-suppression guards) is purely negative
# and passes on base by design.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fail() { echo "A05 VERIFY FAIL: $*" >&2; exit 1; }

# Base for diff guards: the branch point off the integration branch.
# The driver exports BASE (integration branch name); fall back to the wave default.
BASE_BRANCH="${BASE:-delivery/r16-a-home}"
BASE="$(git merge-base HEAD "$BASE_BRANCH" 2>/dev/null \
  || git merge-base HEAD "origin/$BASE_BRANCH" 2>/dev/null \
  || git rev-parse HEAD)"
echo "A05 base ref: $BASE"

REM=mobile/src/notifications/reminders.ts
AUD=mobile/src/screens/AudienceSurveyScreen.tsx
PPS=mobile/src/screens/PermissionPromptScreen.tsx
DRS=mobile/src/screens/DrawResultScreen.tsx
UNIT=mobile/tests/unit/reminders.test.ts

# ── 1. targeted vitest (fails on base: reminders.test.ts missing) ────────────
[ -f "$UNIT" ] || fail "$UNIT missing"
grep -q "requestPermissionsAsync).not.toHaveBeenCalled()" "$UNIT" || fail "$UNIT lacks the 'never requests' assertion"
grep -q "toBe('DeveloperCards')" "$UNIT" || fail "$UNIT lacks the DeveloperCards title assertion"
grep -q "eveningEnabled: false" "$UNIT" || fail "$UNIT lacks the evening-off default assertion"
grep -q "isPermissionPromptPending" "$UNIT" || fail "$UNIT lacks the pending-flag test"
( cd mobile && npx vitest run \
    tests/unit/reminders.test.ts \
    tests/integration/onboarding.screen.test.tsx \
    tests/integration/phase-a-milestones.screen.test.tsx \
    tests/integration/draw-result.screen.test.tsx \
    --reporter=dot ) || fail "targeted vitest red"

# ── 2. typecheck ─────────────────────────────────────────────────────────────
( cd mobile && npm run test:typecheck ) || fail "tsc --noEmit red"

# ── 3. reminders.ts literals (fails on base) ─────────────────────────────────
! grep -q "requestPermissionsAsync" "$REM" || fail "reminders.ts still references requestPermissionsAsync"
grep -q "getPermissionsAsync" "$REM"      || fail "reminders.ts no longer reads permission via getPermissionsAsync"
grep -q "title: 'DeveloperCards'" "$REM"  || fail "reminders.ts morning title is not 'DeveloperCards'"
! grep -q "DevCards" "$REM"               || fail "reminders.ts still contains 'DevCards'"
grep -q "eveningEnabled: false" "$REM"    || fail "DEFAULT_PREFS.eveningEnabled is not false"
grep -q "morningEnabled: true" "$REM"     || fail "DEFAULT_PREFS.morningEnabled is not true"
# storage keys must survive for existing users
for k in "notifications:reminders:prefs:v1" "notifications:morning:daily9:id" "notifications:evening:state:v2" "notifications:reminders:last_due_count:v1"; do
  grep -q "$k" "$REM" || fail "reminders.ts lost storage key $k"
done
# the request must exist in exactly one source file: PermissionPromptScreen
REQ_FILES="$(grep -rl "requestPermissionsAsync" mobile/src | sort | tr '\n' ' ')"
[ "$REQ_FILES" = "$PPS " ] || fail "requestPermissionsAsync found in: [$REQ_FILES], expected only $PPS"

# ── 4. routing + testIDs (fails on base) ─────────────────────────────────────
grep -q "navigation.replace('Home', { firstDrawCoach: true })" "$AUD" || fail "AudienceSurvey does not replace('Home', { firstDrawCoach: true })"
! grep -q "replace('PermissionPrompt')" "$AUD"                        || fail "AudienceSurvey still routes to PermissionPrompt"
grep -q "markPermissionPromptPending" "$AUD"                          || fail "AudienceSurvey does not mark the pending flag"
grep -q "export async function markPermissionPromptPending" "$PPS"    || fail "PermissionPromptScreen lacks markPermissionPromptPending"
grep -q "export async function isPermissionPromptPending" "$PPS"      || fail "PermissionPromptScreen lacks isPermissionPromptPending"
grep -q "export async function clearPermissionPromptPending" "$PPS"   || fail "PermissionPromptScreen lacks clearPermissionPromptPending"
grep -q "notifications:permission-prompt:pending:v1" "$PPS"           || fail "pending flag key literal missing"
! grep -q "firstDrawCoach" "$PPS"                                     || fail "PermissionPromptScreen still passes firstDrawCoach"
grep -q "navigation.navigate('Home'" "$PPS"                           || fail "PermissionPromptScreen must navigate (pop) to Home, not replace"
! grep -q "navigation.replace(" "$PPS"                                || fail "PermissionPromptScreen still uses navigation.replace"
grep -q "navigate('PermissionPrompt')" "$DRS"                         || fail "DrawResult never pushes PermissionPrompt"
grep -q "isPermissionPromptPending" "$DRS"                            || fail "DrawResult does not read the pending flag"
grep -q "clearPermissionPromptPending" "$DRS"                         || fail "DrawResult does not clear the pending flag"
for t in draw-result-done-link screen-draw-result-primary-cta draw-result-earn-pulls-link screen-draw-result-root; do
  grep -q "testID=\"$t\"" "$DRS" || fail "DrawResult lost testID $t"
done
! grep -q "expo-notifications" "$DRS" "$AUD"                          || fail "DrawResult/AudienceSurvey must not import expo-notifications"
! grep -q "notifications/reminders" "$DRS" "$AUD"                     || fail "DrawResult/AudienceSurvey must not import reminders.ts"
grep -q "Allow reminders" "$PPS" && grep -q "Not now" "$PPS"          || fail "PermissionPrompt button copy changed"
grep -q "Finish setup" "$AUD" && grep -q "Skip for now" "$AUD"        || fail "AudienceSurvey button copy changed"

# ── 5. negative guards (pass on base by design) ──────────────────────────────
FROZEN_LINES="$(git diff --numstat "$BASE" -- \
  mobile/src/content/deckRepository.ts \
  mobile/src/sync/progressSync.ts \
  mobile/src/review/model.ts \
  mobile/src/screens/SplashScreen.tsx \
  mobile/src/navigation/types.ts \
  mobile/src/screens/HomeScreen.tsx \
  mobile/src/screens/SettingsScreen.tsx \
  mobile/src/features/gacha/home/deckActionResolver.ts \
  mobile/App.tsx \
  mobile/vitest.config.ts \
  mobile/package.json \
  mobile/package-lock.json | wc -l | tr -d ' ')"
[ "$FROZEN_LINES" = "0" ] || { git diff --numstat "$BASE" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts mobile/src/screens/SplashScreen.tsx mobile/src/navigation/types.ts mobile/src/screens/HomeScreen.tsx mobile/src/screens/SettingsScreen.tsx mobile/src/features/gacha/home/deckActionResolver.ts mobile/App.tsx mobile/vitest.config.ts mobile/package.json mobile/package-lock.json >&2; fail "frozen / out-of-scope files changed"; }
if git diff "$BASE" -- mobile/src mobile/tests | grep '^+' | grep -v '^+++' | grep -qE '@ts-ignore|@ts-expect-error|eslint-disable'; then
  fail "new @ts-ignore / @ts-expect-error / eslint-disable introduced"
fi
if git diff "$BASE" -- mobile/tests | grep '^+' | grep -qE '[.](skip|only)[(]'; then
  fail "test .skip/.only introduced"
fi
CHANGED_FILES="$(git diff --name-only "$BASE" -- mobile | wc -l | tr -d ' ')"
[ "$CHANGED_FILES" -le 8 ] || fail "more than 8 files changed under mobile ($CHANGED_FILES)"

echo "A05 VERIFY OK"
