#!/usr/bin/env bash
# B01 — native-foundation verify. cwd = worktree root. Re-runs the brief's six
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - app.json still says version 1.5.0 / buildNumber 15 / supportsTablet true,
#     has no scheme and no plugins key; package.json still says 1.5.0 and still
#     lists lottie-react-native + expo-av while none of the six new packages exist
#   - package-lock.json still contains "node_modules/lottie-react-native"
# Steps 2 (App.tsx / RootErrorBoundary literals), 3 (packages on disk) and 4
# (rootErrorBoundary.test.tsx does not exist) would also fail on base; step 5
# (prebuild) would pass the prebuild but fail the NSMicrophoneUsageDescription
# grep (expo-av's auto plugin writes it); step 6 is a purely negative scope
# guard and passes on base by design.
#
# Network: none. `expo prebuild` resolves the local mobile/node_modules/expo/
# template.tgz (@expo/cli resolveTemplate.js:98-104) and --no-install skips
# CocoaPods. This is the ONLY Wave B verify allowed to run prebuild; mobile/ios
# is removed on every exit path via the trap.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-b-ceremony}}"   # driver exports BASE
fail() { echo "B01 VERIFY FAIL: $*" >&2; exit 1; }
cleanup() { rm -rf "$ROOT/mobile/ios"; }
trap cleanup EXIT

PKG=mobile/package.json
LOCK=mobile/package-lock.json
APP=mobile/app.json
TSX=mobile/App.tsx
EB=mobile/src/components/RootErrorBoundary.tsx
T=mobile/tests/unit/rootErrorBoundary.test.tsx
[ -f "$PKG" ] && [ -f "$LOCK" ] && [ -f "$APP" ] && [ -f "$TSX" ] || fail "manifest/App.tsx missing"

# ── 1. Manifest guards (FAILS ON BASE) ─────────────────────────────────────
echo "[1/6] app.json / package.json / package-lock.json guards"
node -e '
const a = require("./mobile/app.json").expo;
const p = require("./mobile/package.json");
const problems = [];
if (a.version !== "1.6.0") problems.push("app.json version != 1.6.0 (base tree fails here)");
if (a.jsEngine !== "hermes") problems.push("app.json jsEngine must stay exactly \"hermes\" (it exists at app.json:3 today)");
if (a.ios?.buildNumber !== "16") problems.push("app.json ios.buildNumber != \"16\"");
if (a.ios?.supportsTablet !== false) problems.push("app.json ios.supportsTablet != false");
if (a.scheme !== "recallsmith") problems.push("app.json scheme != recallsmith");
if (JSON.stringify(a.plugins) !== JSON.stringify([["expo-audio", { microphonePermission: false }]])) problems.push("app.json plugins must be exactly [[\"expo-audio\",{\"microphonePermission\":false}]]");
if (JSON.stringify(a.ios?.infoPlist) !== JSON.stringify({ ITSAppUsesNonExemptEncryption: false })) problems.push("app.json ios.infoPlist changed");
if (a.runtimeVersion?.policy !== "appVersion") problems.push("runtimeVersion.policy changed");
if ("newArchEnabled" in a) problems.push("newArchEnabled must not be added");
if (p.version !== "1.6.0") problems.push("package.json version != 1.6.0");
if (p.dependencies["@shopify/react-native-skia"] !== "2.2.12") problems.push("skia must stay exactly 2.2.12");
if (p.devDependencies.vite !== "7.2.4") problems.push("vite must stay exactly 7.2.4");
for (const k of ["lottie-react-native", "expo-av"]) if (p.dependencies[k] || p.devDependencies[k]) problems.push(k + " must be removed");
for (const k of ["react-native-reanimated", "react-native-worklets", "expo-audio", "expo-store-review", "expo-sharing", "react-native-view-shot"]) if (typeof p.dependencies[k] !== "string") problems.push(k + " missing from dependencies");
if (!/^~?4\.1\./.test(p.dependencies["react-native-reanimated"] ?? "")) problems.push("react-native-reanimated range must be ~4.1.x");
if (JSON.stringify(p).includes("@sentry") || JSON.stringify(p).includes("sentry-expo")) problems.push("no Sentry package allowed");
if (p.dependencies.react !== "19.1.0" || p.dependencies["react-native"] !== "0.81.5" || !String(p.dependencies.expo).startsWith("~54.")) problems.push("react/react-native/expo pins changed");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
' || fail "manifest guard failed"
if grep -Eq '"node_modules/(lottie-react-native|expo-av|@sentry/[a-z-]+)"' "$LOCK"; then
  fail "package-lock.json still carries lottie-react-native / expo-av / @sentry (base tree fails here)"
