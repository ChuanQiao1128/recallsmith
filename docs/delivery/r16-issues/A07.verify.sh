#!/usr/bin/env bash
# A07 account-deletion — mechanical verification. cwd = worktree root.
# Re-runs the brief's Acceptance bullets (cheap guards first so a wrong tree fails
# in < 1 s instead of after the 80 s typecheck). Never trusts the worker's report.
#
# Expected on the UNTOUCHED base tree (delivery/r16-a-home @ 92cebbd): EXIT NON-ZERO.
#   - step 1 fails first: mobile/tests/integration/account-deletion.test.tsx does
#     not exist (and vitest would silently drop a missing path and exit 0, so the
#     existence test is explicit).
#   - step 2 would fail: SettingsAccountScreen.tsx / DeleteAccountConfirmScreen.tsx
#     still exist; App.tsx / types.ts / me-final test reference them (28 hits).
#   - step 3 would fail: authStore.ts has no deleteAccountNow; AccountSection.tsx has
#     no settings-delete-account-* testIDs.
#   Steps 4-6 pass on base (typecheck green; 89 files / 529 tests green) and step 7
#   is a purely negative guard (frozen + out-of-scope files unchanged).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASE_BRANCH="${A07_BASE_REF:-${BASE:-delivery/r16-a-home}}"   # driver exports BASE
if git rev-parse --verify --quiet "$BASE_BRANCH" >/dev/null; then
  BASE_REF="$(git merge-base HEAD "$BASE_BRANCH")"
else
  echo "WARN: $BASE_BRANCH not found; using HEAD as frozen-file base" >&2
  BASE_REF="HEAD"
fi

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

ACC="mobile/src/features/gacha/settings/account/AccountSection.tsx"
AUTH="mobile/src/auth/authStore.ts"
NEWTEST="mobile/tests/integration/account-deletion.test.tsx"

step "1/7 new test file exists"
test -f "$NEWTEST" || fail "$NEWTEST missing"
grep -q "screen-settings-primary-cta"      "$NEWTEST" || fail "new test: single-anchor case missing"
grep -q "recallsmith:streaks:snapshot:v1"  "$NEWTEST" || fail "new test: streak key case missing"
grep -q "devcards:u:anon:"                 "$NEWTEST" || fail "new test: anon-partition keeper missing"
grep -q "settings-delete-account-confirm"  "$NEWTEST" || fail "new test: confirm testID never driven"

step "2/7 fake delete path is gone (screens, routes, mock preview, test imports)"
test ! -e mobile/src/screens/SettingsAccountScreen.tsx     || fail "SettingsAccountScreen.tsx still exists"
test ! -e mobile/src/screens/DeleteAccountConfirmScreen.tsx || fail "DeleteAccountConfirmScreen.tsx still exists"
if grep -rnE "SettingsAccount[S':\"]|DeleteAccountConfirm|DELETE_PREVIEW" mobile/App.tsx mobile/src mobile/tests; then
  fail "references to the deleted screens / DELETE_PREVIEW remain (listed above)"
fi
test -e mobile/src/screens/SettingsMainScreen.tsx || fail "SettingsMainScreen.tsx was deleted (out of scope; four out-of-scope tests import it)"
grep -q "SETTINGS_SNAPSHOT" mobile/src/mock/settings.ts || fail "SETTINGS_SNAPSHOT removed from mock/settings.ts (out-of-scope screens import it)"
! grep -q "Account & billing" mobile/src/screens/SettingsMainScreen.tsx || fail "SettingsMainScreen still links to Account & billing"

step "3/7 real deletion wiring (literals from the brief)"
grep -q "deleteAccountNow"             "$AUTH" || fail "authStore: deleteAccountNow missing"
grep -q "purgeUserScopedStorage"       "$AUTH" || fail "authStore: purgeUserScopedStorage missing"
grep -q "recallsmith:streaks:"         "$AUTH" || fail "authStore: streak prefix not purged"
grep -q "invalidateProgressQueueCache" "$AUTH" || fail "authStore: queue cache not invalidated after purge"
grep -q "invalidateDrawStateCache"     "$AUTH" || fail "authStore: draw-state cache not invalidated after purge"
[ "$(grep -c "from 'aws-amplify/auth'" "$AUTH")" = "1" ] || fail "authStore: expected exactly one aws-amplify/auth import"
# deleteUser must sit inside that single (multi-line) import list.
awk "/^import \\{/{f=1} f&&/deleteUser/{found=1} /from 'aws-amplify\\/auth'/{exit} END{exit !found}" "$AUTH" \
  || fail "authStore: deleteUser not imported from aws-amplify/auth"
! grep -q "resetAllProgress" "$AUTH" || fail "authStore must not call resetAllProgress (wipes every account)"
for id in settings-delete-account-open settings-delete-account-input settings-delete-account-confirm settings-delete-account-cancel; do
  grep -q "$id" "$ACC" || fail "AccountSection: testID $id missing"
done
grep -q "DELETE_CONFIRM_TOKEN = 'DELETE'" "$ACC" || fail "AccountSection: DELETE_CONFIRM_TOKEN literal missing"
grep -q "await import('../../../../auth/authStore')" "$ACC" || fail "AccountSection: lazy authStore import missing"
! grep -q "useNavigation" "$ACC" || fail "AccountSection must not call useNavigation (settings.screen.test mock lacks it)"
! grep -qE "^import .*auth/authStore" "$ACC" || fail "AccountSection must not statically import authStore (breaks settings-copy.spec)"
! grep -q "Alert.prompt" "$ACC" || fail "AccountSection: Alert.prompt is banned (iOS-only, untestable)"
# Copy guard duplicated from tests/unit/settings-copy.spec.ts (that spec also runs in step 5).
if sed -n '/^export const ACCOUNT_COPY/,/^} as const;/p' "$ACC" | tr '[:upper:]' '[:lower:]' | grep -qE "wipe|delete all"; then
  fail "ACCOUNT_COPY contains forbidden wording (wipe / delete all)"
fi

step "4/7 typecheck"
( cd mobile && npm run test:typecheck )

step "5/7 targeted vitest (new test + every file whose mocks constrain AccountSection)"
( cd mobile && npx vitest run \
    tests/integration/account-deletion.test.tsx \
    tests/integration/me-final.screen.test.tsx \
    tests/integration/settings.screen.test.tsx \
    tests/unit/settings-copy.spec.ts \
    --reporter=dot )

step "6/7 whole mobile suite"
( cd mobile && npx vitest run --reporter=dot )

step "7/7 frozen + out-of-scope files untouched vs $BASE_REF (negative guard; passes on base)"
NUMSTAT="$(git diff --numstat "$BASE_REF" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts)"
[ -z "$NUMSTAT" ] || { echo "$NUMSTAT"; fail "frozen file modified"; }
OOS="$(git diff --numstat "$BASE_REF" -- \
  mobile/src/screens/SettingsScreen.tsx \
  mobile/tests/integration/settings.screen.test.tsx \
  mobile/tests/unit/settings-copy.spec.ts \
  mobile/src/screens/SettingsNotificationsScreen.tsx \
  mobile/src/screens/SettingsAudienceScreen.tsx \
  mobile/src/screens/SettingsPoolsScreen.tsx \
  mobile/src/screens/SettingsAppearanceScreen.tsx \
  mobile/src/features/gacha/settings/account/accountActions.ts)"
[ -z "$OOS" ] || { echo "$OOS"; fail "out-of-scope file modified (A06 owns SettingsScreen.tsx)"; }

echo
echo "A07 verify: ALL PASS"
