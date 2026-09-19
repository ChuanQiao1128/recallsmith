#!/usr/bin/env bash
# A06 — R3 paywall: priceString + period, Terms/Privacy links, features.paywall.hidden on entrances.
# cwd = worktree root. Re-runs the brief's Acceptance section mechanically.
#
# On the UNTOUCHED base tree this script exits non-zero at:
#   - step 0 (featureFlags.ts missing) if A01 has not been merged into the base yet, otherwise
#   - step 1 (`mobile/tests/integration/paywall.screen.test.tsx` does not exist on base), and
#   - step 3 literal guards (PaywallScreen.tsx has no stdeula URL / ' / month' / testIDs; it still
#     contains 'Monthly subscription'; revenuecat.ts has no rcGetMonthlyPackageSafe; neither
#     SettingsScreen.tsx nor HomeScreen.tsx imports '../config/featureFlags').
#   Steps 2 (regression suites), 4 (frozen/scope numstat) and the negative greps pass on base by design.
set -euo pipefail

BASE_REF="${BASE_REF:-${BASE:-delivery/r16-a-home}}"   # driver exports BASE
fail() { echo "A06 VERIFY FAIL: $*" >&2; exit 1; }
step() { echo; echo "== A06 step $*"; }

PAYWALL=mobile/src/screens/PaywallScreen.tsx
RC=mobile/src/premium/revenuecat.ts
SETTINGS=mobile/src/screens/SettingsScreen.tsx
HOME_SCREEN=mobile/src/screens/HomeScreen.tsx
TEST=mobile/tests/integration/paywall.screen.test.tsx
FLAGS=mobile/src/config/featureFlags.ts

# ---------------------------------------------------------------------------
step 0 "preconditions"
[ -f "$FLAGS" ] || fail "$FLAGS missing — A06 depends on A01 (feature-flag store); base does not contain it"
[ -f "$PAYWALL" ] && [ -f "$RC" ] && [ -f "$SETTINGS" ] && [ -f "$HOME_SCREEN" ] || fail "scope source file missing"
git rev-parse --verify --quiet "$BASE_REF" >/dev/null || fail "base ref $BASE_REF not found (override with BASE_REF=...)"
BASE="$(git merge-base HEAD "$BASE_REF")"
echo "base commit: $BASE"

