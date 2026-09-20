# B01 — M2 native commit (`native-foundation`)

One commit that forks the OTA runtime: version 1.6.0 / build 16, install `react-native-reanimated` ~4.1.1 + `react-native-worklets` 0.5.1 + `expo-audio` + `expo-store-review` + `expo-sharing` + `react-native-view-shot`, remove `lottie-react-native` + `expo-av`, keep Skia exactly 2.2.12, `app.json` plugin `["expo-audio", { "microphonePermission": false }]` + `scheme` + `supportsTablet: false`, `GestureHandlerRootView` + a root `ErrorBoundary` in `App.tsx`, and the `__DEV__` worklet-plugin probe. **No Sentry, no `src/observability/`, no `babel.config.js`, no `eas.json` edit.**

## Context

`app.json:42-43` sets `runtimeVersion.policy = appVersion`, so every OTA update is keyed on `version`. Wave B changes the native module set (Reanimated 4, worklets, expo-audio, view-shot, sharing, store-review; Lottie and expo-av gone), and an OTA carrying that JS to a 1.5.0 binary would crash at the first `require` of a native module that is not there. The version bump, the dependency install and the removals therefore land in ONE commit (`docs/release-1.6.0-plan-2026-09-19.md:154` row 1, DoD `:179`), before any Wave B code that imports the new packages (B02 is the first: `docs/delivery/r16-issues/B00-contracts.md` §5 "needs the packages to exist for the guard's `require`s to be meaningful").

What the tree looks like today (`delivery/r16-b-ceremony`):