fi
for k in react-native-reanimated react-native-worklets expo-audio expo-store-review expo-sharing react-native-view-shot; do
  grep -q "\"node_modules/$k\"" "$LOCK" || fail "package-lock.json lacks node_modules/$k — run npm install, not a hand edit"
done
[ ! -e mobile/babel.config.js ]   || fail "mobile/babel.config.js must not exist (babel-preset-expo applies the worklets plugin)"
[ ! -d mobile/src/observability ] || fail "mobile/src/observability must not exist (Sentry is out of 1.6.0)"

# ── 2. App.tsx + RootErrorBoundary literals ────────────────────────────────
echo "[2/6] App.tsx / RootErrorBoundary.tsx guards"
[ -f "$EB" ] || fail "$EB does not exist"
[ -f "$T" ]  || fail "$T does not exist"
[ "$(head -1 "$TSX")" = "import 'react-native-gesture-handler';" ] || fail "App.tsx line 1 must stay the gesture-handler side-effect import"
grep -q "_WORKLET" "$TSX"                                                                  || fail "App.tsx lacks the _WORKLET probe"
grep -q "'worklet';" "$TSX"                                                                || fail "App.tsx probe lacks the 'worklet' directive"
grep -q "__workletHash" "$TSX"                                                             || fail "App.tsx probe must check __workletHash"
grep -q "react-native-worklets babel plugin is not active" "$TSX"                          || fail "App.tsx probe warning text missing"
grep -q "import { GestureHandlerRootView } from 'react-native-gesture-handler';" "$TSX"    || fail "GestureHandlerRootView import missing"
grep -q "<GestureHandlerRootView style={{ flex: 1 }}>" "$TSX"                              || fail "GestureHandlerRootView element missing"
grep -q "import { RootErrorBoundary } from './src/components/RootErrorBoundary';" "$TSX"   || fail "RootErrorBoundary import missing"
grep -q "<RootErrorBoundary>" "$TSX"                                                       || fail "RootErrorBoundary element missing"
grep -q "configureAmplifyOnce();" "$TSX"                                                   || fail "configureAmplifyOnce() call moved"
# order: GestureHandlerRootView opens before RootErrorBoundary, which opens before the appShell View
L_GH=$(grep -n "<GestureHandlerRootView style={{ flex: 1 }}>" "$TSX" | head -1 | cut -d: -f1)
L_EB=$(grep -n "<RootErrorBoundary>" "$TSX" | head -1 | cut -d: -f1)
L_SHELL=$(grep -n "<View style={styles.appShell}>" "$TSX" | head -1 | cut -d: -f1)
[ -n "$L_SHELL" ] || fail "appShell View disappeared from App.tsx"
[ "$L_GH" -lt "$L_EB" ] && [ "$L_EB" -lt "$L_SHELL" ] || fail "wrap order must be GestureHandlerRootView > RootErrorBoundary > appShell View (found $L_GH/$L_EB/$L_SHELL)"
if grep -Eiq "sentry|lottie|expo-av|linking=|CeremonyTuning" "$TSX"; then
  grep -Ein "sentry|lottie|expo-av|linking=|CeremonyTuning" "$TSX" >&2 || true
  fail "App.tsx carries out-of-scope content (Sentry / lottie / expo-av / B15 linking / B13 screen)"
fi
grep -q "export class RootErrorBoundary extends React.Component" "$EB"   || fail "RootErrorBoundary must be an exported class component"
grep -q 'testID="root-error-boundary"' "$EB"                            || fail "root-error-boundary testID missing"
grep -q 'testID="root-error-retry"' "$EB"                               || fail "root-error-retry testID missing"
grep -q "Something went wrong" "$EB"                                    || fail "fallback title missing"
grep -q "Try again" "$EB"                                               || fail "retry label missing"
grep -q "componentDidCatch" "$EB"                                       || fail "componentDidCatch missing"
grep -q "getDerivedStateFromError" "$EB"                                || fail "getDerivedStateFromError missing"
grep -q "console.error('\[recallsmith\] root error boundary'" "$EB"     || fail "console.error tag literal missing"
foreign="$(grep -E "from '" "$EB" | grep -Ev "from '(react|react-native)';" || true)"
[ -z "$foreign" ] || { echo "$foreign" >&2; fail "RootErrorBoundary may import only react and react-native"; }
grep -Eq "shadowRadius" "$EB" && fail "no shadowRadius in RootErrorBoundary"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$TSX" "$EB" "$T" && fail "test gutting / suppression found"