# ---------------------------------------------------------------------------
step 1 "new paywall suite exists and is green (fails on base: file absent)"
[ -f "$TEST" ] || fail "$TEST does not exist"
[ "$(grep -c "^[[:space:]]*it('" "$TEST")" -ge 5 ] || fail "$TEST must define at least 5 it() cases"
grep -q "describe('PaywallScreen'" "$TEST" || fail "$TEST lacks describe('PaywallScreen')"
grep -q "describe('SettingsScreen paywall entrance'" "$TEST" || fail "$TEST lacks describe('SettingsScreen paywall entrance')"
grep -q "paywall.hidden is true" "$TEST" || fail "$TEST lacks the hidden-flag Settings case"
grep -Fq "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" "$TEST" || fail "$TEST does not assert the Terms of Use URL"
if grep -q "react-native-purchases'" "$TEST" && ! grep -q "vi.mock('react-native-purchases'" "$TEST"; then
  fail "$TEST imports real react-native-purchases"
fi
( cd mobile && npx vitest run tests/integration/paywall.screen.test.tsx --reporter=dot )

# ---------------------------------------------------------------------------
step 2 "typecheck + regression suites (Settings + four Home suites, unchanged files)"
( cd mobile && npm run test:typecheck )
( cd mobile && npx vitest run \
    tests/integration/settings.screen.test.tsx \
    tests/integration/home.screen.test.tsx \
    tests/integration/home-cta-target.test.tsx \
    tests/integration/home-primary-cta.test.tsx \
    tests/integration/home-economy-floor.spec.tsx \
    --reporter=dot )

# ---------------------------------------------------------------------------
step 3 "literal / testID guards (fail on base)"
for lit in \
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/' \
  ' / month' \
  'Not available right now' \
  'Loading price…' \
  'Terms of Use' \
  'Privacy Policy' \
  'paywall-billing-value' \
  'paywall-subscribe' \
  'paywall-terms-link' \
  'paywall-privacy-link' \
  'rcGetMonthlyPackageSafe' \
  'Linking.openURL' ; do
  grep -Fq -- "$lit" "$PAYWALL" || fail "$PAYWALL missing literal: $lit"
done
! grep -Fq 'Monthly subscription' "$PAYWALL" || fail "$PAYWALL still contains 'Monthly subscription'"

# Privacy URL byte-identical between PaywallScreen and SettingsScreen
PRIV_RE='https://tartan-tortoise-e81\.notion\.site/DevCards-Spaced-Recall-Privacy-Policy[^'"'"'"]*'
PRIV_SETTINGS="$(grep -o "$PRIV_RE" "$SETTINGS" | head -1)"
PRIV_PAYWALL="$(grep -o "$PRIV_RE" "$PAYWALL" | head -1)"
[ -n "$PRIV_SETTINGS" ] || fail "$SETTINGS lost PRIVACY_URL"
[ -n "$PRIV_PAYWALL" ] || fail "$PAYWALL has no Privacy URL"
[ "$PRIV_SETTINGS" = "$PRIV_PAYWALL" ] || fail "Privacy URL differs: Settings='$PRIV_SETTINGS' Paywall='$PRIV_PAYWALL'"

# revenuecat.ts: one new additive export, no new @ts-ignore
grep -Eq '^export async function rcGetMonthlyPackageSafe\(' "$RC" || fail "$RC lacks 'export async function rcGetMonthlyPackageSafe('"
grep -q 'Purchases.getOfferings()' "$RC" || fail "$RC no longer calls Purchases.getOfferings()"
[ "$(grep -c '@ts-ignore' "$RC")" -eq 4 ] || fail "$RC @ts-ignore count changed (expected exactly 4)"
for keep in 'export async function rcPurchaseMonthly' 'export async function rcRestore' 'export async function rcGetCustomerInfoSafe' 'export function isPremiumActive'; do
  grep -Fq "$keep" "$RC" || fail "$RC lost existing export: $keep"
done

# Entrances read the flag
for f in "$SETTINGS" "$HOME_SCREEN"; do
  grep -Eq "from '\.\./config/featureFlags'" "$f" || fail "$f does not import from '../config/featureFlags'"
  grep -Eq 'paywall\??\.hidden' "$f" || fail "$f does not reference paywall.hidden"
done
grep -Fq "Premium packs are not available yet. Free packs stay open." "$HOME_SCREEN" || fail "$HOME_SCREEN lacks the hidden-tap alert body"
grep -Fq "navigation.navigate('Paywall')" "$HOME_SCREEN" || fail "$HOME_SCREEN lost the Paywall navigation"
grep -Fq "navigation.navigate('Paywall')" "$SETTINGS" || fail "$SETTINGS lost the Paywall navigation"
grep -Fq "'Open premium'" "$SETTINGS" || fail "$SETTINGS lost the 'Open premium' literal"
grep -Fq "PRIVACY_URL" "$SETTINGS" || fail "$SETTINGS lost PRIVACY_URL"

# Kept testIDs
for tid in screen-settings-root screen-settings-primary-cta; do grep -Fq "\"$tid\"" "$SETTINGS" || fail "$SETTINGS lost testID $tid"; done
for tid in screen-home-root home-featured-pack screen-home-primary-cta home-pack-visual; do grep -Fq "\"$tid\"" "$HOME_SCREEN" || fail "$HOME_SCREEN lost testID $tid"; done

# Negative guards on the diff (pass on base)
ADDED="$(git diff "$BASE" -- "$PAYWALL" "$RC" "$SETTINGS" "$HOME_SCREEN" | grep -E '^\+' | grep -vE '^\+\+\+' || true)"
for bad in '@ts-ignore' '@ts-expect-error' 'eslint-disable' 'coming soon' 'Coming soon' 'placeholder' 'MVP'; do
  ! printf '%s\n' "$ADDED" | grep -Fq -- "$bad" || fail "diff adds banned term: $bad"
done
! grep -Eiq 'coming soon|@ts-ignore|eslint-disable' "$TEST" || fail "$TEST contains a banned term"

# ---------------------------------------------------------------------------
step 4 "diff scope + frozen files (pass on base)"
for frozen in mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts; do
  [ -z "$(git diff --numstat "$BASE" -- "$frozen")" ] || fail "frozen file touched: $frozen"
done
for locked in mobile/package.json mobile/package-lock.json mobile/src/config/featureFlags.ts mobile/src/config/remoteConfig.ts mobile/src/config/forceUpdateGate.ts mobile/src/screens/DeckScreen.tsx mobile/tests/integration/settings.screen.test.tsx; do
  [ -z "$(git diff --numstat "$BASE" -- "$locked")" ] || fail "out-of-scope file changed: $locked"
done
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
CHANGED="$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx; } | sort -u )"
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in
    mobile/src/screens/PaywallScreen.tsx|mobile/src/premium/revenuecat.ts|mobile/src/screens/SettingsScreen.tsx|mobile/src/screens/HomeScreen.tsx|mobile/tests/integration/paywall.screen.test.tsx) ;;
    docs/delivery/r16-issues/*) ;;   # briefs/verify scripts the supervisor drops in
    *) fail "changed path outside A06 scope: $p" ;;
  esac
done <<< "$CHANGED"

echo
echo "A06 VERIFY OK"