- `mobile/package.json:4` `"version": "1.5.0"`; `:26` `"@shopify/react-native-skia": "2.2.12"` (already exact — stays); `:30` `"expo-av": "~16.0.8"` and `:41` `"lottie-react-native": "~7.3.1"` (both removed); `:44` `"react-native-gesture-handler": "~2.28.0"` (already installed, no root view is mounted); `:61` `"fast-check": "^4.9.0"` (B03 relies on it; untouched); `:64` `"vite": "7.2.4"` (pinned by PR #36 — must survive `npm install` byte-for-byte).
- `mobile/app.json:3` `"jsEngine": "hermes"` (already present — **stays exactly as it is**; do not remove or change it), `:6` `"version": "1.5.0"`, `:17` `"supportsTablet": true`, `:22` `"buildNumber": "15"`, no `scheme`, no `plugins` key at all, no `newArchEnabled` key.
- `mobile/App.tsx:1` `import 'react-native-gesture-handler';` (side-effect import only), `:90` `configureAmplifyOnce();` (top level), `:141` `export default function App()`, `:165` `<View style={styles.appShell}>` is the outermost element of the tree, `:275-276` closes it. Nothing catches a render error today: a throw anywhere in the navigator takes the whole app down to the RN red box / native crash.
- `mobile/src/components/CeremonyLottie.tsx:37` and `mobile/src/components/ceremonyAudio.ts:41` `require()` the two removed packages inside `try {}` — they keep building and testing after the removal (Metro only fails on static requires of missing *files*; vitest's `require` throws `ERR_MODULE_NOT_FOUND` into the catch). B04 rewrites `ceremonyAudio.ts`, B11 deletes `CeremonyLottie.tsx`; B01 does not touch either.
- Expo SDK 54 pins the exact ranges in `mobile/node_modules/expo/bundledNativeModules.json`: `react-native-reanimated ~4.1.1`, `react-native-worklets 0.5.1`, `expo-audio ~1.1.1`, `expo-store-review ~9.0.9`, `expo-sharing ~14.0.8`, `react-native-view-shot 4.0.3` (read them from that file, not from memory).
- The worklets Babel plugin is applied automatically: `mobile/node_modules/babel-preset-expo/build/index.js:284-291` adds `react-native-worklets/plugin` when `react-native-worklets` is installed. There is no `mobile/babel.config.js` today and there must be none after B01 (a second plugin application breaks worklets; B00 §0).
- Microphone string: `expo-av` is in prebuild's legacy auto-plugin list (`mobile/node_modules/expo/node_modules/@expo/cli/node_modules/@expo/prebuild-config/build/plugins/withDefaultPlugins.js:227`) and its plugin writes `NSMicrophoneUsageDescription` unconditionally (`mobile/node_modules/expo-av/plugin/build/withAV.js:5-11`). `expo-audio` is NOT auto-applied, so it must be listed under `plugins`; with `microphonePermission: false` the shared permissions helper deletes the key (`mobile/node_modules/@expo/config-plugins/build/ios/Permissions.js:24-32`). Result: the 1.6.0 Info.plist has no microphone string and the App Store privacy label needs no edit (the scope change of 2026-09-20).
- `expo prebuild` uses the local `mobile/node_modules/expo/template.tgz` (`…/@expo/cli/build/src/prebuild/resolveTemplate.js:98-104`) and leaves `package.json` alone for this project (`…/prebuild/updatePackageJson.js:122-150` `updatePackageJSONAsync` → `:165-244` `updatePkgDependencies`: the template's deps `expo`/`react`/`react-native` are all already present, and the `android`/`ios` scripts it would add exist at `package.json:8-9`), so `npx expo prebuild --no-install --platform ios` needs no network and produces only the gitignored `mobile/ios/` (`mobile/.gitignore` `/ios`).

Sentry is out of 1.6.0 (spec scope change 2026-09-20; B00 §0): the root boundary logs with `console.error` only.

**What `npm install` does to a symlinked `node_modules` (verified 2026-09-20, npm 11.6.0, reproduced with a two-project probe):** your worktree starts with `mobile/node_modules -> /Users/qc/src/recallsmith/mobile/node_modules`. `npm install` does not write through that link — it **deletes the symlink and materialises a private, real `mobile/node_modules` directory inside the worktree** (the whole tree, ~1 GB, 1567 lock entries; even a failed install removes the link). The shared directory is left untouched. So after your install `ls -la mobile/node_modules` shows a plain directory, not `->` — that is the expected outcome, not a defect, and you must not try to "repair" it, re-link it, or run anything inside `/Users/qc/src/recallsmith`. Later issues do not read your worktree: after B01 merges, the driver runs `npm install` once on the shared checkout (`delivery/r16-b-ceremony`) before cutting any B02+ worktree (B00 §0). Budget: the full re-materialisation takes several minutes on this machine — start with change 1 so the install runs while you write the rest.

## Read first

1. `docs/delivery/r16-issues/B00-contracts.md` §0 (non-negotiables), §2.17 (`RootErrorBoundary` + the worklet probe, verbatim), §8 (verify conventions), §9 #7 (eas.json / Sentry out).
2. `mobile/package.json:1-68` (whole file — you edit 9 lines of it).
3. `mobile/app.json:1-49` (whole file).
4. `mobile/App.tsx:1-10` (imports), `:84-100` (top-level init), `:141-165` (component head), `:164-166` and `:274-277` (the shell element you wrap).
5. `mobile/node_modules/expo/bundledNativeModules.json` (the version ranges), `mobile/node_modules/babel-preset-expo/build/index.js:284-291` (why no babel.config.js).
6. `mobile/tests/unit/libraryCardTile.test.tsx:1-25` (the `react-native` mock every component unit test in this repo uses) and `mobile/tests/unit/forceUpdateGate.test.tsx:51-53` (`IS_REACT_ACT_ENVIRONMENT`).
7. `docs/release-1.6.0-plan-2026-09-19.md:154-155` (the M2 row and the `GestureHandlerRootView` row) and `:179` (DoD bullet 1).

## Constraints

- **Scope (the ONLY files that may change):** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/App.tsx`, `mobile/src/components/RootErrorBoundary.tsx` (new), `mobile/tests/unit/rootErrorBoundary.test.tsx` (new). Nothing else — in particular no `mobile/babel.config.js`, no `mobile/eas.json`, no `mobile/src/observability/`, no `mobile/ios/` or `mobile/android/` committed, no `metro.config.js`.
- **Frozen files (gacha-v7 §2.1) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **Dependencies — this is the ONE issue allowed to change them.** Add exactly: `react-native-reanimated`, `react-native-worklets`, `expo-audio`, `expo-store-review`, `expo-sharing`, `react-native-view-shot`, each at the range printed by `mobile/node_modules/expo/bundledNativeModules.json`. Remove exactly: `lottie-react-native`, `expo-av`. Do not add `@sentry/*`, `sentry-expo`, `@sentry/react-native`, or any devDependency. `"@shopify/react-native-skia": "2.2.12"` stays exact (no `^`, no `~`). `"vite": "7.2.4"` stays exact. Run `npm install` (NOT `npm ci`, NOT `npm install --package-lock-only`). Expect the outcome described in Context: the `mobile/node_modules` symlink is replaced by a real, private directory in your worktree (`ls -la mobile/node_modules` shows a directory, no `->`). That is correct — verify step 3 resolves the six packages from it. Do not touch, re-link, or run npm in the shared checkout `/Users/qc/src/recallsmith`; the driver re-installs there after your merge. If `npm install` fails part-way (network), rerun it — a half-materialised directory is not recoverable by hand.
- **No `babel.config.js`.** If any tool tells you to create one, do not. (B00 §0: if prebuild ever demanded one it would be `{ presets: ['babel-preset-expo'] }` and nothing else — it does not demand one on this tree.)
- **`App.tsx` diff is additive and small:** two imports, the `__DEV__` probe block after `configureAmplifyOnce();` (`:90`), and the wrap of the shell element. Do not reorder the `Stack.Screen` list, do not touch `ForceUpdateOverlay`, do not add `linking` (B15) or a `CeremonyTuning` screen (B13).
- **testIDs:** `root-error-boundary` (the fallback root `View`), `root-error-retry` (the retry `Pressable`). Copy: `Something went wrong`, `Try again`.
- **Banned literals in any new/changed line:** `humanizer`, `bypass`, `undetect`, `detector`, `evade`, `Gemini said` (driver gate). No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`.
- **Existing tests:** no existing test file changes. The full suite (`npx vitest run`) must stay green after the package removal — it does today because both removed packages are only reached through guarded `require`s (see Context).

## Changes required

1. **`mobile/package.json`** — edit by hand, then install.
   a. `:4` `"version": "1.5.0"` → `"version": "1.6.0"`.
   b. In `dependencies` (keep alphabetical order), delete `"expo-av": "~16.0.8",` (`:30`) and `"lottie-react-native": "~7.3.1",` (`:41`); add, with the ranges from `mobile/node_modules/expo/bundledNativeModules.json` (today: `"expo-audio": "~1.1.1"`, `"expo-sharing": "~14.0.8"`, `"expo-store-review": "~9.0.9"`, `"react-native-reanimated": "~4.1.1"`, `"react-native-view-shot": "4.0.3"`, `"react-native-worklets": "0.5.1"`). If the JSON file prints a different range for one of them, the JSON file wins — copy it verbatim.
   c. Leave every other line byte-identical, including `"@shopify/react-native-skia": "2.2.12"` (`:26`) and `"vite": "7.2.4"` (`:64`).
   d. `cd mobile && npm install` (allow it to finish — it rebuilds the whole `node_modules` tree in your worktree, see Context; this is the only step of the issue that may take minutes). Then `npm ls react-native-reanimated react-native-worklets expo-audio expo-store-review expo-sharing react-native-view-shot` must list all six, and `npm ls lottie-react-native expo-av` must print `(empty)`. `package-lock.json` is regenerated by that command — do not hand-edit it. Check `git diff mobile/package.json` shows exactly the nine lines above (1 version + 2 removed + 6 added), and `git status --porcelain mobile` shows no `mobile/node_modules` entry (it is gitignored as a directory; only the symlink form was ever visible as untracked).
   e. Do NOT run `npx expo install --fix`, `npx expo-doctor`, `eas …`, or `npx expo prebuild` with install (all need the network or would rewrite files outside scope). `npx expo install --check` is allowed as a read-only sanity check if it works offline; ignore it if it wants the network.

2. **`mobile/app.json`**
   a. `:6` `"version": "1.5.0"` → `"1.6.0"`.
   b. `:17` `"supportsTablet": true` → `false`.
   c. `:22` `"buildNumber": "15"` → `"16"`.
   d. Add `"scheme": "recallsmith",` directly after the `"slug": "recallsmith",` line (`:5`). (B15's `navigation/linking.ts` uses `recallsmith://`; B00 §2.15.)
   e. Add, as a sibling of `"ios"` / `"android"` inside `expo` (place it after `"userInterfaceStyle": "light",` at `:9`):
      ```json
      "plugins": [
        ["expo-audio", { "microphonePermission": false }]
      ],
      ```
      Exactly this shape — a two-element tuple, the boolean `false` (not the string `"false"`), no other plugin. `expo-store-review`, `expo-sharing`, `react-native-view-shot`, `react-native-reanimated` and `react-native-worklets` need no plugin entry (Expo autolinking + `babel-preset-expo`).
   f. Nothing else: `"jsEngine": "hermes"` (`:3`) stays byte-identical, `runtimeVersion.policy` stays `appVersion`, `updates.url` stays, `newArchEnabled` is not added (SDK 54 defaults to the New Architecture, which Reanimated 4 requires — adding `false` would break it, adding `true` is a no-op), `android` block unchanged.

3. **`mobile/src/components/RootErrorBoundary.tsx` (new)** — a class component, React + `react-native` imports only (no navigation, no theme module, no async storage: the boundary must render when everything else is broken). Signature and fallback per B00 §2.17:
   ```tsx
   import React from 'react';
   import { Pressable, StyleSheet, Text, View } from 'react-native';

   type Props = { children: React.ReactNode };
   type State = { error: Error | null };

   /**
    * Last line of defence above the navigator. Renders a retry screen instead of
    * letting a render error take the whole app down. Logs with console.error only:
    * 1.6.0 ships no crash reporter (no Sentry — see B00 §0), so the log line is what
    * a dev-client / TestFlight console shows.
    */
   export class RootErrorBoundary extends React.Component<Props, State> {
     state: State = { error: null };

     static getDerivedStateFromError(error: Error): State {
       return { error };
     }

     componentDidCatch(error: Error, info: React.ErrorInfo): void {
       console.error('[recallsmith] root error boundary', error, info.componentStack ?? '');
     }

     private reset = () => {
       this.setState({ error: null });
     };

     render() {
       if (this.state.error) {
         return (
           <View testID="root-error-boundary" style={styles.root}>
             <Text style={styles.title}>Something went wrong</Text>
             <Pressable testID="root-error-retry" accessibilityRole="button" onPress={this.reset} style={styles.button}>
               <Text style={styles.buttonText}>Try again</Text>
             </Pressable>
           </View>
         );
       }
       return this.props.children;
     }
   }

   export default RootErrorBoundary;
   ```
   Styles: a centred full-screen `root` (`flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F5F3FF'` — the same shell colour as `App.tsx:280`), `title` (`fontSize: 18, fontWeight: '800', color: '#111827'`), `button` (`marginTop: 16, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24, backgroundColor: '#4F46E5'`), `buttonText` (`color: '#fff', fontWeight: '800'`). Plain literals, not `src/theme` imports (see the first sentence). No `shadowRadius`. The `console.error` first argument is the exact string `'[recallsmith] root error boundary'` (the unit test and verify.sh grep it).

4. **`mobile/App.tsx`**
   a. Imports: keep `:1` `import 'react-native-gesture-handler';` as the first line. Add, next to it (line 2 or after the other `react-native-*` imports at `:5`): `import { GestureHandlerRootView } from 'react-native-gesture-handler';`. Add `import { RootErrorBoundary } from './src/components/RootErrorBoundary';` after the `BottomTabBar` import (`:12`).
   b. Worklet-plugin probe, inserted at top level directly after `configureAmplifyOnce();` (`:90`) and before `Notifications.setNotificationHandler(` (`:92`), verbatim from B00 §2.17:
      ```ts
      if (__DEV__) {
        // Reanimated 4 needs react-native-worklets/plugin (applied by babel-preset-expo when the package is
        // installed). `_WORKLET` is only true on the UI runtime; on the JS runtime a workletized function
        // carries `__workletHash`. No hash = the plugin did not run and ceremony motion will fall back.
        const workletProbe = () => {
          'worklet';
          return (globalThis as { _WORKLET?: boolean })._WORKLET === true;
        };
        if (typeof (workletProbe as unknown as { __workletHash?: number }).__workletHash !== 'number') {
          console.warn('[recallsmith] react-native-worklets babel plugin is not active');
        }
      }
      ```
      The literal `_WORKLET` and the `'worklet';` directive must both be present (verify greps). Do not turn the warning into a throw.
   c. Wrap the shell: `:165` `<View style={styles.appShell}>` becomes
      ```tsx
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RootErrorBoundary>
          <View style={styles.appShell}>
      ```
      and the matching close (`:275` `</View>` before `);`) becomes `</View></RootErrorBoundary></GestureHandlerRootView>` (one element per line, indented). `GestureHandlerRootView` is the outermost element (the tear Pan and the tilt Pan in B06/B08 need it on Android — `release-1.6.0-plan:155`); the boundary sits inside it so the retry screen still receives touches. `ForceUpdateOverlay` (`:274`) and the tab bar stay where they are, inside `appShell`.
   d. No other change. In particular the `styles` block (`:279-322`) is untouched (`updateCard.shadowRadius: 16` at `:307` is outside the gacha tree — B11's rule does not apply here).

5. **`mobile/tests/unit/rootErrorBoundary.test.tsx` (new)** — `react-test-renderer` + the `react-native` mock of `libraryCardTile.test.tsx:5-18` (View/Text/Pressable/StyleSheet; `Pressable` forwards `onPress`). Set `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true` in `beforeEach`; `vi.spyOn(console, 'error').mockImplementation(() => {})` in `beforeEach` and `mockRestore()` in `afterEach` (React itself also logs caught errors through `console.error`, so assert on *our* call by its first argument, never on call count). A `Bomb` component reads a module-level `let shouldThrow = true` and either throws `new Error('boom')` or renders `<Text testID="child-ok">ok</Text>`. Cases, each its own `it`, titles verbatim:
   1. `it('renders its children when nothing throws', …)` — `shouldThrow = false`; `child-ok` present, `findAllByProps({ testID: 'root-error-boundary' })` empty.
   2. `it('catches a render error and shows the retry screen', …)` — `shouldThrow = true`; `renderer.create(<RootErrorBoundary><Bomb /></RootErrorBoundary>)` inside `act` does not throw; `root-error-boundary` present; the text `Something went wrong` is in the tree; `console.error` was called with `'[recallsmith] root error boundary'` as the first argument and an `Error` whose `message` is `'boom'` as the second (`expect(spy).toHaveBeenCalledWith('[recallsmith] root error boundary', expect.objectContaining({ message: 'boom' }), expect.any(String))`); `child-ok` absent.
   3. `it('retries the children when Try again is pressed', …)` — mount with `shouldThrow = true`, then `shouldThrow = false`, `act(() => tree.root.findByProps({ testID: 'root-error-retry' }).props.onPress())`; afterwards `child-ok` present and `root-error-boundary` absent.
   4. `it('keeps the fallback when the retry throws again', …)` — mount throwing, press retry with `shouldThrow` still `true`; `root-error-boundary` still present and the tree did not throw; `console.error` called at least twice with our first argument.

Estimated size: package.json 9 lines, app.json 8 lines, App.tsx ~25 lines, RootErrorBoundary ~60 lines, test ~90 lines, plus the regenerated lock file.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/B01.verify.sh` re-runs exactly these (steps 1–5) and then removes `mobile/ios`.

1. Manifest guards (exit 0):
   `node -e "const a=require('./mobile/app.json').expo,p=require('./mobile/package.json');const ok=a.version==='1.6.0'&&a.jsEngine==='hermes'&&a.ios.buildNumber==='16'&&a.ios.supportsTablet===false&&a.scheme==='recallsmith'&&JSON.stringify(a.plugins)===JSON.stringify([['expo-audio',{microphonePermission:false}]])&&p.version==='1.6.0'&&p.dependencies['@shopify/react-native-skia']==='2.2.12'&&p.devDependencies.vite==='7.2.4'&&!p.dependencies['lottie-react-native']&&!p.dependencies['expo-av']&&['react-native-reanimated','react-native-worklets','expo-audio','expo-store-review','expo-sharing','react-native-view-shot'].every(k=>typeof p.dependencies[k]==='string')&&!JSON.stringify(p).includes('@sentry');process.exit(ok?0:1)"` · `! grep -Eq '"node_modules/(lottie-react-native|expo-av|@sentry/[a-z-]+)"' mobile/package-lock.json` · `grep -q '"node_modules/react-native-reanimated"' mobile/package-lock.json && grep -q '"node_modules/react-native-worklets"' mobile/package-lock.json && grep -q '"node_modules/expo-audio"' mobile/package-lock.json` · `[ ! -e mobile/babel.config.js ] && [ ! -d mobile/src/observability ]`.
2. Source guards (exit 0): `f=mobile/App.tsx; grep -q "_WORKLET" "$f" && grep -q "'worklet';" "$f" && grep -q "import { GestureHandlerRootView } from 'react-native-gesture-handler';" "$f" && grep -q "<GestureHandlerRootView style={{ flex: 1 }}>" "$f" && grep -q "import { RootErrorBoundary } from './src/components/RootErrorBoundary';" "$f" && grep -q "<RootErrorBoundary>" "$f" && [ "$(head -1 "$f")" = "import 'react-native-gesture-handler';" ] && ! grep -Eiq "sentry|lottie|expo-av" "$f"` and `b=mobile/src/components/RootErrorBoundary.tsx; grep -q "export class RootErrorBoundary extends React.Component" "$b" && grep -q 'testID="root-error-boundary"' "$b" && grep -q 'testID="root-error-retry"' "$b" && grep -q "Something went wrong" "$b" && grep -q "Try again" "$b" && grep -q "componentDidCatch" "$b" && grep -q "console.error('\[recallsmith\] root error boundary'" "$b" && [ -z "$(grep -E "from '" "$b" | grep -Ev "from '(react|react-native)';" || true)" ]` (only `react` and `react-native` imports — every `from '…'` line must be one of those two).
3. Installed in the worktree's `mobile/node_modules` (a real directory after your `npm install`; on the driver's re-installed shared tree it is the symlink again — the check is the same) (exit 0): `cd mobile && node -e "for (const k of ['react-native-reanimated','react-native-worklets','expo-audio','expo-store-review','expo-sharing','react-native-view-shot']) require(k + '/package.json'); process.exit(/^4\.1\./.test(require('react-native-reanimated/package.json').version) ? 0 : 1)"` and `[ ! -d mobile/node_modules/lottie-react-native ] && [ ! -d mobile/node_modules/expo-av ]`.
4. `cd mobile && npm run test:typecheck && npx vitest run tests/unit/rootErrorBoundary.test.tsx tests/integration/draw-ceremony.screen.test.tsx tests/unit/ceremony-copy.test.ts --reporter=dot` — exit 0; the new test file has 4 `it(` blocks. (The draw-ceremony integration test exercises the guarded `lottie-react-native` / `expo-av` requires after the removal.)
5. Prebuild (exit 0, then cleanup): `cd mobile && CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --no-install --platform ios`; then `plist=$(find mobile/ios -maxdepth 2 -name Info.plist | grep -v Tests | head -1)`; `! grep -q NSMicrophoneUsageDescription "$plist"`; `grep -q "<string>1.6.0</string>" "$plist"`; `grep -q "<string>16</string>" "$plist"`; `grep -q "<string>recallsmith</string>" "$plist"`; `git status --porcelain -- mobile/package.json mobile/app.json mobile/.gitignore` shows no change caused by prebuild (compare against a snapshot taken before the command); finally `rm -rf mobile/ios`.
6. Scope + frozen guard (exit 0): `mb=$(git merge-base HEAD delivery/r16-b-ceremony); [ -z "$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts)" ] && [ -z "$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- mobile/src mobile/tests mobile/App.tsx mobile/app.json mobile/package.json mobile/package-lock.json mobile/babel.config.js mobile/eas.json mobile/vitest.config.ts; } | grep -Ev '^(mobile/package\.json|mobile/package-lock\.json|mobile/app\.json|mobile/App\.tsx|mobile/src/components/RootErrorBoundary\.tsx|mobile/tests/unit/rootErrorBoundary\.test\.tsx|docs/delivery/r16-issues/.*)$' )"]`.

## Do NOT

- Do NOT install `@sentry/react-native`, `sentry-expo`, or any crash reporter; do NOT create `mobile/src/observability/`; do NOT edit the privacy-related keys of `app.json` (`infoPlist` stays exactly `{ "ITSAppUsesNonExemptEncryption": false }`).
- Do NOT create `mobile/babel.config.js`, `mobile/metro.config.js`, or edit `mobile/eas.json` (the owner edits it at build time — B00 §9 #7).
- Do NOT commit `mobile/ios/` or `mobile/android/`; delete `mobile/ios` after the prebuild check.
- Do NOT run `npm ci` (it deletes and rebuilds `node_modules` strictly from the lock file, so it cannot add the six new packages to the lock — the lock is what `npm install` regenerates), `npm install --package-lock-only` (verify step 3 needs the packages *on disk*), `npm update`, `eas …`, `npx expo install --fix`, `npx expo prebuild` without `--no-install`, or anything that hits the network beyond `npm install` itself. Do NOT run npm, `ln`, `rm` or git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.
- Do NOT change the `vite` pin, the Skia pin, or any version range other than the eight listed; do NOT bump `react`, `react-native`, `expo`.
- Do NOT add or change `newArchEnabled` / `jsEngine` (`"jsEngine": "hermes"` already exists at `app.json:3` and stays), do NOT add `plugins` entries for the other new packages, or an Android `versionCode`.
- Do NOT touch `CeremonyLottie.tsx`, `ceremonyAudio.ts`, `HolographicLayer.tsx`, `DrawCeremonyScreen.tsx` (B04/B08/B09/B11 own them) even though they mention the removed packages in comments.
- Do NOT edit any existing test; do NOT loosen `tsconfig.json`.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy / EAS command, no test gutting (no `.skip`, no `@ts-ignore`, no `eslint-disable`).