# ── 3. Packages resolvable from mobile/node_modules ────────────────────────
# In the B01 worktree this is the REAL directory npm install materialised (npm 11
# replaces a symlinked node_modules with a private copy — B00 §0); on the shared
# checkout after the driver's post-merge npm install it is the symlink again. The
# check is identical either way and never touches /Users/qc/src/recallsmith.
echo "[3/6] installed packages"
( cd mobile && node -e '
for (const k of ["react-native-reanimated", "react-native-worklets", "expo-audio", "expo-store-review", "expo-sharing", "react-native-view-shot"]) require(k + "/package.json");
const v = require("react-native-reanimated/package.json").version;
if (!/^4\.1\./.test(v)) { console.error("reanimated " + v + " is not 4.1.x"); process.exit(1); }
const w = require("react-native-worklets/package.json").version;
if (!/^0\.5\./.test(w)) { console.error("worklets " + w + " is not 0.5.x"); process.exit(1); }
' ) || fail "new packages are not installed in mobile/node_modules (worker must run npm install — not --package-lock-only — and let it finish)"
[ ! -d mobile/node_modules/lottie-react-native ] || fail "lottie-react-native still on disk — npm install did not prune it"
[ ! -d mobile/node_modules/expo-av ]             || fail "expo-av still on disk — npm install did not prune it"

# ── 4. Typecheck + targeted vitest ─────────────────────────────────────────
echo "[4/6] tsc + vitest (rootErrorBoundary, draw-ceremony, ceremony-copy)"
[ -f "$T" ] || fail "$T does not exist"
IT_COUNT=$(grep -cE "^\s*it\(" "$T" || true)
[ "$IT_COUNT" -ge 4 ] || fail "$T has $IT_COUNT it() blocks, need >= 4"
for s in \
  'renders its children when nothing throws' \
  'catches a render error and shows the retry screen' \
  'retries the children when Try again is pressed' \
  'keeps the fallback when the retry throws again'; do
  grep -Fq "it('$s'" "$T" || fail "missing test case: $s"
done
( cd mobile && npm run test:typecheck ) || fail "typecheck failed"
( cd mobile && npx vitest run \
    tests/unit/rootErrorBoundary.test.tsx \
    tests/integration/draw-ceremony.screen.test.tsx \
    tests/unit/ceremony-copy.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Prebuild: no microphone string, version/build/scheme in the plist ───
echo "[5/6] expo prebuild --no-install --platform ios"
before="$(git status --porcelain -- mobile/package.json mobile/app.json mobile/.gitignore)"
rm -rf mobile/ios
( cd mobile && CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --no-install --platform ios ) || fail "expo prebuild failed"
plist="$(find mobile/ios -maxdepth 2 -name Info.plist | grep -v Tests | head -1 || true)"
[ -n "$plist" ] && [ -f "$plist" ] || fail "generated Info.plist not found under mobile/ios"
if grep -q "NSMicrophoneUsageDescription" "$plist"; then
  fail "Info.plist contains NSMicrophoneUsageDescription (expo-av still linked or expo-audio microphonePermission not false)"
fi
grep -q "<string>1.6.0</string>" "$plist"      || fail "Info.plist lacks CFBundleShortVersionString 1.6.0"
grep -q "<string>16</string>" "$plist"         || fail "Info.plist lacks CFBundleVersion 16"
grep -q "<string>recallsmith</string>" "$plist" || fail "Info.plist lacks the recallsmith URL scheme"
after="$(git status --porcelain -- mobile/package.json mobile/app.json mobile/.gitignore)"
[ "$before" = "$after" ] || { echo "before: $before"; echo "after: $after"; fail "prebuild rewrote package.json/app.json/.gitignore — revert and check the template diff"; }
rm -rf mobile/ios
[ -z "$(git ls-files --others --exclude-standard -- mobile/ios mobile/android)" ] || fail "native folders left untracked"

# ── 6. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[6/6] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules into the
# worktree and the `node_modules/` gitignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/babel.config.js mobile/metro.config.js mobile/eas.json mobile/vitest.config.ts mobile/assets mobile/scripts mobile/docs docs LICENSE-ASSETS; } | sort -u | grep -Ev '^(mobile/package\.json|mobile/package-lock\.json|mobile/app\.json|mobile/App\.tsx|mobile/src/components/RootErrorBoundary\.tsx|mobile/tests/unit/rootErrorBoundary\.test\.tsx|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside B01 scope"; }

echo "B01 VERIFY OK"
